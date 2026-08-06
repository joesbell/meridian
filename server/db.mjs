// SQLite 数据库层：管理批次、新闻条目、GitHub 仓库、文章详情和 README 详情的持久化存储。
// 数据长期累积，每月 1 号 02:00 由 scheduler 彻底清空后重新抓取。
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(serverDir, "..");
const dataDir = path.join(projectDir, "data");
mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "radius.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ---- 建表 ----
db.exec(`
  CREATE TABLE IF NOT EXISTS batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time_label TEXT NOT NULL,
    batch_hour REAL NOT NULL,
    date TEXT NOT NULL,
    scrape_type TEXT NOT NULL DEFAULT 'scheduled',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS news_items (
    id TEXT PRIMARY KEY,
    batch_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT,
    source TEXT,
    source_url TEXT,
    url TEXT,
    image TEXT,
    published_at TEXT,
    lens TEXT,
    FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS repo_items (
    id TEXT PRIMARY KEY,
    batch_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    url TEXT,
    description TEXT,
    language TEXT,
    total_stars TEXT,
    period_growth TEXT,
    rank INTEGER,
    period TEXT,
    growth_daily TEXT,
    growth_weekly TEXT,
    growth_monthly TEXT,
    FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS article_details (
    url TEXT PRIMARY KEY,
    title TEXT,
    paragraphs TEXT,
    image TEXT,
    language TEXT,
    translation_provider TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS readme_details (
    url TEXT PRIMARY KEY,
    title TEXT,
    blocks TEXT,
    language TEXT,
    translation_provider TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_news_batch ON news_items(batch_id);
  CREATE INDEX IF NOT EXISTS idx_news_category ON news_items(category);
  CREATE INDEX IF NOT EXISTS idx_repo_batch ON repo_items(batch_id);
  CREATE INDEX IF NOT EXISTS idx_batch_date_hour ON batches(date, batch_hour);
`);

// 迁移：旧数据库可能没有 status 列
try {
  db.exec("ALTER TABLE batches ADD COLUMN status TEXT NOT NULL DEFAULT 'complete'");
} catch {
  // 列已存在，忽略
}

// 迁移：为按存入时间排序补充 created_at 列
try {
  db.exec("ALTER TABLE news_items ADD COLUMN created_at TEXT");
} catch {
  // 列已存在，忽略
}
try {
  db.exec("ALTER TABLE repo_items ADD COLUMN created_at TEXT");
} catch {
  // 列已存在，忽略
}
// 老数据用所属批次的创建时间回填；无批次的用 published_at 兜底
db.exec("UPDATE news_items SET created_at = (SELECT created_at FROM batches WHERE batches.id = news_items.batch_id) WHERE created_at IS NULL");
db.exec("UPDATE news_items SET created_at = published_at WHERE created_at IS NULL");
db.exec("UPDATE repo_items SET created_at = (SELECT created_at FROM batches WHERE batches.id = repo_items.batch_id) WHERE created_at IS NULL");
db.exec("UPDATE repo_items SET created_at = '' WHERE created_at IS NULL");
db.exec("CREATE INDEX IF NOT EXISTS idx_news_category_created ON news_items(category, created_at DESC)");
db.exec("CREATE INDEX IF NOT EXISTS idx_repo_created ON repo_items(created_at DESC)");

// 将各种来源的发布时间统一为 ISO UTC 字符串，保证可排序
// （RSS 多为 RFC 822 格式 "Tue, 28 Jul 2026 12:10:00 +0000"，字典序无法按时间排序）
function normalizeDateText(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const time = new Date(text).getTime();
  return Number.isNaN(time) ? text : new Date(time).toISOString();
}

// 迁移：把存量 published_at 统一为 ISO 格式
{
  const rows = db.prepare("SELECT id, published_at FROM news_items WHERE published_at IS NOT NULL AND published_at != ''").all();
  const update = db.prepare("UPDATE news_items SET published_at = ? WHERE id = ?");
  for (const row of rows) {
    const normalized = normalizeDateText(row.published_at);
    if (normalized && normalized !== row.published_at) update.run(normalized, row.id);
  }
}

// ---- 批次管理 ----

// 每月 1 号 02:00 抓取前调用：彻底清空全部表（事务内执行，失败整体回滚）。
// 清空后由 scheduler 立即重新抓取一轮，期间页面短暂无数据。
export function purgeAllData() {
  const tx = db.transaction(() => {
    db.exec("DELETE FROM news_items");
    db.exec("DELETE FROM repo_items");
    db.exec("DELETE FROM article_details");
    db.exec("DELETE FROM readme_details");
    db.exec("DELETE FROM batches");
  });
  tx();
}

// 创建新批次（状态为 pending），返回 batch id
export function createBatch(timeLabel, batchHour, scrapeType = "scheduled") {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const stmt = db.prepare(
    "INSERT INTO batches (time_label, batch_hour, date, scrape_type, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
  );
  const result = stmt.run(timeLabel, batchHour, date, scrapeType, now.toISOString());
  return Number(result.lastInsertRowid);
}

// 将批次标记为完成（所有详情已抓取存储完毕）
export function completeBatch(batchId) {
  db.prepare("UPDATE batches SET status = 'complete' WHERE id = ?").run(batchId);
}

// 存入新闻条目（批量）。已存在的 id 保留首次 created_at（重复抓到不置顶，保证滚动分页顺序稳定），
// 其余字段更新为最新内容；新条目按当前时间插入。
const insertNewsStmt = db.prepare(`
  INSERT INTO news_items
    (id, batch_id, category, title, summary, source, source_url, url, image, published_at, lens, created_at)
  VALUES (@id, @batch_id, @category, @title, @summary, @source, @source_url, @url, @image, @published_at, @lens, @created_at)
  ON CONFLICT(id) DO UPDATE SET
    batch_id = excluded.batch_id,
    category = excluded.category,
    title = excluded.title,
    summary = excluded.summary,
    source = excluded.source,
    source_url = excluded.source_url,
    url = excluded.url,
    image = excluded.image,
    published_at = excluded.published_at,
    lens = excluded.lens
`);
export function insertNewsItems(batchId, items) {
  const now = new Date().toISOString();
  const tx = db.transaction((rows) => {
    for (const row of rows) {
      insertNewsStmt.run({
        id: row.id,
        batch_id: batchId,
        category: row.category,
        title: row.title,
        summary: row.summary || "",
        source: row.source || "",
        source_url: row.sourceUrl || "",
        url: row.url || "",
        image: row.image || "",
        published_at: normalizeDateText(row.publishedAt),
        lens: row.lens || "",
        created_at: now,
      });
    }
  });
  tx(items);
}

// 存入仓库条目（批量），created_at 记录存入时间用于排序
const insertRepoStmt = db.prepare(`
  INSERT OR REPLACE INTO repo_items
    (id, batch_id, name, url, description, language, total_stars, period_growth, rank, period,
     growth_daily, growth_weekly, growth_monthly, created_at)
  VALUES (@id, @batch_id, @name, @url, @description, @language, @total_stars, @period_growth, @rank, @period,
          @growth_daily, @growth_weekly, @growth_monthly, @created_at)
`);
export function insertRepoItems(batchId, items) {
  const now = new Date().toISOString();
  const tx = db.transaction((rows) => {
    for (const row of rows) {
      insertRepoStmt.run({
        id: row.id,
        batch_id: batchId,
        name: row.name,
        url: row.url || "",
        description: row.description || "",
        language: row.language || "",
        total_stars: row.totalStars || "",
        period_growth: row.periodGrowth || "",
        rank: row.rank || 0,
        period: row.period || "daily",
        growth_daily: row.growth?.daily || "",
        growth_weekly: row.growth?.weekly || "",
        growth_monthly: row.growth?.monthly || "",
        created_at: now,
      });
    }
  });
  tx(items);
}

// ---- 文章/README 详情 upsert ----

const upsertArticleStmt = db.prepare(`
  INSERT OR REPLACE INTO article_details (url, title, paragraphs, image, language, translation_provider, created_at)
  VALUES (@url, @title, @paragraphs, @image, @language, @translation_provider, @created_at)
`);
export function saveArticleDetail(detail) {
  upsertArticleStmt.run({
    url: detail.url,
    title: detail.title || "",
    paragraphs: JSON.stringify(detail.paragraphs || []),
    image: detail.image || "",
    language: detail.language || "",
    translation_provider: detail.translationProvider || "",
    created_at: new Date().toISOString(),
  });
}

const upsertReadmeStmt = db.prepare(`
  INSERT OR REPLACE INTO readme_details (url, title, blocks, language, translation_provider, created_at)
  VALUES (@url, @title, @blocks, @language, @translation_provider, @created_at)
`);
export function saveReadmeDetail(detail) {
  upsertReadmeStmt.run({
    url: detail.url,
    title: detail.title || "",
    blocks: JSON.stringify(detail.blocks || []),
    language: detail.language || "",
    translation_provider: detail.translationProvider || "",
    created_at: new Date().toISOString(),
  });
}

// ---- 查询 ----

// 按分类取最新 limit 条新闻
// 排序：先按存入时间倒序（新批次优先），同批次内按发布时间倒序（published_at 已统一为 ISO 格式可直接排序）
export function getLatestNewsByCategory(category, limit = 15) {
  return db
    .prepare("SELECT * FROM news_items WHERE category = ? ORDER BY created_at DESC, published_at DESC, rowid ASC LIMIT ?")
    .all(category, limit)
    .map(rowToNewsItem);
}

// 游标（keyset）分页：取某分类排序键在 cursor 之后的 limit 条。
// cursor 为上一页末条目的 { c: created_at, p: published_at, r: rowid }，null 表示第一页。
// 返回 { items, nextCursor }：nextCursor 为末条目的排序键，供下次请求带回。
export function getNewsPageByCategory(category, cursor = null, limit = 5) {
  const base = "SELECT rowid AS _rowid, * FROM news_items WHERE category = @category";
  const order = " ORDER BY created_at DESC, published_at DESC, rowid ASC LIMIT @limit";
  const params = { category, limit };
  const rows = cursor
    ? db.prepare(`${base} AND (created_at < @c OR (created_at = @c AND published_at < @p) OR (created_at = @c AND published_at = @p AND rowid > @r))${order}`)
        .all({ ...params, c: cursor.c, p: cursor.p, r: cursor.r })
    : db.prepare(`${base}${order}`).all(params);
  const items = rows.map(rowToNewsItem);
  const last = rows[rows.length - 1];
  const nextCursor = last ? { c: last.created_at, p: last.published_at || "", r: last._rowid } : null;
  return { items, nextCursor };
}

// 批量获取文章详情，返回 { url: detail } 映射（供分页接口内联详情）
export function getArticleDetails(urls) {
  const result = {};
  if (!urls.length) return result;
  const stmt = db.prepare(`SELECT * FROM article_details WHERE url IN (${urls.map(() => "?").join(",")})`);
  for (const row of stmt.all(...urls)) {
    result[row.url] = {
      title: row.title,
      paragraphs: JSON.parse(row.paragraphs || "[]"),
      image: row.image,
      url: row.url,
      language: row.language,
      translationProvider: row.translation_provider,
    };
  }
  return result;
}

// 按周期取最新 limit 个仓库（按存入时间倒序；同批次内按排名）
export function getLatestRepos(limit = 15, period = "daily") {
  return db
    .prepare("SELECT * FROM repo_items WHERE period = ? ORDER BY created_at DESC, rank ASC LIMIT ?")
    .all(period, limit)
    .map(rowToRepoItem);
}

// 获取文章详情
export function getArticleDetail(url) {
  const row = db.prepare("SELECT * FROM article_details WHERE url = ?").get(url);
  if (!row) return null;
  return {
    title: row.title,
    paragraphs: JSON.parse(row.paragraphs || "[]"),
    image: row.image,
    url: row.url,
    language: row.language,
    translationProvider: row.translation_provider,
  };
}

// 获取 README 详情
export function getReadmeDetail(url) {
  const row = db.prepare("SELECT * FROM readme_details WHERE url = ?").get(url);
  if (!row) return null;
  return {
    title: row.title,
    blocks: JSON.parse(row.blocks || "[]"),
    url: row.url,
    language: row.language,
    translationProvider: row.translation_provider,
  };
}

// 检查是否有任何已存入的数据
export function hasData() {
  const row = db.prepare("SELECT COUNT(*) as count FROM news_items").get();
  if (row.count > 0) return true;
  return db.prepare("SELECT COUNT(*) as count FROM repo_items").get().count > 0;
}

// 清理未完成或空的批次（抓取中断产生的 pending 批次）
export function cleanupEmptyBatches() {
  db.exec(`
    DELETE FROM batches WHERE status = 'pending'
  `);
}

// 获取已收录的 URL 白名单（用于 SSRF 防护的 article/image 请求）
export function getCollectedUrls() {
  const urls = new Set();
  const addSafe = (url) => {
    if (url && /^https?:\/\//.test(url)) {
      try {
        urls.add(new URL(url).toString());
      } catch {
        // skip invalid URLs
      }
    }
  };
  for (const row of db.prepare("SELECT url, image FROM news_items").all()) {
    addSafe(row.url);
    addSafe(row.image);
  }
  for (const row of db.prepare("SELECT url FROM repo_items").all()) {
    addSafe(row.url);
  }
  for (const row of db.prepare("SELECT image FROM article_details").all()) {
    addSafe(row.image);
  }
  return urls;
}

// ---- 行映射函数 ----

function rowToNewsItem(row) {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    summary: row.summary,
    source: row.source,
    sourceUrl: row.source_url,
    url: row.url,
    image: row.image,
    publishedAt: row.published_at,
    lens: row.lens,
    createdAt: row.created_at,
  };
}

function rowToRepoItem(row) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    description: row.description,
    language: row.language,
    totalStars: row.total_stars,
    periodGrowth: row.period_growth,
    rank: row.rank,
    period: row.period,
    growth: {
      daily: row.growth_daily,
      weekly: row.growth_weekly,
      monthly: row.growth_monthly,
    },
    createdAt: row.created_at,
  };
}

export function closeDb() {
  db.close();
}
