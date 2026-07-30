import { Children, useEffect, useRef } from "react";

// Adapted from React Bits Fuzzy Text (JS + CSS variant).
export default function FuzzyText({
  children,
  fontSize = 180,
  fontWeight = 900,
  fontFamily = "Inter, sans-serif",
  color = "#f3f5f0",
  enableHover = true,
  baseIntensity = 0.16,
  hoverIntensity = 0.48,
  fuzzRange = 30,
  fps = 60,
  className = "",
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext("2d");
    if (!context) return undefined;

    let cancelled = false;
    let frame = 0;
    let hovering = false;
    let lastFrame = 0;
    const frameDuration = 1000 / fps;
    const text = Children.toArray(children).join("");
    const size = typeof fontSize === "number" ? fontSize : Number.parseFloat(fontSize) || 180;
    const font = `${fontWeight} ${size}px ${fontFamily}`;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const initialize = async () => {
      try {
        await document.fonts.load(font);
      } catch {
        await document.fonts.ready;
      }
      if (cancelled) return;

      const source = document.createElement("canvas");
      const sourceContext = source.getContext("2d");
      if (!sourceContext) return;
      sourceContext.font = font;
      sourceContext.textBaseline = "alphabetic";
      const metrics = sourceContext.measureText(text);
      const ascent = Math.ceil(metrics.actualBoundingBoxAscent || size);
      const descent = Math.ceil(metrics.actualBoundingBoxDescent || size * 0.2);
      const textWidth = Math.ceil(metrics.width) + 12;
      const textHeight = ascent + descent;
      const margin = fuzzRange + 20;

      source.width = Math.ceil(textWidth * dpr);
      source.height = Math.ceil(textHeight * dpr);
      sourceContext.setTransform(dpr, 0, 0, dpr, 0, 0);
      sourceContext.font = font;
      sourceContext.textBaseline = "alphabetic";
      sourceContext.fillStyle = color;
      sourceContext.fillText(text, 6, ascent);

      const cssWidth = textWidth + margin * 2;
      const cssHeight = textHeight;
      canvas.width = Math.ceil(cssWidth * dpr);
      canvas.height = Math.ceil(cssHeight * dpr);
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      const draw = (time) => {
        if (cancelled) return;
        if (time - lastFrame < frameDuration) {
          frame = window.requestAnimationFrame(draw);
          return;
        }
        lastFrame = time;
        context.clearRect(0, 0, cssWidth, cssHeight);
        const intensity = hovering ? hoverIntensity : baseIntensity;
        for (let row = 0; row < textHeight; row += 1) {
          const offset = Math.floor(intensity * (Math.random() - 0.5) * fuzzRange);
          context.drawImage(
            source,
            0,
            row * dpr,
            source.width,
            dpr,
            margin + offset,
            row,
            textWidth,
            1,
          );
        }
        frame = window.requestAnimationFrame(draw);
      };
      frame = window.requestAnimationFrame(draw);
    };

    const move = (event) => {
      if (!enableHover) return;
      const bounds = canvas.getBoundingClientRect();
      hovering = event.clientX >= bounds.left
        && event.clientX <= bounds.right
        && event.clientY >= bounds.top
        && event.clientY <= bounds.bottom;
    };
    const leave = () => {
      hovering = false;
    };

    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerleave", leave);
    initialize();

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerleave", leave);
    };
  }, [
    baseIntensity,
    children,
    color,
    enableHover,
    fontFamily,
    fontSize,
    fontWeight,
    fps,
    fuzzRange,
    hoverIntensity,
  ]);

  return <canvas ref={canvasRef} className={className} aria-label={String(children)} role="img" />;
}
