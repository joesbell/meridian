import { XMLParser } from "fast-xml-parser";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

// 加载项目根目录 .env（如 TRANSLATION_API_KEY），不存在则忽略
try {
  process.loadEnvFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".env"));
} catch {
  // .env 不存在时保持现有环境变量
}

const CACHE_MS = 2 * 60 * 60 * 1000;
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
});

const NEWS_SOURCES = [
  { name: "TechCrunch", url: "https://techcrunch.com/feed/", bias: "创业 / 商业" },
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml", bias: "科技产品" },
  { name: "MIT Technology Review", url: "https://www.technologyreview.com/feed/", bias: "AI / 大模型" },
  { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", bias: "编程 / Code" },
  { name: "GitHub Blog", url: "https://github.blog/feed/", bias: "编程 / Code" },
  { name: "Hacker News", url: "https://hnrss.org/frontpage", bias: "工具推荐" },
  { name: "STAT", url: "https://www.statnews.com/feed/", bias: "健康 / 医学" },
  { name: "Nature Medicine", url: "https://www.nature.com/nm.rss", bias: "健康 / 医学" },
  { name: "36Kr", url: "https://36kr.com/feed", bias: "创业 / 商业" },
];

let newsCache = { expiresAt: 0, value: null };
let musicCache = { expiresAt: 0, value: null };
const repoCache = new Map();
const articleCache = new Map();
const repoDetailCache = new Map();
const imageCache = new Map();
const serverDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(serverDir, "..");
const scraplingPython = process.env.SCRAPLING_PYTHON || path.join(projectDir, ".venv", "bin", "python");
const scraplingScript = path.join(projectDir, "scripts", "scrape_live.py");
let scraplingQueue = Promise.resolve();
const detailPrefetching = new Map();

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
  if (isNetworkFailure(error)) {
    return {
      status: 503,
      body: {
        error: "网络连接不可用",
        detail: "当前设备或服务器无法访问外部数据源，请检查网络后重试。",
        code: "OFFLINE",
      },
    };
  }
  return {
    status: 502,
    body: {
      error: fallback,
      detail: error instanceof Error ? error.message : String(error),
      code: "UPSTREAM_ERROR",
    },
  };
}

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
    child.stdin.end(JSON.stringify(payload));
  });
}

function runScrapling(mode, payload = {}) {
  const task = scraplingQueue.then(
    () => executeScrapling(mode, payload),
    () => executeScrapling(mode, payload),
  );
  scraplingQueue = task.catch(() => undefined);
  return task;
}

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

function categoryFor(title, description, fallback) {
  const text = `${title} ${description}`.toLowerCase();
  if (/(health|medical|medicine|cancer|clinical|disease|医院|医学|健康|药)/.test(text)) return "健康 / 医学";
  if (/(code|programming|developer|code|github|software|open source|编程|开发|开源)/.test(text)) return "编程 / Code";
  if (/(stock|market|nasdaq|investment|funding|ipo|美股|投资|融资|市场)/.test(text)) return "投资 / 美股";
  if (/(startup|business|venture|company|创业|商业|融资)/.test(text)) return "创业 / 商业";
  if (/(ai|llm|model|openai|anthropic|人工智能|大模型)/.test(text)) return "AI / 大模型";
  return fallback || "科技产品";
}

function editorialLens(category, sourceName) {
  if (sourceName === "Hacker News" || category === "编程 / Code") return "工具推荐";
  if (["投资 / 美股", "创业 / 商业"].includes(category)) return "行业趋势";
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
      const description = entry.description || entry.summary || entry.content || entry["content:encoded"] || "";
      const link = normalizeLink(entry.link) || entry.guid || entry.id || "";
      const image = firstUrl(
        entry["media:content"],
        entry["media:thumbnail"],
        entry.enclosure,
        entry["media:group"]?.["media:content"],
      );
      const publishedAt = entry.pubDate || entry.published || entry.updated || new Date(Date.now() - index * 3600_000).toISOString();
      if (!title || !link) return null;
      const category = source.name === "GitHub Blog"
        ? "编程 / Code"
        : source.name === "TechCrunch"
          ? "创业 / 商业"
          : source.name === "36Kr"
            ? "投资 / 美股"
            : categoryFor(title, description, source.bias);
      return {
        id: `${source.name}-${link}`.replace(/[^a-zA-Z0-9]+/g, "-").slice(-96),
        title,
        summary: shortText(description || title),
        source: source.name,
        sourceUrl: source.url,
        url: link,
        image,
        publishedAt,
        category,
        lens: editorialLens(category, source.name),
      };
    })
    .filter(Boolean);
}

async function fetchText(url, { timeout = 12000, github = false } = {}) {
  const signal = AbortSignal.timeout(timeout);
  const response = await fetch(url, {
    signal,
    headers: {
      "user-agent": github
        ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        : "RadiusLiveEdition/1.0 (+https://radius.local; editorial reader)",
      accept: github
        ? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        : "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.5",
      "accept-language": github ? "en-US,en;q=0.9" : "zh-CN,zh;q=0.9,en;q=0.7",
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

function dateValue(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function faviconFor(url) {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=128`;
  } catch {
    return "";
  }
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

async function translateNewsToChinese(items) {
  const result = await runScrapling("translate", { items });
  if (!Array.isArray(result.items) || result.items.length !== items.length || result.language !== "zh-CN") {
    throw new Error("Scrapling 中文翻译结果不完整");
  }
  return result;
}

function diversifiedItems(items, limit = 15) {
  const buckets = new Map();
  for (const item of items) {
    const sourceItems = buckets.get(item.source) || [];
    sourceItems.push(item);
    buckets.set(item.source, sourceItems);
  }
  for (const bucket of buckets.values()) bucket.sort((a, b) => dateValue(b.publishedAt) - dateValue(a.publishedAt));
  const selected = [];
  while (selected.length < limit) {
    let added = false;
    for (const source of NEWS_SOURCES.map((entry) => entry.name)) {
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

export async function getNews(force = false) {
  if (!force && newsCache.value && newsCache.expiresAt > Date.now()) return newsCache.value;
  const results = await Promise.allSettled(
    NEWS_SOURCES.map(async (source) => extractFeedItems(await fetchText(source.url), source)),
  );
  const collected = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const unique = new Map();
  for (const item of collected.sort((a, b) => dateValue(b.publishedAt) - dateValue(a.publishedAt))) {
    const key = item.url.replace(/[?#].*$/, "");
    if (!unique.has(key)) unique.set(key, item);
  }
  const selected = diversifiedItems([...unique.values()], 15);
  const items = await Promise.all(selected.map(async (item) => ({
    ...item,
    image: item.image || await extractOgImage(item.url),
  })));
  if (items.length === 0) {
    throw new Error("新闻源暂不可用（没有取得有效文章）");
  }
  const localized = await translateNewsToChinese(items);
  const value = {
    generatedAt: new Date().toISOString(),
    cacheHours: 2,
    sourceCount: results.filter((result) => result.status === "fulfilled").length,
    language: "zh-CN",
    translationProvider: localized.translationProvider || "中文本地化翻译",
    items: localized.items,
  };
  newsCache = { expiresAt: Date.now() + CACHE_MS, value };
  void prefetchNewsDetails(value.items);
  return value;
}

export async function getGithub(period = "daily", force = false) {
  const key = ["daily", "weekly", "monthly"].includes(period) ? period : "daily";
  const cached = repoCache.get(key);
  if (!force && cached?.expiresAt > Date.now()) return cached.value;
  const result = await runScrapling("github");
  const snapshots = result.snapshots || {};
  const generatedAt = new Date().toISOString();
  const expiresAt = Date.now() + CACHE_MS;
  let cachedCount = 0;
  for (const current of ["daily", "weekly", "monthly"]) {
    const rows = snapshots[current];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const value = {
      generatedAt,
      cacheHours: 2,
      period: current,
      source: result.source || "GitHub Trending 官方页面",
      language: "zh-CN",
      translationProvider: result.translationProvider || "中文本地化翻译",
      items: rows,
    };
    repoCache.set(current, { expiresAt, value });
    cachedCount += 1;
  }
  if (cachedCount === 0 || !repoCache.get(key)?.value) {
    throw new Error(`GitHub ${key} 榜单当前没有取得有效数据`);
  }
  void prefetchRepoDetails(snapshots[key] || []);
  return repoCache.get(key).value;
}

function scoreMusicMatch(result, song) {
  const track = cleanText(result.trackName).toLowerCase();
  const artist = cleanText(result.artistName).toLowerCase();
  const wantedTrack = cleanText(song.title).toLowerCase();
  const wantedArtist = cleanText(song.artist).toLowerCase();
  let score = result.previewUrl ? 3 : 0;
  if (track === wantedTrack) score += 8;
  else if (track.includes(wantedTrack) || wantedTrack.includes(track)) score += 4;
  if (artist === wantedArtist) score += 5;
  else if (wantedArtist.split(/\s+&\s+|,\s*/).some((name) => name.length > 2 && artist.includes(name))) score += 3;
  return score;
}

async function resolveMusicPreview(song) {
  const term = encodeURIComponent(`${song.title} ${song.artist}`);
  const response = await fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=8&country=US`, {
    signal: AbortSignal.timeout(12_000),
    headers: { "user-agent": "RadiusLiveEdition/1.0" },
  });
  if (!response.ok) return { ...song, previewUrl: "", artwork: "", trackUrl: "" };
  const data = await response.json();
  const candidates = Array.isArray(data.results) ? data.results : [];
  const selected = candidates
    .map((result) => ({ result, score: scoreMusicMatch(result, song) }))
    .sort((a, b) => b.score - a.score)[0];
  if (!selected || selected.score < 5) return { ...song, previewUrl: "", artwork: "", trackUrl: "" };
  const result = selected.result;
  return {
    ...song,
    title: result.trackName || song.title,
    artist: result.artistName || song.artist,
    album: result.collectionName || "",
    previewUrl: result.previewUrl || "",
    artwork: String(result.artworkUrl100 || "").replace("100x100", "600x600"),
    trackUrl: result.trackViewUrl || "",
  };
}

export async function getMusic(force = false) {
  if (!force && musicCache.value && musicCache.expiresAt > Date.now()) return musicCache.value;
  const chart = await runScrapling("music");
  if (!Array.isArray(chart.items) || chart.items.length < 8) {
    throw new Error("Scrapling 未返回可验证的嘻哈热歌榜");
  }
  const items = await Promise.all(chart.items.slice(0, 12).map(resolveMusicPreview));
  const playableItems = items.filter((item) => item.previewUrl);
  if (playableItems.length < 3) {
    throw new Error(`官方试听源仅匹配到 ${playableItems.length} 首歌曲`);
  }
  const value = {
    generatedAt: new Date().toISOString(),
    cacheHours: 2,
    source: chart.source,
    sourceUrl: chart.sourceUrl,
    previewSource: "Apple Music 官方试听",
    items,
  };
  musicCache = { expiresAt: Date.now() + CACHE_MS, value };
  return value;
}

function safeRemoteUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("仅支持公开 HTTP(S) 来源");
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost"
    || host === "::1"
    || /^127\./.test(host)
    || /^10\./.test(host)
    || /^192\.168\./.test(host)
    || /^169\.254\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error("不允许访问本地或私有网络地址");
  }
  return url;
}

export async function getArticle(url, force = false) {
  const target = safeRemoteUrl(url).toString();
  const cached = articleCache.get(target);
  if (!force && cached?.expiresAt > Date.now()) return cached.value;
  if (!force && detailPrefetching.has(target)) return detailPrefetching.get(target);
  const article = await runScrapling("article", { url: target });
  if (!Array.isArray(article.paragraphs) || article.paragraphs.length < 2 || article.language !== "zh-CN") {
    throw new Error("Scrapling 未返回完整的中文正文");
  }
  const value = { ...article, generatedAt: new Date().toISOString() };
  articleCache.set(target, { expiresAt: Date.now() + CACHE_MS, value });
  return value;
}

export async function getRepoReadme(url, force = false) {
  const target = safeRemoteUrl(url);
  if (target.hostname !== "github.com") throw new Error("README 仅支持 GitHub 公开仓库");
  const normalized = `${target.protocol}//${target.host}${target.pathname.replace(/\/+$/, "")}`;
  const cached = repoDetailCache.get(normalized);
  if (!force && cached?.expiresAt > Date.now()) return cached.value;
  if (!force && detailPrefetching.has(normalized)) return detailPrefetching.get(normalized);
  const readme = await runScrapling("readme", { url: normalized });
  if (!Array.isArray(readme.blocks) || readme.blocks.length === 0 || readme.language !== "zh-CN") {
    throw new Error("Scrapling 未返回完整的中文 README");
  }
  const value = { ...readme, generatedAt: new Date().toISOString() };
  repoDetailCache.set(normalized, { expiresAt: Date.now() + CACHE_MS, value });
  return value;
}

async function prefetchNewsDetails(items) {
  for (const item of items) {
    const key = item.url;
    if (!key || articleCache.get(key)?.expiresAt > Date.now() || detailPrefetching.has(key)) continue;
    const task = getArticle(key);
    detailPrefetching.set(key, task);
    try {
      await task;
    } catch {
      // The list is already usable; individual paywalls must not block it.
    } finally {
      if (detailPrefetching.get(key) === task) detailPrefetching.delete(key);
    }
  }
}

async function prefetchRepoDetails(items) {
  const unique = new Map(items.filter((item) => item?.url).map((item) => [item.url, item]));
  for (const item of unique.values()) {
    const key = item.url.replace(/\/+$/, "");
    if (repoDetailCache.get(key)?.expiresAt > Date.now() || detailPrefetching.has(key)) continue;
    const task = getRepoReadme(key);
    detailPrefetching.set(key, task);
    try {
      await task;
    } catch {
      // Repositories without a readable README still remain valid ranking rows.
    } finally {
      if (detailPrefetching.get(key) === task) detailPrefetching.delete(key);
    }
  }
}

async function fetchImageCandidate(url, referer) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(18_000),
    redirect: "follow",
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      referer,
    },
  });
  if (!response.ok) throw new Error(`图片来源返回 ${response.status}`);
  const contentType = response.headers.get("content-type") || "image/jpeg";
  if (!contentType.startsWith("image/") && contentType !== "application/octet-stream") {
    throw new Error("远程资源不是图片");
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (!body.length || body.length > 12_000_000) throw new Error("图片大小异常");
  return { body, contentType: detectImageType(body, contentType) };
}

function detectImageType(body, contentType = "") {
  if (contentType.startsWith("image/")) return contentType;
  if (body[0] === 0xff && body[1] === 0xd8) return "image/jpeg";
  if (body[0] === 0x89 && body.subarray(1, 4).toString() === "PNG") return "image/png";
  if (body.subarray(0, 4).toString() === "RIFF" && body.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (body.subarray(0, 3).toString() === "GIF") return "image/gif";
  if (body.subarray(0, 160).toString().includes("<svg")) return "image/svg+xml";
  return "image/jpeg";
}

async function fetchImageWithScrapling(url, referer) {
  const result = await runScrapling("image", { url, referer });
  const body = Buffer.from(result.body || "", "base64");
  if (!body.length || body.length > 12_000_000) throw new Error("Scrapling 图片大小异常");
  return { body, contentType: detectImageType(body, result.contentType || "") };
}

export async function getImage(url, referer = "") {
  const target = safeRemoteUrl(url);
  const safeReferer = referer ? safeRemoteUrl(referer).toString() : `${target.protocol}//${target.host}/`;
  const cacheKey = target.toString();
  const cached = imageCache.get(cacheKey);
  if (cached?.expiresAt > Date.now()) return cached.value;
  let value;
  try {
    value = await fetchImageCandidate(target.toString(), safeReferer);
  } catch {
    try {
      value = await fetchImageWithScrapling(target.toString(), safeReferer);
    } catch {
      const favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(target.hostname)}&sz=128`;
      try {
        value = await fetchImageCandidate(favicon, "https://www.google.com/");
      } catch {
        value = await fetchImageWithScrapling(favicon, "https://www.google.com/");
      }
    }
  }
  imageCache.set(cacheKey, { expiresAt: Date.now() + CACHE_MS, value });
  return value;
}

function queryValue(url, key) {
  return new URL(url, "http://radius.local").searchParams.get(key);
}

export function createFeedMiddleware() {
  return async (req, res, next) => {
    if (!req.url?.startsWith("/api/")) return next();
    try {
      const force = queryValue(req.url, "force") === "1";
      if (req.url.startsWith("/api/image")) {
        const imageUrl = queryValue(req.url, "url");
        if (!imageUrl) throw new Error("缺少图片地址");
        const image = await getImage(imageUrl, queryValue(req.url, "referer") || "");
        res.statusCode = 200;
        res.setHeader("content-type", image.contentType);
        res.setHeader("cache-control", "public, max-age=7200, stale-while-revalidate=86400");
        res.end(image.body);
        return;
      }
      const data = req.url.startsWith("/api/news")
        ? await getNews(force)
        : req.url.startsWith("/api/github")
          ? await getGithub(queryValue(req.url, "period") || "daily", force)
          : req.url.startsWith("/api/repo")
            ? await getRepoReadme(queryValue(req.url, "url") || "", force)
          : req.url.startsWith("/api/music")
            ? await getMusic(force)
          : req.url.startsWith("/api/article")
            ? await getArticle(queryValue(req.url, "url") || "", force)
            : null;
      if (!data) return next();
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(JSON.stringify(data));
    } catch (error) {
      const failure = publicApiError(error);
      res.statusCode = failure.status;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify(failure.body));
    }
  };
}
