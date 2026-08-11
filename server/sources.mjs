// 新闻数据源配置：按 6 个分类组织，每个分类包含多个国际知名权威源。
// bias 字段保留为兜底分类，但源已按 categoryId 预分类，优先使用 categoryId。

export const CATEGORIES = [
  { id: "商业", label: "商业", icon: "ChartLine" },
  { id: "科技产品", label: "科技产品", icon: "DeviceMobile" },
  { id: "AI大模型", label: "AI大模型", icon: "Brain" },
  { id: "编程", label: "编程", icon: "Code" },
  { id: "工具推荐", label: "工具推荐", icon: "Wrench" },
  { id: "健康", label: "健康", icon: "Heartbeat" },
];

// 每个分类的数据源：涵盖国际知名科技/商业媒体（2026-08 用抓取器 UA 逐一实测可用）
export const NEWS_SOURCES = [
  // —— 商业 ——
  { name: "TechCrunch", url: "https://techcrunch.com/feed/", categoryId: "商业" },
  { name: "36Kr", url: "https://36kr.com/feed", categoryId: "商业" },
  { name: "CNBC Business", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147", categoryId: "商业" },
  { name: "Harvard Business Review", url: "https://hbr.org/the-latest/rss", categoryId: "商业" },
  { name: "MarketWatch", url: "https://feeds.marketwatch.com/marketwatch/topstories/", categoryId: "商业" },
  { name: "WSJ Business", url: "https://feeds.a.dj.com/rss/WSJcomUSBusiness.xml", categoryId: "商业" },

  // —— 科技产品 ——（Wired 已移除：RSS 全是广告营销文案）
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml", categoryId: "科技产品" },
  { name: "Engadget", url: "https://www.engadget.com/rss.xml", categoryId: "科技产品" },
  { name: "Gizmodo", url: "https://gizmodo.com/rss", categoryId: "科技产品" },
  { name: "TechRadar", url: "https://www.techradar.com/rss", categoryId: "科技产品" },
  { name: "CNET", url: "https://www.cnet.com/rss/news/", categoryId: "科技产品" },
  { name: "9to5Mac", url: "https://9to5mac.com/feed/", categoryId: "科技产品" },

  // —— AI 大模型 ——（AI News 已移除：厂商软文居多）
  { name: "MIT Technology Review", url: "https://www.technologyreview.com/feed/", categoryId: "AI大模型" },
  { name: "VentureBeat AI", url: "https://venturebeat.com/category/ai/feed/", categoryId: "AI大模型" },
  { name: "The Register AI", url: "https://www.theregister.com/ai/headlines.atom", categoryId: "AI大模型" },
  { name: "OpenAI News", url: "https://openai.com/news/rss.xml", categoryId: "AI大模型" },
  { name: "Google DeepMind", url: "https://deepmind.google/blog/rss.xml", categoryId: "AI大模型" },
  { name: "量子位", url: "https://qbitai.com/feed", categoryId: "AI大模型" },

  // —— 编程 ——
  { name: "GitHub Blog", url: "https://github.blog/feed/", categoryId: "编程" },
  { name: "Dev.to", url: "https://dev.to/feed", categoryId: "编程" },
  { name: "The New Stack", url: "https://thenewstack.io/feed/", categoryId: "编程" },
  { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", categoryId: "编程" },
  { name: "Stack Overflow Blog", url: "https://stackoverflow.blog/feed/", categoryId: "编程" },
  { name: "freeCodeCamp", url: "https://www.freecodecamp.org/news/rss/", categoryId: "编程" },

  // —— 工具推荐 ——（Lifehacker 已移除：内容已 SEO 农场化）
  { name: "Hacker News", url: "https://hnrss.org/frontpage", categoryId: "工具推荐" },
  { name: "Product Hunt", url: "https://www.producthunt.com/feed", categoryId: "工具推荐" },
  { name: "少数派", url: "https://sspai.com/feed", categoryId: "工具推荐" },
  { name: "小众软件", url: "https://www.appinn.com/feed/", categoryId: "工具推荐" },

  // —— 健康 ——
  // 已用抓取器的 UA 逐一实测（2026-08）：以下源均可正常返回 RSS。
  // Mayo Clinic / Healthline / Drugs.com / Cochrane / WebMD 被 Cloudflare 拦截（403/超时），
  // PubMed 无通用 RSS、UpToDate 需订阅、MedlinePlus 只有按主题的百科更新源、Cancer.org 未找到 RSS，故未纳入。
  { name: "WHO", url: "https://www.who.int/rss-feeds/news-english.xml", categoryId: "健康" },
  { name: "CDC MMWR", url: "https://www.cdc.gov/mmwr/rss/mmwr.xml", categoryId: "健康" },
  { name: "Nature Medicine", url: "https://www.nature.com/nm.rss", categoryId: "健康" },
  { name: "American Diabetes Association", url: "https://www.diabetes.org/rss.xml", categoryId: "健康" },
  { name: "American Heart Association", url: "https://newsroom.heart.org/cats/heart_news.xml", categoryId: "健康" },
];

// 每个分类取多少条新闻
export const ITEMS_PER_CATEGORY = 15;
// GitHub 榜单取多少条
export const GITHUB_LIMIT = 15;
