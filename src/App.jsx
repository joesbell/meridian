import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";
import {
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowUpRight,
  CaretRight,
  CircleNotch,
  GithubLogo,
  LinkSimple,
  Pulse,
  Star,
  StarFour,
} from "@phosphor-icons/react";
import { InteractiveRobotSpline } from "./InteractiveRobotSpline";
import { HighResolutionThinkingOrb } from "./HighResolutionThinkingOrb";
import FuzzyText from "./FuzzyText";
import { AsciiSideLabel } from "./AsciiSideLabel";
import ProfileCard from "./ProfileCard";
import Shuffle from "./Shuffle";
import ShinyText from "./ShinyText";
import SpecularButton from "./SpecularButton";
import GooeyNav from "./GooeyNav";
import "./styles.css";

const PERIODS = [
  ["daily", "今日"],
  ["weekly", "本周"],
  ["monthly", "本月"],
];

const SIGNALS = [
  { label: "AI", x: 22, y: 30, tone: "mint" },
  { label: "CODE", x: 72, y: 24, tone: "orange" },
  { label: "MARKET", x: 62, y: 67, tone: "blue" },
  { label: "HEALTH", x: 30, y: 73, tone: "orange" },
];

function InitialDataOverlay() {
  return (
    <div className="initial-data-overlay" role="status" aria-live="polite" aria-label="正在抓取首次数据">
      <div className="initial-data-overlay__content">
        <HighResolutionThinkingOrb
          state="searching"
          size={320}
          speed={1}
          ariaLabel="正在搜索实时数据"
        />
        <strong>SEARCHING LIVE SIGNALS</strong>
        <span>正在抓取今日简报与 GitHub 热榜</span>
      </div>
    </div>
  );
}

function Offline404({ onRetry, retrying }) {
  return (
    <main className="offline-page">
      <div className="offline-page__grid" aria-hidden="true" />
      <section className="offline-page__content">
        <span className="eyebrow"><i /> SIGNAL DISCONNECTED</span>
        <FuzzyText
          fontSize={190}
          fontWeight={800}
          fontFamily="Inter, PingFang SC, sans-serif"
          color="#7dffd9"
          baseIntensity={0.18}
          hoverIntensity={0.62}
          fuzzRange={24}
          fps={58}
        >
          404
        </FuzzyText>
        <h1>实时数据网络已断开</h1>
        <p>当前设备或服务器无法连接新闻源与 GitHub。恢复网络后即可重新建立实时信号。</p>
        <SpecularButton
          size="md"
          radius={7}
          lineColor="#7dffd9"
          baseColor="#39534b"
          textColor="#dffff5"
          followMouse
          proximity={260}
          onClick={onRetry}
          disabled={retrying}
        >
          {retrying ? <CircleNotch className="spin" weight="bold" /> : <ArrowCounterClockwise weight="bold" />}
          <span>{retrying ? "正在重连" : "重新连接"}</span>
        </SpecularButton>
      </section>
    </main>
  );
}

async function fetchJson(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.detail || data.error || `请求失败（${response.status}）`);
    error.code = data.code || "";
    throw error;
  }
  return data;
}

function isOfflineError(error) {
  return (
    navigator.onLine === false
    || error?.code === "OFFLINE"
    || /(Failed to fetch|NetworkError|ERR_INTERNET_DISCONNECTED|ENETUNREACH|ENOTFOUND|网络连接不可用)/i.test(error?.message || "")
  );
}

function InteractiveBackdrop({ uniformGrid = false }) {
  const canvasRef = useRef(null);
  const ringRef = useRef(null);
  const dotRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ring = ringRef.current;
    const dot = dotRef.current;
    if (!canvas || !ring || !dot) return undefined;
    const ctx = canvas.getContext("2d");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    let width = window.innerWidth;
    let height = window.innerHeight;
    let px = width / 2;
    let py = height / 2;
    let rx = px;
    let ry = py;
    let visible = false;
    let frame = 0;
    let lastTrail = 0;
    let points = [];
    let cols = 0;
    let rows = 0;
    const spacing = 42;
    const radius = 150;
    const maxDisplace = 24;
    const gridEase = reduced ? 1 : 0.13;
    canvas.dataset.gridMode = "convex";
    canvas.dataset.gridRadius = String(radius);
    canvas.dataset.maxDisplace = String(maxDisplace);
    const pointer = { x: px, y: py, influence: 0 };
    const pointerXTo = gsap.quickTo(pointer, "x", { duration: 0.28, ease: "power3.out" });
    const pointerYTo = gsap.quickTo(pointer, "y", { duration: 0.28, ease: "power3.out" });
    const pointerInfluenceTo = gsap.quickTo(pointer, "influence", { duration: 0.24, ease: "power2.out" });
    const trails = [];
    const motes = Array.from({ length: 70 }, () => ({
      x: Math.random(),
      y: Math.random(),
      size: Math.random() * 1.4 + 0.25,
      phase: Math.random() * Math.PI * 2,
    }));

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      cols = Math.ceil(width / spacing) + 3;
      rows = Math.ceil(height / spacing) + 3;
      points = new Array(cols * rows);
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < cols; column += 1) {
          const x0 = (column - 1) * spacing;
          const y0 = (row - 1) * spacing;
          points[row * cols + column] = { x0, y0, x: x0, y: y0 };
        }
      }
    };

    const move = (event) => {
      px = event.clientX;
      py = event.clientY;
      visible = true;
      pointerXTo(px);
      pointerYTo(py);
      pointerInfluenceTo(1);
      dot.style.transform = `translate3d(${px}px, ${py}px, 0)`;
      const interactive = event.target instanceof Element && event.target.closest("button, a, input");
      ring.classList.toggle("is-active", Boolean(interactive));
      if (!reduced && performance.now() - lastTrail > 18) {
        trails.push({ x: px, y: py, life: 1, size: interactive ? 4 : 2 });
        lastTrail = performance.now();
      }
      document.documentElement.style.setProperty("--pointer-x", `${(px / width - 0.5) * -18}px`);
      document.documentElement.style.setProperty("--pointer-y", `${(py / height - 0.5) * -14}px`);
    };

    const draw = (time) => {
      ctx.clearRect(0, 0, width, height);
      const localGlow = ctx.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, radius * 0.95);
      localGlow.addColorStop(0, `rgba(73, 183, 157, ${0.16 * pointer.influence})`);
      localGlow.addColorStop(0.44, `rgba(49, 88, 255, ${0.055 * pointer.influence})`);
      localGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = localGlow;
      ctx.fillRect(pointer.x - radius, pointer.y - radius, radius * 2, radius * 2);

      for (let index = 0; index < points.length; index += 1) {
        const point = points[index];
        let targetX = point.x0;
        let targetY = point.y0;
        if (pointer.influence > 0.001) {
          const dx = point.x0 - pointer.x;
          const dy = point.y0 - pointer.y;
          const distance = Math.hypot(dx, dy);
          if (distance < radius) {
            const force = 1 - distance / radius;
            const push = force * force * maxDisplace * pointer.influence;
            const inverse = distance > 0.001 ? 1 / distance : 0;
            targetX += dx * inverse * push;
            targetY += dy * inverse * push;
          }
        }
        point.x += (targetX - point.x) * gridEase;
        point.y += (targetY - point.y) * gridEase;
      }

      const pointAlpha = (point) => {
        let alpha = 0.21;
        if (!uniformGrid) {
          const horizontalDistance = Math.abs(point.x0 - width / 2) / Math.max(1, width / 2);
          const centerLight = Math.pow(Math.max(0, 1 - horizontalDistance), 1.2);
          alpha = 0.1 + centerLight * 0.11;
        }
        if (pointer.influence > 0.001) {
          const distance = Math.hypot(point.x0 - pointer.x, point.y0 - pointer.y);
          if (distance < radius) alpha += (1 - distance / radius) * 0.44 * pointer.influence;
        }
        return alpha;
      };

      const drawGridLine = (start, end) => {
        const alpha = (pointAlpha(start) + pointAlpha(end)) * 0.5;
        ctx.strokeStyle = alpha > 0.2
          ? `rgba(139, 255, 224, ${Math.min(alpha, 0.68)})`
          : `rgba(88, 190, 169, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
      };

      ctx.lineWidth = 1;
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < cols; column += 1) {
          const point = points[row * cols + column];
          if (column < cols - 1) drawGridLine(point, points[row * cols + column + 1]);
          if (row < rows - 1) drawGridLine(point, points[(row + 1) * cols + column]);
        }
      }

      motes.forEach((mote) => {
        ctx.globalAlpha = 0.12 + Math.sin(time * 0.0015 + mote.phase) * 0.08;
        ctx.fillStyle = "#8affdf";
        ctx.beginPath();
        ctx.arc(mote.x * width + (px / width - 0.5) * -9, mote.y * height, mote.size, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      for (let index = trails.length - 1; index >= 0; index -= 1) {
        const trail = trails[index];
        trail.life -= 0.035;
        trail.y += 0.15;
        if (trail.life <= 0) {
          trails.splice(index, 1);
          continue;
        }
        ctx.fillStyle = `rgba(255,91,45,${trail.life * 0.55})`;
        ctx.fillRect(trail.x - trail.size / 2, trail.y - trail.size / 2, trail.size, trail.size);
      }
      if (visible && !coarse) {
        rx += (px - rx) * 0.16;
        ry += (py - ry) * 0.16;
        ring.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
        ring.classList.add("is-visible");
        dot.classList.add("is-visible");
      }
      frame = window.requestAnimationFrame(draw);
    };

    const leave = () => {
      visible = false;
      pointerInfluenceTo(0);
      ring.classList.remove("is-visible", "is-active");
      dot.classList.remove("is-visible");
    };
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    frame = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
      pointerXTo.tween?.kill();
      pointerYTo.tween?.kill();
      pointerInfluenceTo.tween?.kill();
    };
  }, [uniformGrid]);

  return (
    <>
      <div className={`ambient${uniformGrid ? " ambient--uniform" : ""}`} aria-hidden="true">
        <div className="ambient__grid" />
        <canvas ref={canvasRef} className="ambient__canvas" />
        <AsciiSideLabel text="NEWS" side="left" />
        <AsciiSideLabel text="CODING" side="right" />
      </div>
      <div ref={ringRef} className="cursor-ring" />
      <div ref={dotRef} className="cursor-dot" />
    </>
  );
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  const minutes = Math.max(1, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  return `${Math.floor(minutes / 1440)} 天前`;
}

function formatSync(value) {
  if (!value) return "等待同步";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "等待同步"
    : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatNumber(value) {
  if (value === undefined || value === null || value === "—") return "—";
  const numeric = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(numeric) ? new Intl.NumberFormat("zh-CN").format(numeric) : String(value);
}

function sourceFavicon(url) {
  try {
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(url).hostname)}&sz=128`;
  } catch {
    return "https://www.google.com/s2/favicons?domain=github.com&sz=128";
  }
}

function proxiedImage(url, referer) {
  return `/api/image?url=${encodeURIComponent(url)}&referer=${encodeURIComponent(referer || "")}`;
}

function articleImage(item) {
  return proxiedImage(item.image || sourceFavicon(item.url), item.url);
}

function onImageError(item, event) {
  const image = event.currentTarget;
  if (image.dataset.fallback === "1") return;
  image.dataset.fallback = "1";
  image.classList.add("is-source-mark");
  image.src = proxiedImage(sourceFavicon(item.url), "https://www.google.com/");
}

function useRoute() {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const listener = () => setPath(window.location.pathname);
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  }, []);
  const navigate = (to) => {
    window.history.pushState({}, "", to);
    setPath(to);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  return { path, navigate };
}

function RailHeader({ code, title, meta, refreshing, onRefresh }) {
  return (
    <header className="rail-header">
      <div>
        <span className="eyebrow">
          <i />
          <Shuffle
            text={code}
            tag="span"
            className="eyebrow-shuffle"
            shuffleDirection="right"
            duration={0.4}
            animationMode="evenodd"
            shuffleTimes={1}
            ease="power3.out"
            stagger={0.045}
            scrambleCharset="SIGNALINTELDAILYOPENSOURCE0123456789"
            triggerOnHover
            respectReducedMotion
            loop
            loopDelay={2}
          />
        </span>
        <h2 className="rail-title-static">{title}</h2>
      </div>
      <SpecularButton
        size="sm"
        radius={5}
        tint="#0b0e0d"
        tintOpacity={0.74}
        blur={3}
        textColor="#d9f7ee"
        lineColor="#7dffd9"
        baseColor="#394740"
        intensity={1.35}
        shineSize={16}
        shineFade={48}
        thickness={1.15}
        speed={0.4}
        followMouse
        proximity={220}
        autoAnimate={false}
        className="refresh"
        onClick={onRefresh}
        disabled={refreshing}
      >
        {refreshing ? <CircleNotch className="spin" weight="bold" /> : <ArrowCounterClockwise weight="bold" />}
        <span>{refreshing ? "抓取中" : "刷新"}</span>
      </SpecularButton>
      <time>{meta}</time>
    </header>
  );
}

function NewsCard({ item, index, onOpen }) {
  return (
    <button className="news-card spotlight-card" data-effect="reactbits-spotlight-card" onClick={() => onOpen(item)}>
      <span className="news-card__index">{String(index + 1).padStart(2, "0")}</span>
      <span className="news-card__visual">
        <img src={articleImage(item)} alt="" loading={index > 3 ? "lazy" : "eager"} onError={(event) => onImageError(item, event)} />
        <span>{item.lens || "重要新闻"}</span>
      </span>
      <span className="news-card__copy">
        <small>{item.category} · {item.source}</small>
        <strong>{item.title}</strong>
        <span>{item.summary}</span>
        <em>{formatTime(item.publishedAt)} <CaretRight weight="bold" /></em>
      </span>
    </button>
  );
}

function RepoCard({ item, onOpen }) {
  return (
    <button className="repo-card border-glow-card" data-effect="reactbits-border-glow" onClick={() => onOpen(item)}>
      <span className="repo-card__rank">{String(item.rank).padStart(2, "0")}</span>
      <span className="repo-card__mark"><GithubLogo weight="fill" /></span>
      <span className="repo-card__copy">
        <strong>{item.name}</strong>
        <span>{item.description || "原仓库未提供项目简介。"}</span>
        <small><i /> {item.language}</small>
      </span>
      <span className="repo-card__metric">
        <b><Star weight="fill" /> {formatNumber(item.totalStars)}</b>
        <em>+{formatNumber(item.periodGrowth)}</em>
      </span>
    </button>
  );
}

function LiveError({ title, detail, onRetry }) {
  return (
    <div className="live-error">
      <Pulse weight="fill" />
      <b>{title}</b>
      <span>{detail}</span>
      <button onClick={onRetry}>重新抓取</button>
    </div>
  );
}

function RadarStage({ signalCount }) {
  const rootRef = useRef(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const context = gsap.context(() => {
      if (!reduced) {
        gsap.to(".radar__sweep", { rotate: 360, duration: 7.5, repeat: -1, ease: "none" });
        gsap.to(".radar__ring--pulse", { scale: 1.08, opacity: 0.08, duration: 2.4, repeat: -1, yoyo: true, ease: "sine.inOut" });
        gsap.to(".signal", { scale: 1.35, duration: 0.7, repeat: -1, yoyo: true, stagger: 0.22, ease: "sine.inOut" });
      }
    }, root);
    return () => context.revert();
  }, []);

  return (
    <section className="center-stage" ref={rootRef}>
      <div className="center-stage__label">
        <span>INTELLIGENCE RADIO</span>
        <small>{String(signalCount).padStart(2, "0")} ACTIVE SIGNALS</small>
      </div>
      <div className="profile-card-slot">
        <ProfileCard
          avatarUrl="/assets/profile/jason-jiang-night-portrait.jpg"
          name="JASON.姜森"
          title="AI.software Engineer"
          email="joesebll@163.com"
        />
      </div>
      <div className="radar" aria-label="信息雷达动画">
        <div className="radar__ring radar__ring--outer" />
        <div className="radar__ring radar__ring--middle" />
        <div className="radar__ring radar__ring--inner radar__ring--pulse" />
        <div className="radar__cross radar__cross--x" />
        <div className="radar__cross radar__cross--y" />
        <div className="radar__sweep" />
        <div className="radar__origin"><Pulse weight="fill" /></div>
        {SIGNALS.map((signal) => (
          <span key={signal.label} className={`radar__signal radar__signal--${signal.tone}`} style={{ left: `${signal.x}%`, top: `${signal.y}%` }}>
            <i className="signal" />
            <b>{signal.label}</b>
          </span>
        ))}
        <span className="radar__scale radar__scale--a">030°</span>
        <span className="radar__scale radar__scale--b">120°</span>
        <span className="radar__scale radar__scale--c">240°</span>
      </div>

      <InteractiveRobotSpline />
    </section>
  );
}

function Detail({ item, type, onBack }) {
  const isNews = type === "news";
  const [content, setContent] = useState(null);
  const [state, setState] = useState({ loading: true, error: "" });
  const cardFrameRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: "" });
    setContent(null);
    const endpoint = isNews ? "/api/article" : "/api/repo";
    fetchJson(`${endpoint}?url=${encodeURIComponent(item.url)}`)
      .then((data) => {
        if (!cancelled) {
          setContent(data);
          setState({ loading: false, error: "" });
        }
      })
      .catch((error) => !cancelled && setState({ loading: false, error: error.message }));
    return () => {
      cancelled = true;
    };
  }, [isNews, item.url]);

  const moveSpotlight = (event) => {
    const frame = cardFrameRef.current;
    const card = frame?.querySelector(".detail-card");
    if (!frame || !card) return;
    const rect = card.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const angle = Math.atan2(y - rect.height / 2, x - rect.width / 2) * (180 / Math.PI) + 90;
    card.style.setProperty("--spot-x", `${x}px`);
    card.style.setProperty("--spot-y", `${y}px`);
    card.style.setProperty("--spot-opacity", "0.88");
    frame.style.setProperty("--glow-angle", `${angle}deg`);
    frame.style.setProperty("--glow-opacity", "0.94");
  };

  const leaveSpotlight = () => {
    const frame = cardFrameRef.current;
    const card = frame?.querySelector(".detail-card");
    card?.style.setProperty("--spot-opacity", "0.24");
    frame?.style.setProperty("--glow-opacity", "0.58");
  };

  return (
    <main className="detail-page">
      <div className="detail-toolbar">
        <SpecularButton
          size="sm"
          radius={5}
          tint="#0b0e0d"
          tintOpacity={0.9}
          blur={3}
          textColor="#d9f7ee"
          lineColor="#7dffd9"
          baseColor="#394740"
          intensity={1.35}
          shineSize={16}
          shineFade={48}
          thickness={1.15}
          speed={0.4}
          followMouse
          proximity={220}
          autoAnimate={false}
          className="back-button"
          onClick={onBack}
        >
          <ArrowLeft weight="bold" />
          <span>返回</span>
        </SpecularButton>
      </div>
      <div
        ref={cardFrameRef}
        className="detail-card-frame border-glow-card"
        onPointerMove={moveSpotlight}
        onPointerLeave={leaveSpotlight}
      >
        <article className="detail-card spotlight-card">
          <div className="detail-card__topline">
            <span className="eyebrow"><i /> {isNews ? `${item.category} / ${item.source}` : "GITHUB TRENDING"}</span>
            <a className="source-link" href={item.url} target="_blank" rel="noreferrer">核验原始来源 <ArrowUpRight weight="bold" /></a>
          </div>
          <h1>{isNews ? content?.title || item.title : item.name}</h1>
          {isNews && <img src={proxiedImage(content?.image || item.image || sourceFavicon(item.url), item.url)} alt="" onError={(event) => onImageError(item, event)} />}
          <p className="detail-card__lead">{item.summary || item.description}</p>
          {state.loading && <div className="detail-state"><CircleNotch className="spin" /> {isNews ? "正在读取本地缓存；如未命中，Scrapling 将抓取并翻译原文…" : "正在读取本地 README 缓存；如未命中，Scrapling 将抓取并翻译…"}</div>}
          {state.error && <LiveError title={isNews ? "原文暂不可读" : "README 暂不可读"} detail={state.error} onRetry={() => window.location.reload()} />}
          {content?.paragraphs?.length > 0 && <div className="article-body">{content.paragraphs.map((paragraph, index) => <p key={`${index}-${paragraph.slice(0, 16)}`}>{paragraph}</p>)}</div>}
          {!isNews && <dl className="repo-stats"><div><dt>总 Star</dt><dd>{formatNumber(item.totalStars)}</dd></div><div><dt>今日增长</dt><dd>{formatNumber(item.growth?.daily)}</dd></div><div><dt>本周增长</dt><dd>{formatNumber(item.growth?.weekly)}</dd></div><div><dt>本月增长</dt><dd>{formatNumber(item.growth?.monthly)}</dd></div></dl>}
          {content?.blocks?.length > 0 && (
            <div className="readme-body">
              {content.blocks.map((block, index) => {
                if (block.type === "heading") return <h2 key={`${index}-${block.text.slice(0, 16)}`}>{block.text}</h2>;
                if (block.type === "code") return <pre key={`${index}-${block.text.slice(0, 16)}`}><code>{block.text}</code></pre>;
                if (block.type === "list") return <p className="readme-body__list" key={`${index}-${block.text.slice(0, 16)}`}>{block.text}</p>;
                return <p key={`${index}-${block.text.slice(0, 16)}`}>{block.text}</p>;
              })}
            </div>
          )}
          <p className="detail-note">
            {isNews
              ? "标题、摘要与正文来自实时原文；后台会在首页加载后预抓取、翻译并缓存。"
              : "榜单来自 GitHub Trending；详情来自对应仓库 README，并在非中文时完成中文本地化后缓存。"}
            {content?.translationProvider ? ` 当前翻译：${content.translationProvider}。` : ""}
          </p>
        </article>
      </div>
    </main>
  );
}

export function App() {
  const { path, navigate } = useRoute();
  const [news, setNews] = useState([]);
  const [repos, setRepos] = useState([]);
  const [period, setPeriod] = useState("daily");
  const [newsUpdatedAt, setNewsUpdatedAt] = useState("");
  const [repoUpdatedAt, setRepoUpdatedAt] = useState("");
  const [refreshing, setRefreshing] = useState({ news: false, github: false });
  const [errors, setErrors] = useState({ news: "", github: "" });
  const [initialLoading, setInitialLoading] = useState(true);
  const [offlinePage, setOfflinePage] = useState(false);
  const shellRef = useRef(null);
  const periodRef = useRef(period);
  const initialSettledRef = useRef({ news: null, github: null });

  const markInitialSettled = (source, outcome) => {
    initialSettledRef.current[source] = outcome;
    const { news: newsOutcome, github: githubOutcome } = initialSettledRef.current;
    if (newsOutcome && githubOutcome) {
      const totalItems = newsOutcome.count + githubOutcome.count;
      setOfflinePage(totalItems === 0 && (newsOutcome.offline || githubOutcome.offline || navigator.onLine === false));
      setInitialLoading(false);
    }
  };

  const loadNews = async (force = false, isInitial = false) => {
    setRefreshing((value) => ({ ...value, news: true }));
    let outcome = { count: 0, offline: false };
    try {
      const data = await fetchJson(`/api/news${force ? "?force=1" : ""}`);
      const items = Array.isArray(data.items) ? data.items : [];
      if (items.length === 0) throw new Error("新闻源暂未返回有效内容");
      setNews(items);
      setNewsUpdatedAt(data.generatedAt);
      setErrors((value) => ({ ...value, news: "" }));
      outcome = { count: items.length, offline: false };
    } catch (error) {
      setErrors((value) => ({ ...value, news: error.message }));
      outcome = { count: news.length, offline: isOfflineError(error) };
    } finally {
      setRefreshing((value) => ({ ...value, news: false }));
      if (isInitial) markInitialSettled("news", outcome);
    }
  };

  const loadRepos = async (selectedPeriod = period, force = false, isInitial = false) => {
    setRefreshing((value) => ({ ...value, github: true }));
    let outcome = { count: 0, offline: false };
    try {
      const data = await fetchJson(`/api/github?period=${selectedPeriod}${force ? "&force=1" : ""}`);
      const items = Array.isArray(data.items) ? data.items : [];
      if (items.length === 0) throw new Error("GitHub 当前周期暂未返回有效项目");
      setRepos(items);
      setRepoUpdatedAt(data.generatedAt);
      setErrors((value) => ({ ...value, github: "" }));
      outcome = { count: items.length, offline: false };
    } catch (error) {
      setErrors((value) => ({ ...value, github: error.message }));
      outcome = { count: repos.length, offline: isOfflineError(error) };
    } finally {
      setRefreshing((value) => ({ ...value, github: false }));
      if (isInitial) markInitialSettled("github", outcome);
    }
  };

  const retryInitialLoad = () => {
    setOfflinePage(false);
    setInitialLoading(true);
    initialSettledRef.current = { news: null, github: null };
    loadRepos("daily", true, true);
    window.setTimeout(() => loadNews(true, true), 180);
  };

  useEffect(() => {
    loadRepos("daily", false, true);
    const newsTimer = window.setTimeout(() => loadNews(false, true), 180);
    const refreshTimer = window.setInterval(() => {
      loadNews(true);
      loadRepos(periodRef.current, true);
    }, 2 * 60 * 60 * 1000);
    return () => {
      window.clearTimeout(newsTimer);
      window.clearInterval(refreshTimer);
    };
  }, []);

  useEffect(() => {
    periodRef.current = period;
  }, [period]);

  useLayoutEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    const context = gsap.context(() => {
      const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });
      timeline
        .from(".masthead > *", { y: -16, opacity: 0, duration: 0.55, stagger: 0.06 })
        .from(".rail--news", { x: -40, opacity: 0, duration: 0.7 }, "-=.25")
        .from(".rail--github", { x: 40, opacity: 0, duration: 0.7 }, "<")
        .from(".center-stage", { scale: 0.96, opacity: 0, duration: 0.85 }, "-=.5")
        .from(".profile-card-slot", { y: 28, rotate: -2, opacity: 0, duration: 0.7 }, "-=.45");
    }, shellRef);
    return () => context.revert();
  }, []);

  useEffect(() => {
    if (window.matchMedia("(pointer: coarse)").matches) return undefined;
    const tiltedCards = shellRef.current?.querySelectorAll(".tilted-card") || [];
    const spotlightCards = shellRef.current?.querySelectorAll(".spotlight-card") || [];
    const glowCards = shellRef.current?.querySelectorAll(".border-glow-card") || [];
    const cleanups = [];
    tiltedCards.forEach((card) => {
      const rotateX = gsap.quickTo(card, "rotationX", { duration: 0.42, ease: "power3.out" });
      const rotateY = gsap.quickTo(card, "rotationY", { duration: 0.42, ease: "power3.out" });
      const scaleX = gsap.quickTo(card, "scaleX", { duration: 0.42, ease: "power3.out" });
      const scaleY = gsap.quickTo(card, "scaleY", { duration: 0.42, ease: "power3.out" });
      const move = (event) => {
        const rect = card.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        rotateX((y / rect.height - 0.5) * -10);
        rotateY((x / rect.width - 0.5) * 12);
        scaleX(1.018);
        scaleY(1.018);
        card.style.setProperty("--tilt-x", `${x}px`);
        card.style.setProperty("--tilt-y", `${y}px`);
        card.style.setProperty("--tilt-glare", "1");
      };
      const leave = () => {
        rotateX(0);
        rotateY(0);
        scaleX(1);
        scaleY(1);
        card.style.setProperty("--tilt-glare", "0");
      };
      card.addEventListener("pointermove", move);
      card.addEventListener("pointerleave", leave);
      cleanups.push(() => {
        card.removeEventListener("pointermove", move);
        card.removeEventListener("pointerleave", leave);
        rotateX.tween?.kill();
        rotateY.tween?.kill();
        scaleX.tween?.kill();
        scaleY.tween?.kill();
      });
    });
    spotlightCards.forEach((card) => {
      const move = (event) => {
        const rect = card.getBoundingClientRect();
        card.style.setProperty("--spot-x", `${event.clientX - rect.left}px`);
        card.style.setProperty("--spot-y", `${event.clientY - rect.top}px`);
        card.style.setProperty("--spot-opacity", "0.86");
      };
      const leave = () => card.style.setProperty("--spot-opacity", "0");
      card.addEventListener("pointermove", move);
      card.addEventListener("pointerleave", leave);
      cleanups.push(() => {
        card.removeEventListener("pointermove", move);
        card.removeEventListener("pointerleave", leave);
      });
    });
    glowCards.forEach((card) => {
      const move = (event) => {
        const rect = card.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const dx = x - rect.width / 2;
        const dy = y - rect.height / 2;
        const angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
        const edgeX = Math.abs(dx) / Math.max(1, rect.width / 2);
        const edgeY = Math.abs(dy) / Math.max(1, rect.height / 2);
        const edge = Math.max(edgeX, edgeY);
        card.style.setProperty("--glow-angle", `${angle}deg`);
        card.style.setProperty("--glow-edge", String(edge));
        card.style.setProperty("--glow-opacity", String(0.28 + Math.min(1, edge) * 0.62));
        card.classList.add("is-pointer-active");
      };
      const leave = () => {
        card.style.setProperty("--glow-edge", "0.22");
        card.style.setProperty("--glow-opacity", "0.42");
        card.classList.remove("is-pointer-active");
      };
      card.addEventListener("pointermove", move);
      card.addEventListener("pointerleave", leave);
      cleanups.push(() => {
        card.removeEventListener("pointermove", move);
        card.removeEventListener("pointerleave", leave);
        card.classList.remove("is-pointer-active");
      });
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [news, repos]);

  const detail = useMemo(() => {
    const [kind, id] = path.split("/").filter(Boolean);
    if (kind === "news") return { type: "news", item: news.find((item) => item.id === decodeURIComponent(id)) };
    if (kind === "repo") return { type: "repo", item: repos.find((item) => item.id === decodeURIComponent(id)) };
    return null;
  }, [path, news, repos]);

  if (offlinePage) {
    return (
      <>
        <InteractiveBackdrop />
        <Offline404 onRetry={retryInitialLoad} retrying={initialLoading} />
        {initialLoading && <InitialDataOverlay />}
      </>
    );
  }

  if (detail?.item) {
    return (
      <>
        <InteractiveBackdrop uniformGrid />
        <Detail item={detail.item} type={detail.type} onBack={() => navigate("/")} />
        {initialLoading && <InitialDataOverlay />}
      </>
    );
  }

  const now = new Date();
  const date = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(now).replace("/", ".");

  return (
    <>
      <InteractiveBackdrop />
      <main className="site-shell" ref={shellRef}>
        <header className="masthead">
          <div className="brand">
            <StarFour className="brand__sparkle" weight="fill" aria-hidden="true" />
            <ShinyText
              text="Forest Radius"
              className="brand__shiny"
              speed={2.4}
              color="#aab4b0"
              shineColor="#ffffff"
              spread={118}
              direction="left"
            />
          </div>
          <div className="masthead__signal"><Pulse weight="fill" /> REAL-TIME SIGNAL CONTROL</div>
          <time>{date}<small>{now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}</small></time>
        </header>

        <section className="control-grid">
          <aside className="rail rail--news">
            <RailHeader code="DAILY INTEL" title="今日简报" meta={`${formatSync(newsUpdatedAt)} · 全中文`} refreshing={refreshing.news} onRefresh={() => loadNews(true)} />
            <div className="rail__scroll news-stack">
              {news.map((item, index) => <NewsCard key={item.id} item={item} index={index} onOpen={(record) => navigate(`/news/${encodeURIComponent(record.id)}`)} />)}
              {errors.news && <LiveError title="新闻信号中断" detail={errors.news} onRetry={() => loadNews(true)} />}
            </div>
          </aside>

          <RadarStage signalCount={news.length + repos.length} />

          <aside className="rail rail--github">
            <RailHeader code="OPEN SOURCE" title="GitHub 热榜" meta={`${formatSync(repoUpdatedAt)} · TOP ${repos.length || "—"}`} refreshing={refreshing.github} onRefresh={() => loadRepos(period, true)} />
            <div className="period-tabs">
              <GooeyNav
                items={PERIODS.map(([value, label]) => ({ value, label }))}
                activeIndex={Math.max(0, PERIODS.findIndex(([value]) => value === period))}
                onSelect={(item) => {
                  setPeriod(item.value);
                  loadRepos(item.value);
                }}
              />
            </div>
            <div className="rail__scroll repo-stack">
              {repos.map((item) => <RepoCard key={item.id} item={item} onOpen={(record) => navigate(`/repo/${encodeURIComponent(record.id)}`)} />)}
              {errors.github && <LiveError title="GitHub 信号中断" detail={errors.github} onRetry={() => loadRepos(period, true)} />}
            </div>
          </aside>
        </section>

        <footer className="site-footer">
          <span><Pulse weight="fill" /> 两小时自动同步 · 手动刷新会重新触发 Scrapling</span>
          <span>LIVE DATA ONLY <LinkSimple weight="bold" /></span>
        </footer>
      </main>
      {initialLoading && <InitialDataOverlay />}
    </>
  );
}
