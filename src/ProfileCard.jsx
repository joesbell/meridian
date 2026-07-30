import { memo, useEffect, useRef } from "react";
import { EnvelopeSimple } from "@phosphor-icons/react";
import "./ProfileCard.css";

const clamp = (value, min = 0, max = 100) => Math.min(Math.max(value, min), max);
const mapRange = (value, fromMin, fromMax, toMin, toMax) =>
  toMin + ((toMax - toMin) * (value - fromMin)) / (fromMax - fromMin);

function ProfileCardComponent({
  avatarUrl,
  name = "JASON.姜森",
  title = "AI.software Engineer",
  email = "joesebll@163.com",
  className = "",
}) {
  const wrapperRef = useRef(null);
  const cardRef = useRef(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const card = cardRef.current;
    if (!wrapper || !card) return undefined;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let currentX = card.clientWidth / 2;
    let currentY = card.clientHeight / 2;
    let targetX = currentX;
    let targetY = currentY;

    const render = () => {
      currentX += (targetX - currentX) * 0.13;
      currentY += (targetY - currentY) * 0.13;

      const width = card.clientWidth || 1;
      const height = card.clientHeight || 1;
      const percentX = clamp((currentX / width) * 100);
      const percentY = clamp((currentY / height) * 100);
      const fromLeft = percentX / 100;
      const fromTop = percentY / 100;
      const fromCenter = clamp(Math.hypot(percentX - 50, percentY - 50) / 50, 0, 1);

      wrapper.style.setProperty("--pointer-x", `${percentX}%`);
      wrapper.style.setProperty("--pointer-y", `${percentY}%`);
      wrapper.style.setProperty("--background-x", `${mapRange(percentX, 0, 100, 35, 65)}%`);
      wrapper.style.setProperty("--background-y", `${mapRange(percentY, 0, 100, 35, 65)}%`);
      wrapper.style.setProperty("--pointer-from-left", fromLeft);
      wrapper.style.setProperty("--pointer-from-top", fromTop);
      wrapper.style.setProperty("--pointer-from-center", fromCenter);
      wrapper.style.setProperty("--rotate-x", reducedMotion ? "0deg" : `${-((percentX - 50) / 7)}deg`);
      wrapper.style.setProperty("--rotate-y", reducedMotion ? "0deg" : `${(percentY - 50) / 6}deg`);

      if (Math.abs(targetX - currentX) > 0.05 || Math.abs(targetY - currentY) > 0.05) {
        frame = requestAnimationFrame(render);
      } else {
        frame = 0;
      }
    };

    const requestRender = () => {
      if (!frame) frame = requestAnimationFrame(render);
    };

    const move = (event) => {
      const bounds = wrapper.getBoundingClientRect();
      wrapper.classList.add("is-active");
      targetX = event.clientX - bounds.left;
      targetY = event.clientY - bounds.top;
      requestRender();
    };

    const enter = (event) => {
      wrapper.classList.add("is-active");
      move(event);
    };

    const leave = () => {
      targetX = card.clientWidth / 2;
      targetY = card.clientHeight / 2;
      wrapper.classList.remove("is-active");
      requestRender();
    };

    wrapper.addEventListener("pointerenter", enter);
    wrapper.addEventListener("pointermove", move);
    wrapper.addEventListener("pointerleave", leave);
    requestRender();

    return () => {
      cancelAnimationFrame(frame);
      wrapper.removeEventListener("pointerenter", enter);
      wrapper.removeEventListener("pointermove", move);
      wrapper.removeEventListener("pointerleave", leave);
    };
  }, []);

  return (
    <div
      ref={wrapperRef}
      className={`profile-card-wrapper ${className}`.trim()}
      aria-label={`${name}，${title}`}
    >
      <div className="profile-card__behind" aria-hidden="true" />
      <article
        ref={cardRef}
        className="profile-card border-glow-card profile-card--border-glow"
        data-effect="reactbits-border-glow"
      >
        <div className="profile-card__inside">
          <img
            className="profile-card__photo"
            src={avatarUrl}
            alt={`${name} 个人照片`}
            width="1279"
            height="1706"
          />
          <div className="profile-card__shine" aria-hidden="true" />
          <div className="profile-card__glare" aria-hidden="true" />
          <div className="profile-card__scan" aria-hidden="true" />
          <header className="profile-card__identity">
            <strong>{name}</strong>
            <span>{title}</span>
          </header>
          <footer className="profile-card__footer">
            <span><EnvelopeSimple weight="bold" /><b>{email}</b></span>
          </footer>
        </div>
      </article>
    </div>
  );
}

const ProfileCard = memo(ProfileCardComponent);

export default ProfileCard;
