import { useEffect, useRef } from "react";
import * as THREE from "three";

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const fragmentShader = `
  precision highp float;
  varying vec2 vUv;
  uniform vec2 uMouse;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uInfluence;

  float gridLine(vec2 uv, float density) {
    vec2 cell = fract(uv * density);
    vec2 distanceToEdge = min(cell, 1.0 - cell);
    float line = max(
      1.0 - smoothstep(0.0, 0.035, distanceToEdge.x),
      1.0 - smoothstep(0.0, 0.035, distanceToEdge.y)
    );
    return line;
  }

  void main() {
    vec2 uv = vUv;
    vec2 mouse = uMouse;
    vec2 pixelDelta = (uv - mouse) * uResolution;
    float distancePx = length(pixelDelta);
    float bowl = exp(-(distancePx * distancePx) / (2.0 * 19.0 * 19.0)) * uInfluence;
    float rim = exp(-pow((distancePx - 30.0) / 5.5, 2.0)) * uInfluence;
    vec2 directionUv = normalize(pixelDelta + vec2(0.0001)) / uResolution;
    vec2 warpedUv = uv + directionUv * bowl * 10.0;
    warpedUv += directionUv * sin(distancePx * 0.42 - uTime * 2.0) * rim * 0.75;

    float fine = gridLine(warpedUv, 27.0);
    float major = gridLine(warpedUv, 6.75);
    vec3 base = vec3(0.025, 0.035, 0.033);
    vec3 grid = vec3(0.15, 0.42, 0.35) * fine * 0.20;
    grid += vec3(0.18, 0.52, 0.43) * major * 0.13;
    float depthShade = 1.0 - bowl * 0.74;
    vec3 dent = -base * bowl * 1.22;
    vec3 edge = vec3(0.24, 0.86, 0.69) * rim * 0.22;
    float vignette = smoothstep(0.88, 0.22, distance(vUv, vec2(0.5)));
    gl_FragColor = vec4(((base + grid) * depthShade + dent + edge) * (0.72 + vignette * 0.28), 0.88);
  }
`;

export function RadarField() {
  const hostRef = useRef(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.Camera();
    const resolution = new THREE.Vector2(1, 1);
    const targetMouse = new THREE.Vector2(0.5, 0.5);
    const smoothMouse = new THREE.Vector2(0.5, 0.5);
    const uniforms = {
      uMouse: { value: smoothMouse },
      uResolution: { value: resolution },
      uTime: { value: 0 },
      uInfluence: { value: 0 },
    };
    const shaderMaterial = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      transparent: true,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), shaderMaterial);
    scene.add(quad);
    const clock = new THREE.Clock();
    let targetInfluence = 0;
    let frame = 0;

    const resize = () => {
      const rect = host.getBoundingClientRect();
      renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
      resolution.set(rect.width, rect.height);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const move = (event) => {
      const rect = host.getBoundingClientRect();
      targetMouse.set(
        THREE.MathUtils.clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1),
        THREE.MathUtils.clamp(1 - (event.clientY - rect.top) / Math.max(1, rect.height), 0, 1),
      );
      targetInfluence = 1;
    };
    const leave = () => {
      targetInfluence = 0;
    };
    const pointerSurface = host.parentElement || host;
    pointerSurface.addEventListener("pointermove", move, { passive: true });
    pointerSurface.addEventListener("pointerleave", leave);

    const render = () => {
      const delta = Math.min(clock.getDelta(), 0.05);
      const ease = 1 - Math.exp(-delta * 10);
      smoothMouse.lerp(targetMouse, ease);
      uniforms.uInfluence.value = THREE.MathUtils.lerp(uniforms.uInfluence.value, targetInfluence, ease * 0.8);
      uniforms.uTime.value = clock.elapsedTime;
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(render);
    };
    frame = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(frame);
      pointerSurface.removeEventListener("pointermove", move);
      pointerSurface.removeEventListener("pointerleave", leave);
      observer.disconnect();
      quad.geometry.dispose();
      shaderMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={hostRef} className="radar-field" aria-hidden="true" />;
}
