import { useEffect, useRef } from "react";
import "./GooeyNav.css";

export default function GooeyNav({
  items,
  activeIndex = 0,
  onSelect,
  animationTime = 520,
  particleCount = 12,
  particleDistances = [54, 8],
  particleR = 74,
  timeVariance = 220,
  colors = [1, 2, 3, 1, 2, 4],
}) {
  const containerRef = useRef(null);
  const navRef = useRef(null);
  const filterRef = useRef(null);
  const textRef = useRef(null);
  const previousIndexRef = useRef(activeIndex);
  const timersRef = useRef([]);

  const noise = (amount = 1) => amount / 2 - Math.random() * amount;

  const getXY = (distance, pointIndex, totalPoints) => {
    const angle = ((360 + noise(8)) / totalPoints) * pointIndex * (Math.PI / 180);
    return [distance * Math.cos(angle), distance * Math.sin(angle)];
  };

  const updateEffectPosition = (element) => {
    if (!containerRef.current || !filterRef.current || !textRef.current || !element) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    const itemRect = element.getBoundingClientRect();
    const styles = {
      left: `${itemRect.x - containerRect.x}px`,
      top: `${itemRect.y - containerRect.y}px`,
      width: `${itemRect.width}px`,
      height: `${itemRect.height}px`,
    };
    Object.assign(filterRef.current.style, styles);
    Object.assign(textRef.current.style, styles);
    textRef.current.textContent = element.textContent;
  };

  const makeParticles = (element) => {
    const bubbleTime = animationTime * 2 + timeVariance;
    element.style.setProperty("--time", `${bubbleTime}ms`);
    element.querySelectorAll(".gooey-particle").forEach((particle) => particle.remove());

    for (let index = 0; index < particleCount; index += 1) {
      const timeout = window.setTimeout(() => {
        const rotateNoise = noise(particleR / 10);
        const start = getXY(particleDistances[0], particleCount - index, particleCount);
        const end = getXY(particleDistances[1] + noise(7), particleCount - index, particleCount);
        const duration = animationTime * 2 + noise(timeVariance * 2);
        const particle = document.createElement("span");
        const point = document.createElement("span");
        particle.className = "gooey-particle";
        point.className = "gooey-point";
        particle.style.setProperty("--start-x", `${start[0]}px`);
        particle.style.setProperty("--start-y", `${start[1]}px`);
        particle.style.setProperty("--end-x", `${end[0]}px`);
        particle.style.setProperty("--end-y", `${end[1]}px`);
        particle.style.setProperty("--time", `${duration}ms`);
        particle.style.setProperty("--scale", `${1 + noise(0.2)}`);
        particle.style.setProperty("--color", `var(--gooey-color-${colors[Math.floor(Math.random() * colors.length)]})`);
        particle.style.setProperty("--rotate", `${(rotateNoise > 0 ? rotateNoise + particleR / 20 : rotateNoise - particleR / 20) * 10}deg`);
        particle.appendChild(point);
        element.appendChild(particle);
        requestAnimationFrame(() => element.classList.add("is-active"));
        const removal = window.setTimeout(() => particle.remove(), duration);
        timersRef.current.push(removal);
      }, 30);
      timersRef.current.push(timeout);
    }
  };

  useEffect(() => {
    const activeItem = navRef.current?.querySelectorAll("li")[activeIndex];
    if (!activeItem) return undefined;
    updateEffectPosition(activeItem);
    textRef.current?.classList.add("is-active");

    if (previousIndexRef.current !== activeIndex && filterRef.current) {
      textRef.current?.classList.remove("is-active");
      void textRef.current?.offsetWidth;
      textRef.current?.classList.add("is-active");
      filterRef.current.classList.remove("is-active");
      makeParticles(filterRef.current);
    }
    previousIndexRef.current = activeIndex;

    const observer = new ResizeObserver(() => updateEffectPosition(activeItem));
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [activeIndex]);

  useEffect(() => () => timersRef.current.forEach((timer) => window.clearTimeout(timer)), []);

  return (
    <div className="gooey-nav" ref={containerRef}>
      <nav aria-label="GitHub 热榜周期">
        <ul ref={navRef} role="tablist">
          {items.map((item, index) => (
            <li key={item.value} className={activeIndex === index ? "is-active" : ""}>
              <button
                type="button"
                role="tab"
                aria-selected={activeIndex === index}
                tabIndex={activeIndex === index ? 0 : -1}
                onClick={() => onSelect?.(item, index)}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <span className="gooey-effect gooey-effect--filter" ref={filterRef} aria-hidden="true" />
      <span className="gooey-effect gooey-effect--text" ref={textRef} aria-hidden="true" />
    </div>
  );
}
