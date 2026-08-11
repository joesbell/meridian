# Meridian Live Edition — 上线就绪审查报告

> 审查方式：16 个 AI agent（5 维度并行分析 + 11 个高危发现对抗验证），2026-08-03
> 结论：**代码架构质量不错（SSRF 防护、三级降级、批次模型都是加分项），但按 README 的 Docker 路线现在部署必失败；另有一个公网暴露的滥用缺口和一个需要你拍板的版权战略问题。**

---

## 一、第一性原理：上线 = 四件事

| 命题 | 现状判定 |
|---|---|
| **构建可复现**：任何人在任何机器按文档能构建出能跑的镜像 | ❌ 必失败（Node 版本不匹配） |
| **进程可存活**：无人值守跑 30 天不死、不乱 | ⚠️ 大体可以，有 3 个慢性问题 |
| **接口可防身**：公网暴露后不被滥用、不烧钱 | ❌ /api/refresh 无门槛可循环触发 |
| **内容可辩护**：被出版方/Google/GitHub 找上门时说得清 | ⚠️ 全文重发布模式需要你决策 |

---

## 二、上线前必须修（Blocker）

### B1. Dockerfile 装的 Node 版本跑不起 better-sqlite3 —— 镜像能构建，容器启动即崩
- **证据**：`Dockerfile:3-5` 用 Debian apt 装 nodejs（scrapling 基底是 bookworm，apt 源 = Node 18）；但 `better-sqlite3@13` 要求 Node ≥22，预编译二进制按 Node-API v10 编译，Node 18 只支持 ≤v9。`npm ci` 只报警告能装完，**镜像构建成功**，但 `server/db.mjs:3` 顶层 import，容器启动即 crash。
- **影响**：README 唯一文档化的部署路线开箱即坏。
- **修复**（二选一）：
  ```dockerfile
  # 方案 A：NodeSource 装 Node 22
  RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs && rm -rf /var/lib/apt/lists/*
  # 方案 B（更干净）：多阶段构建，node:22-bookworm 做 npm ci + build，
  # 再把 node_modules 和 dist 拷进 scrapling 运行时镜像
  ```

### B2. /api/refresh 无鉴权、无冷却、无方法限制 —— 任何人一个 while 循环让你永不停抓
- **证据**：`server/feedApi.mjs:223` 任意 GET 即触发完整抓取周期（23 个 RSS + Chrome + 付费翻译）；`scheduler.mjs:47-53` 的互斥锁只串行排队不拒绝，队列无上限。跨站 `<img src=".../api/refresh">` 都能触发。
- **验证校准**：账单不会无限烧（详情有 DB 缓存，重复刷新边际成本低），但服务器会被压着持续抓取、出站 IP 有被 RSS 源/GitHub 封的风险。定为 high，但修复只要 10 行，放 blocker 档一起修。
- **修复**：
  ```js
  // feedApi.mjs handleRefresh 前加冷却
  let lastRefreshAt = 0;
  // 若正在抓或距上次 < 10 分钟：return { started: false, scraping: true }
  ```

---

## 三、上线后很快会咬人（High，建议同一批修）

### H1. requirements.txt 从没被安装 + base 镜像 :latest 漂移
`Dockerfile:8` COPY 了 requirements.txt 但无 `pip install`；运行时 scrapling 版本 = 构建那一刻 `ghcr.io/d4vinci/scrapling:latest` 碰巧的版本。上游发新版改 API 后，某次重建镜像爬虫静默全挂。**修复**：Dockerfile 加 `RUN pip install --no-cache-dir -r requirements.txt`，base 镜像钉具体 tag。

### H2. data/ 未进 .dockerignore + README 启动命令没挂卷
本机 8MB 的 meridian.db 会被 `COPY . .` 打进镜像；容器替换时库随容器销毁（翻译缓存全丢 = Qwen-MT 重译费用）。**修复**：`.dockerignore` 加 `data/`；`docker run` 加 `-v meridian-data:/app/data`。（db.mjs:11 已有 mkdirSync，无需改代码）

### H3. 图片代理白名单只校验初始 URL，重定向可逃逸
`feedApi.mjs:136-147` 白名单只查用户提交的 URL；`scraper.mjs:146-158` 的重定向循环每跳只重跑 SSRF 校验、不重验白名单；且 `google.com` / `.mzstatic.com` 无条件放行。攻击者找到白名单域上的开放重定向即可把你的服务器当匿名图片代理跳板。**修复**：`fetchWithRedirectGuard` 加 per-hop 白名单回调（改动集中在一处）。

---

## 四、应修（Medium，一周内）

| # | 问题 | 位置 | 一句话修复 |
|---|---|---|---|
| M1 | 无优雅停机：docker stop 硬杀进行中的抓取；Chrome 孤儿进程靠 PID1(node) 回收不了 | `start.mjs:62-68` | docker run 加 `--init`；start.mjs 加 SIGTERM handler（server.close + db.close） |
| M2 | 静态资源零缓存头：MB 级 three.js/Spline bundle 每次访问全量重下 | `start.mjs:40-43` | `/assets/` 路径加 `max-age=31536000, immutable`，index.html 加 `no-cache` |
| M3 | /api/image 无服务端缓存：同一张图每个新访客都重新回源，可被刷带宽 | `feedApi.mjs:134` | 进程内 Map 缓存（key=url, 2h TTL，超 500 条 clear） |
| M4 | getCollectedUrls() 每次请求 3 次全表同步扫描，图片请求多时阻塞事件循环 | `db.mjs:340` | 模块级缓存 Set，入库/清理时置脏 |
| M5 | 全站无 HTTP 安全头（CSP/nosniff/frame-deny） | `start.mjs:40` | createServer 回调开头统一 setHeader 四行 |
| M6 | 错误响应把 Python stderr/内部路径原样回给客户端 | `scraper.mjs:788`、`start.mjs:55` | 502 分支 detail 改固定文案，原始错误只进服务端日志 |
| M7 | /api/feed 每次全量拼 ~200KB JSON，no-store 无 ETag，轮询期带宽随用户数线性放大 | `feedApi.mjs:274` | ETag = updatedAt 哈希，If-None-Match 返回 304 |
| M8 | 前端初始轮询无超时无退避：后端可达但数据永不就绪时每个标签页 17,280 次/天请求 | `App.jsx:763` | 加 10 分钟上限或指数退避，超时转 Offline404 |
| M9 | GitHub Trending 用伪装 Chrome 抓 + UA 伪装 fetch，有 IP 被封风险 | `scrape_live.py:18-24` | 速率已克制可保留；换诚实 UA；长期改官方 Search API 近似 trending |
| M10 | SQLite 常驻数百篇受版权全文 + 图片代理替访客盗链，放大版权敞口（见 S1） | `db.mjs`、`feedApi.mjs:210` | 取决于 S1 的决策 |

## 五、可以缓一缓（Low）

- **L1** 00:00 清理绑死 5 分钟窗口，错过当天不清理——但 INSERT OR REPLACE 去重 + 下次清理自愈，实际只是"偶发延迟一天"。改 `lastPruneDate` 判断更稳。
- **L2** 定时抓取 5 分钟触发窗口被系统休眠跨过会静默丢 2 小时槽位——改用"2h slot 是否已抓"判断可补抓。
- **L3** Google Translate 降级端点违反 Google ToS——仅在 Qwen-MT 挂时触发，最坏显示英文原文，可留作备注。
- **L4** 前端 canvas 每帧全屏网格 ~2700 次 stroke + Spline WebGL，移动端发热耗电——reduced/coarse 时画静态帧即可。
- **L5** 客户端直连 Google favicon 泄露访客 IP；详情页无"AI 翻译仅供参考"免责声明——各一行修复。
- **L6** 已被验证推翻：~~Scrapling 子进程 SIGTERM 死锁~~（Python 无信号处理器，SIGTERM 直接内核终止，链条不成立）。

---

## 六、战略决策：S1 版权敞口（需要你拍板，不是代码问题）

**代码事实**（已验证）：系统抓取 23 家媒体全文（RSS content:encoded + HTTP + Chrome 三级），翻译后经 `/api/article` 在公网重发布；全库无 robots.txt 检查；HBR/STAT/CNBC/Wired/MIT TR 的 ToS 均禁止系统性抓取与再发布。

**缓解事实**：付费墙源（HBR/STAT）实际抓不到正文（paragraphs<2 抛错）；最现实后果是 DMCA 转发通知（有合规窗口），不是直接停机；全文 RSS 聚合+署名回链是广泛存在的行业实践。

**三个选项**：
1. **保持全文模式但非公网**（本机/内网/密码保护）——零法律风险，保留全部体验。
2. **收窄为「标题+摘要+原文跳转」公网上线**——删掉三级全文抓取和 /api/article，移除 HBR/STAT 源；Dev.to/GitHub Blog 等开源友好源可保留详情。
3. **全文模式直接公网**——接受 DMCA 风险，收到通知即下架。个人低流量站大概率相安无事，但数据库里常驻数百篇双语全文使"持久复制"的定性比"瞬时缓存"重得多。

---

## 七、推荐修复顺序（约一天工作量）

```
第 1 小时（能跑）：B1 Dockerfile Node 22 + H1 pip install + H2 .dockerignore/挂卷
第 2 小时（防身）：B2 refresh 冷却 + M5 安全头 + M6 错误文案
第 3 小时（省钱）：M3 图片内存缓存 + M4 白名单缓存 + M2 静态缓存头
第 4 小时（加固）：H3 重定向白名单 + M1 优雅停机 + M7 ETag
之后：       M8/M9/L 系列按需；S1 决策先于域名解析上线
```

**验证清单**：修完后 `docker build` 在干净 clone 上跑通 → 容器启动后有数据 → `curl` 连打 /api/refresh 第二次返回 started:false → DevTools 确认 /assets/* 有 immutable 头 → docker stop 观察日志有优雅退出。
