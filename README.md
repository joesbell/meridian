# RADIUS / LIVE EDITION

一个 React 驱动的全球新闻与 GitHub 热榜阅读器。

## 已实现

- 两栏阅读体验：每日新闻简报 + GitHub 实时热榜。
- 新闻端读取 TechCrunch、The Verge、MIT Technology Review、Ars Technica、GitHub Blog、Hacker News、STAT、36Kr 等公开信源，再由 Scrapling 抓取页面、正文与受热链限制的图片。只要取得一条真实内容就会显示，不会为了凑满 15 条而补入示例。
- 新闻覆盖 AI / 大模型、科技产品、投资 / 美股、创业 / 商业、编程 / Codex、健康 / 医学，并标记重要新闻、行业趋势、工具推荐。
- GitHub 端抓取官方 Trending 的今日 / 本周 / 本月页面，每个周期最多显示 15 条真实结果；列表展示当前总 Star 及今天、本周、本月的官方增量。某仓库不在另一周期的榜单中时显示“—”，不会补零或估算。
- 两个栏目均支持手动刷新；打开页面后每两小时自动抓取一次。服务端缓存时长也是两小时，避免重复抓取。
- 首页首次取得列表后，服务端会在后台依次预抓取新闻正文和当前 GitHub 榜单仓库的 README，完成中文本地化并写入两小时缓存；点击详情时优先读取缓存。
- 首次抓取确认断网且两栏都没有数据时，页面会显示 React Bits Fuzzy Text 风格的 404；单个来源失败或仍有任意真实数据时继续展示首页。
- GSAP 仅用于低干扰淡入与刷新反馈；交互不再移动正文、缩放图片或持续追随鼠标，保留 `prefers-reduced-motion` 的浏览器默认降动效能力。

## 本地运行

```bash
npm install
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
npm run dev -- --port 4173
```

打开 `http://localhost:4173`。

## 中文呈现

界面、新闻标题、摘要、详情正文、GitHub 项目简介和 README 均显示简体中文。为避免逐词硬译，推荐使用大模型做中文本地化（任意 OpenAI 兼容接口均可，默认 DeepSeek）：

```bash
cp .env.example .env
# 编辑 .env，填入 TRANSLATION_API_KEY
```

服务器启动时会自动加载 `.env`。未配置密钥时仍会使用 Google Translate 降级路径，但中文润色质量不如大模型。产品名、仓库名、编程语言、代码、URL 和数字保持原样，原始链接始终保留用于核验。

## 独立发布路径：GitHub + 自有服务器 + Docker + 自有域名

Scrapling 需要真实 Chrome 进程，不适合普通 Vercel Serverless 函数。项目已包含 `Dockerfile` 和独立生产服务器，推荐部署到你自己控制的 Ubuntu 云服务器；代码、域名、缓存和抓取进程都归你。

1. 在 GitHub 新建自己的仓库，把本目录推送到 `main`。
2. 在自己的云服务器安装 Docker，克隆仓库并进入项目目录。
3. 构建并启动：

```bash
docker build -t radius-live .
docker run -d --name radius-live \
  --restart unless-stopped \
  --env-file .env \
  -p 4173:4173 \
  radius-live
```

4. 在 Cloudflare 或域名注册商中，把域名的 A 记录指向服务器公网 IP。
5. 使用 Caddy 或 Nginx 把 `https://你的域名` 反向代理到 `http://127.0.0.1:4173`，并开启 HTTPS。
6. 更新时执行 `git pull`，重新构建镜像并替换容器。

## 上线前的一个现实建议

本地和单实例部署使用两小时内存缓存，适合个人使用与低流量站点。若网站有多人同时访问，建议接入自己账号下的 Redis，并用两小时定时任务预热抓取；这样不同访问者共享同一份快照，服务重启也不丢缓存。

## 验证

```bash
npm run build
npm run test:sites
```

视觉验收记录在 `design-qa.md`。
