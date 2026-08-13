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
} from "@phosphor-icons/react";
import { InteractiveRobotSpline } from "./InteractiveRobotSpline";
import { HighResolutionThinkingOrb } from "./HighResolutionThinkingOrb";
import FuzzyText from "./FuzzyText";
import { AsciiSideLabel } from "./AsciiSideLabel";
import ProfileCard, { MorphingCube, NewsGlobe } from "./ProfileCard";
import Shuffle from "./Shuffle";
import ShinyText from "./ShinyText";
import SpecularButton from "./SpecularButton";
import GooeyNav from "./GooeyNav";
import GradientText from "./GradientText";
import LightRays from "./LightRays";
import "./styles.css";

// 临时调试：让加载页常驻以预览效果，改回 false 即恢复正常
const PIN_LOADING_OVERLAY = false;

// 新闻分类标签（与 server/sources.mjs 的 CATEGORIES 一致）
const NEWS_CATEGORIES = ["商业", "科技产品", "AI大模型", "编程", "工具推荐", "健康"];

// GitHub 热榜周期（与 server 抓取的 snapshots key 一致）
const REPO_PERIODS = [
  { value: "daily", label: "今日" },
  { value: "weekly", label: "本周" },
  { value: "monthly", label: "本月" },
];

const SIGNALS = [
  { label: "AI", x: 22, y: 30, tone: "mint" },
  { label: "CODE", x: 72, y: 24, tone: "orange" },
  { label: "MARKET", x: 62, y: 67, tone: "blue" },
  { label: "HEALTH", x: 30, y: 73, tone: "orange" },
];

function LiveClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const date = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(now).replace("/", ".");
  const time = now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });

  return <time dateTime={now.toISOString()}>{date}<small>{time}</small></time>;
}

function AnimatedBrandMark() {
  const rootRef = useRef(null);

  useLayoutEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    const context = gsap.context(() => {
      gsap.fromTo(
        ".brand-mark__glint",
        { xPercent: -180 },
        { xPercent: 220, duration: 1.2, ease: "power2.inOut" },
      );
    }, rootRef);
    return () => context.revert();
  }, []);

  return (
    <span ref={rootRef} className="brand-mark" aria-hidden="true">
      <span className="brand-mark__crop">
        <img className="brand-mark__glyph" src="/assets/brand/meridian-mark-header.png" alt="" />
        <i className="brand-mark__glint" />
      </span>
    </span>
  );
}

function InitialDataOverlay() {
  return (
    <div className="initial-data-overlay" role="status" aria-live="polite" aria-label="正在抓取首次数据">
      <div className="initial-data-overlay__backdrop" aria-hidden="true">
        <LightRays
          raysOrigin="top-center"
          raysColor="#7dffd9"
          raysSpeed={1.2}
          lightSpread={0.9}
          rayLength={2.2}
          pulsating
          fadeDistance={1.1}
          saturation={0.9}
          followMouse
          mouseInfluence={0.16}
          noiseAmount={0.06}
          distortion={0.08}
        />
      </div>
      <div className="initial-data-overlay__content">
        <HighResolutionThinkingOrb
          state="searching"
          size={320}
          speed={1}
          ariaLabel="正在搜索实时数据"
        />
        <strong>SEARCHING LIVE SIGNALS</strong>
        <span>正在抓取全分类新闻与 GitHub 热榜，请稍候…</span>
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

async function fetchJson(url, options) {
  const response = await fetch(url, options);
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // 低端机判定：CPU ≤4 核或内存 ≤4GB 直接降级；运行后采样前 120 帧均值 <30fps 再自动降级（只降不升）
    let degraded = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
    let sampled = degraded;
    let sampleFrames = 0;
    let sampleStart = 0;
    let width = window.innerWidth;
    let height = window.innerHeight;
    let px = width / 2;
    let py = height / 2;
    let frame = 0;
    let points = [];
    let cols = 0;
    let rows = 0;
    let spacing = degraded ? 64 : 42;
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
    const motes = Array.from({ length: 70 }, () => ({
      x: Math.random(),
      y: Math.random(),
      size: Math.random() * 1.4 + 0.25,
      phase: Math.random() * Math.PI * 2,
    }));

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const ratio = degraded ? 1 : Math.min(window.devicePixelRatio || 1, 2);
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

    const degrade = () => {
      degraded = true;
      spacing = 64;
      resize();
    };

    const move = (event) => {
      px = event.clientX;
      py = event.clientY;
      pointerXTo(px);
      pointerYTo(py);
      pointerInfluenceTo(1);
      document.documentElement.style.setProperty("--pointer-x", `${(px / width - 0.5) * -18}px`);
      document.documentElement.style.setProperty("--pointer-y", `${(py / height - 0.5) * -14}px`);
    };

    const draw = (time) => {
      if (!sampled) {
        if (sampleFrames === 0) sampleStart = time;
        sampleFrames += 1;
        if (sampleFrames >= 120) {
          sampled = true;
          if (120000 / (time - sampleStart) < 30) degrade();
        }
      }
      ctx.clearRect(0, 0, width, height);
      if (!degraded) {
        const localGlow = ctx.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, radius * 0.95);
        localGlow.addColorStop(0, `rgba(73, 183, 157, ${0.16 * pointer.influence})`);
        localGlow.addColorStop(0.44, `rgba(49, 88, 255, ${0.055 * pointer.influence})`);
        localGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = localGlow;
        ctx.fillRect(pointer.x - radius, pointer.y - radius, radius * 2, radius * 2);
      }

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

      const moteCount = degraded ? 28 : motes.length;
      for (let index = 0; index < moteCount; index += 1) {
        const mote = motes[index];
        ctx.globalAlpha = 0.12 + Math.sin(time * 0.0015 + mote.phase) * 0.08;
        ctx.fillStyle = "#8affdf";
        ctx.beginPath();
        ctx.arc(mote.x * width + (px / width - 0.5) * -9, mote.y * height, mote.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      frame = window.requestAnimationFrame(draw);
    };

    const leave = () => {
      pointerInfluenceTo(0);
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
    <div className={`ambient${uniformGrid ? " ambient--uniform" : ""}`} aria-hidden="true">
      <div className="ambient__grid" />
      <canvas ref={canvasRef} className="ambient__canvas" />
      <AsciiSideLabel text="NEWS" side="left" />
      <AsciiSideLabel text="CODING" side="right" />
    </div>
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

function RailHeader({ code, title, meta, visual }) {
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
      {visual === "news" && <NewsGlobe />}
      {visual === "github" && <MorphingCube className="rail-header__canvas" flatten color={0x7fffd8} />}
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

function RadarStage({ paused = false }) {
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

      <InteractiveRobotSpline paused={paused} />
    </section>
  );
}

function Detail({ item, type, onBack, prefetched }) {
  const isNews = type === "news";
  const [content, setContent] = useState(prefetched || null);
  const [state, setState] = useState({ loading: !prefetched, error: "" });
  const [zoomed, setZoomed] = useState(false);
  const cardFrameRef = useRef(null);
  // 与列表卡片保持一致：优先用抓取时确定的封面图，详情接口的图只做兜底
  const detailImage = isNews ? proxiedImage(item.image || content?.image || sourceFavicon(item.url), item.url) : "";

  // 图片放大后按 Esc 关闭
  useEffect(() => {
    if (!zoomed) return undefined;
    const onKey = (event) => event.key === "Escape" && setZoomed(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomed]);

  useEffect(() => {
    // 滚动分页接口已内联返回摘要详情 → 直接用缓存，不再请求
    if (prefetched) {
      setContent(prefetched);
      setState({ loading: false, error: "" });
      return undefined;
    }
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
  }, [isNews, item.url, prefetched]);

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
          {isNews && <img src={detailImage} alt="" onClick={() => setZoomed(true)} onError={(event) => onImageError(item, event)} />}
          {!isNews && <p className="detail-card__lead">{item.description}</p>}
          {state.loading && <div className="detail-state"><CircleNotch className="spin" /> 正在从数据库读取…</div>}
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
              ? `来源：${item.source}。数据来自定时抓取批次，详情由大模型理解原文后生成中文要点摘要。`
              : "榜单来自 GitHub Trending；详情由大模型理解对应仓库 README 后生成中文要点摘要。"}
            {content?.translationProvider ? ` 当前引擎：${content.translationProvider}。` : ""}
          </p>
        </article>
      </div>
      {zoomed && detailImage && (
        <div className="image-lightbox" onClick={() => setZoomed(false)}>
          <img src={detailImage} alt="" />
        </div>
      )}
    </main>
  );
}

export function App() {
  const { path, navigate } = useRoute();
  const [showProfile, setShowProfile] = useState(false);

  // 名片浮层打开时按 Esc 关闭
  useEffect(() => {
    if (!showProfile) return undefined;
    const onKey = (event) => event.key === "Escape" && setShowProfile(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showProfile]);

  // 数据状态：feed 包含所有分类新闻 + GitHub 三周期仓库
  const [feed, setFeed] = useState({ available: false, news: {}, github: {}, timeLabel: null, updatedAt: null });
  const [activeCategory, setActiveCategory] = useState(NEWS_CATEGORIES[0]);
  const [repoPeriod, setRepoPeriod] = useState(REPO_PERIODS[0].value);
  const [initialLoading, setInitialLoading] = useState(true);
  const [offlinePage, setOfflinePage] = useState(false);
  const [error, setError] = useState("");
  const shellRef = useRef(null);
  // 最新的 feed（供轮询回调读取，避免闭包拿到旧值）
  const feedRef = useRef(feed);
  feedRef.current = feed;
  // 定时抓取窗口轮询状态
  const scheduledRef = useRef({ hour: -1, timer: null, baseline: null });
  // 滚动分页：每个分类独立的追加条目/游标/加载状态（切换分类不丢失）
  const [pagedNews, setPagedNews] = useState({});
  const pagedNewsRef = useRef(pagedNews);
  pagedNewsRef.current = pagedNews;
  // 分页接口内联返回的中文摘要详情缓存：详情页秒开，/api/article 兜底
  const detailCacheRef = useRef({});

  // 从 /api/feed 加载数据，返回响应（轮询用它判断新数据是否入库）
  const loadFeed = async (isInitial = false) => {
    try {
      const data = await fetchJson("/api/feed");
      setFeed(data);
      setError("");
      setOfflinePage(false);
      if (data.available) {
        setInitialLoading(false);
      }
      return data;
    } catch (err) {
      if (isOfflineError(err)) {
        setOfflinePage(true);
      }
      setError(err.message);
      return null;
    }
  };

  // 滚动触底加载当前分类的下一页（5 条 + 中文摘要详情）。
  // 不足 5 条或返回空 → 标记 exhausted，之后不再请求；失败静默，下次触底重试。
  const loadMoreNews = async (category) => {
    const state = pagedNewsRef.current[category] || { items: [], cursor: feedRef.current.newsCursors?.[category] || null, exhausted: false, loading: false };
    if (state.loading || state.exhausted) return;
    const loadingState = { ...state, loading: true };
    setPagedNews((prev) => ({ ...prev, [category]: loadingState }));
    pagedNewsRef.current = { ...pagedNewsRef.current, [category]: loadingState };
    try {
      const query = state.cursor ? `&cursor=${encodeURIComponent(state.cursor)}` : "";
      const data = await fetchJson(`/api/news/page?category=${encodeURIComponent(category)}${query}`);
      Object.assign(detailCacheRef.current, data.details || {});
      const existing = new Set(state.items.map((item) => item.id));
      const fresh = (data.items || []).filter((item) => !existing.has(item.id));
      const next = {
        items: [...state.items, ...fresh],
        cursor: data.nextCursor || state.cursor,
        exhausted: Boolean(data.exhausted) || fresh.length === 0,
        loading: false,
      };
      setPagedNews((prev) => ({ ...prev, [category]: next }));
      pagedNewsRef.current = { ...pagedNewsRef.current, [category]: next };
    } catch {
      // 静默失败：重置 loading，下次触底自动重试
      const reset = { ...state, loading: false };
      setPagedNews((prev) => ({ ...prev, [category]: reset }));
      pagedNewsRef.current = { ...pagedNewsRef.current, [category]: reset };
    }
  };

  // 新闻列表滚动：距底部 200px 内触发下一页请求
  const handleNewsScroll = (event) => {
    const el = event.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      loadMoreNews(activeCategory);
    }
  };

  // 初始加载：5 秒轮询，拿到数据后立即停止
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      const data = await loadFeed(true);
      if (data?.available && !stopped) {
        stopped = true;
        clearInterval(timer);
      }
    };
    tick();
    const timer = setInterval(tick, 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  // 定时抓取轮询：02:00 / 10:00 / 18:00 整点后 5 分钟内每 30 秒查一次，
  // 发现 updatedAt 变化（新数据入库）即停；窗口结束自动清理
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const inWindow = [2, 10, 18].includes(now.getHours()) && now.getMinutes() < 5;
      const state = scheduledRef.current;
      if (inWindow && state.hour !== now.getHours()) {
        state.hour = now.getHours();
        state.baseline = feedRef.current.updatedAt;
        if (state.timer) clearInterval(state.timer);
        state.timer = setInterval(async () => {
          const data = await loadFeed();
          if (data?.updatedAt && data.updatedAt !== scheduledRef.current.baseline) {
            clearInterval(scheduledRef.current.timer);
            scheduledRef.current.timer = null;
          }
        }, 30 * 1000);
      } else if (!inWindow && state.hour !== -1) {
        state.hour = -1;
        if (state.timer) {
          clearInterval(state.timer);
          state.timer = null;
        }
      }
    };
    tick();
    const guard = setInterval(tick, 30 * 1000);
    return () => {
      clearInterval(guard);
      if (scheduledRef.current.timer) clearInterval(scheduledRef.current.timer);
    };
  }, []);

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

  // 所有新闻的扁平查找表（用于详情页查找）：首屏 10 条 + 滚动分页追加的条目，按 id 去重
  const allNews = useMemo(() => {
    const seen = new Set();
    const items = [];
    for (const cat of Object.keys(feed.news || {})) {
      for (const item of [...(feed.news[cat] || []), ...(pagedNews[cat]?.items || [])]) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          items.push(item);
        }
      }
    }
    return items;
  }, [feed, pagedNews]);

  const githubRepos = feed.github?.[repoPeriod] || [];
  // 所有周期的仓库合集（用于详情页查找）
  const allRepos = useMemo(
    () => REPO_PERIODS.flatMap((p) => feed.github?.[p.value] || []),
    [feed],
  );
  // 当前分类的完整列表：首屏 + 分页追加（去重）
  const activeNews = useMemo(() => {
    const seen = new Set();
    const merged = [];
    for (const item of [...(feed.news?.[activeCategory] || []), ...(pagedNews[activeCategory]?.items || [])]) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        merged.push(item);
      }
    }
    return merged;
  }, [feed, pagedNews, activeCategory]);
  const activePaging = pagedNews[activeCategory];

  // 卡片交互效果
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
  }, [activeNews, githubRepos]);

  // 详情页查找
  const detail = useMemo(() => {
    const [kind, id] = path.split("/").filter(Boolean);
    if (kind === "news") return { type: "news", item: allNews.find((item) => item.id === decodeURIComponent(id)) };
    if (kind === "repo") return { type: "repo", item: allRepos.find((item) => item.id === decodeURIComponent(id)) };
    return null;
  }, [path, allNews, allRepos]);

  const retryInitialLoad = () => {
    setOfflinePage(false);
    setInitialLoading(true);
    loadFeed(true);
  };

  if (offlinePage) {
    return (
      <>
        <InteractiveBackdrop />
        <Offline404 onRetry={retryInitialLoad} retrying={initialLoading} />
        {(PIN_LOADING_OVERLAY || initialLoading) && <InitialDataOverlay />}
      </>
    );
  }

  const detailItem = detail?.item;

  return (
    <>
      <InteractiveBackdrop uniformGrid={Boolean(detailItem)} />
      {/* 首页常驻挂载：进入详情页只 hidden 不卸载，返回时机器人/列表/滚动位置全部保留 */}
      <div hidden={Boolean(detailItem)}>
        <main className="site-shell" ref={shellRef}>
        <header className="masthead">
          <div className="brand">
            <AnimatedBrandMark />
            <ShinyText
              text="Meridian"
              className="brand__shiny"
              speed={2.4}
              color="#aab4b0"
              shineColor="#ffffff"
              spread={118}
              direction="left"
            />
            <span className="brand__cn">子午视界</span>
          </div>
          <div className="masthead__signal">
            <GradientText
              className="masthead__gradient"
              colors={["#5227FF", "#FF9FFC", "#B497CF"]}
              animationSpeed={8}
              direction="horizontal"
              yoyo
            >
              好奇为眼，真实为岸，此刻为帆
            </GradientText>
          </div>
          <div className="masthead__actions">
            <a
              className="masthead__github"
              href="https://github.com/joesbell/meridian"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub 仓库"
              title="GitHub · joesbell/meridian"
            >
              <GithubLogo weight="bold" />
              <span>GitHub</span>
            </a>
            <LiveClock />
          </div>
        </header>

        <section className="control-grid">
          <aside className="rail rail--news">
            <RailHeader
              code="DAILY INTEL"
              title="今日简报"
              meta={`${feed.timeLabel || "--:--"} · 全中文`}
              visual="news"
            />
            <div className="category-tabs">
              <GooeyNav
                items={NEWS_CATEGORIES.map((cat) => ({ label: cat, value: cat }))}
                initialActiveIndex={NEWS_CATEGORIES.indexOf(activeCategory)}
                onSelect={(item) => setActiveCategory(item.value)}
                label="新闻分类"
              />
            </div>
            <div className="rail__scroll news-stack" onScroll={handleNewsScroll}>
              {activeNews.map((item, index) => (
                <NewsCard key={item.id} item={item} index={index} onOpen={(record) => navigate(`/news/${encodeURIComponent(record.id)}`)} />
              ))}
              {activePaging?.loading && (
                <div className="paging-hint"><CircleNotch className="spin" weight="bold" /> 正在加载更多…</div>
              )}
              {activePaging?.exhausted && activeNews.length > 0 && (
                <div className="paging-hint">已加载该分类全部内容</div>
              )}
              {activeNews.length === 0 && feed.available && (
                <LiveError title="该分类暂无数据" detail="当前抓取批次中此分类未取得有效内容，下个抓取窗口后自动恢复。" onRetry={() => loadFeed()} />
              )}
              {error && <LiveError title="新闻信号中断" detail={error} onRetry={() => loadFeed()} />}
            </div>
          </aside>

          <RadarStage paused={Boolean(detailItem)} />

          <aside className="rail rail--github">
            <RailHeader
              code="OPEN SOURCE"
              title="GitHub 热榜"
              meta={`${feed.timeLabel || "--:--"} · TOP ${githubRepos.length || "—"}`}
              visual="github"
            />
            <div className="category-tabs">
              <GooeyNav
                items={REPO_PERIODS}
                initialActiveIndex={REPO_PERIODS.findIndex((p) => p.value === repoPeriod)}
                onSelect={(item) => setRepoPeriod(item.value)}
                label="GitHub 热榜周期"
              />
            </div>
            <div className="rail__scroll repo-stack">
              {githubRepos.map((item) => (
                <RepoCard key={item.id} item={item} onOpen={(record) => navigate(`/repo/${encodeURIComponent(record.id)}`)} />
              ))}
              {githubRepos.length === 0 && feed.available && (
                <LiveError title="GitHub 榜单暂无数据" detail="当前抓取批次中 GitHub Trending 未取得有效内容，下个抓取窗口后自动恢复。" onRetry={() => loadFeed()} />
              )}
            </div>
          </aside>
        </section>

        <footer className="site-footer">
          <span><Pulse weight="fill" /> 每日 02:00 / 10:00 / 18:00 自动同步</span>
          <button
            type="button"
            className="site-footer__author"
            aria-label="打开 JASON 个人名片"
            onClick={() => setShowProfile(true)}
          >
            <Shuffle text="Visit The Author" className="site-footer__author-shuffle" />
            <LinkSimple weight="bold" />
          </button>
        </footer>
      </main>
      </div>
      {detailItem && (
        <Detail
          item={detail.item}
          type={detail.type}
          prefetched={detailCacheRef.current[detail.item.url]}
          onBack={() => navigate("/")}
        />
      )}
      {showProfile && (
        <div className="profile-overlay" onClick={() => setShowProfile(false)}>
          <div className="profile-overlay__card" onClick={(event) => event.stopPropagation()}>
            <ProfileCard
              avatarUrl="/assets/profile/jason-jiang-night-portrait.jpg"
              name="JASON.姜森"
              title="AI.AGENT Engineer"
              email="joesebll@163.com"
            />
          </div>
        </div>
      )}
      {(PIN_LOADING_OVERLAY || initialLoading) && <InitialDataOverlay />}
    </>
  );
}
