// 调度器：每天 02:00 / 10:00 / 18:00 三个整点触发全量抓取；每月 1 号 02:00 抓取前彻底清空数据库。
// 服务器启动时立即执行一次抓取。列表入库后批次即标记为 complete，详情在后台预取。
// 详情（文章正文 / README）由 GLM-4-Flash 理解后生成中文要点摘要，失败回退 Qwen-MT 全量翻译。
import {
  purgeAllData,
  createBatch,
  completeBatch,
  insertNewsItems,
  insertRepoItems,
  saveArticleDetail,
  saveReadmeDetail,
  getArticleDetail,
  getReadmeDetail,
  cleanupEmptyBatches,
} from "./db.mjs";
import {
  scrapeAllNews,
  scrapeGithub,
  scrapeArticleDetail,
  scrapeReadmeDetail,
  extractArticleFromRss,
  fetchArticleFromHtml,
  batchTranslateArticles,
  fetchReadmeFast,
  translateReadmeBlocks,
  parallelLimit,
  cleanupScraplingProcesses,
} from "./scraper.mjs";
import { summarizeArticle, summarizeReadme } from "./summarize.mjs";
import { CATEGORIES, GITHUB_LIMIT } from "./sources.mjs";

// 互斥锁：防止定时抓取和手动刷新同时运行
let scrapingMutex = Promise.resolve();
let isScraping = false;

export function getScrapingStatus() {
  return isScraping;
}

// 格式化时间标签
function timeLabelFromDate(date) {
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

// 全量抓取一轮数据并写入数据库
// scrapeType: "scheduled"（定时） | "initial"（启动）
// 看门狗：整轮超过 30 分钟强制判负 → 清理残留进程 → 立即重抓，最多连试 3 次。
// 任何一个环节意外挂死（如 2026-08-17 批次 #25 无声卡死 16 小时）都不能再瘫痪调度；
// 3 次封顶是防止持续性故障无限重试烧 GLM 翻译配额，失败后等下一个定时点即可
const WATCHDOG_MS = 30 * 60_000;
const MAX_ATTEMPTS = 3;

export async function runScrapeCycle(scrapeType = "scheduled") {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    // 互斥：同一时刻只跑一轮
    const previous = scrapingMutex;
    let resolveMutex;
    scrapingMutex = new Promise((resolve) => {
      resolveMutex = resolve;
    });

    await previous;
    isScraping = true;

    try {
      const work = runScrapeCycleWork(scrapeType);
      work.catch(() => undefined); // 看门狗胜出的场景下，内部 promise 之后的拒判不炸进程
      const watchdog = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("批次看门狗：本轮超过 30 分钟未完成，强制结束")), WATCHDOG_MS),
      );
      watchdog.catch(() => undefined); // race 早已结束时定时器晚触发，不算未处理拒判
      return await Promise.race([work, watchdog]);
    } catch (error) {
      const isWatchdog = error.message.includes("看门狗");
      if (!isWatchdog || attempt === MAX_ATTEMPTS) {
        console.error(`[scheduler] 抓取批次失败: ${error.message}`);
        throw error;
      }
      console.error(`[scheduler] ${error.message}，清理残留进程后立即重抓（第 ${attempt + 1}/${MAX_ATTEMPTS} 次）`);
      cleanupScraplingProcesses();
    } finally {
      isScraping = false;
      resolveMutex();
    }
  }
  return undefined; // 不可达：MAX_ATTEMPTS 次时上面已 throw
}

// 一轮抓取的完整工作体（由 runScrapeCycle 的看门狗包裹调用）。
// 主体保持原 try 块缩进；错误直接抛给外层统一记录，互斥锁由外层 finally 释放
async function runScrapeCycleWork(scrapeType) {
  {
    const now = new Date();
    const timeLabel = timeLabelFromDate(now);
    const batchHour = now.getHours() + now.getMinutes() / 60;

    // 每月 1 号 02:00 的定时抓取前彻底清空数据库，然后重新抓取一轮
    if (scrapeType === "scheduled" && now.getDate() === 1 && now.getHours() === 2) {
      purgeAllData();
      scrapeType = "monthly-reset";
      console.log("[scheduler] 每月 1 号彻底清空完成，开始重新抓取");
    }

    // 创建批次（状态为 pending）
    const batchId = createBatch(timeLabel, batchHour, scrapeType);
    console.log(`[scheduler] 开始抓取批次 #${batchId} (${timeLabel}, ${scrapeType})`);

    // 新闻 + GitHub 并行抓取
    const [newsResult, githubResult] = await Promise.allSettled([scrapeAllNews(), scrapeGithub()]);

    let newsCount = 0;
    let repoCount = 0;
    let allNewsItems = [];
    let allRepoItems = [];

    // 存入新闻列表
    if (newsResult.status === "fulfilled" && newsResult.value) {
      const allNews = newsResult.value;
      for (const category of Object.keys(allNews)) {
        const items = allNews[category];
        if (items.length > 0) {
          insertNewsItems(batchId, items);
          newsCount += items.length;
          allNewsItems.push(...items);
        }
      }
    } else if (newsResult.status === "rejected") {
      console.error(`[scheduler] 新闻抓取失败: ${newsResult.reason?.message || newsResult.reason}`);
    }

    // 存入 GitHub 仓库列表（今日/本周/本月三个周期都存）
    if (githubResult.status === "fulfilled" && githubResult.value) {
      const snapshots = githubResult.value.snapshots || {};
      const seenRepoUrls = new Set();
      for (const period of ["daily", "weekly", "monthly"]) {
        const repos = (snapshots[period] || []).slice(0, GITHUB_LIMIT);
        if (repos.length > 0) {
          insertRepoItems(batchId, repos);
          repoCount += repos.length;
          // 同一仓库可能出现在多个周期，README 只预取一次
          for (const repo of repos) {
            const key = (repo.url || "").replace(/\/+$/, "");
            if (key && !seenRepoUrls.has(key)) {
              seenRepoUrls.add(key);
              allRepoItems.push(repo);
            }
          }
        }
      }
    } else if (githubResult.status === "rejected") {
      console.error(`[scheduler] GitHub 抓取失败: ${githubResult.reason?.message || githubResult.reason}`);
    }

    console.log(`[scheduler] 批次 #${batchId} 列表完成: ${newsCount} 条新闻, ${repoCount} 个仓库`);

    // 列表数据已入库，立即标记批次为完成
    completeBatch(batchId);

    // 后台抓取详情（只抓本次涉及的）
    if (allNewsItems.length > 0) await prefetchAllArticleDetails(allNewsItems);
    if (allRepoItems.length > 0) await prefetchAllReadmeDetails(allRepoItems);

    console.log(`[scheduler] 批次 #${batchId} 完成: ${newsCount} 条新闻, ${repoCount} 个仓库`);

    return { batchId, timeLabel, newsCount, repoCount };
  }
}

// 抓取所有文章详情并存入数据库
// 正文提取三级策略：RSS 快速路径（0 网络请求）→ HTTP 抓取（~1-2s/篇）→ Chrome 兜底（~30s/篇）
// 中文化策略：GLM-4-Flash 理解后输出中文要点摘要（并发 5）；失败的回退 Qwen-MT 全量翻译
async function prefetchAllArticleDetails(allNewsItems) {
  let cached = 0;
  let summarized = 0;
  let translated = 0;
  let failed = 0;

  // 分离已缓存 vs 需抓取
  const pendingItems = [];
  for (const item of allNewsItems) {
    if (getArticleDetail(item.url)) {
      cached += 1;
    } else {
      pendingItems.push(item);
    }
  }

  // === 正文提取：RSS → HTTP → Chrome ===
  const articles = [];

  // 第一级：RSS 内容快速提取
  const needFetchItems = [];
  for (const item of pendingItems) {
    const article = item.contentHtml ? extractArticleFromRss(item) : null;
    if (article) {
      articles.push(article);
    } else {
      needFetchItems.push(item);
    }
  }

  // 第二级：HTTP 抓取（并发 5 个，~1-2s/篇）
  if (needFetchItems.length > 0) {
    console.log(`[scheduler] HTTP 抓取 ${needFetchItems.length} 篇无 RSS 内容的文章…`);
    const httpResults = await parallelLimit(needFetchItems, 5, async (item) => {
      try {
        return await fetchArticleFromHtml(item.url);
      } catch {
        return null;
      }
    });

    const needChrome = [];
    for (let i = 0; i < needFetchItems.length; i++) {
      if (httpResults[i]) {
        articles.push(httpResults[i]);
      } else {
        needChrome.push(needFetchItems[i]);
      }
    }

    // 第三级：Chrome 兜底（仅用于 HTTP 抓取失败的）
    if (needChrome.length > 0) {
      console.log(`[scheduler] Chrome 兜底抓取 ${needChrome.length} 篇…`);
      for (const item of needChrome) {
        try {
          const detail = await scrapeArticleDetail(item.url);
          articles.push({ ...detail, url: item.url });
        } catch {
          failed += 1;
        }
      }
    }
  }

  // === GLM 中文摘要（并发 5）：理解正文后输出中文要点 ===
  const summaryResults = await parallelLimit(articles, 5, (article) => summarizeArticle(article));

  // 摘要失败的回退 Qwen-MT 全量翻译
  const needTranslate = [];
  for (let i = 0; i < articles.length; i++) {
    if (summaryResults[i]) {
      const detail = { ...articles[i], ...summaryResults[i], url: articles[i].url };
      delete detail._needsTranslation;
      saveArticleDetail(detail);
      summarized += 1;
    } else {
      needTranslate.push(articles[i]);
    }
  }

  if (needTranslate.length > 0) {
    console.log(`[scheduler] ${needTranslate.length} 篇摘要失败，回退全量翻译…`);
    try {
      const translatedList = await batchTranslateArticles(needTranslate);
      for (let i = 0; i < translatedList.length; i++) {
        const detail = { ...translatedList[i], url: needTranslate[i].url };
        delete detail._needsTranslation;
        saveArticleDetail(detail);
        translated += 1;
      }
    } catch (error) {
      console.error(`[scheduler] 批量翻译失败 (${needTranslate.length} 篇): ${error.message}，存储未翻译版本`);
      for (const article of needTranslate) {
        const detail = { ...article, language: "zh-CN" };
        delete detail._needsTranslation;
        saveArticleDetail(detail);
        translated += 1;
      }
    }
  }

  if (allNewsItems.length > 0) {
    console.log(`[scheduler] 文章详情: ${summarized} 摘要 + ${translated} 全量翻译, ${cached} 已缓存, ${failed} 失败`);
  }
}

// 抓取所有仓库的 README 并存入数据库
// 快速路径：raw.githubusercontent.com HTTP 获取原文 Markdown（~0.5s/仓库）→ GLM 中文摘要
// 摘要失败回退 Qwen-MT 全量翻译；HTTP 获取失败的走 Chrome 兜底
async function prefetchAllReadmeDetails(repos) {
  let cached = 0;
  let summarized = 0;
  let translated = 0;
  let failed = 0;

  const urlsToFetch = [];
  for (const repo of repos) {
    if (!repo.url) continue;
    const normalizedUrl = repo.url.replace(/\/+$/, "");
    if (getReadmeDetail(normalizedUrl)) {
      cached += 1;
      continue;
    }
    urlsToFetch.push(normalizedUrl);
  }

  if (urlsToFetch.length === 0) return;

  // 快速路径：并发 HTTP 获取 raw README 原文（不翻译，留给摘要模型理解）
  console.log(`[scheduler] HTTP 获取 ${urlsToFetch.length} 个 README…`);
  const readmes = await parallelLimit(urlsToFetch, 5, async (url) => {
    try {
      return await fetchReadmeFast(url, { translate: false });
    } catch {
      return null;
    }
  });

  const needChrome = [];
  const fetchedReadmes = [];
  for (let i = 0; i < urlsToFetch.length; i++) {
    if (readmes[i]) {
      fetchedReadmes.push(readmes[i]);
    } else {
      needChrome.push(urlsToFetch[i]);
    }
  }

  // GLM 中文摘要（并发 5）
  const summaryResults = await parallelLimit(fetchedReadmes, 5, (readme) => summarizeReadme(readme));
  for (let i = 0; i < fetchedReadmes.length; i++) {
    const readme = fetchedReadmes[i];
    if (summaryResults[i]) {
      saveReadmeDetail({ url: readme.url, ...summaryResults[i] });
      summarized += 1;
    } else {
      // 回退：Qwen-MT 全量翻译
      try {
        const providerLabel = await translateReadmeBlocks(readme.blocks, readme.url);
        saveReadmeDetail({ ...readme, language: "zh-CN", translationProvider: providerLabel });
      } catch {
        saveReadmeDetail(readme);
      }
      translated += 1;
    }
  }

  // 慢速路径：Chrome 兜底
  if (needChrome.length > 0) {
    console.log(`[scheduler] Chrome 兜底获取 ${needChrome.length} 个 README…`);
    for (const url of needChrome) {
      try {
        const detail = await scrapeReadmeDetail(url);
        saveReadmeDetail(detail);
        summarized += 1;
      } catch {
        failed += 1;
      }
    }
  }

  console.log(`[scheduler] README 详情: ${summarized} 摘要 + ${translated} 全量翻译, ${cached} 已缓存, ${failed} 失败`);
}

// 定时调度：每分钟检查是否到达抓取整点（02:00 / 10:00 / 18:00）
const SCHEDULE_HOURS = [2, 10, 18];
let schedulerTimer = null;
let lastScrapeHour = -1;

export function startScheduler() {
  if (schedulerTimer) return;

  // 清理上次中断留下的未完成批次
  cleanupEmptyBatches();

  // 启动时立即执行一次抓取，保证页面尽快有最新数据
  runScrapeCycle("initial").catch((error) => {
    console.error(`[scheduler] 启动抓取失败: ${error.message}`);
  });

  console.log("[scheduler] 定时调度已启动（启动即抓取一次，之后每天 02:00 / 10:00 / 18:00 触发；每月 1 号 02:00 清空重抓）");

  // 每分钟检查是否需要触发
  schedulerTimer = setInterval(() => {
    const now = new Date();
    const hour = now.getHours();

    // 只在 02/10/18 整点后 5 分钟内触发，且每个整点只触发一次
    if (SCHEDULE_HOURS.includes(hour) && now.getMinutes() < 5 && hour !== lastScrapeHour) {
      lastScrapeHour = hour;
      console.log(`[scheduler] 定时触发 ${String(hour).padStart(2, "0")}:00 抓取`);
      runScrapeCycle("scheduled").catch((error) => {
        console.error(`[scheduler] 定时抓取失败: ${error.message}`);
      });
    }
  }, 60_000);
}

export function stopScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
