// API 中间件层：从数据库读取数据、分类滚动分页、文章/README 详情代理、图片代理。
// 抓取逻辑在 scraper.mjs，调度在 scheduler.mjs，中文摘要在 summarize.mjs，本文件只负责 HTTP 接口。
import {
  getNewsPageByCategory,
  getArticleDetails,
  getLatestRepos,
  getArticleDetail,
  getReadmeDetail,
  getCollectedUrls,
  hasData,
  saveArticleDetail,
  saveReadmeDetail,
} from "./db.mjs";
import {
  safeRemoteUrl,
  isPrivateAddress,
  scrapeArticleDetail,
  scrapeReadmeDetail,
  scrapeImage,
  publicApiError,
  fetchWithRedirectGuard,
  readBodyWithLimit,
  withHostLimit,
  ALLOWED_IMAGE_TYPES,
  detectImageType,
  isNetworkFailure,
} from "./scraper.mjs";
import { summarizeArticle, summarizeReadme } from "./summarize.mjs";
import { getScrapingStatus } from "./scheduler.mjs";
import { CATEGORIES } from "./sources.mjs";

// 从请求 URL 中读取查询参数
function queryValue(url, key) {
  return new URL(url, "http://meridian.local").searchParams.get(key);
}

// 获取当前展示数据：每个分类取数据库中按存入时间最新的 10 条（首屏；更多走 /api/news/page 滚动分页），
// GitHub 榜单取最新 15 个。updatedAt 为所有条目中最大的存入时间，
// 前端用它判断"是否有新数据入库"以决定何时停止轮询。
const NEWS_FEED_LIMIT = 10;
const GITHUB_FEED_LIMIT = 15;
const NEWS_PAGE_SIZE = 5;

// ---- 头条热度分 ----
// RSS 协议本身不提供阅读量/点击量，可用的真实热度信号只有两个：
//   1) 同一故事被多家独立源报道（item.heat，抓取时在原文标题上计算）——权重最高
//   2) 发布时间新鲜度（96 小时线性衰减）——兜底与并列裁决
// 对首屏条目打分，得分最高者提升为分类头条（位置 0），其余维持时间序；
// 只调整展示顺序，分页游标仍按时间序计算，不受影响。
export function promoteTopStory(items) {
  if (items.length < 3) return items;
  const scores = items.map((item) => {
    const published = Date.parse(item.publishedAt || "") || Date.parse(item.createdAt || "") || 0;
    const hours = Math.max(0, (Date.now() - published) / 3_600_000);
    const freshness = Math.max(0, 1 - hours / 96);
    return freshness + (item.heat || 0) * 0.8;
  });
  let top = 0;
  for (let i = 1; i < scores.length; i += 1) {
    if (scores[i] > scores[top]) top = i;
  }
  if (top === 0) return items;
  const next = items.slice();
  next.unshift(next.splice(top, 1)[0]);
  return next;
}

async function getFeed() {
  const news = {};
  const newsCursors = {};
  let updatedAt = "";
  for (const c of CATEGORIES) {
    const { items, nextCursor } = getNewsPageByCategory(c.id, null, NEWS_FEED_LIMIT);
    if (items.length) {
      news[c.id] = promoteTopStory(items);
      newsCursors[c.id] = nextCursor
        ? Buffer.from(JSON.stringify(nextCursor), "utf-8").toString("base64url")
        : null;
      for (const item of items) {
        if (item.createdAt && item.createdAt > updatedAt) updatedAt = item.createdAt;
      }
    }
  }

  const reposByPeriod = {};
  let repoTotal = 0;
  for (const period of ["daily", "weekly", "monthly"]) {
    const repos = getLatestRepos(GITHUB_FEED_LIMIT, period);
    reposByPeriod[period] = repos;
    repoTotal += repos.length;
    for (const repo of repos) {
      if (repo.createdAt && repo.createdAt > updatedAt) updatedAt = repo.createdAt;
    }
  }

  const available = Object.keys(news).length > 0 || repoTotal > 0;
  return {
    available,
    scraping: getScrapingStatus(),
    updatedAt: updatedAt || null,
    timeLabel: updatedAt
      ? new Date(updatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" })
      : null,
    categories: CATEGORIES.map((c) => c.id),
    news,
    newsCursors,
    github: reposByPeriod,
  };
}

// 分类滚动分页：只返回一个分类的下一页（5 条），内联已存的中文摘要详情。
// cursor 为上一页响应里的 nextCursor（base64 JSON），缺省为第一页。
// 余量不足 5 条就有多少返回多少；没有了返回空 items + exhausted: true，前端停止该类加载。
function handleNewsPage(category, cursorParam) {
  if (!CATEGORIES.some((c) => c.id === category)) {
    const error = new Error("未知的新闻分类");
    error.code = "BAD_CATEGORY";
    throw error;
  }
  let cursor = null;
  if (cursorParam) {
    try {
      cursor = JSON.parse(Buffer.from(cursorParam, "base64url").toString("utf-8"));
      if (typeof cursor?.c !== "string" || typeof cursor?.r !== "number") cursor = null;
    } catch {
      cursor = null;
    }
  }
  const { items, nextCursor } = getNewsPageByCategory(category, cursor, NEWS_PAGE_SIZE);
  const details = getArticleDetails(items.map((item) => item.url).filter(Boolean));
  return {
    category,
    items,
    details,
    nextCursor: items.length === NEWS_PAGE_SIZE && nextCursor
      ? Buffer.from(JSON.stringify(nextCursor), "utf-8").toString("base64url")
      : null,
    exhausted: items.length < NEWS_PAGE_SIZE,
  };
}

// 文章详情：优先从 DB 读取，未命中则实时抓取 + GLM 中文摘要（失败保留原文）并缓存
async function handleArticle(url) {
  const target = (await safeRemoteUrl(url)).toString();

  // 先查 DB
  const cached = getArticleDetail(target);
  if (cached) return cached;

  // 白名单校验
  const allowedUrls = getCollectedUrls();
  if (!allowedUrls.has(target)) {
    // 尝试刷新白名单
    const error = new Error("仅支持抓取已收录的文章链接");
    error.code = "SSRF_BLOCKED";
    throw error;
  }

  // 实时抓取 + 中文摘要
  const detail = await scrapeArticleDetail(target);
  const summary = await summarizeArticle({ ...detail, url: target });
  const value = summary
    ? { ...detail, ...summary, url: target }
    : { ...detail, url: target };
  saveArticleDetail(value);
  return value;
}

// README 详情：优先从 DB 读取，未命中则实时抓取 + GLM 中文摘要（失败保留原文）并缓存
async function handleRepo(url) {
  const target = await safeRemoteUrl(url);
  if (target.hostname !== "github.com") {
    const error = new Error("README 仅支持 GitHub 公开仓库");
    error.code = "SSRF_BLOCKED";
    throw error;
  }
  const normalized = `${target.protocol}//${target.host}${target.pathname.replace(/\/+$/, "")}`;

  // 先查 DB
  const cached = getReadmeDetail(normalized);
  if (cached) return cached;

  // 实时抓取 + 中文摘要
  const detail = await scrapeReadmeDetail(normalized);
  const summary = await summarizeReadme({ ...detail, url: normalized });
  const value = summary
    ? { ...detail, ...summary, url: normalized }
    : { ...detail, url: normalized };
  saveReadmeDetail(value);
  return value;
}

// 图片代理：白名单 → 直抓 → Scrapling 代抓 → favicon 兜底
async function handleImage(url, referer = "") {
  const target = await safeRemoteUrl(url);
  const allowedUrls = getCollectedUrls();
  const isAllowed =
    allowedUrls.has(target.toString()) ||
    target.hostname === "www.google.com" ||
    target.hostname === "google.com" ||
    target.hostname.endsWith(".mzstatic.com");

  if (!isAllowed) {
    const error = new Error("图片地址不在允许范围内");
    error.code = "SSRF_BLOCKED";
    throw error;
  }

  const safeReferer = referer
    ? (await safeRemoteUrl(referer)).toString()
    : `${target.protocol}//${target.host}/`;

  // 直抓
  try {
    const value = await fetchImageCandidate(target.toString(), safeReferer);
    return value;
  } catch {
    // 降级到 Scrapling
  }
  try {
    const result = await scrapeImage(target.toString(), safeReferer);
    const body = Buffer.from(result.body || "", "base64");
    if (!body.length || body.length > 12_000_000) throw new Error("图片大小异常");
    const declared = String(result.contentType || "").split(";")[0].trim().toLowerCase();
    const detected = detectImageType(body, declared);
    if (!ALLOWED_IMAGE_TYPES.has(detected)) throw new Error("不允许的图片类型");
    return { body, contentType: detected };
  } catch {
    // favicon 兜底
    const favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(target.hostname)}&sz=128`;
    try {
      return await fetchImageCandidate(favicon, "https://www.google.com/");
    } catch {
      const result = await scrapeImage(favicon, "https://www.google.com/");
      const body = Buffer.from(result.body || "", "base64");
      const detected = detectImageType(body, "image/png");
      return { body, contentType: detected };
    }
  }
}

async function fetchImageCandidate(url, referer) {
  return withHostLimit(url, async () => {
    const response = await fetchWithRedirectGuard(url, {
      signal: AbortSignal.timeout(18_000),
      headers: {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        referer,
      },
    });
    if (!response.ok) throw new Error(`图片来源返回 ${response.status}`);
    const contentType = (response.headers.get("content-type") || "application/octet-stream").split(";")[0].trim().toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(contentType) && contentType !== "application/octet-stream") {
      throw new Error("不允许的图片类型");
    }
    const body = await readBodyWithLimit(response, 12_000_000, "图片");
    if (!body.length) throw new Error("图片大小异常");
    const detected = detectImageType(body, contentType);
    if (!ALLOWED_IMAGE_TYPES.has(detected)) throw new Error("不允许的图片类型");
    return { body, contentType: detected };
  });
}

// 组装 API 中间件
export function createFeedMiddleware() {
  return async (req, res, next) => {
    if (!req.url?.startsWith("/api/")) return next();
    try {
      // ---- 图片代理 ----
      if (req.url.startsWith("/api/image")) {
        const imageUrl = queryValue(req.url, "url");
        if (!imageUrl) throw new Error("缺少图片地址");
        const image = await handleImage(imageUrl, queryValue(req.url, "referer") || "");
        res.statusCode = 200;
        res.setHeader("content-type", image.contentType);
        res.setHeader("cache-control", "public, max-age=7200, stale-while-revalidate=86400");
        res.end(image.body);
        return;
      }

      // ---- 分类滚动分页（单分类下一页，内联中文摘要详情）----
      if (req.url.startsWith("/api/news/page")) {
        const data = handleNewsPage(queryValue(req.url, "category") || "", queryValue(req.url, "cursor") || "");
        res.statusCode = 200;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.setHeader("cache-control", "no-store");
        res.end(JSON.stringify(data));
        return;
      }

      // ---- 数据状态 ----
      if (req.url.startsWith("/api/status")) {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.setHeader("cache-control", "no-store");
        res.end(JSON.stringify({
          hasData: hasData(),
          scraping: getScrapingStatus(),
        }));
        return;
      }

      // ---- 文章详情 ----
      if (req.url.startsWith("/api/article")) {
        const articleUrl = queryValue(req.url, "url");
        if (!articleUrl) throw new Error("缺少文章地址");
        const data = await handleArticle(articleUrl);
        res.statusCode = 200;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.setHeader("cache-control", "no-store");
        res.end(JSON.stringify(data));
        return;
      }

      // ---- README 详情 ----
      if (req.url.startsWith("/api/repo")) {
        const repoUrl = queryValue(req.url, "url");
        if (!repoUrl) throw new Error("缺少仓库地址");
        const data = await handleRepo(repoUrl);
        res.statusCode = 200;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.setHeader("cache-control", "no-store");
        res.end(JSON.stringify(data));
        return;
      }

      // ---- 主数据接口 ----
      if (req.url.startsWith("/api/feed") || req.url.startsWith("/api/news") || req.url.startsWith("/api/github")) {
        const data = await getFeed();
        res.statusCode = 200;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.setHeader("cache-control", "no-store");
        res.end(JSON.stringify(data));
        return;
      }

      return next();
    } catch (error) {
      const failure = publicApiError(error);
      res.statusCode = failure.status;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify(failure.body));
    }
  };
}

// 导出工具函数（兼容原有引用）
export { isNetworkFailure, publicApiError, safeRemoteUrl, isPrivateAddress };
