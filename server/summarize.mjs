// 详情中文摘要：用通用对话模型（默认智谱 GLM-4-Flash，免费）理解英文原文后输出中文要点总结，
// 替代原来的逐段硬翻译。OpenAI 兼容协议，Node 直连，不经 Python 子进程。
// 未配置 SUMMARY_API_KEY 或调用失败时返回 null，由调用方回退到 Qwen-MT 全量翻译。

export const SUMMARY_PROVIDER_LABEL = "GLM-4-Flash 中文摘要";

function summaryConfig() {
  return {
    apiKey: process.env.SUMMARY_API_KEY || "",
    model: process.env.SUMMARY_MODEL || "glm-4-flash",
    url: process.env.SUMMARY_API_URL || "https://open.bigmodel.cn/api/paas/v4/chat/completions",
  };
}

export function summaryEnabled() {
  return Boolean(summaryConfig().apiKey);
}

// 从模型输出中提取 JSON 对象（容忍 ```json 围栏、前后杂文本、全角标点）
function extractJson(text) {
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) return null;
  const raw = match[0];
  try {
    return JSON.parse(raw);
  } catch {
    // 模型偶尔输出全角标点（，“”：）充当 JSON 结构符，做定点修复后重试：
    // 只替换紧邻结构符的全角符号，不动中文字符串内容里的标点
    const fixed = raw
      .replace(/([\]}"”0-9A-Za-z一-鿿])\s*，\s*(?=[\[{"“0-9])/g, "$1,") // 字段间全角逗号
      .replace(/([{[,])\s*[“”]/g, '$1"') // 结构符后的全角引号
      .replace(/[“”]\s*(?=[}\],])/g, '"') // 结构符前的全角引号
      .replace(/"\s*：\s*(?=[\[{"“0-9tfn-])/g, '":'); // 键名后全角冒号
    try {
      return JSON.parse(fixed);
    } catch {
      return null;
    }
  }
}

// 调一次对话模型，把正文/README 理解后总结为 { titleZh, points[] }
// kind: "article" | "readme"；text 已在外部截断
async function summarize(kind, title, text) {
  const { apiKey, model, url } = summaryConfig();
  const label = kind === "readme" ? "GitHub 仓库 README" : "英文新闻文章";
  const response = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: 4096,
      messages: [
        {
          role: "system",
          content:
            "你是资深中文科技资讯主编，母语级中文写作者。读懂用户给你的英文原文后，用中文重写出详细完整的要点报道（不是逐句翻译）。" +
            '只返回 JSON：{"title_zh":"中文标题","points":["要点1","要点2",...]}。' +
            "JSON 的结构符号（引号、逗号、冒号、括号）必须是半角英文标点，禁止使用全角符号；" +
            "写作要求：" +
            "1. 8~12 个要点，按信息重要性排序，覆盖原文全部关键事实：事件始末、数据、人物、背景、因果、引述、结论与影响；" +
            "2. 每个要点是 1~3 句完整陈述（30~80 字），信息量饱满，让读者不读原文也能完整了解这条新闻；" +
            "3. 全部要点合计 800~1500 字；原文信息量本身很少时按实际信息量总结，不要硬凑；" +
            "4. 用地道自然的中文表达重新组织语言，严禁翻译腔（如“的”字堆叠、生硬直译、欧式长句），专有名词保留英文原文；" +
            "5. 严禁使用省略号（……或...），每句话必须说完整；原文末尾被截断时，只总结已有信息，不得用省略号暗示还有下文；" +
            "6. 不输出空泛套话（如“值得关注”“引发热议”这类没有信息量的句子）；" +
            "不要输出 JSON 以外的任何内容。",
        },
        {
          role: "user",
          content: `以下是一篇${label}，标题：${title}\n\n正文：\n${text}`,
        },
      ],
    }),
  });
  if (!response.ok) {
    // GLM 的错误详情在响应体里（如 1301 内容安全拦截、参数错误），必须打出来才能排查
    const body = await response.text().catch(() => "");
    throw new Error(`摘要模型返回 ${response.status}: ${body.slice(0, 300)}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content || "";
  const parsed = extractJson(content);
  if (!parsed || !Array.isArray(parsed.points) || parsed.points.length === 0) {
    console.error(`[summarize] 模型原始输出（前 200 字）: ${content.slice(0, 200)}`);
    throw new Error("摘要模型未返回有效 JSON");
  }
  const points = parsed.points.map((p) => String(p).trim()).filter(Boolean).slice(0, 14);
  if (points.length === 0) throw new Error("摘要模型未返回有效要点");
  return {
    titleZh: String(parsed.title_zh || "").trim() || title,
    points,
  };
}

// 超长文本截断：尽量在段落/换行边界切断，避免把半句话喂给模型
function truncateAtBoundary(text, limit) {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const boundary = Math.max(cut.lastIndexOf("\n\n"), cut.lastIndexOf("\n"));
  return boundary > limit * 0.8 ? cut.slice(0, boundary) : cut;
}

// 文章详情 → 中文摘要。返回可直接 saveArticleDetail 的字段，失败返回 null。
export async function summarizeArticle(article) {
  if (!summaryEnabled()) return null;
  const text = truncateAtBoundary((article.paragraphs || []).join("\n\n"), 12000);
  if (!text) return null;
  try {
    const { titleZh, points } = await summarize("article", article.title || "", text);
    return {
      title: titleZh,
      paragraphs: points,
      language: "zh-CN",
      translationProvider: SUMMARY_PROVIDER_LABEL,
    };
  } catch (error) {
    console.error(`[summarize] 文章摘要失败 (${article.url || article.title}): ${error.message}`);
    return null;
  }
}

// README → 中文摘要。blocks 中的代码块跳过，其余拼接为原文。失败返回 null。
export async function summarizeReadme(readme) {
  if (!summaryEnabled()) return null;
  const text = truncateAtBoundary(
    (readme.blocks || [])
      .filter((b) => b.type !== "code")
      .map((b) => b.text)
      .join("\n"),
    12000,
  );
  if (!text) return null;
  try {
    const { titleZh, points } = await summarize("readme", readme.title || "", text);
    return {
      title: titleZh,
      blocks: points.map((point) => ({ type: "paragraph", text: point })),
      language: "zh-CN",
      translationProvider: SUMMARY_PROVIDER_LABEL,
    };
  } catch (error) {
    console.error(`[summarize] README 摘要失败 (${readme.url || readme.title}): ${error.message}`);
    return null;
  }
}
