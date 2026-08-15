// 新闻 / 仓库列表共用的常量与纯函数（桌面端 App 与移动端 MobileHome 共用）

// 新闻分类标签（与 server/sources.mjs 的 CATEGORIES 一致）
export const NEWS_CATEGORIES = ["商业", "科技产品", "AI大模型", "编程", "工具推荐", "健康"];

// GitHub 热榜周期（与 server 抓取的 snapshots key 一致）
export const REPO_PERIODS = [
  { value: "daily", label: "今日" },
  { value: "weekly", label: "本周" },
  { value: "monthly", label: "本月" },
];

export function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  const minutes = Math.max(1, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  return `${Math.floor(minutes / 1440)} 天前`;
}

// 绝对发布时间：2026-08-13 10:04（列表与详情页统一使用）。
// 全站统一锁定北京时间：中文简报站，所有访客看到同一口径，不随设备时区变化
export function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export function formatNumber(value) {
  if (value === undefined || value === null || value === "—") return "—";
  const numeric = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(numeric) ? new Intl.NumberFormat("zh-CN").format(numeric) : String(value);
}

export function sourceFavicon(url) {
  try {
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(url).hostname)}&sz=128`;
  } catch {
    return "https://www.google.com/s2/favicons?domain=github.com&sz=128";
  }
}

export function proxiedImage(url, referer) {
  return `/api/image?url=${encodeURIComponent(url)}&referer=${encodeURIComponent(referer || "")}`;
}

export function articleImage(item) {
  return proxiedImage(item.image || sourceFavicon(item.url), item.url);
}

export function onImageError(item, event) {
  const image = event.currentTarget;
  if (image.dataset.fallback === "1") return;
  image.dataset.fallback = "1";
  image.classList.add("is-source-mark");
  image.src = proxiedImage(sourceFavicon(item.url), "https://www.google.com/");
}
