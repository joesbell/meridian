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

// 每个分类的数据源：涵盖国际知名科技/商业/健康媒体
export const NEWS_SOURCES = [
  // —— 商业 ——
  { name: "TechCrunch", url: "https://techcrunch.com/feed/", categoryId: "商业" },
  { name: "36Kr", url: "https://36kr.com/feed", categoryId: "商业" },
  { name: "CNBC Business", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147", categoryId: "商业" },
  { name: "Harvard Business Review", url: "https://hbr.org/the-latest/rss", categoryId: "商业" },

  // —— 科技产品 ——
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml", categoryId: "科技产品" },
  { name: "Engadget", url: "https://www.engadget.com/rss.xml", categoryId: "科技产品" },
  { name: "Wired", url: "https://www.wired.com/feed/rss", categoryId: "科技产品" },
  { name: "Gizmodo", url: "https://gizmodo.com/rss", categoryId: "科技产品" },

  // —— AI 大模型 ——
  { name: "MIT Technology Review", url: "https://www.technologyreview.com/feed/", categoryId: "AI大模型" },
  { name: "VentureBeat AI", url: "https://venturebeat.com/category/ai/feed/", categoryId: "AI大模型" },
  { name: "AI News", url: "https://artificialintelligence-news.com/feed/", categoryId: "AI大模型" },
  { name: "The Register AI", url: "https://www.theregister.com/ai/headlines.atom", categoryId: "AI大模型" },

  // —— 编程 ——
  { name: "GitHub Blog", url: "https://github.blog/feed/", categoryId: "编程" },
  { name: "Dev.to", url: "https://dev.to/feed", categoryId: "编程" },
  { name: "The New Stack", url: "https://thenewstack.io/feed/", categoryId: "编程" },
  { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", categoryId: "编程" },

  // —— 工具推荐 ——
  { name: "Hacker News", url: "https://hnrss.org/frontpage", categoryId: "工具推荐" },
  { name: "Product Hunt", url: "https://www.producthunt.com/feed", categoryId: "工具推荐" },
  { name: "Lifehacker", url: "https://lifehacker.com/rss", categoryId: "工具推荐" },

  // —— 健康 ——
  { name: "STAT", url: "https://www.statnews.com/feed/", categoryId: "健康" },
  { name: "Nature Medicine", url: "https://www.nature.com/nm.rss", categoryId: "健康" },
  { name: "Medical News Today", url: "https://www.medicalnewstoday.com/rss", categoryId: "健康" },
  { name: "WebMD", url: "https://rssfeeds.webmd.com/rss/rss.aspx?RSSSource=RSS_PUBLIC", categoryId: "健康" },
];

// 每个分类取多少条新闻
export const ITEMS_PER_CATEGORY = 15;
// GitHub 榜单取多少条
export const GITHUB_LIMIT = 15;
