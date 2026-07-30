import { useEffect, useRef } from "react";
import { MODE_DRAWS, resolvePreset } from "thinking-orbs";

export function HighResolutionThinkingOrb({
  state = "searching",
  size = 320,
  speed = 1,
  ariaLabel = "正在搜索实时数据",
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const context = canvas.getContext("2d");
    if (!context) return undefined;

    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    const preset = resolvePreset(state, 64);
    const draw = MODE_DRAWS[preset.mode];
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let running = false;

    canvas.width = Math.round(size * pixelRatio);
    canvas.height = Math.round(size * pixelRatio);

    const paint = (time) => {
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, size, size);
      draw(context, size, time * preset.speed * speed, true, preset.opts);
    };

    const render = (now) => {
      paint(now / 1000);
      if (running) frame = window.requestAnimationFrame(render);
    };

    const start = () => {
      if (running || reducedMotion) return;
      running = true;
      frame = window.requestAnimationFrame(render);
    };

    const stop = () => {
      running = false;
      window.cancelAnimationFrame(frame);
    };

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") stop();
      else start();
    };

    paint(0.6);
    start();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [size, speed, state]);

  return (
    <canvas
      ref={canvasRef}
      className="high-resolution-thinking-orb"
      role="img"
      aria-label={ariaLabel}
      style={{ width: size, height: size }}
    />
  );
}
