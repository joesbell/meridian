# 架构调整设计：定时抓取 ×3、滚动分页、详情中文摘要

日期：2026-08-04

## 背景

原架构：每 2 小时（偶数整点）抓取一轮，每日 00:00 保留式清理（每类留 20 条），前端每分类展示 15 条，左右栏有手动刷新按钮（Turnstile 防脚本），详情为逐段全量翻译。

## 变更总览

1. 移除左右栏手动刷新按钮及整套 Turnstile 防机器人机制（前端 widget + `/api/refresh` + `verifyTurnstile`）。
2. 抓取频率：每天 **02:00 / 10:00 / 18:00** 三次整点抓取。
3. 数据保留：不再每日清理；**每月 1 号 02:00** 抓取前 `purgeAllData()` 彻底清空全部表，然后立即重新抓取。
4. 重复文章：同一 id 重复抓到保留首次 `created_at`（不置顶），保证分页顺序稳定。
5. 新闻列表：每分类每次 5 条；滚动触底触发 `/api/news/page?category&cursor` 游标分页（keyset），响应内联该 5 条的中文摘要详情；不足 5 条或空则该分类停止加载。GitHub 反显逻辑不变（每周期 15 条）。
6. 详情数据生成：文章详情 + README 改为 **GLM-4-Flash（智谱，免费）理解后输出中文要点总结**（`{title_zh, points[]}`），不再是逐段硬翻译；列表标题/摘要翻译不变（Qwen-MT）。降级链：GLM → Qwen-MT 全量翻译 → Google 翻译。
7. 前端轮询：02/10/18 整点后 **5 分钟**窗口内每 30 秒查 `/api/feed`，`updatedAt` 变化即停；窗口外不轮询。
8. ProfileCard（Jason 卡片）移到整页底部居中（footer 上方），尺寸缩小约 0.8 倍。
9. 一次性操作：实施完成后删除 `data/meridian.db*`，重启服务触发首轮抓取。

## 后端

### scheduler.mjs
- 触发条件改为 `hour ∈ {2, 10, 18}` 且整点后 5 分钟内、每整点只触发一次。
- 每月 1 号 02:00 先 `purgeAllData()` 再走正常抓取（scrapeType `monthly-reset`）。
- 启动立即抓取保留（scrapeType `initial`）。
- 删除 `refresh` 分支；`runScrapeCycle` 不再被 HTTP 层调用。
- 详情预取：文章/README 抓取后走 GLM 摘要生成（并发 ≤5），失败回退 Qwen-MT 全量翻译 → Google。

### db.mjs
- `insertNewsItems`：已存在 id 保留原 `created_at`（INSERT OR IGNORE 语义，内容可更新但入库时间不动）。
- 新增 `getNewsPageByCategory(category, cursor, limit=5)`：按 `(created_at DESC, published_at DESC, rowid ASC)` keyset 翻页。
- 新增 `getArticleDetails(urls)` 批量查详情，供分页接口内联。
- 新增 `purgeAllData()`：事务清空全部表。

### feedApi.mjs
- 新闻 `FEED_LIMIT` 15 → 5；GitHub 仍 15。
- 新增 `GET /api/news/page?category=<id>&cursor=<opaque>` → `{ items, details, nextCursor, exhausted }`。
- 删除 `/api/refresh`、`handleRefresh`、`verifyTurnstile`。
- `/api/article`、`/api/repo` 实时兜底路径也改为 GLM 摘要（与批量路径一致）。

### summarize（新，server/summarize.mjs）
- Node 直接 fetch 智谱 OpenAI 兼容端点（`SUMMARY_API_URL`，默认 `https://open.bigmodel.cn/api/paas/v4/chat/completions`）。
- 环境变量：`SUMMARY_API_KEY` / `SUMMARY_MODEL=glm-4-flash` / `SUMMARY_API_URL`。
- 输入正文/README，输出 `{ title_zh, points: [3~6 个中文要点] }`，存入现有 `paragraphs`/`blocks` 字段，schema 不变；`translation_provider` 记 "GLM-4-Flash 中文摘要"。

## 前端（App.jsx / styles.css）

- 删除 `RailHeader` 刷新按钮、`useTurnstile`、手动刷新状态与轮询；`LiveError` 重试改为 `loadFeed`。
- 定时轮询窗口：`hour ∈ {2,10,18}` 且分钟 < 5，窗口内每 30 秒查一次。
- 新闻 `.rail__scroll` onScroll 触底（距底 <200px、非加载中、未 exhausted）→ 请求下一页并追加；详情写入本地缓存供详情页秒开，`/api/article` 仍作兜底。
- 各分类分页状态（cursor/exhausted）独立保留，切换分类不丢失。
- ProfileCard 移至 `site-footer` 上方独立居中区块，缩放约 0.8。
- footer 文案改为「每日 02:00 / 10:00 / 18:00 自动同步」。

## 错误处理与测试

- 分页接口失败：前端静默，下次触底重试。
- 月度清空在事务内，失败整体回滚不抓取。
- GLM 摘要失败逐篇回退旧翻译链，详情页不为空。
- 更新 `tests/feed-api.test.mjs`：分页游标、不足 5 条、空结果、category 校验；db 层补 created_at 保留与 purgeAllData 用例。
