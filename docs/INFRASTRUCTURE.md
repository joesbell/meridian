# Meridian · 线上部署架构总览

> 站点：https://joesbell.top · 本文讲"网站是怎么跑起来、怎么被访问到的"；代码内部结构见 [ARCHITECTURE.md](ARCHITECTURE.md)。

---

## 一、访问链路全景图

```mermaid
flowchart TB
    subgraph USER["🌐 访问者"]
        B["浏览器<br/>本地缓存：JS/CSS 指纹文件永久缓存<br/>其余文件 ETag 协商（没变 → 304 秒回）"]
    end

    subgraph CF["☁️ Cloudflare 边缘层 · joesbell.top"]
        DNS["DNS 解析 + 反向代理<br/>隐藏源站真实 IP · 抗 DDoS"]
        CACHE["边缘缓存<br/>JS/CSS 默认缓存 HIT<br/>Cache Rule：/assets/* 强制缓存 4h（3D 机器人、图片）<br/>HTML 不缓存，发版即时生效"]
        DNS --> CACHE
    end

    subgraph VPS["🖥️ RackNerd VPS · 美国 · 1GB RAM + 3GB swap"]
        CADDY["Caddy :80/:443<br/>自动续期 Let's Encrypt 证书<br/>zstd/gzip 压缩 → 反代 127.0.0.1:4173"]

        subgraph DOCKER["🐳 Docker 容器 meridian-live"]
            direction TB
            NODE["Node.js 服务<br/>start.mjs 静态托管 + feedApi.mjs 数据接口<br/>keyset 游标分页 · 头条热度提升 · 图片反代"]
            SCHED["⏰ 调度器<br/>每天 02:00 / 10:00 / 18:00 采集<br/>启动即采一次 · 每月 1 号清库重抓"]
            PIPE["🕷️ 采集管线<br/>RSS → HTTP → Scrapling 无头 Chrome 三级降级<br/>串行队列 · 150s 超时强杀 + 2s 强制结算<br/>按名补杀逃逸 Chrome"]
            AI["🤖 中文化管线<br/>GLM-4-Flash 摘要 → Qwen-MT 翻译<br/>→ Google Translate 兜底"]
            DB[("🗄️ SQLite · WAL<br/>Docker 数据卷 meridian-data<br/>发版不丢数据")]
            SCHED --> PIPE --> AI --> DB
            NODE --> DB
        end

        CADDY --> DOCKER

        subgraph SYS["系统层"]
            F2B["🛡️ fail2ban<br/>SSH 暴力破解自动封 IP"]
            PANEL["🎛️ 1Panel<br/>服务器可视化管理面板（仅本地）"]
        end
    end

    subgraph EXT["🌍 外部数据源"]
        RSS["23 家科技媒体 RSS"]
        GH["GitHub Trending"]
        LLM["智谱 GLM · 阿里云百炼 Qwen<br/>Google Translate"]
    end

    B -->|https| DNS
    CACHE -->|未命中回源| CADDY
    PIPE --> RSS & GH
    AI --> LLM

    classDef browser fill:#0c4a6e,stroke:#38bdf8,color:#e0f2fe,stroke-width:2px
    classDef cf fill:#f6821f,stroke:#c2610c,color:#fff,stroke-width:2px
    classDef caddy fill:#134e4a,stroke:#2dd4bf,color:#ccfbf1,stroke-width:2px
    classDef container fill:#1e293b,stroke:#818cf8,color:#e0e7ff,stroke-width:2px
    classDef inner fill:#312e81,stroke:#818cf8,color:#e0e7ff
    classDef db fill:#14532d,stroke:#4ade80,color:#dcfce7,stroke-width:2px
    classDef sys fill:#3f3f46,stroke:#a1a1aa,color:#e4e4e7
    classDef ext fill:#4a044e,stroke:#e879f9,color:#fae8ff

    class B browser
    class DNS,CACHE cf
    class CADDY caddy
    class NODE,SCHED,PIPE,AI inner
    class DB db
    class F2B,PANEL sys
    class RSS,GH,LLM ext
```

---

## 二、三级缓存：一次刷新到底发生了什么

```mermaid
flowchart LR
    REQ["🔄 浏览器刷新"] --> L1{"① 浏览器本地缓存<br/>指纹文件永久有效<br/>其余带 ETag 问一句"}
    L1 -->|没变| R304["⚡ 304 直接用本地<br/>几百字节，毫秒级"]
    L1 -->|要取文件| L2{"② Cloudflare 边缘缓存<br/>/assets/* 4h · JS/CSS 默认缓存"}
    L2 -->|HIT 命中| RHIT["⚡ 就近节点直接发<br/>不碰美国源站"]
    L2 -->|MISS 未命中| L3["③ 回源 VPS<br/>Node 服务器出文件<br/>CF 顺便存一份给下个人"]
    L3 --> L2

    classDef step fill:#1e293b,stroke:#38bdf8,color:#e0f2fe,stroke-width:2px
    classDef fast fill:#14532d,stroke:#4ade80,color:#dcfce7,stroke-width:2px
    classDef slow fill:#7f1d1d,stroke:#f87171,color:#fee2e2,stroke-width:2px
    class REQ,L1,L2 step
    class R304,RHIT fast
    class L3 slow
```

**分工**：Cloudflare 缓存管"第一次访问/别的访客"的跨国速度；ETag 管"你自己反复刷新"的秒开 + 发版后内容一变指纹就变、绝不错用旧文件。两层互补，缺一不可。

---

## 三、部署链路

```mermaid
flowchart LR
    DEV["💻 本地<br/>git commit"] --> ARCH["📦 git archive main<br/>导出干净副本"]
    ARCH --> SSH["🔐 rsync over SSH<br/>双通道：3 秒直连优先<br/>不通自动回落 Clash 代理 :7897"]
    SSH --> BUILD["🔨 VPS 上 docker build<br/>含 Playwright + Chrome 环境"]
    BUILD --> SWAP["♻️ 替换容器<br/>--init tini 回收僵尸进程<br/>--restart unless-stopped<br/>TZ=Asia/Shanghai"]
    SWAP --> LIVE["✅ https://joesbell.top"]

    GH["GitHub<br/>只做代码备份<br/>不在部署链路里"]
    DEV -.->|git push| GH

    classDef local fill:#0c4a6e,stroke:#38bdf8,color:#e0f2fe,stroke-width:2px
    classDef net fill:#713f12,stroke:#fbbf24,color:#fef3c7,stroke-width:2px
    classDef build fill:#312e81,stroke:#818cf8,color:#e0e7ff,stroke-width:2px
    classDef done fill:#14532d,stroke:#4ade80,color:#dcfce7,stroke-width:2px
    classDef backup fill:#3f3f46,stroke:#a1a1aa,color:#e4e4e7
    class DEV,ARCH local
    class SSH net
    class BUILD,SWAP build
    class LIVE done
    class GH backup
```

---

## 四、组件速查表

| 组件 | 角色 | 关键配置 |
|---|---|---|
| **Cloudflare** | DNS + 代理 + 边缘缓存 | Cache Rule：`joesbell.top/assets/*` 缓存 4h |
| **Caddy** | HTTPS 入口 + 反代 | 自动证书；`reverse_proxy 127.0.0.1:4173` |
| **Docker 容器** | 应用唯一运行环境 | `--init` · `TZ=Asia/Shanghai` · 数据卷 `meridian-data` |
| **Node 服务** | 静态托管 + API | 哈希文件 immutable 1 年；public 文件 ETag 协商缓存 |
| **调度器** | 定时采集 | 02:00 / 10:00 / 18:00 北京时间，每月 1 号清库 |
| **Scrapling + Chrome** | 硬骨头页面渲染抓取 | 串行队列，超时强杀 + 强制结算，逃逸进程按名补杀 |
| **GLM-4-Flash / Qwen-MT** | 中文化 | 摘要 60s 超时，失败逐级降级，兜底 Google Translate |
| **SQLite** | 数据持久化 | WAL 模式，Docker 卷内，发版不丢 |
| **fail2ban** | SSH 防暴力破解 | sshd jail，试错自动封 IP |
| **1Panel** | 服务器管理面板 | 仅监听 127.0.0.1:18080 |
| **SSH 双通道** | 部署网络保障 | `~/.ssh/config`：直连优先，回落 Clash 代理 |
