// 抓取引擎：RSS/Atom 解析、Scrapling 子进程管理、中文化翻译、SSRF 防护。
// 不含缓存或数据库逻辑——纯抓取，结果交给 scheduler 写入 DB。
import { XMLParser } from "fast-xml-parser";
import { spawn } from "node:child_process";
import dns from "node:dns/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NEWS_SOURCES, ITEMS_PER_CATEGORY, GITHUB_LIMIT } from "./sources.mjs";

// 加载 .env（翻译 API Key 等）
try {
  process.loadEnvFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".env"));
} catch {
  // .env 不存在时忽略
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
});

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(serverDir, "..");
const scraplingPython = process.env.SCRAPLING_PYTHON || path.join(projectDir, ".venv", "bin", "python");
const scraplingScript = path.join(projectDir, "scripts", "scrape_live.py");

// 串行队列：同一时刻只跑一个 Scrapling 子进程
let scraplingQueue = Promise.resolve();

// ============ Scrapling 子进程管理 ============

function executeScrapling(mode, payload = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(scraplingPython, [scraplingScript, mode], {
      cwd: projectDir,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGTERM"), 150_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 12_000_000) child.kill("SIGTERM");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Scrapling 进程退出：${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`Scrapling 返回了无法解析的数据：${stdout.slice(0, 180)}`));
      }
    });
    // 子进程启动即崩（如 import 失败）时 stdin 会触发 EPIPE；吞掉它，错误统一由 close 事件上报
    child.stdin.on("error", () => undefined);
    child.stdin.end(JSON.stringify(payload));
  });
}

export function runScrapling(mode, payload = {}) {
  const task = scraplingQueue.then(
    () => executeScrapling(mode, payload),
    () => executeScrapling(mode, payload),
  );
  scraplingQueue = task.catch(() => undefined);
  return task;
}

// ============ SSRF 防护（从原 feedApi.mjs 迁移） ============

const ipv4BlockList = new net.BlockList();
ipv4BlockList.addSubnet("0.0.0.0", 8, "ipv4");
ipv4BlockList.addSubnet("10.0.0.0", 8, "ipv4");
ipv4BlockList.addSubnet("100.64.0.0", 10, "ipv4");
ipv4BlockList.addSubnet("127.0.0.0", 8, "ipv4");
ipv4BlockList.addSubnet("169.254.0.0", 16, "ipv4");
ipv4BlockList.addSubnet("172.16.0.0", 12, "ipv4");
ipv4BlockList.addSubnet("192.168.0.0", 16, "ipv4");
ipv4BlockList.addSubnet("198.18.0.0", 15, "ipv4");
ipv4BlockList.addSubnet("224.0.0.0", 4, "ipv4");
ipv4BlockList.addSubnet("240.0.0.0", 4, "ipv4");
const ipv6BlockList = new net.BlockList();
ipv6BlockList.addAddress("::", "ipv6");
ipv6BlockList.addAddress("::1", "ipv6");
ipv6BlockList.addSubnet("fc00::", 7, "ipv6");
ipv6BlockList.addSubnet("fe80::", 10, "ipv6");
ipv6BlockList.addSubnet("ff00::", 8, "ipv6");

function ssrfError(message) {
  const error = new Error(message);
  error.code = "SSRF_BLOCKED";
  return error;
}

export function isPrivateAddress(address) {
  const text = String(address).toLowerCase();
  const mapped = text.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  const mappedHex = text.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = Number.parseInt(mappedHex[1], 16);
    const lo = Number.parseInt(mappedHex[2], 16);
    return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (net.isIPv4(text)) return ipv4BlockList.check(text, "ipv4");
  if (net.isIPv6(text)) return ipv6BlockList.check(text, "ipv6");
  return true;
}

export async function safeRemoteUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw ssrfError("无效的地址");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw ssrfError("仅支持公开 HTTP(S) 来源");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw ssrfError("不允许访问本地或私有网络地址");
  }
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw ssrfError("不允许访问本地或私有网络地址");
    return url;
  }
  const records = await dns.lookup(host, { all: true, verbatim: true });
  if (!records.length || records.some((record) => isPrivateAddress(record.address))) {
    throw ssrfError("目标域名解析到本地或私有网络地址");
  }
  return url;
}

// ============ HTTP 抓取工具 ============

async function fetchWithRedirectGuard(url, options = {}, maxRedirects = 5) {
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    current = (await safeRemoteUrl(current)).toString();
    const response = await fetch(current, { ...options, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    response.body?.cancel()?.catch(() => undefined);
    if (!location) return response;
    current = new URL(location, current).toString();
  }
  throw new Error("重定向次数过多");
}

async function readBodyWithLimit(response, maxBytes, label) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) throw new Error(`${label}大小超过 ${Math.round(maxBytes / 1_000_000)}MB 限制`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const HOST_MAX_CONCURRENCY = 4;
const hostActive = new Map();
const hostWaiters = new Map();
async function withHostLimit(url, task) {
  const host = new URL(url).hostname;
  while ((hostActive.get(host) || 0) >= HOST_MAX_CONCURRENCY) {
    await new Promise((resolve) => {
      const queue = hostWaiters.get(host) || [];
      queue.push(resolve);
      hostWaiters.set(host, queue);
    });
  }
  hostActive.set(host, (hostActive.get(host) || 0) + 1);
  try {
    return await task();
  } finally {
    hostActive.set(host, Math.max(0, (hostActive.get(host) || 1) - 1));
    const queue = hostWaiters.get(host);
    if (queue?.length) queue.shift()();
  }
}

export async function fetchText(url, { timeout = 12000, github = false } = {}) {
  const signal = AbortSignal.timeout(timeout);
  return withHostLimit(url, async () => {
    const response = await fetchWithRedirectGuard(url, {
      signal,
      headers: {
        "user-agent": github
          ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
          : "MeridianLiveEdition/1.0 (+https://meridian.local; editorial reader)",
        accept: github
          ? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
          : "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.5",
        "accept-language": github ? "en-US,en;q=0.9" : "zh-CN,zh;q=0.9,en;q=0.7",
      },
    });
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    const body = await readBodyWithLimit(response, 6_000_000, "页面");
    return body.toString("utf-8");
  });
}

export { fetchWithRedirectGuard, readBodyWithLimit, withHostLimit };

// ============ RSS 解析 ============

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function cleanText(value = "") {
  if (value && typeof value === "object") {
    const preferred = value["#text"] || value["__cdata"] || value["@_value"];
    if (preferred) return cleanText(preferred);
    const firstText = Object.values(value).find((candidate) => typeof candidate === "string");
    return firstText ? cleanText(firstText) : "";
  }
  return String(value)
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function shortText(value, length = 118) {
  const text = cleanText(value);
  return text.length > length ? `${text.slice(0, length).trim()}…` : text;
}

function firstUrl(...values) {
  for (const value of values.flat(Infinity)) {
    if (typeof value === "string" && /^https?:\/\//.test(value)) return value;
    if (value && typeof value === "object" && typeof value["@_url"] === "string") return value["@_url"];
    if (value && typeof value === "object" && typeof value["@_href"] === "string") return value["@_href"];
  }
  return "";
}

function normalizeLink(link) {
  if (typeof link === "string") return link;
  if (Array.isArray(link)) return normalizeLink(link.find((entry) => entry?.["@_rel"] !== "replies") || link[0]);
  return link?.["@_href"] || link?.href || "";
}

function dateValue(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function editorialLens(category) {
  if (category === "编程" || category === "工具推荐") return "工具推荐";
  if (category === "商业") return "行业趋势";
  return "重要新闻";
}

function extractFeedItems(xml, source) {
  const root = parser.parse(xml);
  const channel = root?.rss?.channel;
  const rssItems = asArray(channel?.item);
  const atomItems = asArray(root?.feed?.entry);
  return [...rssItems, ...atomItems]
    .map((entry, index) => {
      const title = cleanText(entry.title || entry["media:title"] || "");
      const description = entry.description || entry.summary || entry.content || "";
      const contentEncoded = entry["content:encoded"] || entry.content?.["__cdata"] || "";
      const link = normalizeLink(entry.link) || entry.guid || entry.id || "";
      const image = firstUrl(
        entry["media:content"],
        entry["media:thumbnail"],
        entry.enclosure,
        entry["media:group"]?.["media:content"],
      );
      const publishedAt = entry.pubDate || entry.published || entry.updated || new Date(Date.now() - index * 3600_000).toISOString();
      if (!title || !link) return null;
      // 捕获 RSS 完整正文 HTML（用于快速文章详情提取，避免启动 Chrome）
      const contentHtml = contentEncoded || description;
      return {
        id: `${source.name}-${link}`.replace(/[^a-zA-Z0-9]+/g, "-").slice(-96),
        title,
        summary: shortText(description || title),
        source: source.name,
        sourceUrl: source.url,
        url: link,
        image,
        publishedAt,
        category: source.categoryId,
        lens: editorialLens(source.categoryId),
        contentHtml: typeof contentHtml === "string" && contentHtml.length > 400 ? contentHtml : "",
      };
    })
    .filter(Boolean);
}

async function extractOgImage(url) {
  try {
    const html = await fetchText(url);
    const imageMatch = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/i);
    return imageMatch?.[1]?.replace(/&amp;/g, "&") || "";
  } catch {
    return "";
  }
}

// ============ 翻译 ============

async function translateNewsToChinese(items) {
  const result = await runScrapling("translate", { items });
  if (!Array.isArray(result.items) || result.items.length !== items.length || result.language !== "zh-CN") {
    throw new Error("Scrapling 中文翻译结果不完整");
  }
  return result;
}

// 按来源多样化取样
function diversifiedItems(items, limit) {
  const buckets = new Map();
  for (const item of items) {
    const sourceItems = buckets.get(item.source) || [];
    sourceItems.push(item);
    buckets.set(item.source, sourceItems);
  }
  for (const bucket of buckets.values()) bucket.sort((a, b) => dateValue(b.publishedAt) - dateValue(a.publishedAt));
  const selected = [];
  const sourceNames = [...buckets.keys()];
  while (selected.length < limit) {
    let added = false;
    for (const source of sourceNames) {
      const next = buckets.get(source)?.shift();
      if (next && selected.length < limit) {
        selected.push(next);
        added = true;
      }
    }
    if (!added) break;
  }
  return selected;
}

// ============ 高层抓取函数 ============

// 抓取所有分类的新闻：返回 { "商业": [...], "科技产品": [...], ... }
export async function scrapeAllNews() {
  // 并行抓取所有源
  const results = await Promise.allSettled(
    NEWS_SOURCES.map(async (source) => {
      const xml = await fetchText(source.url);
      return extractFeedItems(xml, source);
    }),
  );

  // 按分类收集
  const byCategory = {};
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const item of result.value) {
      if (!byCategory[item.category]) byCategory[item.category] = [];
      byCategory[item.category].push(item);
    }
  }

  // 每个分类：去重 → 多样化取样 15 条 → 补封面图
  const output = {};
  for (const category of Object.keys(byCategory)) {
    const items = byCategory[category];
    // 按 URL 去重
    const unique = new Map();
    for (const item of items.sort((a, b) => dateValue(b.publishedAt) - dateValue(a.publishedAt))) {
      const key = item.url.replace(/[?#].*$/, "");
      if (!unique.has(key)) unique.set(key, item);
    }
    const selected = diversifiedItems([...unique.values()], ITEMS_PER_CATEGORY);
    output[category] = selected;
  }

  // 批量翻译每个分类
  for (const category of Object.keys(output)) {
    if (output[category].length === 0) continue;
    // 补封面图
    output[category] = await Promise.all(
      output[category].map(async (item) => ({
        ...item,
        image: item.image || await extractOgImage(item.url),
      })),
    );
    try {
      const localized = await translateNewsToChinese(output[category]);
      output[category] = localized.items;
    } catch (error) {
      console.error(`[scraper] 分类「${category}」(${output[category].length} 条) 列表翻译失败: ${error.message}，保留原文`);
    }
  }

  return output;
}

// 抓取 GitHub Trending（日榜）
export async function scrapeGithub() {
  const result = await runScrapling("github");
  return result;
}

// 抓取单篇文章详情
export async function scrapeArticleDetail(url) {
  const article = await runScrapling("article", { url });
  if (!Array.isArray(article.paragraphs) || article.paragraphs.length < 2) {
    throw new Error("Scrapling 未返回完整的正文");
  }
  return article;
}

// 抓取仓库 README
export async function scrapeReadmeDetail(url) {
  const normalized = url.replace(/\/+$/, "");
  const readme = await runScrapling("readme", { url: normalized });
  if (!Array.isArray(readme.blocks) || readme.blocks.length === 0) {
    throw new Error("Scrapling 未返回完整的 README");
  }
  return readme;
}

// ============ 快速文章详情提取（基于 RSS 内容） ============

// 从 HTML 中提取干净的段落文本
function parseHtmlParagraphs(html) {
  if (!html || typeof html !== "string") return [];
  // 移除 script/style 标签
  const cleaned = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  // 提取 <p> 标签内容
  const paragraphs = [];
  const seen = new Set();
  const matches = cleaned.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi);
  for (const match of matches) {
    const text = cleanText(match[1]);
    if (text.length < 28 || seen.has(text)) continue;
    if (/(cookie|sign up|subscribe|advertisement|all rights reserved|privacy policy|terms of)/i.test(text)) continue;
    seen.add(text);
    paragraphs.push(text.slice(0, 1800));
    if (paragraphs.length >= 36) break;
  }
  return paragraphs;
}

// 从 RSS 正文中提取文章详情（无需 Chrome）
export function extractArticleFromRss(item) {
  if (!item.contentHtml) return null;
  const paragraphs = parseHtmlParagraphs(item.contentHtml);
  if (paragraphs.length < 2) return null;
  // 提取 og:image 或第一张图
  const imageMatch = item.contentHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
  const image = imageMatch?.[1] ? new URL(imageMatch[1], item.url).toString() : item.image || "";
  return {
    title: item.title,
    paragraphs,
    image,
    url: item.url,
    language: "",
    translationProvider: "",
    _needsTranslation: true,
  };
}

// 每块最大文本数：保证单次 Python 子进程在 150s 超时内完成（50 条 × 6 并发 ≈ 6-7s）
const TRANSLATE_CHUNK_SIZE = Number(process.env.TRANSLATE_CHUNK_SIZE) || 50;

// 把 Python 返回的引擎名映射为前端展示文案
function translationProviderLabel(provider) {
  if (!provider) return "";
  if (provider === "Google Translate") return "Google 翻译（降级）";
  return `千问 ${provider}`;
}

// 批量翻译任意文本数组（分块调用，单块失败保留原文不影响其他块）
// 返回 { translations, providers }：providers[i] 为每条实际使用的引擎（"" 表示未翻译）
export async function batchTranslateTexts(texts, chunkSize = TRANSLATE_CHUNK_SIZE) {
  if (texts.length === 0) return { translations: [], providers: [] };
  const translations = [];
  const providers = [];
  for (let i = 0; i < texts.length; i += chunkSize) {
    const chunk = texts.slice(i, i + chunkSize);
    try {
      const result = await runScrapling("batch_translate", { texts: chunk });
      if (Array.isArray(result.translations) && result.translations.length === chunk.length) {
        translations.push(...result.translations);
        providers.push(...(Array.isArray(result.providers) && result.providers.length === chunk.length
          ? result.providers
          : chunk.map(() => "")));
      } else {
        console.error(`[scraper] 翻译块 ${i}..${i + chunk.length - 1} 结果不完整，保留原文`);
        translations.push(...chunk);
        providers.push(...chunk.map(() => ""));
      }
    } catch (error) {
      console.error(`[scraper] 翻译块 ${i}..${i + chunk.length - 1} 失败: ${error.message}，保留原文`);
      translations.push(...chunk);
      providers.push(...chunk.map(() => ""));
    }
  }
  return { translations, providers };
}

// 从 Markdown 文本解析出 blocks（标题/段落/代码/列表），与 Python 端格式一致
// 去除内联标记：badge 图片整块删除、链接保留文字、HTML 标签剥掉——
// 否则这些标记会进入翻译管道，被译成 <p对齐="中心"> 之类的乱码
function stripInlineMarkdown(text) {
  return String(text)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // ![alt](url) 图片（shields badge 等）
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // [文字](url) 链接保留文字
    .replace(/<[^>]+>/g, " ") // 内联/单行 HTML 标签
    .replace(/\*\*([^*]+)\*\*/g, "$1") // 粗体标记
    .replace(/\s+/g, " ")
    .trim();
}

export function parseMarkdownBlocks(markdown, maxBlocks = 140) {
  const lines = markdown.split("\n");
  const blocks = [];
  let currentParagraph = [];
  let inCodeBlock = false;
  let codeLines = [];

  function flushParagraph() {
    if (currentParagraph.length === 0) return;
    const text = currentParagraph.join(" ").trim();
    if (text.length >= 2) {
      blocks.push({ type: "paragraph", text: text.slice(0, 1800) });
    }
    currentParagraph = [];
  }

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCodeBlock) {
        // 结束代码块
        const code = codeLines.join("\n").trim();
        if (code) blocks.push({ type: "code", text: code.slice(0, 5000) });
        codeLines = [];
        inCodeBlock = false;
      } else {
        flushParagraph();
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }
    // 标题
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      const text = stripInlineMarkdown(headingMatch[2]);
      if (text) blocks.push({ type: "heading", text: text.slice(0, 1800) });
      continue;
    }
    // 列表项
    const listMatch = line.match(/^[\s]*[-*+]\s+(.+)$/);
    if (listMatch) {
      flushParagraph();
      const text = stripInlineMarkdown(listMatch[1]);
      if (text) blocks.push({ type: "list", text: text.slice(0, 1800) });
      continue;
    }
    // 空行
    if (line.trim() === "") {
      flushParagraph();
      continue;
    }
    // HTML 行：以 <tag 或 </tag 开头的整行（<p align="center">、</div>、badge 容器等）。
    // 单行带文字内容的（如 <h1 align="center">Kaneo</h1>）提取纯文本，其余丢弃
    if (/^\s*<\/?[a-zA-Z][a-zA-Z0-9-]*(\s|>|\/)/.test(line)) {
      flushParagraph();
      const text = stripInlineMarkdown(line);
      if (text) currentParagraph.push(text);
      continue;
    }
    // 普通段落文本：剥掉内联标记；整行都是 badge/图片时剥完为空，直接丢弃
    const stripped = stripInlineMarkdown(line);
    if (!stripped) {
      flushParagraph();
      continue;
    }
    currentParagraph.push(stripped);
    if (blocks.length >= maxBlocks) break;
  }
  flushParagraph();
  if (inCodeBlock && codeLines.length > 0) {
    const code = codeLines.join("\n").trim();
    if (code) blocks.push({ type: "code", text: code.slice(0, 5000) });
  }

  // 限制总长度
  let totalLength = 0;
  const result = [];
  for (const block of blocks) {
    if (totalLength + block.text.length > 60_000) break;
    result.push(block);
    totalLength += block.text.length;
    if (result.length >= maxBlocks) break;
  }
  return result;
}

// 翻译 README blocks（code 块跳过），就地修改文本，返回主力引擎的展示标签
export async function translateReadmeBlocks(blocks, repo = "") {
  const translatable = [];
  const positions = [];
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].type !== "code") {
      positions.push(i);
      translatable.push(blocks[i].text);
    }
  }

  let translations = translatable;
  let textProviders = translatable.map(() => "");
  try {
    ({ translations, providers: textProviders } = await batchTranslateTexts(translatable));
  } catch (error) {
    console.error(`[scraper] README 翻译失败 (${repo}): ${error.message}，保留原文`);
  }

  for (let j = 0; j < positions.length; j++) {
    blocks[positions[j]].text = translations[j] || blocks[positions[j]].text;
  }

  // 该页 provider 取所有文本块中占比最高的引擎
  const providerCounts = {};
  for (const p of textProviders) if (p) providerCounts[p] = (providerCounts[p] || 0) + 1;
  const mainProvider = Object.keys(providerCounts).sort((a, b) => providerCounts[b] - providerCounts[a])[0] || "";
  return translationProviderLabel(mainProvider);
}

// 通过 HTTP 快速获取 GitHub README raw 内容（无需 Chrome，~0.5s/仓库）
// translate: true（默认）返回全量中文翻译版；false 返回原文版（供摘要模型理解）
export async function fetchReadmeFast(repoUrl, { translate = true } = {}) {
  // 从 URL 提取 owner/repo
  const match = repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
  if (!match) throw new Error("无效的 GitHub URL");
  const repo = match[1].replace(/\/+$/, "");

  // 尝试多个可能的 README 文件名和分支
  const branches = ["main", "master", "HEAD"];
  const filenames = ["README.md", "readme.md", "README.MD", "README.rst", "README"];

  for (const branch of branches) {
    for (const filename of filenames) {
      try {
        const rawUrl = `https://raw.githubusercontent.com/${repo}/${branch}/${filename}`;
        const response = await fetch(rawUrl, {
          signal: AbortSignal.timeout(8000),
          headers: { "user-agent": "MeridianLiveEdition/1.0" },
          redirect: "follow",
        });
        if (!response.ok) continue;
        const markdown = await response.text();
        if (markdown.length < 20) continue;

        const blocks = parseMarkdownBlocks(markdown);
        if (blocks.length === 0) continue;

        // 提取标题
        const title = blocks.find((b) => b.type === "heading")?.text || repo.split("/")[1];

        const providerLabel = translate ? await translateReadmeBlocks(blocks, repo) : "";

        return {
          title,
          blocks,
          url: repoUrl.replace(/\/+$/, ""),
          language: translate ? "zh-CN" : "",
          translationProvider: providerLabel,
        };
      } catch {
        continue;
      }
    }
  }
  throw new Error("无法获取 README");
}

// 批量翻译文章详情：每篇文章的标题+段落合并为一条文本，只调 1 次 API（而非 1+段落数 次）
// 翻译结果按 \n\n 拆分回标题+段落；拆分段落数过少时保留原文段落
export async function batchTranslateArticles(articles) {
  if (articles.length === 0) return [];

  // 每篇合并为一条文本（||| 分隔——Qwen-MT 会原样保留这个标记），限制 30k 字符
  const articleTexts = articles.map((a) => {
    const parts = [a.title, ...a.paragraphs].filter(Boolean);
    return parts.join("|||").slice(0, 30000);
  });

  // 每块 20 篇（合并后每条文本更长，块要比普通翻译小）
  const { translations, providers } = await batchTranslateTexts(articleTexts, 20);

  return articles.map((article, i) => {
    const translated = (translations[i] || "").trim();
    const providerLabel = translationProviderLabel(providers[i]);
    if (!translated) {
      return { ...article, language: "zh-CN", translationProvider: "", _needsTranslation: false };
    }
    const parts = translated.split("|||").filter((p) => p.trim());
    const expectedParas = article.paragraphs.length;

    // 拆分成功（至少有标题+1段）→ 使用翻译结果
    if (parts.length >= 2) {
      return {
        ...article,
        title: parts[0],
        paragraphs: parts.slice(1),
        language: "zh-CN",
        translationProvider: providerLabel,
        _needsTranslation: false,
      };
    }
    // 模型可能返回了整段无法拆分 → 标题用翻译，段落保留原文
    return {
      ...article,
      title: translated,
      language: "zh-CN",
      translationProvider: providerLabel,
      _needsTranslation: false,
    };
  });
}

// 通过 HTTP 抓取文章页面 HTML 并提取正文（无需 Chrome，~1-2s/篇）
export async function fetchArticleFromHtml(url) {
  const html = await fetchText(url, { timeout: 15000 });
  const paragraphs = parseHtmlParagraphs(html);
  if (paragraphs.length < 2) return null;
  const titleMatch = html.match(/<meta[^>]+(?:property|name)=["'](?:og:title|twitter:title)["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<title>([^<]+)<\/title>/i);
  const imageMatch = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/i);
  const title = titleMatch ? cleanText(titleMatch[1]) : paragraphs[0].slice(0, 100);
  const image = imageMatch ? imageMatch[1].replace(/&amp;/g, "&") : "";
  return {
    title,
    paragraphs,
    image,
    url,
    language: "",
    translationProvider: "",
    _needsTranslation: true,
  };
}

// 并发执行任务（限制并发数）
export async function parallelLimit(items, limit, taskFn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      try {
        results[index] = await taskFn(items[index], index);
      } catch (error) {
        results[index] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

// 批量抓取多个仓库的 README（复用 Chrome 会话）
export async function batchReadmeDetails(urls) {
  const result = await runScrapling("batch_readme", { urls });
  return result.results || [];
}

// 抓取图片（用于代理）
export async function scrapeImage(url, referer = "") {
  return runScrapling("image", { url, referer });
}

// 判断错误是否为网络层失败
export function isNetworkFailure(error) {
  const messages = [];
  let current = error;
  for (let depth = 0; current && depth < 4; depth += 1) {
    messages.push(current instanceof Error ? `${current.name} ${current.message}` : String(current));
    current = current?.cause;
  }
  return /(ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ENETUNREACH|ENETDOWN|EHOSTUNREACH|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|fetch failed|network.*(?:unavailable|offline)|socket hang up)/i.test(messages.join(" "));
}

export function publicApiError(error, fallback = "无法读取最新信息") {
  if (error?.code === "SSRF_BLOCKED") {
    return { status: 403, body: { error: "目标地址不在允许范围内", detail: error.message, code: "FORBIDDEN" } };
  }
  if (error?.code === "BAD_CATEGORY") {
    return { status: 400, body: { error: "未知的新闻分类", detail: error.message, code: "BAD_CATEGORY" } };
  }
  if (isNetworkFailure(error)) {
    return { status: 503, body: { error: "网络连接不可用", detail: "当前设备或服务器无法访问外部数据源，请检查网络后重试。", code: "OFFLINE" } };
  }
  return { status: 502, body: { error: fallback, detail: error instanceof Error ? error.message : String(error), code: "UPSTREAM_ERROR" } };
}

// 图片代理用的图片类型白名单和检测
export const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function detectImageType(body, contentType = "") {
  if (body[0] === 0xff && body[1] === 0xd8) return "image/jpeg";
  if (body[0] === 0x89 && body.subarray(1, 4).toString() === "PNG") return "image/png";
  if (body.subarray(0, 4).toString() === "RIFF" && body.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (body.subarray(0, 3).toString() === "GIF") return "image/gif";
  return ALLOWED_IMAGE_TYPES.has(contentType) ? contentType : "";
}
