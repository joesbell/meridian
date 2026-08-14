import { useEffect, useRef, useState } from "react";
import {
  GithubLogo,
  Newspaper,
  Pulse,
  Star,
  UserCircle,
} from "@phosphor-icons/react";
import {
  NEWS_CATEGORIES,
  REPO_PERIODS,
  articleImage,
  formatDateTime,
  formatNumber,
  onImageError,
} from "./feed-utils";

// 注意：mobile.css 由 App.jsx 在 styles.css 之后引入（覆盖级联需要），此处不要再 import

// 版本条：数据入库时间（客户端时区格式化，不受服务器时区影响）
function editionLabel(updatedAt) {
  const formatted = formatDateTime(updatedAt);
  return formatted ? `数据更新时间：${formatted}` : "等待首次同步";
}

// 分类/周期切换：下划线文字 tab，吸顶常驻；筛选语义用 aria-pressed，不冒充 tab
function FilterTabs({ items, activeValue, onSelect, label }) {
  return (
    <div className="m-tabs" role="group" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.value}
          aria-pressed={item.value === activeValue}
          className={`m-tab${item.value === activeValue ? " is-active" : ""}`}
          onClick={() => onSelect(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

// 头条：当日该分类第 1 条，全幅图 + 大标题，承担全部"重点"表达。
// 封面图抓取失败（只剩 favicon 兜底）时降级为纯文字头条，不把 logo 放大成海报
function LeadStory({ item, onOpen }) {
  const [imgOk, setImgOk] = useState(true);
  return (
    <button className="m-lead" onClick={() => onOpen(item)}>
      {imgOk && (
        <span className="m-lead__media">
          <img src={articleImage(item)} alt="" onError={() => setImgOk(false)} />
        </span>
      )}
      <span className="m-lead__body">
        <strong>{item.title}</strong>
        {item.summary && <span className="m-lead__summary">{item.summary}</span>}
        <small>{item.source} · {formatDateTime(item.publishedAt)}</small>
      </span>
    </button>
  );
}

// 新闻行：标题左、缩略图右，发丝线分隔，无卡片
function NewsRow({ item, onOpen }) {
  return (
    <button className="m-item" onClick={() => onOpen(item)}>
      <span className="m-item__copy">
        <strong>{item.title}</strong>
        <small>{item.source} · {formatDateTime(item.publishedAt)}</small>
      </span>
      <span className="m-item__thumb">
        <img src={articleImage(item)} alt="" loading="lazy" onError={(event) => onImageError(item, event)} />
      </span>
    </button>
  );
}

// 仓库行：等宽排名 + 名称 + 简介 + 指标，同样走分隔线
function RepoRow({ item, onOpen }) {
  return (
    <button className="m-item m-item--repo" onClick={() => onOpen(item)}>
      <span className="m-item__rank">{String(item.rank).padStart(2, "0")}</span>
      <span className="m-item__copy">
        <strong>{item.name}</strong>
        <span className="m-item__desc">{item.description || "原仓库未提供项目简介。"}</span>
        <small>
          {item.language && <span className="m-item__lang">{item.language}</span>}
          <Star weight="fill" aria-hidden="true" /> {formatNumber(item.totalStars)}
          <em>+{formatNumber(item.periodGrowth)}</em>
        </small>
      </span>
    </button>
  );
}

// 加载更多时的骨架行：形状与真实行一致，不用转圈
function SkeletonRows({ count = 3 }) {
  return (
    <div className="m-skel" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div className="m-skel__row" key={i}>
          <span className="m-skel__lines"><i /><i className="short" /></span>
          <span className="m-skel__thumb" />
        </div>
      ))}
    </div>
  );
}

function StateBlock({ error, empty, onRetry }) {
  if (error) {
    return (
      <div className="m-state">
        <Pulse weight="fill" />
        <span>{error}</span>
        <button onClick={onRetry}>重新抓取</button>
      </div>
    );
  }
  if (empty) {
    return <div className="m-state">该分类暂无数据，下个抓取窗口后自动恢复。</div>;
  }
  return null;
}

export function MobileHome({
  feed,
  activeCategory,
  onSelectCategory,
  repoPeriod,
  onSelectPeriod,
  news,
  paging,
  repos,
  error,
  onRetry,
  onLoadMore,
  onOpenNews,
  onOpenRepo,
  onShowProfile,
}) {
  const [tab, setTab] = useState("news");
  const sentinelRef = useRef(null);

  // 哨兵进入视口即加载下一页（window 级滚动，替代桌面端容器 onScroll）
  useEffect(() => {
    if (tab !== "news") return undefined;
    const el = sentinelRef.current;
    if (!el) return undefined;
    const observer = new IntersectionObserver(
      (entries) => entries[0]?.isIntersecting && onLoadMore(),
      { rootMargin: "500px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [tab, onLoadMore]);

  // 头条制：第 1 条进全幅头条位，其余走紧凑列表（替代原来的 5 卡横滑轮播）
  const lead = tab === "news" && news.length > 0 ? news[0] : null;
  const rest = tab === "news" ? news.slice(1) : [];

  return (
    <main className="mobile-shell">
      <header className="m-header">
        <div className="m-brand">
          <img className="m-brand__mark" src="/assets/brand/meridian-mark-header.png" alt="" />
          <span className="m-brand__name">Meridian</span>
          <span className="m-brand__cn">子午视界</span>
        </div>
        <a
          className="m-header__github"
          href="https://github.com/joesbell/meridian"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub 仓库"
        >
          <GithubLogo weight="bold" />
        </a>
      </header>

      <p className="m-edition">
        <i className="m-status-dot" aria-hidden="true" />
        {editionLabel(feed.updatedAt)}
      </p>

      {tab === "news" && (
        <section className="m-feed" aria-label="今日简报">
          <FilterTabs
            items={NEWS_CATEGORIES.map((cat) => ({ label: cat, value: cat }))}
            activeValue={activeCategory}
            onSelect={onSelectCategory}
            label="新闻分类"
          />

          {lead && <LeadStory key={lead.id} item={lead} onOpen={onOpenNews} />}

          <div className="m-list">
            {rest.map((item) => (
              <NewsRow key={item.id} item={item} onOpen={onOpenNews} />
            ))}
            <StateBlock error={error} empty={news.length === 0 && feed.available} onRetry={onRetry} />
            <div ref={sentinelRef} className="m-sentinel" aria-hidden="true" />
            {paging?.loading && <SkeletonRows />}
            {paging?.exhausted && news.length > 0 && (
              <div className="m-endline">已加载该分类全部内容</div>
            )}
          </div>
        </section>
      )}

      {tab === "github" && (
        <section className="m-feed" aria-label="GitHub 热榜">
          <FilterTabs
            items={REPO_PERIODS}
            activeValue={repoPeriod}
            onSelect={onSelectPeriod}
            label="GitHub 热榜周期"
          />

          <div className="m-list">
            {repos.map((item) => (
              <RepoRow key={item.id} item={item} onOpen={onOpenRepo} />
            ))}
            {repos.length === 0 && feed.available && (
              <div className="m-state">GitHub 榜单暂无数据，下个抓取窗口后自动恢复。</div>
            )}
          </div>
        </section>
      )}

      <nav className="m-tabbar" aria-label="主导航">
        <button
          className={tab === "news" ? "is-active" : ""}
          onClick={() => setTab("news")}
          aria-current={tab === "news" ? "page" : undefined}
        >
          <Newspaper weight={tab === "news" ? "fill" : "regular"} />
          <span>简报</span>
        </button>
        <button
          className={tab === "github" ? "is-active" : ""}
          onClick={() => setTab("github")}
          aria-current={tab === "github" ? "page" : undefined}
        >
          <GithubLogo weight={tab === "github" ? "fill" : "regular"} />
          <span>热榜</span>
        </button>
        <button onClick={onShowProfile}>
          <UserCircle />
          <span>我的</span>
        </button>
      </nav>
    </main>
  );
}
