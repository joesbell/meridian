import { useEffect, useRef } from "react";

const CHARSET = "  .,:;i1tfLCG08@";
const GLYPHS = {
  C: ["1111", "1000", "1000", "1000", "1111"],
  D: ["1110", "1001", "1001", "1001", "1110"],
  E: ["1111", "1000", "1110", "1000", "1111"],
  G: ["1111", "1000", "1011", "1001", "1111"],
  I: ["1111", "0110", "0110", "0110", "1111"],
  N: ["1001", "1101", "1011", "1001", "1001"],
  O: ["1111", "1001", "1001", "1001", "1111"],
  S: ["1111", "1000", "1111", "0001", "1111"],
  W: ["1001", "1001", "1011", "1111", "1001"],
};

export function AsciiSideLabel({ text, side, scale = 2 }) {
  const rootRef = useRef(null);
  const preRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    const output = preRef.current;
    if (!root || !output) return undefined;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const source = document.createElement("canvas");
    const ctx = source.getContext("2d", { willReadFrequently: true });
    if (!ctx) return undefined;

    let columns = 0;
    let rows = 0;
    let frame = 0;
    let lastPaint = 0;
    let pointerX = window.innerWidth / 2;
    let pointerY = window.innerHeight / 2;

    const resize = () => {
      const bounds = root.getBoundingClientRect();
      columns = Math.max(24, Math.floor(bounds.width / (4 * scale)));
      rows = Math.max(10, Math.floor(bounds.height / (6 * scale)));
      source.width = columns;
      source.height = rows;
      output.style.fontSize = `${Math.max(4.4 * scale, bounds.width / columns)}px`;
    };

    const onPointerMove = (event) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
    };

    const paint = (time = 0) => {
      if (time - lastPaint < (reduced ? 240 : 72)) {
        frame = window.requestAnimationFrame(paint);
        return;
      }
      lastPaint = time;
      ctx.clearRect(0, 0, columns, rows);
      const bounds = root.getBoundingClientRect();
      const localY = Math.max(-1, Math.min(1, (pointerY - (bounds.top + bounds.height / 2)) / (bounds.height / 2)));
      const edgeDistance = side === "left" ? pointerX : window.innerWidth - pointerX;
      const nearSide = 1 - Math.min(1, edgeDistance / Math.max(1, window.innerWidth * 0.25));
      const wave = reduced ? 0 : Math.sin(time * 0.00125) * 0.65;
      const pointerWave = localY * Math.max(0, nearSide) * 0.8;
      const glyphWidth = text.length * 4 + Math.max(0, text.length - 1);
      const originX = Math.floor((columns - glyphWidth) / 2 + wave + pointerWave);
      const originY = Math.floor((rows - 5) / 2);
      [...text].forEach((character, characterIndex) => {
        const glyph = GLYPHS[character] || GLYPHS.E;
        glyph.forEach((line, row) => {
          [...line].forEach((pixel, column) => {
            if (pixel !== "1") return;
            const flicker = reduced ? 0.92 : 0.78 + Math.sin(time * 0.003 + row + characterIndex) * 0.18;
            ctx.fillStyle = `rgba(255,255,255,${Math.min(1, flicker + Math.max(0, nearSide) * 0.12)})`;
            ctx.fillRect(originX + characterIndex * 5 + column, originY + row, 1, 1);
          });
        });
      });

      const pixels = ctx.getImageData(0, 0, columns, rows).data;
      let ascii = "";
      for (let row = 0; row < rows; row += 1) {
        const rowShift = reduced ? 0 : Math.round(Math.sin(row * 0.4 + time * 0.0024) * 0.55);
        for (let column = 0; column < columns; column += 1) {
          const sampleColumn = Math.max(0, Math.min(columns - 1, column + rowShift));
          const index = (row * columns + sampleColumn) * 4;
          const alpha = pixels[index + 3] / 255;
          const light = ((pixels[index] * 0.3 + pixels[index + 1] * 0.6 + pixels[index + 2] * 0.1) / 255) * alpha;
          ascii += light < 0.035 ? " " : CHARSET[Math.min(CHARSET.length - 1, Math.floor(light * (CHARSET.length - 1)))];
        }
        ascii += "\n";
      }
      output.textContent = ascii;
      root.style.setProperty("--ascii-energy", String(0.48 + Math.max(0, nearSide) * 0.42));
      frame = window.requestAnimationFrame(paint);
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    frame = window.requestAnimationFrame(paint);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, [scale, side, text]);

  return (
    <div
      ref={rootRef}
      className={`ascii-side-label ascii-side-label--${side}`}
      data-ascii-text={text}
      aria-hidden="true"
    >
      <span className="ascii-side-label__rule" />
      <pre ref={preRef} />
      <span className="ascii-side-label__meta">{side === "left" ? "01 / INTEL" : "02 / SOURCE"}</span>
    </div>
  );
}
