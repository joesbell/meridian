<p align="center">
  <img src="public/assets/brand/meridian-mark.png" width="96" alt="Meridian Logo" />
</p>

<h1 align="center">Meridian · 子午视界</h1>

<p align="center">
  <strong>一站聚合全球科技资讯与 GitHub 热榜，AI 全文翻译成中文。</strong><br/>
  好奇为眼，真实为岸，此刻为帆。
</p>

---

## 这是什么

Meridian 是一个自动运转的科技资讯聚合站：

- **每天 3 轮自动抓取** 23 家国际顶级科技媒体（TechCrunch、The Verge、MIT Technology Review、Ars Technica、Hacker News、STAT、36Kr……），覆盖 商业、科技产品、AI 大模型、编程、工具推荐、健康 6 大分类
- **GitHub Trending 官方榜单**今日 / 本周 / 本月三周期热榜，真实 Star 数与周期增量，不估算、不补零
- **AI 全程中文化**：标题、摘要、文章正文、项目 README 全部由大模型翻译润色（Qwen-MT 翻译 + GLM-4-Flash 摘要），产品名、代码、链接保留原文可核验
- **点开即读**：服务端后台预取正文和 README 并缓存，详情页毫秒级打开，沉浸式中文阅读
- **真实数据原则**：只展示真实抓到的内容，抓不到就空着，绝不用示例数据凑数

## 为什么用它

| 以前的姿势 | 用 Meridian 后 |
|---|---|
| 每天刷五六个英文科技站 | 打开一页，6 大分类尽收眼底 |
| 英文长文啃不动 | AI 翻译成自然流畅的中文，附要点摘要 |
| GitHub 热榜全是英文简介 | 简介和 README 都是中文，30 秒判断值不值得看 |
| 各站更新节奏不一 | 每天 02:00 / 10:00 / 18:00（北京时间）准时更新 |

## 运转机制

- 调度器每天 02:00 / 10:00 / 18:00 三个整点触发全量抓取（`server/scheduler.mjs`）
- RSS 优先，抓不到正文走 HTTP，再不行用 Scrapling 真实 Chrome 兜底（`scripts/scrape_live.py`）
- 摘要失败自动回退全量翻译，保证详情页永远有中文内容
- 每月 1 号 02:00 抓取前彻底清空数据库，重新抓取一轮，保持内容新鲜

## 视觉体验

Spline 3D 交互机器人、GSAP 动效、响应式三栏控制台布局，支持 `prefers-reduced-motion` 自动降动效。

## 技术栈

React 19 + Vite 6 前端 · 原生 Node.js 后端 · SQLite（better-sqlite3）持久化 · Python Scrapling 真实 Chrome 抓取 · 阿里云百炼 Qwen-MT / 智谱 GLM-4-Flash 中文化 · Docker 一键部署

## 本地运行

```bash
npm install
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env   # 填入 TRANSLATION_API_KEY（阿里云百炼）
npm run dev:all        # 打开 http://localhost:5173
```

## 部署

需要真实 Chrome 环境，不适用 Serverless，推荐自有 VPS + Docker：

```bash
docker build -t meridian-live .
docker run -d --name meridian-live --restart unless-stopped \
  --env-file .env -v meridian-data:/app/data -p 4173:4173 meridian-live
```

本项目生产环境使用 `npm run deploy` 一键发版（main 分支代码 → rsync → 服务器重建镜像 → 重启容器）。

## 验证

```bash
npm run build
npm run test:feed
npm run test:sites
```

视觉验收记录在 `design-qa.md`，架构细节见 `docs/ARCHITECTURE.md`。
