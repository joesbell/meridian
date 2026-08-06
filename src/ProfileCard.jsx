import { memo, useEffect, useRef } from "react";
import * as THREE from "three";
import "./ProfileCard.css";

const clamp = (value, min = 0, max = 100) => Math.min(Math.max(value, min), max);
const mapRange = (value, fromMin, fromMax, toMin, toMax) =>
  toMin + ((toMax - toMin) * (value - fromMin)) / (fromMax - fromMin);

export function MorphingCube({ className = "profile-card__cube", flatten = false, color = 0x263129 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 30);
    camera.position.z = 7.2;
    const group = new THREE.Group();
    scene.add(group);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6f8878, 2.6));
    const light = new THREE.DirectionalLight(0xffffff, 4.2);
    light.position.set(3, 4, 6);
    scene.add(light);

    const geometry = new THREE.BoxGeometry(0.48, 0.48, 0.48);
    const material = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.62,
      roughness: 0.3,
    });
    const pieces = [];
    for (let x = -1; x <= 1; x += 1) {
      for (let y = -1; y <= 1; y += 1) {
        for (let z = -1; z <= 1; z += 1) {
          const index = pieces.length;
          const mesh = new THREE.Mesh(geometry, material);
          const base = new THREE.Vector3(x, y, z).multiplyScalar(0.52);
          const direction = base.lengthSq()
            ? base.clone().normalize()
            : new THREE.Vector3(0.7, -0.45, 0.55).normalize();
          mesh.position.copy(base);
          group.add(mesh);
          const latitude = Math.acos(1 - (2 * (index + 0.5)) / 27);
          const longitude = Math.PI * (1 + Math.sqrt(5)) * index;
          const exploded = new THREE.Vector3(
            Math.sin(latitude) * Math.cos(longitude) * 1.72,
            Math.cos(latitude) * 1.34,
            Math.sin(latitude) * Math.sin(longitude) * 1.05,
          );
          pieces.push({
            mesh,
            base,
            direction,
            exploded,
            groundY: -1.62 + (index % 4) * 0.025,
            dropDelay: (index % 9) * 0.045 + Math.floor(index / 9) * 0.07,
            driftX: ((index * 7) % 9 - 4) * 0.055,
            driftZ: ((index * 5) % 7 - 3) * 0.045,
            spinX: 1.8 + (index % 5) * 0.38,
            spinZ: (index % 2 ? -1 : 1) * (1.4 + (index % 4) * 0.34),
            x,
            y,
            z,
          });
        }
      }
    }

    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      renderer.setSize(Math.max(width, 1), Math.max(height, 1), false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ease = (value) => value * value * (3 - 2 * value);
    const xAxis = new THREE.Vector3(1, 0, 0);
    const yAxis = new THREE.Vector3(0, 1, 0);
    const leftRotation = new THREE.Quaternion();
    const applyFall = (piece, elapsed) => {
      const { mesh, exploded, groundY, dropDelay, driftX, driftZ, spinX, spinZ } = piece;
      const time = Math.max(0, elapsed - dropDelay);
      const gravity = 3.15;
      const impactTime = Math.sqrt((2 * Math.max(exploded.y - groundY, 0.08)) / gravity);
      mesh.position.copy(exploded);
      if (time < impactTime) {
        mesh.position.y = exploded.y - 0.5 * gravity * time * time;
      } else {
        const bounceTime = time - impactTime;
        const bounce = Math.exp(-3.25 * bounceTime) * Math.abs(Math.sin(bounceTime * 8.2)) * 0.34;
        const rollTime = Math.min(bounceTime, 1.25);
        mesh.position.set(exploded.x + driftX * rollTime, groundY + bounce, exploded.z + driftZ * rollTime);
      }
      mesh.rotation.x = (piece.mesh.userData.explodeX || 0) + time * spinX;
      mesh.rotation.z = (piece.mesh.userData.explodeZ || 0) + time * spinZ;
    };
    let frame = 0;
    const render = (now = 0) => {
      const seconds = now / 1000;
      const phase = seconds % (flatten ? 12.2 : 7);
      let scatter = 0;
      if (flatten) {
        if (phase < 2.2) {
          const spin = ease(phase / 2.2);
          group.rotation.x = 0.35 + Math.sin(spin * Math.PI * 2) * 0.18;
          group.rotation.y = spin * Math.PI * 2;
        } else if (phase < 3.1) {
          group.rotation.x = 0.35 * (1 - ease((phase - 2.2) / 0.9));
          group.rotation.y = 0;
        } else if (phase < 10.2) {
          group.rotation.set(0, 0, 0);
        } else {
          group.rotation.x = 0.35 * ease((phase - 10.2) / 2);
          group.rotation.y = 0;
        }
      } else {
        scatter = phase < 2 ? 0 : phase < 3 ? ease(phase - 2) : phase < 4.2 ? 1 : phase < 5.2 ? 1 - ease(phase - 4.2) : 0;
        group.rotation.x = 0.42 + seconds * 0.42;
        group.rotation.y = 0.58 + seconds * 0.62;
      }

      pieces.forEach((piece, index) => {
        const { mesh, base, direction, exploded, x, y, z } = piece;
        if (!flatten) {
          mesh.position.copy(base).addScaledVector(direction, scatter * 0.72);
          mesh.rotation.x = scatter * (index % 3) * 0.34;
          mesh.rotation.y = scatter * (index % 5) * 0.22;
          return;
        }

        mesh.position.copy(base);
        mesh.quaternion.identity();
        const topProgress = phase < 2.2 ? 0 : phase < 3.1 ? ease((phase - 2.2) / 0.9) : 1;
        const bottomProgress = phase < 3.1 ? 0 : phase < 4 ? ease((phase - 3.1) / 0.9) : 1;
        const leftProgress = phase < 4 ? 0 : phase < 5.1 ? ease((phase - 4) / 1.1) : 1;
        const layerAngle = y === 1 ? topProgress * Math.PI / 2 : y === -1 ? -bottomProgress * Math.PI / 2 : 0;
        if (layerAngle) {
          mesh.position.applyAxisAngle(yAxis, layerAngle);
          mesh.quaternion.setFromAxisAngle(yAxis, layerAngle);
        }
        const isCurrentLeftLayer = Math.abs(mesh.position.x + 0.52) < 0.01;
        if (isCurrentLeftLayer && leftProgress) {
          const angle = -leftProgress * Math.PI / 2;
          mesh.position.applyAxisAngle(xAxis, angle);
          leftRotation.setFromAxisAngle(xAxis, angle);
          mesh.quaternion.premultiply(leftRotation);
        }

        if (phase >= 5.1 && phase < 6.3) {
          const progress = ease((phase - 5.1) / 1.2);
          mesh.position.lerp(exploded, progress);
          mesh.rotation.x = progress * (index % 4) * 0.48;
          mesh.rotation.z = progress * (index % 5) * 0.38;
          mesh.userData.explodeX = (index % 4) * 0.48;
          mesh.userData.explodeZ = (index % 5) * 0.38;
        } else if (phase >= 6.3 && phase < 7.1) {
          mesh.position.copy(exploded);
          mesh.rotation.x = mesh.userData.explodeX || 0;
          mesh.rotation.z = mesh.userData.explodeZ || 0;
        } else if (phase >= 7.1 && phase < 9.5) {
          applyFall(piece, phase - 7.1);
        } else if (phase >= 9.5 && phase < 10.2) {
          applyFall(piece, 2.4);
        } else if (phase >= 10.2) {
          const progress = ease((phase - 10.2) / 2);
          applyFall(piece, 2.4);
          mesh.position.lerp(base, progress);
          mesh.rotation.x *= 1 - progress;
          mesh.rotation.z *= 1 - progress;
        }
      });
      renderer.render(scene, camera);
      if (!reducedMotion) frame = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, [color, flatten]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="img"
      aria-label={flatten ? "分层旋转、均匀爆开、物理坠落并重新聚合的 WebGL 魔方动画" : "旋转、散开并重新聚合的 WebGL 魔方动画"}
    />
  );
}

export function NewsGlobe({ className = "rail-header__canvas" }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 20);
    camera.position.z = 6.4;

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const loader = new THREE.TextureLoader();
    const earthTexture = loader.load("/assets/earth/earth-atmos.jpg");
    const specularTexture = loader.load("/assets/earth/earth-specular.jpg");
    const normalTexture = loader.load("/assets/earth/earth-normal.jpg");
    const cloudTexture = loader.load("/assets/earth/earth-clouds.png");
    earthTexture.colorSpace = THREE.SRGBColorSpace;
    cloudTexture.colorSpace = THREE.SRGBColorSpace;
    earthTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    cloudTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

    scene.add(new THREE.AmbientLight(0x8aa5b8, 1.15));
    const sunlight = new THREE.DirectionalLight(0xffffff, 3.4);
    sunlight.position.set(-3, 2.2, 4.5);
    scene.add(sunlight);
    const globe = new THREE.Group();
    const earthGeometry = new THREE.SphereGeometry(0.88, 48, 32);
    const earthMaterial = new THREE.MeshPhongMaterial({
      map: earthTexture,
      specularMap: specularTexture,
      normalMap: normalTexture,
      normalScale: new THREE.Vector2(0.68, 0.68),
      specular: new THREE.Color(0x385c70),
      shininess: 18,
    });
    const cloudGeometry = new THREE.SphereGeometry(0.9, 48, 32);
    const cloudMaterial = new THREE.MeshPhongMaterial({ map: cloudTexture, transparent: true, opacity: 0.72, depthWrite: false });
    const atmosphereGeometry = new THREE.SphereGeometry(0.98, 48, 32);
    const atmosphereMaterial = new THREE.ShaderMaterial({
      vertexShader: "varying vec3 vNormal; void main(){vNormal=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      fragmentShader: "varying vec3 vNormal; void main(){float glow=pow(max(0.0,0.72-dot(vNormal,vec3(0.0,0.0,1.0))),2.4);gl_FragColor=vec4(0.18,0.72,1.0,glow*0.72);}",
      transparent: true,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const earth = new THREE.Mesh(earthGeometry, earthMaterial);
    const clouds = new THREE.Mesh(cloudGeometry, cloudMaterial);
    globe.add(earth, clouds, new THREE.Mesh(atmosphereGeometry, atmosphereMaterial));
    globe.rotation.z = -0.18;
    scene.add(globe);

    const paperCanvas = document.createElement("canvas");
    paperCanvas.width = 128;
    paperCanvas.height = 88;
    const context = paperCanvas.getContext("2d");
    context.fillStyle = "#f4f2e8";
    context.fillRect(0, 0, 128, 88);
    context.fillStyle = "#263129";
    context.fillRect(9, 9, 72, 8);
    context.fillStyle = "#758078";
    [27, 38, 49, 60, 71].forEach((y, index) => context.fillRect(9, y, index % 2 ? 90 : 108, 4));
    const paperTexture = new THREE.CanvasTexture(paperCanvas);
    const paperGeometry = new THREE.PlaneGeometry(0.62, 0.43);
    const directions = [
      [1, 0.35, 0.1], [0.65, 0.8, -0.1], [-0.15, 1, 0.1], [-0.75, 0.65, 0],
      [-1, 0.1, -0.1], [-0.55, -0.7, 0.1], [0.25, -1, 0], [0.9, -0.45, -0.1],
    ];
    const papers = directions.map((values, index) => {
      const material = new THREE.MeshBasicMaterial({ map: paperTexture, transparent: true, side: THREE.DoubleSide, depthWrite: false });
      const mesh = new THREE.Mesh(paperGeometry, material);
      scene.add(mesh);
      return { mesh, material, direction: new THREE.Vector3(...values).normalize(), offset: index / directions.length };
    });

    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      renderer.setSize(Math.max(width, 1), Math.max(height, 1), false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    const render = (now = 0) => {
      const seconds = now / 1000;
      earth.rotation.y = seconds * 0.24;
      clouds.rotation.y = seconds * 0.3;
      papers.forEach(({ mesh, material, direction, offset }, index) => {
        const progress = (seconds * 0.22 + offset) % 1;
        mesh.position.copy(direction).multiplyScalar(0.72 + progress * 2.25);
        mesh.position.x += Math.sin(progress * Math.PI * 2 + index) * 0.22;
        mesh.position.y += Math.sin(progress * Math.PI) * 0.42;
        mesh.position.z += Math.sin(progress * Math.PI) * 0.3;
        mesh.rotation.z = seconds * (index % 2 ? -0.62 : 0.62) + index;
        mesh.rotation.y = Math.sin(seconds + index) * 0.45;
        const visibility = Math.sin(progress * Math.PI);
        mesh.scale.setScalar(0.45 + visibility * 0.55);
        material.opacity = visibility * 0.92;
      });
      renderer.render(scene, camera);
      if (!reducedMotion) frame = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      papers.forEach(({ material }) => material.dispose());
      paperTexture.dispose();
      paperGeometry.dispose();
      earthTexture.dispose();
      specularTexture.dispose();
      normalTexture.dispose();
      cloudTexture.dispose();
      earthGeometry.dispose();
      earthMaterial.dispose();
      cloudGeometry.dispose();
      cloudMaterial.dispose();
      atmosphereGeometry.dispose();
      atmosphereMaterial.dispose();
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className={className} role="img" aria-label="旋转地球持续发射新闻纸张的 WebGL 动画" />;
}

function ProfileCardComponent({
  avatarUrl,
  name = "JASON.姜森",
  title = "AI.AGENT Engineer",
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
          <div className="profile-card__media">
            <img
              className="profile-card__photo"
              src={avatarUrl}
              alt={`${name} 个人照片`}
              width="1279"
              height="1706"
            />
            <header className="profile-card__identity">
              <strong>{name}</strong>
            </header>
          </div>
          <div className="profile-card__shine" aria-hidden="true" />
          <div className="profile-card__glare" aria-hidden="true" />
          <div className="profile-card__scan" aria-hidden="true" />
          <footer className="profile-card__footer">
            <div className="profile-card__contact">
              <img src={avatarUrl} alt="" aria-hidden="true" />
              <span>
                <b>{email}</b>
                <small>{title}</small>
              </span>
            </div>
            <MorphingCube />
          </footer>
        </div>
      </article>
    </div>
  );
}

const ProfileCard = memo(ProfileCardComponent);

export default ProfileCard;
