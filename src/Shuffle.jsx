import { useMemo, useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import "./Shuffle.css";

gsap.registerPlugin(useGSAP);

function randomCharacter(charset, fallback) {
  if (!charset) return fallback;
  return charset[Math.floor(Math.random() * charset.length)] || fallback;
}

function isWideCharacter(character) {
  return /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/u.test(character);
}

export default function Shuffle({
  text = "",
  className = "",
  shuffleDirection = "right",
  duration = 0.35,
  ease = "power3.out",
  tag = "span",
  onShuffleComplete,
  shuffleTimes = 1,
  animationMode = "evenodd",
  loop = false,
  loopDelay = 0,
  stagger = 0.03,
  maxDelay = 0,
  scrambleCharset = "",
  colorFrom,
  colorTo,
  respectReducedMotion = true,
  triggerOnHover = true,
}) {
  const rootRef = useRef(null);
  const Tag = tag;
  const characters = useMemo(() => [...text], [text]);
  const rolls = Math.max(1, Math.floor(shuffleTimes));

  useGSAP(
    () => {
      const root = rootRef.current;
      if (!root) return undefined;
      const reduced = respectReducedMotion && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const wrappers = [...root.querySelectorAll("[data-shuffle-wrapper]")];
      const vertical = shuffleDirection === "up" || shuffleDirection === "down";
      const forward = shuffleDirection === "right" || shuffleDirection === "down";
      let timeline;

      const randomize = () => {
        wrappers.forEach((wrapper) => {
          const strip = wrapper.firstElementChild;
          if (!strip) return;
          const finalCharacter = wrapper.dataset.finalCharacter;
          [...strip.children].forEach((glyph, index, glyphs) => {
            if (index === 0 || index === glyphs.length - 1) return;
            glyph.textContent = randomCharacter(scrambleCharset, finalCharacter);
          });
        });
      };

      const configure = () => {
        wrappers.forEach((wrapper) => {
          const strip = wrapper.firstElementChild;
          if (!strip) return;
          const rect = wrapper.getBoundingClientRect();
          const step = vertical ? rect.height : rect.width;
          const start = forward ? -(rolls + 1) * step : 0;
          const end = forward ? 0 : -(rolls + 1) * step;
          strip.dataset.shuffleStart = String(start);
          strip.dataset.shuffleEnd = String(end);
          [...strip.children].forEach((glyph) => {
            glyph.style.width = `${rect.width}px`;
            glyph.style.height = `${rect.height}px`;
          });
          gsap.set(strip, vertical ? { y: start, x: 0 } : { x: start, y: 0 });
          if (colorFrom) strip.style.color = colorFrom;
        });
      };

      const setStart = () => {
        wrappers.forEach((wrapper) => {
          const strip = wrapper.firstElementChild;
          const start = Number(strip?.dataset.shuffleStart || 0);
          if (strip) gsap.set(strip, vertical ? { y: start } : { x: start });
        });
      };

      const animateGroup = (targets, at) => {
        if (!targets.length) return;
        const vars = {
          duration,
          ease,
          force3D: true,
          stagger: animationMode === "evenodd" ? stagger : 0,
        };
        if (vertical) {
          vars.y = (_, strip) => Number(strip.dataset.shuffleEnd || 0);
        } else {
          vars.x = (_, strip) => Number(strip.dataset.shuffleEnd || 0);
        }
        timeline.to(targets, vars, at);
        if (colorFrom && colorTo) timeline.to(targets, { color: colorTo, duration, ease }, at);
      };

      const buildTimeline = () => {
        const strips = wrappers.map((wrapper) => wrapper.firstElementChild).filter(Boolean);
        root.dataset.shuffleRuns = "1";
        timeline = gsap.timeline({
          smoothChildTiming: true,
          repeat: loop ? -1 : 0,
          repeatDelay: loop ? loopDelay : 0,
          onRepeat: () => {
            root.dataset.shuffleRuns = String(Number(root.dataset.shuffleRuns || 1) + 1);
            randomize();
            setStart();
            onShuffleComplete?.();
          },
          onComplete: () => onShuffleComplete?.(),
        });

        if (animationMode === "evenodd") {
          const odd = strips.filter((_, index) => index % 2 === 1);
          const even = strips.filter((_, index) => index % 2 === 0);
          const oddDuration = duration + Math.max(0, odd.length - 1) * stagger;
          animateGroup(odd, 0);
          animateGroup(even, oddDuration * 0.7);
        } else {
          strips.forEach((strip) => animateGroup([strip], Math.random() * maxDelay));
        }
      };

      randomize();
      configure();
      root.classList.add("is-ready");
      if (reduced) {
        wrappers.forEach((wrapper) => {
          const strip = wrapper.firstElementChild;
          if (strip) gsap.set(strip, vertical ? { y: 0 } : { x: 0 });
        });
        return () => root.classList.remove("is-ready");
      }

      buildTimeline();
      const replay = () => {
        randomize();
        setStart();
        timeline.restart();
      };
      if (triggerOnHover) root.addEventListener("pointerenter", replay);

      return () => {
        if (triggerOnHover) root.removeEventListener("pointerenter", replay);
        timeline?.kill();
        root.classList.remove("is-ready");
      };
    },
    {
      scope: rootRef,
      dependencies: [
        text,
        shuffleDirection,
        duration,
        ease,
        shuffleTimes,
        animationMode,
        loop,
        loopDelay,
        stagger,
        maxDelay,
        scrambleCharset,
        colorFrom,
        colorTo,
        respectReducedMotion,
        triggerOnHover,
        onShuffleComplete,
      ],
    },
  );

  return (
    <Tag
      ref={rootRef}
      className={`shuffle-parent ${className}`}
      aria-label={text}
      data-effect="reactbits-shuffle"
      data-shuffle-cycle={loop ? loopDelay : undefined}
    >
      <span className="shuffle-content" aria-hidden="true">
        {characters.map((character, characterIndex) => {
          if (character === " ") {
            return <span className="shuffle-space" key={`space-${characterIndex}`} />;
          }
          const glyphs = Array.from({ length: rolls + 2 }, (_, glyphIndex) => (
            <span className="shuffle-char" key={`${characterIndex}-${glyphIndex}`}>
              {character}
            </span>
          ));
          return (
            <span
              className={`shuffle-char-wrapper shuffle-char-wrapper--${shuffleDirection}${isWideCharacter(character) ? " shuffle-char-wrapper--wide" : ""}`}
              data-shuffle-wrapper
              data-final-character={character}
              key={`${character}-${characterIndex}`}
            >
              <span className="shuffle-char-strip">{glyphs}</span>
            </span>
          );
        })}
      </span>
    </Tag>
  );
}
