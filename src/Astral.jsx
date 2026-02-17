/**
 * ASTRAL – Production-Grade Interactive 3D Satellite Collision Visualization
 * 
 * v4.0 FINAL PRODUCTION BUILD
 * 
 * Techniques from anime.js & igloo.inc:
 *   · Locomotive-style smooth scroll with velocity tracking
 *   · Magnetic cursor with elastic trail + context awareness  
 *   · Character-level staggered text reveals with spring physics
 *   · Morphing SVG path animations
 *   · Scroll-velocity-based visual distortion
 *   · Grain overlay with animated noise
 *   · Parallax depth layers
 *   · Number counter animations with easing
 *   · Color-shifting accent gradients
 *   · Horizontal scroll micro-sections
 *   · Frame corner markers with phase-reactive colors
 *   · Ultra-precise typography with optical kerning
 *
 * 3D Features:
 *   · Visible colored orbital rings (neon-styled, always visible)
 *   · Satellites constrained to orbit paths with visible motion
 *   · Multi-layer atmosphere with real stratification
 *   · Free camera orbit when scroll stops (drag to explore)
 *   · Real-time collision: satellites approach on orbits, collide, disintegrate
 *   · Fiery debris spreads in collision orbital shell
 *   · Post-processing: bloom, chromatic aberration, grain, vignette
 */

import { useRef, useEffect, useState, useCallback, memo, useMemo } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

/* ═══════════════════════════════════════════════════════════════════════════
   §1 DESIGN SYSTEM
   ═══════════════════════════════════════════════════════════════════════════ */

const EARTH_RADIUS = 2.2;
const CAM_DIST = 8.5;
const SAT_POOL = 200;
const DEBRIS_N = 1400;
const SCROLL_IDLE_MS = 200;

const PHASES = { P0: 0, P1: 0.2, P2: 0.4, P3: 0.6, P4: 0.8 };
const FOV_MAP = [50, 62, 36, 30, 44];

const C = {
  bg: "#010812",
  text: "#e8edf5",
  textDim: "rgba(160,190,255,0.4)",
  textMicro: "rgba(160,190,255,0.25)",
  dim06: "rgba(255,255,255,0.06)",
  blue: "#4a90e2",
  cyan: "#00ffc8",
  orange: "#ff8800",
  red: "#ff3030",
  redDeep: "#ff6020",
  satNormal: "#a0c8ff",
  satActive: "#00ffc8",
  satDim: "#162038",
  debris: "#ff5518",
  debrisCool: "#ff8833",
};

const ACCENT = ["#4a90e2", "#ff8800", "#00ffc8", "#ff3030", "#ff6020"];
const STATUS_LABEL = ["NOMINAL", "WARNING", "MONITORING", "CRITICAL", "CASCADE"];

const F = {
  display: "'Instrument Serif', Georgia, serif",
  mono: "'JetBrains Mono', 'Courier New', monospace",
  sans: "'Inter', -apple-system, sans-serif",
};

/* Orbit definitions — colored, visible, beautiful */
const ORBIT_DEFS = [
  { r: 1.22, inc: 0.20, asc: 0.0,  color: "#2266ff", width: 1.2 },
  { r: 1.30, inc: -0.35, asc: 0.8,  color: "#3388ee", width: 1.0 },
  { r: 1.36, inc: 0.50, asc: 1.6,  color: "#4499dd", width: 1.1 },
  { r: 1.42, inc: -0.15, asc: 2.4,  color: "#55aacc", width: 0.9 },
  { r: 1.48, inc: 0.65, asc: 3.2,  color: "#44bbdd", width: 1.0 },
  { r: 1.54, inc: -0.45, asc: 4.0,  color: "#33ccee", width: 0.8 },
  { r: 1.60, inc: 0.30, asc: 4.8,  color: "#22ddff", width: 1.1 },
  { r: 1.66, inc: -0.55, asc: 5.5,  color: "#55ccff", width: 0.9 },
  { r: 1.72, inc: 0.40, asc: 0.5,  color: "#6699ff", width: 1.0 },
  { r: 1.78, inc: -0.25, asc: 1.2,  color: "#7788ee", width: 0.8 },
  { r: 1.84, inc: 0.55, asc: 2.0,  color: "#8877dd", width: 0.9 },
  { r: 1.90, inc: -0.40, asc: 2.8,  color: "#9966cc", width: 0.7 },
];

/* Atmosphere layers */
const ATMO = [
  { name: "Troposphere",  r: 1.008, color: "#4488cc", op: 0.05, rim: 2.0 },
  { name: "Stratosphere", r: 1.022, color: "#5599dd", op: 0.045, rim: 2.4 },
  { name: "Mesosphere",   r: 1.038, color: "#6688cc", op: 0.038, rim: 2.8 },
  { name: "Thermosphere", r: 1.058, color: "#4477bb", op: 0.030, rim: 3.4 },
  { name: "Exosphere",    r: 1.085, color: "#3366aa", op: 0.022, rim: 4.2 },
];

const CHAPTERS = [
  { tag: "PHASE 00", title: "Normal\nOrbit", body: "4 satellites trace clean paths above Earth. The orbital shell is peaceful, organized — a marvel of human engineering stretching across low Earth orbit.", accent: "#4a90e2" },
  { tag: "PHASE 01", title: "Orbital\nCongestion", body: "Over 9,000 active satellites now share orbital space. The shell grows dense — a crowded highway with no traffic control, no lanes, no margin for error.", accent: "#ff8800" },
  { tag: "PHASE 02", title: "Active\nSatellites", body: "Among thousands of objects, only a fraction remain operational. These critical assets — communications, navigation, weather — sustain modern civilization.", accent: "#00ffc8" },
  { tag: "PHASE 03", title: "Collision\nRisk", body: "ASTRAL detects two objects on converging trajectories. At 7.8 km/s, even centimeter-scale debris carries the energy of a hand grenade.", accent: "#ff3030" },
  { tag: "PHASE 04", title: "Kessler\nSyndrome", body: "Two satellites collide and disintegrate. Fiery debris spreads across the orbital shell. One collision becomes a thousand. This is physics.", accent: "#ff6020" },
];

const METRICS = [
  { label: "TRACKED OBJECTS", vals: ["8,900", "9,400+", "9,400+", "9,403", "9,403+"] },
  { label: "COLLISION ALERTS", vals: ["0", "0", "12", "1 CRITICAL", "CASCADE"] },
  { label: "ORBITAL BANDS", vals: ["CLEAR", "DENSE", "DENSE", "COMPROMISED", "UNUSABLE"] },
];

/* ═══════════════════════════════════════════════════════════════════════════
   §2 MATH
   ═══════════════════════════════════════════════════════════════════════════ */

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const remap = (v, a, b) => clamp((v - a) / (b - a));
const lerp = (a, b, t) => a + (b - a) * t;
const smootherstep = t => t * t * t * (t * (t * 6 - 15) + 10);
const outExpo = t => t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
const outElastic = t => {
  if (t === 0 || t === 1) return t;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
};
const outBack = t => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const spring = (current, target, velocity, stiffness = 0.08, damping = 0.7) => {
  const force = (target - current) * stiffness;
  const newVel = (velocity + force) * damping;
  return { value: current + newVel, velocity: newVel };
};

const randOnSphere = (r, rng = Math.random) => {
  const th = rng() * Math.PI * 2;
  const ph = Math.acos(2 * rng() - 1);
  return new THREE.Vector3(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph), r * Math.sin(ph) * Math.sin(th));
};
const prng = (seed = 42) => { let s = seed; return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; }; };

/* Orbital position calculator */
const orbitPos = (radius, inc, asc, angle) => {
  const x0 = Math.cos(angle) * radius;
  const z0 = Math.sin(angle) * radius;
  const y1 = -z0 * Math.sin(inc);
  const z1 = z0 * Math.cos(inc);
  return new THREE.Vector3(
    x0 * Math.cos(asc) - z1 * Math.sin(asc),
    y1,
    x0 * Math.sin(asc) + z1 * Math.cos(asc)
  );
};

/* ═══════════════════════════════════════════════════════════════════════════
   §3 LOCOMOTIVE-STYLE SMOOTH SCROLL ENGINE
   ═══════════════════════════════════════════════════════════════════════════ */

function useLocoScroll() {
  const raw = useRef(0);
  const smooth = useRef(0);
  const velocity = useRef(0);
  const scrolling = useRef(false);
  const idleTimer = useRef(null);
  const [chapter, setChapter] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const el = document.documentElement;
      const max = el.scrollHeight - window.innerHeight;
      raw.current = max > 0 ? clamp(window.scrollY / max) : 0;
      scrolling.current = true;
      clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => { scrolling.current = false; }, SCROLL_IDLE_MS);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); clearTimeout(idleTimer.current); };
  }, []);

  useEffect(() => {
    let raf;
    const tick = () => {
      const delta = raw.current - smooth.current;
      const speed = Math.abs(delta) > 0.06 ? 0.055 : 0.028;
      const prev = smooth.current;
      smooth.current += delta * speed;
      velocity.current = smooth.current - prev;
      if (Math.abs(delta) < 0.00003) smooth.current = raw.current;
      const p = smooth.current;
      setChapter(p < PHASES.P1 ? 0 : p < PHASES.P2 ? 1 : p < PHASES.P3 ? 2 : p < PHASES.P4 ? 3 : 4);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return { raw, smooth, velocity, scrolling, chapter };
}

/* ═══════════════════════════════════════════════════════════════════════════
   §4 MOUSE + DRAG SYSTEM
   ═══════════════════════════════════════════════════════════════════════════ */

function useMouseSystem() {
  const pos = useRef({ x: 0, y: 0, cx: 0, cy: 0 });
  const smooth = useRef({ x: 0, y: 0 });
  const down = useRef(false);
  const prev = useRef({ x: 0, y: 0 });
  const drag = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const mm = e => {
      pos.current = { cx: e.clientX, cy: e.clientY, x: (e.clientX / window.innerWidth) * 2 - 1, y: -(e.clientY / window.innerHeight) * 2 + 1 };
      if (down.current) {
        drag.current.x = e.clientX - prev.current.x;
        drag.current.y = e.clientY - prev.current.y;
        prev.current = { x: e.clientX, y: e.clientY };
      }
    };
    const md = e => { down.current = true; prev.current = { x: e.clientX, y: e.clientY }; drag.current = { x: 0, y: 0 }; };
    const mu = () => { down.current = false; drag.current = { x: 0, y: 0 }; };

    window.addEventListener("mousemove", mm, { passive: true });
    window.addEventListener("mousedown", md);
    window.addEventListener("mouseup", mu);
    window.addEventListener("touchstart", e => { if (e.touches[0]) md(e.touches[0]); }, { passive: true });
    window.addEventListener("touchmove", e => { if (e.touches[0]) mm(e.touches[0]); }, { passive: true });
    window.addEventListener("touchend", mu);

    let raf;
    const tick = () => {
      smooth.current.x += (pos.current.x - smooth.current.x) * 0.05;
      smooth.current.y += (pos.current.y - smooth.current.y) * 0.05;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("mousemove", mm); window.removeEventListener("mousedown", md); window.removeEventListener("mouseup", mu); };
  }, []);

  return { pos, smooth, down, drag };
}

/* ═══════════════════════════════════════════════════════════════════════════
   §5 CUSTOM CURSOR (igloo.inc grade)
   ═══════════════════════════════════════════════════════════════════════════ */

const Cursor = memo(function Cursor({ chapter, scrolling }) {
  const dotRef = useRef(null);
  const ringRef = useRef(null);
  const labelRef = useRef(null);
  const pos = useRef({ x: -100, y: -100 });
  const dotPos = useRef({ x: -100, y: -100 });
  const ringPos = useRef({ x: -100, y: -100 });
  const scale = useRef({ v: 1, vel: 0 });
  const hovering = useRef(false);
  const label = useRef("");

  useEffect(() => {
    const mm = e => { pos.current = { x: e.clientX, y: e.clientY }; };
    const mo = e => {
      const el = e.target.closest("[data-magnetic], a, button, [data-hover]");
      hovering.current = !!el;
      label.current = el?.getAttribute("data-cursor-label") || "";
    };
    window.addEventListener("mousemove", mm, { passive: true });
    document.addEventListener("mouseover", mo, { passive: true });

    let raf;
    const tick = () => {
      // Dot follows fast
      dotPos.current.x += (pos.current.x - dotPos.current.x) * 0.2;
      dotPos.current.y += (pos.current.y - dotPos.current.y) * 0.2;
      // Ring follows slower (igloo.inc lag effect)
      ringPos.current.x += (pos.current.x - ringPos.current.x) * 0.08;
      ringPos.current.y += (pos.current.y - ringPos.current.y) * 0.08;
      // Spring scale
      const target = hovering.current ? 3.2 : scrolling ? 0.5 : 1;
      const s = spring(scale.current.v, target, scale.current.vel, 0.06, 0.72);
      scale.current = { v: s.value, vel: s.velocity };

      if (dotRef.current) dotRef.current.style.transform = `translate(${dotPos.current.x - 4}px,${dotPos.current.y - 4}px) scale(${scale.current.v})`;
      if (ringRef.current) {
        ringRef.current.style.transform = `translate(${ringPos.current.x - 24}px,${ringPos.current.y - 24}px) scale(${scale.current.v * 0.45 + 0.55})`;
        ringRef.current.style.borderColor = ACCENT[chapter];
      }
      if (labelRef.current) {
        labelRef.current.textContent = label.current;
        labelRef.current.style.opacity = label.current ? "1" : "0";
        labelRef.current.style.transform = `translate(${ringPos.current.x + 28}px,${ringPos.current.y - 8}px)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("mousemove", mm); document.removeEventListener("mouseover", mo); };
  }, [chapter, scrolling]);

  return (
    <>
      <div ref={dotRef} style={{ position: "fixed", top: 0, left: 0, width: 8, height: 8, borderRadius: "50%", background: C.text, pointerEvents: "none", zIndex: 9999, mixBlendMode: "difference", willChange: "transform" }} />
      <div ref={ringRef} style={{ position: "fixed", top: 0, left: 0, width: 48, height: 48, borderRadius: "50%", border: `1px solid ${ACCENT[0]}`, pointerEvents: "none", zIndex: 9998, opacity: 0.4, willChange: "transform", transition: "border-color 0.5s ease" }} />
      <div ref={labelRef} style={{ position: "fixed", top: 0, left: 0, pointerEvents: "none", zIndex: 9997, fontFamily: F.mono, fontSize: 8, letterSpacing: "0.2em", color: ACCENT[chapter], opacity: 0, transition: "opacity 0.3s", willChange: "transform" }} />
    </>
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   §6 TEXT ANIMATION SYSTEM (anime.js grade)
   ═══════════════════════════════════════════════════════════════════════════ */

function SplitChars({ children, visible = true, delay = 0, stagger = 0.022, style = {} }) {
  const text = String(children);
  return (
    <span style={{ display: "inline-block", ...style }} aria-label={text}>
      {text.split("").map((c, i) => (
        <span key={i} aria-hidden style={{
          display: "inline-block",
          transform: visible ? "translateY(0) rotateX(0)" : "translateY(120%) rotateX(-80deg)",
          opacity: visible ? 1 : 0,
          transition: `transform 0.9s cubic-bezier(0.19,1,0.22,1) ${delay + i * stagger}s, opacity 0.5s ease ${delay + i * stagger}s`,
          transformOrigin: "bottom center",
          whiteSpace: c === " " ? "pre" : "normal",
          willChange: "transform, opacity",
        }}>
          {c === " " ? "\u00A0" : c}
        </span>
      ))}
    </span>
  );
}

function RevealLine({ children, delay = 0, visible = true, style = {} }) {
  return (
    <div style={{ overflow: "hidden", ...style }}>
      <div style={{
        transform: visible ? "translateY(0)" : "translateY(105%)",
        opacity: visible ? 1 : 0,
        transition: `transform 1.1s cubic-bezier(0.19,1,0.22,1) ${delay}s, opacity 0.7s ease ${delay}s`,
        willChange: "transform, opacity",
      }}>
        {children}
      </div>
    </div>
  );
}

/* Animated number counter (anime.js signature) */
function AnimatedNumber({ value, duration = 1200, visible = true }) {
  const [display, setDisplay] = useState("0");
  const ref = useRef(null);
  
  useEffect(() => {
    if (!visible) { setDisplay("0"); return; }
    const numericVal = parseInt(value.replace(/[^0-9]/g, ""), 10);
    if (isNaN(numericVal)) { setDisplay(value); return; }
    
    const start = performance.now();
    const tick = (now) => {
      const t = clamp((now - start) / duration);
      const eased = outExpo(t);
      const current = Math.round(numericVal * eased);
      setDisplay(current.toLocaleString() + value.replace(/[0-9,]/g, ""));
      if (t < 1) ref.current = requestAnimationFrame(tick);
    };
    ref.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(ref.current);
  }, [value, visible, duration]);

  return <span>{display}</span>;
}

function Magnetic({ children, strength = 0.3, style = {} }) {
  const ref = useRef(null);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const mm = useCallback(e => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setOff({ x: (e.clientX - r.left - r.width / 2) * strength, y: (e.clientY - r.top - r.height / 2) * strength });
  }, [strength]);
  const ml = useCallback(() => setOff({ x: 0, y: 0 }), []);
  return (
    <div ref={ref} data-magnetic onMouseMove={mm} onMouseLeave={ml} style={{
      ...style, transform: `translate(${off.x}px,${off.y}px)`,
      transition: "transform 0.4s cubic-bezier(0.19,1,0.22,1)", willChange: "transform",
    }}>{children}</div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   §7 POST-PROCESSING SHADERS
   ═══════════════════════════════════════════════════════════════════════════ */

const VignetteFS = {
  uniforms: { tDiffuse: { value: null }, uI: { value: 0.42 } },
  vertexShader: `varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader: `uniform sampler2D tDiffuse;uniform float uI;varying vec2 v;void main(){vec4 c=texture2D(tDiffuse,v);vec2 u=v*(1.-v.yx);c.rgb*=pow(u.x*u.y*15.,uI*0.45);gl_FragColor=c;}`,
};

const GrainFS = {
  uniforms: { tDiffuse: { value: null }, uT: { value: 0 }, uI: { value: 0.04 } },
  vertexShader: `varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader: `uniform sampler2D tDiffuse;uniform float uT,uI;varying vec2 v;float h(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}void main(){vec4 c=texture2D(tDiffuse,v);c.rgb+=(h(v*1e3+uT*137.)*2.-1.)*uI;gl_FragColor=c;}`,
};

const ChromaFS = {
  uniforms: { tDiffuse: { value: null }, uO: { value: 0.0005 } },
  vertexShader: `varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader: `uniform sampler2D tDiffuse;uniform float uO;varying vec2 v;void main(){vec2 d=v-.5;float l=length(d);float o=uO*l;gl_FragColor=vec4(texture2D(tDiffuse,v+d*o).r,texture2D(tDiffuse,v).g,texture2D(tDiffuse,v-d*o).b,1.);}`,
};

/* ═══════════════════════════════════════════════════════════════════════════
   §8 THREE.JS SCENE ENGINE
   ═══════════════════════════════════════════════════════════════════════════ */

function buildStars() {
  const rng = prng(99), N = 5000;
  const p = new Float32Array(N * 3), s = new Float32Array(N), a = new Float32Array(N), tw = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const v = randOnSphere(85 + rng() * 100, rng);
    p[i * 3] = v.x; p[i * 3 + 1] = v.y; p[i * 3 + 2] = v.z;
    s[i] = rng() * 2.0 + 0.3; a[i] = rng() * 0.6 + 0.4; tw[i] = 0.15 + rng() * 1.5;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(p, 3));
  g.setAttribute("size", new THREE.BufferAttribute(s, 1));
  g.setAttribute("alpha", new THREE.BufferAttribute(a, 1));
  g.setAttribute("twinkle", new THREE.BufferAttribute(tw, 1));
  return g;
}

function generateSats(orbits, rng) {
  const sats = [];
  let id = 0;
  orbits.forEach((o, oi) => {
    const n = oi < 4 ? 1 : Math.ceil(SAT_POOL / orbits.length);
    for (let j = 0; j < n && id < SAT_POOL; j++) {
      sats.push({
        id: id++, oi,
        r: EARTH_RADIUS * o.r, inc: o.inc, asc: o.asc,
        phase: (j / n) * Math.PI * 2 + rng() * 0.4,
        speed: 0.08 + rng() * 0.08,
        size: 0.018 + rng() * 0.012,
      });
    }
  });
  while (sats.length < SAT_POOL) {
    const oi = Math.floor(rng() * orbits.length);
    const o = orbits[oi];
    sats.push({ id: sats.length, oi, r: EARTH_RADIUS * o.r, inc: o.inc, asc: o.asc, phase: rng() * Math.PI * 2, speed: 0.08 + rng() * 0.08, size: 0.018 + rng() * 0.012 });
  }
  return sats.slice(0, SAT_POOL);
}

const satPos = (s, t) => orbitPos(s.r, s.inc, s.asc, s.phase + s.speed * t);

class AstralEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.clock = new THREE.Clock();
    this.progress = 0;
    this.mx = 0; this.my = 0;
    this.isScrolling = true;
    this.isDragging = false;
    this.dragDX = 0; this.dragDY = 0;
    this.scrollVelocity = 0;
    this.disposed = false;
    this.currentFov = FOV_MAP[0];

    this._d = new THREE.Object3D();
    this._tc = new THREE.Color();
    this._tv = new THREE.Vector3();
    this._tv2 = new THREE.Vector3();

    // Camera orbit
    this.camSph = new THREE.Spherical(CAM_DIST, Math.PI / 2 - 0.08, 0);
    this.camTarget = new THREE.Spherical(CAM_DIST, Math.PI / 2 - 0.08, 0);
    this.camUserTheta = 0; this.camUserPhi = 0;
    this.camFree = false;
    const L = [
      { th: 0, ph: Math.PI / 2 - 0.08, d: CAM_DIST },
      { th: 0.3, ph: Math.PI / 2, d: CAM_DIST + 1.5 },
      { th: 0.1, ph: Math.PI / 2 - 0.12, d: CAM_DIST - 1.5 },
      { th: 0, ph: Math.PI / 2 + 0.08, d: CAM_DIST - 3.0 },
      { th: 0, ph: Math.PI / 2, d: CAM_DIST + 0.5 },
    ];
    this.camLocked = L;

    this.collisionDone = false;
    this.collisionTime = 0;
    this.collisionPt = new THREE.Vector3();
    this.collisionR = 0;

    this._initRenderer();
    this._initScene();
    this._initCamera();
    this._initPost();
    this._initLights();
    this._initStars();
    this._initNebula();
    this._initEarth();
    this._initAtmo();
    this._initOrbits();
    this._initSats();
    this._initDebris();
    this._initFlash();

    this._raf = requestAnimationFrame(this._loop.bind(this));
  }

  _initRenderer() {
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.setSize(window.innerWidth, window.innerHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.15;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = r;
    this._ro = new ResizeObserver(() => {
      const w = window.innerWidth, h = window.innerHeight;
      r.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.composer?.setSize(w, h);
    });
    this._ro.observe(document.body);
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(C.bg);
    this.scene.fog = new THREE.FogExp2(C.bg, 0.0025);
    this.root = new THREE.Group();
    this.scene.add(this.root);
  }

  _initCamera() {
    this.camera = new THREE.PerspectiveCamera(FOV_MAP[0], window.innerWidth / window.innerHeight, 0.1, 500);
    this.camera.position.setFromSpherical(this.camSph);
    this.camera.lookAt(0, 0, 0);
  }

  _initPost() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.28, 1.0, 0.78);
    this.composer.addPass(this.bloom);
    this.chroma = new ShaderPass(ChromaFS);
    this.composer.addPass(this.chroma);
    this.vig = new ShaderPass(VignetteFS);
    this.composer.addPass(this.vig);
    this.grain = new ShaderPass(GrainFS);
    this.composer.addPass(this.grain);
  }

  _initLights() {
    this.scene.add(new THREE.DirectionalLight(0xfff5e0, 2.6).translateX(8).translateY(4).translateZ(6));
    this.scene.add(new THREE.DirectionalLight(0x3a6fff, 0.4).translateX(-6).translateY(-2).translateZ(-4));
    this.scene.add(new THREE.DirectionalLight(0x553399, 0.1).translateY(-5).translateZ(3));
    this.scene.add(new THREE.AmbientLight(0x0d1a2e, 0.85));
    this.colLight = new THREE.PointLight(0xff4400, 0, 18);
    this.root.add(this.colLight);
  }

  _initStars() {
    const g = buildStars();
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `attribute float size,alpha,twinkle;varying float vA;uniform float uTime;void main(){vA=alpha*(0.5+0.5*sin(uTime*twinkle+alpha*30.));vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=size*(260./-mv.z);gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `varying float vA;void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;float a=smoothstep(.5,0.,d);gl_FragColor=vec4(mix(vec3(.7,.85,1.),vec3(1.),a),a*vA);}`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.starMat = m;
    this.stars = new THREE.Points(g, m);
    this.scene.add(this.stars);
  }

  _initNebula() {
    const rng = prng(42), N = 400;
    const p = new Float32Array(N * 3), s = new Float32Array(N);
    for (let i = 0; i < N; i++) { const v = randOnSphere(30 + rng() * 50, rng); p[i * 3] = v.x; p[i * 3 + 1] = v.y; p[i * 3 + 2] = v.z; s[i] = rng() * 20 + 6; }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    g.setAttribute("size", new THREE.BufferAttribute(s, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `attribute float size;varying float vA;uniform float uTime;void main(){vA=0.012*(0.8+0.2*sin(uTime*0.06+position.x));vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=size*(160./-mv.z);gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `varying float vA;void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;gl_FragColor=vec4(0.12,0.25,0.6,smoothstep(.5,0.,d)*vA);}`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.nebMat = m;
    this.scene.add(new THREE.Points(g, m));
  }

  _initEarth() {
    const fg = new THREE.SphereGeometry(EARTH_RADIUS, 128, 128);
    const fm = new THREE.MeshStandardMaterial({ color: 0x2255aa, roughness: 0.65, metalness: 0.05, emissive: 0x0a1530, emissiveIntensity: 0.12 });
    this.earth = new THREE.Mesh(fg, fm);
    this.root.add(this.earth);

    const cg = new THREE.SphereGeometry(EARTH_RADIUS * 1.006, 96, 96);
    const cm = new THREE.MeshPhongMaterial({ color: 0xffffff, transparent: true, opacity: 0.045, depthWrite: false });
    this.clouds = new THREE.Mesh(cg, cm);
    this.root.add(this.clouds);

    new GLTFLoader().load("/earth.glb", gltf => {
      this.root.remove(this.earth);
      const mdl = gltf.scene;
      const s = EARTH_RADIUS / new THREE.Box3().setFromObject(mdl).getBoundingSphere(new THREE.Sphere()).radius;
      mdl.scale.setScalar(s);
      mdl.traverse(c => {
        if (c.isMesh && c.material) {
          const hsl = {}; c.material.color?.getHSL(hsl);
          if (hsl.s !== undefined) c.material.color.setHSL(hsl.h, Math.min(hsl.s * 1.35, 1), hsl.l * 1.05);
          c.material.needsUpdate = true;
        }
      });
      this.earth = mdl;
      this.root.add(this.earth);
    }, undefined, () => {});
  }

  _initAtmo() {
    this.atmoLayers = [];
    ATMO.forEach(layer => {
      const g = new THREE.SphereGeometry(EARTH_RADIUS * layer.r, 96, 96);
      const m = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(layer.color) },
          uRim: { value: layer.rim },
          uOp: { value: layer.op },
          uTime: { value: 0 },
          uWarn: { value: 0 },
        },
        vertexShader: `varying vec3 vN,vP,vW;void main(){vN=normalize(normalMatrix*normal);vP=(modelViewMatrix*vec4(position,1.)).xyz;vW=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader: `
          uniform vec3 uColor;uniform float uRim,uOp,uTime,uWarn;
          varying vec3 vN,vP,vW;
          void main(){
            float rim=1.-abs(dot(normalize(vN),normalize(-vP)));
            rim=pow(rim,uRim);
            float shimmer=1.+0.06*sin(uTime*0.5+vW.y*5.+vW.x*3.);
            vec3 col=mix(uColor,vec3(0.95,0.2,0.05),uWarn*0.35);
            gl_FragColor=vec4(col,rim*uOp*shimmer);
          }`,
        transparent: true, side: THREE.FrontSide, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(g, m);
      this.root.add(mesh);
      this.atmoLayers.push({ mesh, mat: m });
    });
  }

  /* ── COLORED VISIBLE ORBIT RINGS ──────────────────────────────────── */
  _initOrbits() {
    this.orbitRings = [];
    ORBIT_DEFS.forEach(o => {
      const pts = [];
      for (let i = 0; i <= 512; i++) {
        const a = (i / 512) * Math.PI * 2;
        pts.push(orbitPos(EARTH_RADIUS * o.r, o.inc, o.asc, a));
      }
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      
      // Use ShaderMaterial for glowing colored orbits
      const m = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(o.color) },
          uOpacity: { value: 0.0 },
          uTime: { value: 0 },
          uGlow: { value: 0.3 },
        },
        vertexShader: `
          varying float vDist;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vDist = -mv.z;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uOpacity, uTime, uGlow;
          varying float vDist;
          void main() {
            float brightness = 0.6 + 0.4 * sin(uTime * 0.3 + vDist * 2.0);
            vec3 col = uColor * brightness;
            // Add glow effect
            col += uColor * uGlow;
            gl_FragColor = vec4(col, uOpacity * brightness);
          }`,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      
      const line = new THREE.Line(g, m);
      this.root.add(line);
      this.orbitRings.push({ line, mat: m, def: o });
    });

    // Danger orbits (collision pair)
    this.dangerOrbitA = { r: EARTH_RADIUS * 1.42, inc: 0.35, asc: 0.4 };
    this.dangerOrbitB = { r: EARTH_RADIUS * 1.42, inc: -0.3, asc: 0.4 };

    [["dRingA", "dRingMatA", this.dangerOrbitA], ["dRingB", "dRingMatB", this.dangerOrbitB]].forEach(([mn, mm, o]) => {
      const pts = [];
      for (let i = 0; i <= 512; i++) pts.push(orbitPos(o.r, o.inc, o.asc, (i / 512) * Math.PI * 2));
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      const m = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color("#ff2020") },
          uOpacity: { value: 0 },
          uTime: { value: 0 },
          uGlow: { value: 0.5 },
        },
        vertexShader: `varying float vDist;void main(){vec4 mv=modelViewMatrix*vec4(position,1.);vDist=-mv.z;gl_Position=projectionMatrix*mv;}`,
        fragmentShader: `uniform vec3 uColor;uniform float uOpacity,uTime,uGlow;varying float vDist;void main(){float b=0.5+0.5*sin(uTime*2.+vDist*3.);vec3 c=uColor*(b+uGlow);gl_FragColor=vec4(c,uOpacity*b);}`,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const l = new THREE.Line(g, m);
      this.root.add(l);
      this[mn] = l; this[mm] = m;
    });
  }

  _initSats() {
    const rng = prng(13);
    this.satData = generateSats(ORBIT_DEFS, rng);
    this.activeIdx = [0, 7, 14, 22, 31, 38, 47, 55, 63, 74, 88, 101, 130, 155];

    this._buildInstanced(this._buildSatGeo());

    new GLTFLoader().load("/satellite.glb", gltf => {
      let g = null;
      gltf.scene.traverse(c => { if (c.isMesh && !g) g = c.geometry.clone(); });
      if (g) { g.computeBoundingSphere(); const s = 0.045 / g.boundingSphere.radius; g.scale(s, s, s); this.root.remove(this.satInst); this._buildInstanced(g); }
    }, undefined, () => {});

    // Danger sats
    this.dA = { r: this.dangerOrbitA.r, inc: this.dangerOrbitA.inc, asc: this.dangerOrbitA.asc, phase: 0, speed: 0.2 };
    this.dB = { r: this.dangerOrbitB.r, inc: this.dangerOrbitB.inc, asc: this.dangerOrbitB.asc, phase: Math.PI * 0.82, speed: 0.23 };

    const dg = this._buildSatGeo();
    this.dMatA = new THREE.MeshPhongMaterial({ color: C.satNormal, emissive: C.satNormal, emissiveIntensity: 0.3, shininess: 100 });
    this.dMatB = this.dMatA.clone();
    this.dMeshA = new THREE.Mesh(dg, this.dMatA); this.dMeshA.scale.setScalar(2.0); this.dMeshA.visible = false;
    this.dMeshB = new THREE.Mesh(dg.clone(), this.dMatB); this.dMeshB.scale.setScalar(2.0); this.dMeshB.visible = false;
    this.root.add(this.dMeshA); this.root.add(this.dMeshB);

    new GLTFLoader().load("/satellite.glb", gltf => {
      let g = null;
      gltf.scene.traverse(c => { if (c.isMesh && !g) g = c.geometry.clone(); });
      if (g) {
        g.computeBoundingSphere(); const s = 0.05 / g.boundingSphere.radius; g.scale(s, s, s);
        this.root.remove(this.dMeshA); this.root.remove(this.dMeshB);
        this.dMeshA = new THREE.Mesh(g, this.dMatA); this.dMeshA.scale.setScalar(2.0); this.dMeshA.visible = false;
        this.dMeshB = new THREE.Mesh(g.clone(), this.dMatB); this.dMeshB.scale.setScalar(2.0); this.dMeshB.visible = false;
        this.root.add(this.dMeshA); this.root.add(this.dMeshB);
      }
    }, undefined, () => {});

    // Glow sprites
    const gt = this._glowTex(255, 50, 30);
    this.gMA = new THREE.SpriteMaterial({ map: gt, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.gMB = this.gMA.clone();
    this.dGlowA = new THREE.Sprite(this.gMA); this.dGlowA.scale.setScalar(0);
    this.dGlowB = new THREE.Sprite(this.gMB); this.dGlowB.scale.setScalar(0);
    this.root.add(this.dGlowA); this.root.add(this.dGlowB);

    // Active glow
    const ag = this._buildSatGeo();
    this.actMeshes = this.activeIdx.map(() => {
      const m = new THREE.Mesh(ag.clone(), new THREE.MeshPhongMaterial({ color: C.satActive, emissive: C.satActive, emissiveIntensity: 2.0, shininess: 120, transparent: true }));
      m.visible = false; this.root.add(m); return m;
    });
    const at = this._glowTex(0, 255, 200);
    this.actSprites = this.activeIdx.map(() => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: at, color: 0x00ffc8, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
      sp.scale.setScalar(0.4); this.root.add(sp); return sp;
    });

    // Disintegration fragments
    this._initFrags();
  }

  _initFrags() {
    const rng = prng(88);
    this.frags = [[], []];
    for (let s = 0; s < 2; s++) {
      for (let i = 0; i < 80; i++) {
        const g = new THREE.TetrahedronGeometry(0.006 + rng() * 0.018, 0);
        const m = new THREE.MeshPhongMaterial({
          color: new THREE.Color().setHSL(0.04 + rng() * 0.05, 0.95, 0.35 + rng() * 0.25),
          emissive: new THREE.Color(0xff3300), emissiveIntensity: 2.5, shininess: 50, transparent: true, opacity: 0,
        });
        const mesh = new THREE.Mesh(g, m); mesh.visible = false; this.root.add(mesh);
        this.frags[s].push({ mesh, mat: m, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rotAxis: new THREE.Vector3(rng() - .5, rng() - .5, rng() - .5).normalize(), rotSpd: (rng() - .5) * 12, life: 1 });
      }
    }
  }

  _buildSatGeo() {
    const b = new THREE.BoxGeometry(0.048, 0.018, 0.032);
    const p = new THREE.BoxGeometry(0.065, 0.003, 0.022);
    const pL = p.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(-0.058, 0, 0));
    const pR = p.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(0.058, 0, 0));
    const a = new THREE.CylinderGeometry(0.001, 0.001, 0.018, 4);
    a.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0.018, 0));
    const mg = mergeGeometries([b, pL, pR, a]);
    b.dispose(); p.dispose(); pL.dispose(); pR.dispose(); a.dispose();
    return mg;
  }

  _buildInstanced(g) {
    const m = new THREE.MeshPhongMaterial({ color: 0xffffff, emissive: new THREE.Color(0x182840), emissiveIntensity: 0.3, shininess: 65 });
    this.satMat = m;
    this.satInst = new THREE.InstancedMesh(g, m, SAT_POOL);
    this.satInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.satInst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SAT_POOL * 3).fill(1), 3);
    this.root.add(this.satInst);
  }

  _glowTex(r, g, b) {
    const s = 128, cv = document.createElement("canvas"); cv.width = cv.height = s;
    const ctx = cv.getContext("2d"), grd = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, `rgba(${r},${g},${b},1)`); grd.addColorStop(0.2, `rgba(${r},${g},${b},0.75)`);
    grd.addColorStop(0.5, `rgba(${r},${g},${b},0.25)`); grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grd; ctx.fillRect(0, 0, s, s);
    return new THREE.CanvasTexture(cv);
  }

  _initDebris() {
    const rng = prng(55);
    this.debrisP = Array.from({ length: DEBRIS_N }, () => ({
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: rng(), size: rng() * 0.02 + 0.006,
      col: new THREE.Color().setHSL(0.02 + rng() * 0.06, 0.95, 0.3 + rng() * 0.3), active: false,
    }));
    const p = new Float32Array(DEBRIS_N * 3), s = new Float32Array(DEBRIS_N), c = new Float32Array(DEBRIS_N * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("pSize", new THREE.BufferAttribute(s, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("pColor", new THREE.BufferAttribute(c, 3).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      vertexShader: `attribute float pSize;attribute vec3 pColor;varying vec3 vC;void main(){vC=pColor;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=pSize*(500./-mv.z);gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `varying vec3 vC;void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;float core=smoothstep(.5,0.,d);vec3 fc=vC+vec3(.35,.06,0.)*core;gl_FragColor=vec4(fc,core+smoothstep(.5,.1,d)*.4);}`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.debrisGeo = g; this.debrisMat = m;
    this.debrisPoints = new THREE.Points(g, m);
    this.root.add(this.debrisPoints);

    // Kessler cloud
    const kN = 1800, kr = prng(77);
    const kp = new Float32Array(kN * 3), ks = new Float32Array(kN), kc = new Float32Array(kN * 3);
    for (let i = 0; i < kN; i++) {
      const v = randOnSphere(EARTH_RADIUS * (1.28 + kr() * 0.48), kr);
      kp[i * 3] = v.x; kp[i * 3 + 1] = v.y; kp[i * 3 + 2] = v.z;
      ks[i] = kr() * 1.8 + 0.3;
      const cc = new THREE.Color().setHSL(0.02 + kr() * 0.06, 0.9, 0.25 + kr() * 0.2);
      kc[i * 3] = cc.r; kc[i * 3 + 1] = cc.g; kc[i * 3 + 2] = cc.b;
    }
    const kg = new THREE.BufferGeometry();
    kg.setAttribute("position", new THREE.BufferAttribute(kp, 3)); kg.setAttribute("size", new THREE.BufferAttribute(ks, 1)); kg.setAttribute("color", new THREE.BufferAttribute(kc, 3));
    this.kesslerMat = new THREE.ShaderMaterial({
      uniforms: { uOp: { value: 0 }, uTime: { value: 0 } },
      vertexShader: `attribute float size;attribute vec3 color;varying vec3 vC;uniform float uTime;void main(){vC=color;float s=size*(0.8+0.2*sin(uTime*0.35+position.x*5.));vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=s*(260./-mv.z);gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `varying vec3 vC;uniform float uOp;void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;gl_FragColor=vec4(vC,smoothstep(.5,0.,d)*uOp);}`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.root.add(new THREE.Points(kg, this.kesslerMat));
  }

  _initFlash() {
    this.flashDiv = document.createElement("div");
    Object.assign(this.flashDiv.style, { position: "fixed", inset: "0", background: "radial-gradient(ellipse at center,rgba(255,180,80,.35) 0%,rgba(255,40,0,.4) 35%,transparent 65%)", opacity: "0", pointerEvents: "none", zIndex: "50" });
    document.body.appendChild(this.flashDiv);
  }

  /* ════════════════════════════════════════════════════════════════════
     MAIN LOOP
     ════════════════════════════════════════════════════════════════════ */

  _loop() {
    if (this.disposed) return;
    this._raf = requestAnimationFrame(this._loop.bind(this));
    const t = this.clock.getElapsedTime();
    const p = this.progress;
    const p0 = smootherstep(remap(p, PHASES.P0, PHASES.P1));
    const p1 = smootherstep(remap(p, PHASES.P1, PHASES.P2));
    const p2 = smootherstep(remap(p, PHASES.P2, PHASES.P3));
    const p3 = smootherstep(remap(p, PHASES.P3, PHASES.P4));
    const p4 = smootherstep(remap(p, PHASES.P4, 1.0));
    const ch = p < PHASES.P1 ? 0 : p < PHASES.P2 ? 1 : p < PHASES.P3 ? 2 : p < PHASES.P4 ? 3 : 4;

    this._cam(t, ch, p3);
    this._post(t, ch, p3, p4);
    this.starMat.uniforms.uTime.value = t; this.stars.rotation.y = t * 0.0018;
    this.nebMat.uniforms.uTime.value = t;
    if (this.earth) this.earth.rotation.y = t * 0.028;
    if (this.clouds) { this.clouds.rotation.y = t * 0.035; this.clouds.rotation.x = t * 0.004; }
    this._atmo(t, p1, ch);
    this._orbits(t, ch, p0, p1);
    this._sats(t, ch, p0, p1, p2, p3, p4);
    this._danger(t, ch, p3, p4);
    this._debris(t, ch, p3, p4);
    this._fragUpdate(t);
    this._colLight(t, ch);
    this.composer.render();
  }

  _cam(t, ch, p3) {
    const tf = FOV_MAP[ch];
    this.currentFov += (tf - this.currentFov) * 0.022;
    this.camera.fov = this.currentFov;
    this.camera.updateProjectionMatrix();

    this.camFree = !this.isScrolling;

    if (this.camFree) {
      if (this.isDragging) {
        this.camUserTheta += this.dragDX * 0.004;
        this.camUserPhi -= this.dragDY * 0.004;
        this.camUserPhi = clamp(this.camUserPhi, -Math.PI * 0.38, Math.PI * 0.38);
      } else {
        this.camUserTheta += 0.003;
      }
    } else {
      this.camUserTheta *= 0.93;
      this.camUserPhi *= 0.93;
    }

    const L = this.camLocked[ch];
    let th = L.th, ph = L.ph, dist = L.d;

    if (ch === 3) {
      const cp = this._tv.addVectors(satPos(this.dA, t), satPos(this.dB, t)).multiplyScalar(0.5);
      const sp = new THREE.Spherical().setFromVector3(cp);
      th = lerp(L.th, sp.theta, p3 * 0.6);
      ph = lerp(L.ph, sp.phi, p3 * 0.4);
      dist = lerp(L.d, L.d - 1.8, p3);
    }

    this.camTarget.theta = th + this.camUserTheta;
    this.camTarget.phi = ph + this.camUserPhi;
    this.camTarget.radius = dist;

    this.camSph.theta += (this.camTarget.theta - this.camSph.theta) * 0.035;
    this.camSph.phi += (this.camTarget.phi - this.camSph.phi) * 0.035;
    this.camSph.radius += (this.camTarget.radius - this.camSph.radius) * 0.035;
    this.camSph.phi = clamp(this.camSph.phi, 0.15, Math.PI - 0.15);

    this.camera.position.setFromSpherical(this.camSph);

    // Scroll-velocity distortion (igloo.inc technique)
    const velSkew = this.scrollVelocity * 15;
    this.camera.position.y += velSkew * 0.3;

    if (this._shakeOn) {
      const el = t - this._shakeT;
      if (el > 1.8) { this._shakeOn = false; }
      else {
        const env = Math.exp(-el * 3.2);
        const a = 0.22 * env;
        this.camera.position.x += a * (Math.sin(t * 93) * .5 + Math.sin(t * 47) * .3 + Math.sin(t * 211) * .2);
        this.camera.position.y += a * (Math.sin(t * 78) * .45 + Math.sin(t * 34) * .35 + Math.sin(t * 157) * .2);
      }
    }
    this.camera.lookAt(0, 0, 0);
  }

  _post(t, ch, p3, p4) {
    this.bloom.strength = ch === 4 ? lerp(0.28, 0.55, p4) : ch === 3 ? lerp(0.28, 0.4, p3) : 0.28;
    this.chroma.uniforms.uO.value = ch >= 3 ? lerp(0.0005, 0.002, ch === 4 ? p4 : p3) : 0.0005;
    this.grain.uniforms.uT.value = t;
    this.grain.uniforms.uI.value = ch === 4 ? 0.07 : 0.035;
  }

  _atmo(t, p1, ch) {
    const w = ch >= 1 ? Math.min(p1, 1) : 0;
    this.atmoLayers.forEach(a => {
      a.mat.uniforms.uTime.value = t;
      a.mat.uniforms.uWarn.value += (w - a.mat.uniforms.uWarn.value) * 0.025;
    });
  }

  _orbits(t, ch, p0, p1) {
    this.orbitRings.forEach((o, i) => {
      let target;
      if (ch === 0) target = 0.12 * p0;
      else if (ch === 1) target = 0.25;
      else if (ch === 2) target = 0.15;
      else target = 0.08;
      
      o.mat.uniforms.uOpacity.value += (target - o.mat.uniforms.uOpacity.value) * 0.035;
      o.mat.uniforms.uTime.value = t;
    });
  }

  _sats(t, ch, p0, p1, p2, p3, p4) {
    const d = this._d, tc = this._tc;
    const vis = ch === 0 ? 4 : ch === 1 ? Math.round(lerp(4, SAT_POOL, outExpo(remap(this.progress, PHASES.P1, PHASES.P2)))) : SAT_POOL;

    for (let i = 0; i < SAT_POOL; i++) {
      const s = this.satData[i];
      const pos = satPos(s, t);
      if (i < vis) {
        d.position.copy(pos);
        d.lookAt(this._tv.set(0, 0, 0));
        d.rotation.z += s.phase * 0.5;
        d.updateMatrix();
        this.satInst.setMatrixAt(i, d.matrix);
      } else {
        d.position.set(9999, 9999, 9999); d.updateMatrix(); this.satInst.setMatrixAt(i, d.matrix);
      }

      const isAct = this.activeIdx.includes(i);
      if (ch === 0) tc.set(C.satNormal);
      else if (ch === 1) tc.set(C.satNormal).lerp(new THREE.Color("#ffbb33"), p1 * 0.65);
      else if (ch === 2) tc.set(isAct ? C.satActive : C.satDim);
      else tc.set(isAct ? C.satActive : C.satDim).lerp(new THREE.Color("#444466"), ch >= 3 ? p3 * 0.45 : 0);
      this.satInst.setColorAt(i, tc);
    }
    this.satInst.instanceMatrix.needsUpdate = true;
    if (this.satInst.instanceColor) this.satInst.instanceColor.needsUpdate = true;

    const sa = ch === 2 || ch === 3;
    this.activeIdx.forEach((si, ai) => {
      const pos = satPos(this.satData[si], t);
      const m = this.actMeshes[ai], sp = this.actSprites[ai];
      if (sa) {
        const pulse = 0.7 + 0.3 * Math.sin(t * 2.5 + ai * 0.8);
        const alpha = ch === 2 ? clamp(p2 * 3) : clamp(1 - p3 * 2);
        m.visible = true; m.position.copy(pos); m.lookAt(0, 0, 0);
        m.material.emissiveIntensity = 2.0 * pulse * alpha; m.material.opacity = alpha;
        sp.position.copy(pos); sp.material.opacity = 0.5 * pulse * alpha; sp.scale.setScalar(0.45 * (0.85 + 0.15 * pulse));
      } else { m.visible = false; sp.material.opacity = 0; }
    });
  }

  _danger(t, ch, p3, p4) {
    if (ch < 3) {
      this.dMeshA.visible = false; this.dMeshB.visible = false;
      this.dGlowA.visible = false; this.dGlowB.visible = false;
      this.dRingMatA.uniforms.uOpacity.value = 0;
      this.dRingMatB.uniforms.uOpacity.value = 0;
      if (this.collisionDone) {
        this.collisionDone = false;
        this.frags.forEach(fl => fl.forEach(f => { f.mesh.visible = false; f.mat.opacity = 0; }));
      }
      return;
    }

    this.dRingMatA.uniforms.uTime.value = t;
    this.dRingMatB.uniforms.uTime.value = t;

    const pA = satPos(this.dA, t), pB = satPos(this.dB, t);

    if (ch === 3 && !this.collisionDone) {
      this.dMeshA.visible = true; this.dMeshB.visible = true;
      this.dGlowA.visible = true; this.dGlowB.visible = true;

      // Satellites on their orbits, converging
      const mid = this._tv.addVectors(pA, pB).multiplyScalar(0.5);
      const aA = pA.clone().lerp(mid, p3 * 0.88);
      const aB = pB.clone().lerp(mid, p3 * 0.88);

      this.dMeshA.position.copy(aA); this.dMeshA.lookAt(0, 0, 0);
      this.dMeshB.position.copy(aB); this.dMeshB.lookAt(0, 0, 0);
      this.dGlowA.position.copy(aA); this.dGlowB.position.copy(aB);

      const freq = 4 + p3 * 18;
      const pulse = 0.5 + 0.5 * Math.sin(t * freq);
      const dc = new THREE.Color().setHSL(0.02, 1, 0.28 + 0.32 * pulse);
      this.dMatA.color.copy(dc); this.dMatA.emissive.copy(dc); this.dMatA.emissiveIntensity = 1.8 * pulse;
      this.dMatB.color.copy(dc); this.dMatB.emissive.copy(dc); this.dMatB.emissiveIntensity = 1.8 * pulse;

      const gs = 0.15 + p3 * 1.4;
      this.dGlowA.scale.setScalar(gs); this.dGlowB.scale.setScalar(gs);
      this.gMA.opacity = 0.9 * pulse; this.gMB.opacity = 0.9 * pulse;

      this.dRingMatA.uniforms.uOpacity.value = p3 * 0.45 * pulse;
      this.dRingMatB.uniforms.uOpacity.value = p3 * 0.45 * pulse;

    } else if (ch === 4 && !this.collisionDone) {
      // COLLISION
      this.collisionDone = true;
      this.collisionTime = t;
      this.collisionPt.copy(this._tv.addVectors(pA, pB).multiplyScalar(0.5));
      this.collisionR = this.collisionPt.length();

      this.dMeshA.visible = false; this.dMeshB.visible = false;
      this.dGlowA.visible = false; this.dGlowB.visible = false;

      // Spawn fragments
      const rng = prng(999);
      this.frags.forEach((fl, si) => {
        fl.forEach(f => {
          f.pos.copy(this.collisionPt).add(new THREE.Vector3((rng() - .5) * .04, (rng() - .5) * .04, (rng() - .5) * .04));
          const tan = new THREE.Vector3().crossVectors(f.pos.clone().normalize(), new THREE.Vector3(0, 1, 0)).normalize();
          f.vel.copy(tan).multiplyScalar(1.8 + rng() * 3.5).add(new THREE.Vector3((rng() - .5) * 1.2, (rng() - .5) * 1.2, (rng() - .5) * 1.2));
          f.mesh.visible = true; f.mat.opacity = 1; f.mat.emissiveIntensity = 3.0; f.life = 1;
        });
      });

      // Trigger debris spread in orbital shell
      const dr = prng(1234);
      this.debrisP.forEach(d => {
        d.pos.copy(this.collisionPt).add(new THREE.Vector3((dr() - .5) * .08, (dr() - .5) * .08, (dr() - .5) * .08));
        const up = d.pos.clone().normalize();
        const tan = new THREE.Vector3().crossVectors(up, new THREE.Vector3(dr() - .5, dr() - .5, dr() - .5)).normalize();
        d.vel.copy(tan).multiplyScalar(1.2 + dr() * 4.5).add(up.multiplyScalar((dr() - .5) * .6));
        d.active = true;
        d.col.setHSL(0.02 + dr() * 0.06, 0.95, 0.3 + dr() * 0.35);
      });

      this._shakeOn = true; this._shakeT = t;
      this.flashDiv.style.transition = "opacity 0.04s"; this.flashDiv.style.opacity = "1";
      setTimeout(() => { this.flashDiv.style.transition = "opacity 1.2s ease-out"; this.flashDiv.style.opacity = "0"; }, 70);

    } else if (ch === 4 && this.collisionDone) {
      this.dMeshA.visible = false; this.dMeshB.visible = false;
      this.dGlowA.visible = false; this.dGlowB.visible = false;
      this.dRingMatA.uniforms.uOpacity.value *= 0.98;
      this.dRingMatB.uniforms.uOpacity.value *= 0.98;
    }
  }

  _debris(t, ch, p3, p4) {
    const pb = this.debrisGeo.attributes.position.array;
    const sb = this.debrisGeo.attributes.pSize.array;
    const cb = this.debrisGeo.attributes.pColor.array;

    if (ch >= 4 && this.collisionDone) {
      const dt = Math.max(0, t - this.collisionTime);
      this.debrisP.forEach((d, i) => {
        if (!d.active) { pb[i * 3] = 9999; pb[i * 3 + 1] = 9999; pb[i * 3 + 2] = 9999; return; }
        const decay = Math.exp(-dt * 0.12);
        d.pos.x += d.vel.x * decay * 0.01; d.pos.y += d.vel.y * decay * 0.01; d.pos.z += d.vel.z * decay * 0.01;
        const len = d.pos.length();
        if (len > this.collisionR * 1.18) d.pos.setLength(this.collisionR * 1.18);
        if (len < this.collisionR * 0.85) d.pos.setLength(this.collisionR * 0.85);
        if (len < EARTH_RADIUS * 1.03) d.pos.setLength(EARTH_RADIUS * 1.03);
        const drift = 0.035 + d.life * 0.05;
        d.pos.x += Math.sin(t * drift + i * 0.031) * 0.0025;
        d.pos.z += Math.cos(t * drift + i * 0.7) * 0.0025;

        pb[i * 3] = d.pos.x; pb[i * 3 + 1] = d.pos.y; pb[i * 3 + 2] = d.pos.z;
        const cool = clamp(1 - dt * 0.018, 0.2, 1);
        sb[i] = (4.0 + d.life * 5.5) * cool * (0.8 + 0.2 * Math.sin(t * 5 + i * 1.1));
        const hot = clamp(1 - dt * 0.03, 0.1, 1);
        cb[i * 3] = d.col.r * (0.45 + 0.55 * hot); cb[i * 3 + 1] = d.col.g * hot * 0.5; cb[i * 3 + 2] = d.col.b * hot * 0.15;
      });
      this.debrisGeo.attributes.position.needsUpdate = true;
      this.debrisGeo.attributes.pSize.needsUpdate = true;
      this.debrisGeo.attributes.pColor.needsUpdate = true;
      this.kesslerMat.uniforms.uOp.value = clamp(p4 * 2.0, 0, 0.8);
      this.kesslerMat.uniforms.uTime.value = t;
    } else {
      for (let i = 0; i < DEBRIS_N; i++) { pb[i * 3] = 9999; pb[i * 3 + 1] = 9999; pb[i * 3 + 2] = 9999; }
      this.debrisGeo.attributes.position.needsUpdate = true;
      this.kesslerMat.uniforms.uOp.value = 0;
    }
  }

  _fragUpdate(t) {
    if (!this.collisionDone) return;
    const dt = Math.max(0, t - this.collisionTime);
    this.frags.forEach(fl => fl.forEach(f => {
      if (!f.mesh.visible) return;
      const decay = Math.exp(-dt * 0.25);
      f.pos.x += f.vel.x * decay * 0.008; f.pos.y += f.vel.y * decay * 0.008; f.pos.z += f.vel.z * decay * 0.008;
      const len = f.pos.length();
      if (len > this.collisionR * 1.35) f.pos.setLength(this.collisionR * 1.35);
      if (len < EARTH_RADIUS * 1.01) f.pos.setLength(EARTH_RADIUS * 1.01);
      f.mesh.position.copy(f.pos);
      f.mesh.rotateOnAxis(f.rotAxis, f.rotSpd * 0.014);
      f.life = Math.max(0, 1 - dt * 0.1);
      f.mat.opacity = f.life;
      f.mat.emissiveIntensity = 3.0 * f.life;
      const hot = clamp(1 - dt * 0.06, 0, 1);
      f.mat.color.setHSL(0.03 + (1 - hot) * 0.02, 0.9, 0.18 + hot * 0.45);
      f.mat.emissive.setHSL(0.02, 1, hot * 0.45);
      if (f.life < 0.005) f.mesh.visible = false;
    }));
  }

  _colLight(t, ch) {
    if (ch === 4 && this.collisionDone) {
      this.colLight.intensity = Math.max(0, 22 * Math.exp(-(t - this.collisionTime) * 1.8));
      this.colLight.position.copy(this.collisionPt);
    } else { this.colLight.intensity = 0; }
  }

  setProgress(p) { this.progress = p; }
  setMouse(x, y) { this.mx = x; this.my = y; }
  setScrolling(v) { this.isScrolling = v; }
  setDragging(v) { this.isDragging = v; }
  setDragDelta(dx, dy) { this.dragDX = dx; this.dragDY = dy; }
  setScrollVelocity(v) { this.scrollVelocity = v; }

  dispose() {
    this.disposed = true; cancelAnimationFrame(this._raf); this.renderer.dispose(); this._ro.disconnect();
    if (this.flashDiv?.parentNode) this.flashDiv.parentNode.removeChild(this.flashDiv);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   §9 THREE CANVAS
   ═══════════════════════════════════════════════════════════════════════════ */

function ThreeCanvas({ progressRef, mouseRef, scrollingRef, dragRef, isDownRef, velocityRef }) {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    engineRef.current = new AstralEngine(canvasRef.current);
    return () => engineRef.current?.dispose();
  }, []);

  useEffect(() => {
    let raf;
    const tick = () => {
      if (engineRef.current) {
        engineRef.current.setProgress(progressRef.current);
        engineRef.current.setMouse(mouseRef.current.x, mouseRef.current.y);
        engineRef.current.setScrolling(scrollingRef.current);
        engineRef.current.setDragging(isDownRef.current);
        engineRef.current.setDragDelta(dragRef.current.x, dragRef.current.y);
        engineRef.current.setScrollVelocity(velocityRef.current);
        dragRef.current.x = 0; dragRef.current.y = 0;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [progressRef, mouseRef, scrollingRef, dragRef, isDownRef, velocityRef]);

  return <canvas ref={canvasRef} style={{ position: "fixed", inset: 0, width: "100%", height: "100%", zIndex: 1 }} />;
}

/* ═══════════════════════════════════════════════════════════════════════════
   §10 HUD COMPONENTS
   ═══════════════════════════════════════════════════════════════════════════ */

const Header = memo(function Header({ chapter }) {
  const ch = CHAPTERS[chapter];
  const [m, setM] = useState(false);
  useEffect(() => { setTimeout(() => setM(true), 200); }, []);
  return (
    <header style={{ position: "fixed", top: 0, left: 0, right: 0, padding: "clamp(20px,3vw,40px) clamp(24px,4vw,60px)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", zIndex: 20, pointerEvents: "none", background: "linear-gradient(to bottom,rgba(1,8,18,.82),rgba(1,8,18,.3) 55%,transparent)" }}>
      <div style={{ pointerEvents: "auto" }}>
        <Magnetic strength={0.15}><div data-hover data-cursor-label="HOME">
          <RevealLine visible={m} delay={0.2}><div style={{ fontSize: "clamp(18px,2vw,24px)", fontFamily: F.display, fontWeight: 300, color: C.text, letterSpacing: ".2em" }}>ASTRAL</div></RevealLine>
          <RevealLine visible={m} delay={0.35}><div style={{ fontSize: "clamp(7px,.7vw,9px)", letterSpacing: ".45em", color: C.textDim, fontFamily: F.mono, textTransform: "uppercase", marginTop: 2 }}>Orbital Risk Intelligence</div></RevealLine>
          <CurvedString accent={ch.accent} mounted={m} />
        </div></Magnetic>
      </div>
      <div style={{ textAlign: "right", fontFamily: F.mono, pointerEvents: "auto" }}>
        <Magnetic strength={0.1}><div data-hover>
          <RevealLine visible={m} delay={0.4}><div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end", marginBottom: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: ch.accent, boxShadow: `0 0 10px ${ch.accent}`, animation: "statusPulse 2s ease-in-out infinite" }} />
            <span style={{ color: ch.accent, fontSize: "clamp(8px,.8vw,11px)", letterSpacing: ".3em", transition: "color .6s" }}>{STATUS_LABEL[chapter]}</span>
          </div></RevealLine>
          <RevealLine visible={m} delay={0.55}><div style={{ color: C.textMicro, fontSize: "clamp(7px,.65vw,9px)", letterSpacing: ".25em" }}>LEO TRACKING ACTIVE</div></RevealLine>
        </div></Magnetic>
      </div>
    </header>
  );
});

function CurvedString({ accent, mounted }) {
  const pRef = useRef(null), gRef = useRef(null), cRef = useRef(null), aRef = useRef(null);
  const st = useRef({ cx: 50, cy: 10, vx: 0, vy: 0 });
  const apply = () => { if (!pRef.current) return; const d = `M 0 10 Q ${st.current.cx} ${st.current.cy} 100 10`; pRef.current.setAttribute("d", d); gRef.current?.setAttribute("d", d); };
  const snap = () => {
    if (aRef.current) cancelAnimationFrame(aRef.current);
    const tick = () => { const s = st.current; s.vx = (s.vx + (50 - s.cx) * .06) * .52; s.vy = (s.vy + (10 - s.cy) * .06) * .52; s.cx += s.vx; s.cy += s.vy; apply(); if (Math.abs(s.vx) > .02 || Math.abs(s.vy) > .02 || Math.abs(s.cx - 50) > .02 || Math.abs(s.cy - 10) > .02) aRef.current = requestAnimationFrame(tick); else { s.cx = 50; s.cy = 10; s.vx = 0; s.vy = 0; apply(); } };
    aRef.current = requestAnimationFrame(tick);
  };
  const mm = e => { if (aRef.current) { cancelAnimationFrame(aRef.current); aRef.current = null; } const b = cRef.current.getBoundingClientRect(); st.current = { cx: ((e.clientX - b.left) / b.width) * 100, cy: ((e.clientY - b.top) / b.height) * 20, vx: 0, vy: 0 }; apply(); };
  useEffect(() => () => { if (aRef.current) cancelAnimationFrame(aRef.current); }, []);
  return (
    <div ref={cRef} onMouseMove={mm} onMouseLeave={snap} style={{ width: "100%", marginTop: 10, cursor: "crosshair", pointerEvents: "auto", opacity: mounted ? 1 : 0, transition: "opacity .8s ease .6s" }}>
      <svg width="100%" height="20" viewBox="0 0 100 20" preserveAspectRatio="none" style={{ display: "block", overflow: "visible" }}>
        <path ref={gRef} d="M 0 10 Q 50 10 100 10" stroke={accent} strokeWidth="6" fill="transparent" opacity=".08" style={{ filter: "blur(3px)", transition: "stroke .6s" }} />
        <path ref={pRef} d="M 0 10 Q 50 10 100 10" stroke={accent} strokeWidth=".7" fill="transparent" opacity=".55" style={{ transition: "stroke .6s" }} />
      </svg>
    </div>
  );
}

const ProgressBar = memo(function ProgressBar({ progress, chapter }) {
  const ch = CHAPTERS[chapter]; const pct = (progress * 100).toFixed(2);
  const [m, setM] = useState(false); useEffect(() => { setTimeout(() => setM(true), 800); }, []);
  return (
    <div style={{ position: "fixed", right: "clamp(20px,3vw,40px)", top: "50%", transform: `translateY(-50%) translateX(${m ? 0 : 20}px)`, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, zIndex: 20, opacity: m ? 1 : 0, transition: "opacity 1s ease .8s, transform 1s cubic-bezier(.19,1,.22,1) .8s" }}>
      <div style={{ color: ch.accent, fontSize: 7, letterSpacing: ".25em", fontFamily: F.mono, writingMode: "vertical-rl", textOrientation: "mixed", transform: "rotate(180deg)", marginBottom: 8, textShadow: `0 0 12px ${ch.accent}`, transition: "color .5s, text-shadow .5s", opacity: .75 }}>{ch.tag}</div>
      <div style={{ width: 1.5, height: 160, background: C.dim06, borderRadius: 2, position: "relative" }}>
        <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: `${pct}%`, background: `linear-gradient(to bottom,${ch.accent}88,${ch.accent})`, borderRadius: 2, boxShadow: `0 0 8px ${ch.accent}66`, transition: "background .5s, box-shadow .5s" }} />
        <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", top: `calc(${pct}% - 3.5px)`, width: 7, height: 7, borderRadius: "50%", background: ch.accent, boxShadow: `0 0 12px 4px ${ch.accent}88`, transition: "background .5s" }} />
      </div>
      <div style={{ color: C.textMicro, fontSize: 7, fontFamily: F.mono, letterSpacing: ".15em", marginTop: 4 }}>{Math.round(progress * 100)}%</div>
    </div>
  );
});

function ChapterOverlay({ chapter }) {
  const [disp, setDisp] = useState(chapter); const [vis, setVis] = useState(true); const [m, setM] = useState(false);
  useEffect(() => { setTimeout(() => setM(true), 600); }, []);
  useEffect(() => { if (chapter !== disp) { setVis(false); const t = setTimeout(() => { setDisp(chapter); setVis(true); }, 420); return () => clearTimeout(t); } }, [chapter, disp]);
  const ch = CHAPTERS[disp];
  return (
    <div style={{ position: "fixed", left: "clamp(24px,4vw,60px)", bottom: "clamp(60px,8vh,100px)", maxWidth: "clamp(280px,30vw,420px)", zIndex: 20, fontFamily: F.mono, opacity: m ? 1 : 0, transition: "opacity .8s ease .5s" }}>
      <RevealLine visible={vis}><div style={{ color: ch.accent, fontSize: "clamp(9px,.8vw,11px)", fontWeight: 700, letterSpacing: ".35em", marginBottom: 16, textShadow: `0 0 25px ${ch.accent}`, transition: "color .5s, text-shadow .5s" }}>{ch.tag}<span style={{ color: C.textMicro, fontWeight: 400 }}> ── ASTRAL</span></div></RevealLine>
      <div style={{ marginBottom: 24 }}>
        {ch.title.split("\n").map((l, i) => <RevealLine key={`${disp}-${i}`} visible={vis} delay={.08 + i * .08}><div style={{ color: C.text, fontSize: "clamp(28px,3.5vw,52px)", fontFamily: F.display, fontWeight: 300, lineHeight: 1.05, letterSpacing: "-.01em", textShadow: "0 2px 40px rgba(0,0,0,.8)" }}>{l}</div></RevealLine>)}
      </div>
      <RevealLine visible={vis} delay={.25}><div style={{ color: "rgba(200,220,255,.58)", fontSize: "clamp(11px,1vw,13px)", lineHeight: 1.85, fontFamily: F.sans, fontWeight: 300, maxWidth: 340, textShadow: "0 1px 12px rgba(0,0,0,.9)" }}>{ch.body}</div></RevealLine>
      <div style={{ marginTop: 28, width: vis ? 40 : 0, height: 1.5, background: ch.accent, boxShadow: `0 0 15px ${ch.accent}88`, transition: "width .8s cubic-bezier(.19,1,.22,1) .35s, background .5s, box-shadow .5s" }} />
    </div>
  );
}

const MetricsTicker = memo(function MetricsTicker({ chapter }) {
  const [m, setM] = useState(false); useEffect(() => { setTimeout(() => setM(true), 1000); }, []);
  return (
    <div style={{ position: "fixed", right: "clamp(24px,4vw,60px)", bottom: "clamp(60px,8vh,100px)", fontFamily: F.mono, textAlign: "right", zIndex: 20, opacity: m ? 1 : 0, transform: `translateY(${m ? 0 : 10}px)`, transition: "opacity .8s ease 1s, transform .8s ease 1s" }}>
      {METRICS.map((mt, i) => (
        <div key={i} style={{ marginBottom: 18 }}>
          <div style={{ color: C.textMicro, fontSize: "clamp(7px,.6vw,8px)", letterSpacing: ".4em", marginBottom: 3 }}>{mt.label}</div>
          <div style={{ color: CHAPTERS[chapter].accent, fontSize: "clamp(12px,1.2vw,16px)", fontWeight: 600, letterSpacing: ".05em", textShadow: `0 0 18px ${CHAPTERS[chapter].accent}33`, transition: "color .5s" }}>
            <AnimatedNumber value={mt.vals[chapter]} visible={m} />
          </div>
        </div>
      ))}
    </div>
  );
});

function ScrollHint({ progress }) {
  const op = progress < 0.02 ? 1 : Math.max(0, 1 - progress / .06);
  const [m, setM] = useState(false); useEffect(() => { setTimeout(() => setM(true), 1500); }, []);
  return (
    <div style={{ position: "fixed", bottom: "clamp(24px,3vh,40px)", left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, zIndex: 20, opacity: m ? op : 0, transition: "opacity .8s", fontFamily: F.mono }}>
      <div style={{ color: C.textDim, fontSize: 8, letterSpacing: ".5em" }}>SCROLL TO EXPLORE</div>
      <div style={{ width: 18, height: 30, border: `1px solid ${C.textDim}`, borderRadius: 10, display: "flex", justifyContent: "center", paddingTop: 5 }}>
        <div style={{ width: 2.5, height: 6, borderRadius: 2, background: C.textDim, animation: "scrollDot 2s cubic-bezier(.19,1,.22,1) infinite" }} />
      </div>
    </div>
  );
}

function CameraMode({ scrolling }) {
  return (
    <div style={{ position: "fixed", top: "50%", left: "clamp(24px,4vw,60px)", transform: "translateY(-50%)", zIndex: 20, fontFamily: F.mono, pointerEvents: "none", opacity: scrolling ? 0 : .45, transition: "opacity .8s ease" }}>
      <div style={{ fontSize: 7, letterSpacing: ".3em", color: C.textDim, writingMode: "vertical-rl", textOrientation: "mixed", transform: "rotate(180deg)" }}>FREE CAMERA ── DRAG TO ORBIT</div>
    </div>
  );
}

function Corners({ chapter }) {
  const ac = CHAPTERS[chapter].accent;
  const [m, setM] = useState(false); useEffect(() => { setTimeout(() => setM(true), 1200); }, []);
  const s = p => ({ position: "fixed", ...p, width: 14, height: 14, zIndex: 15, pointerEvents: "none", opacity: m ? .22 : 0, transition: "opacity 1s ease 1.2s, border-color .5s" });
  return <>
    <div style={{ ...s({ top: "clamp(20px,3vw,40px)", left: "clamp(24px,4vw,60px)" }), borderTop: `1px solid ${ac}`, borderLeft: `1px solid ${ac}` }} />
    <div style={{ ...s({ top: "clamp(20px,3vw,40px)", right: "clamp(20px,3vw,40px)" }), borderTop: `1px solid ${ac}`, borderRight: `1px solid ${ac}` }} />
    <div style={{ ...s({ bottom: "clamp(20px,3vw,40px)", left: "clamp(24px,4vw,60px)" }), borderBottom: `1px solid ${ac}`, borderLeft: `1px solid ${ac}` }} />
    <div style={{ ...s({ bottom: "clamp(20px,3vw,40px)", right: "clamp(20px,3vw,40px)" }), borderBottom: `1px solid ${ac}`, borderRight: `1px solid ${ac}` }} />
  </>;
}

function Loader({ onDone }) {
  const [p, setP] = useState(0); const [v, setV] = useState(true); const [tv, setTv] = useState(false);
  useEffect(() => {
    setTimeout(() => setTv(true), 80);
    let prog = 0;
    const iv = setInterval(() => { prog += Math.random() * 10 + 2; if (prog >= 100) { prog = 100; clearInterval(iv); setTimeout(() => { setV(false); setTimeout(onDone, 800); }, 450); } setP(Math.min(prog, 100)); }, 90);
    return () => clearInterval(iv);
  }, [onDone]);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: C.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", opacity: v ? 1 : 0, transition: "opacity .8s cubic-bezier(.19,1,.22,1)", pointerEvents: v ? "all" : "none" }}>
      <div style={{ fontSize: "clamp(32px,5vw,56px)", fontFamily: F.display, fontWeight: 300, color: C.text, letterSpacing: ".25em", marginBottom: 40 }}><SplitChars visible={tv} stagger={.04} delay={.1}>ASTRAL</SplitChars></div>
      <RevealLine visible={tv} delay={.5}><div style={{ fontSize: 9, letterSpacing: ".5em", color: C.textDim, fontFamily: F.mono, marginBottom: 50, textTransform: "uppercase" }}>Satellite Collision Prediction</div></RevealLine>
      <div style={{ width: "clamp(200px,30vw,300px)", height: 1, background: C.dim06, borderRadius: 1, overflow: "hidden", opacity: tv ? 1 : 0, transition: "opacity .5s ease .8s" }}>
        <div style={{ height: "100%", width: `${p}%`, background: `linear-gradient(90deg,${C.blue},${C.cyan})`, transition: "width .2s", boxShadow: `0 0 10px ${C.blue}66` }} />
      </div>
      <div style={{ marginTop: 16, fontSize: 10, fontFamily: F.mono, color: C.textMicro, letterSpacing: ".2em", opacity: tv ? 1 : 0, transition: "opacity .5s ease .9s" }}>{Math.round(p)}%</div>
    </div>
  );
}

function Vignettes() {
  return <>
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: "25vh", background: "linear-gradient(to top,rgba(1,8,18,.72),transparent)", pointerEvents: "none", zIndex: 10 }} />
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: "15vh", background: "linear-gradient(to bottom,rgba(1,8,18,.65),transparent)", pointerEvents: "none", zIndex: 10 }} />
    <div style={{ position: "fixed", top: 0, left: 0, bottom: 0, width: "8vw", background: "linear-gradient(to right,rgba(1,8,18,.3),transparent)", pointerEvents: "none", zIndex: 10 }} />
    <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "8vw", background: "linear-gradient(to left,rgba(1,8,18,.3),transparent)", pointerEvents: "none", zIndex: 10 }} />
  </>;
}

function Grain() {
  return <div style={{ position: "fixed", inset: 0, zIndex: 90, pointerEvents: "none", opacity: .028, mixBlendMode: "overlay", backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`, backgroundRepeat: "repeat", backgroundSize: "128px" }} />;
}

/* ═══════════════════════════════════════════════════════════════════════════
   §11 CSS
   ═══════════════════════════════════════════════════════════════════════════ */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@200;300;400;500&family=JetBrains+Mono:wght@300;400;500;600;700&display=swap');
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:auto;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;scrollbar-width:none;-ms-overflow-style:none}
body{background:${C.bg};overflow-x:hidden;cursor:none;font-family:${F.sans}}
@media(hover:hover){*{cursor:none!important}}
@media(hover:none){*{cursor:auto!important}}
#astral-scroll-space{height:500vh;position:relative}
::selection{background:rgba(74,144,226,.25);color:${C.text}}
::-webkit-scrollbar{width:0;display:none}
@keyframes statusPulse{0%,100%{opacity:1;box-shadow:0 0 10px currentColor}50%{opacity:.35;box-shadow:0 0 4px currentColor}}
@keyframes scrollDot{0%{transform:translateY(0);opacity:1}70%,100%{transform:translateY(14px);opacity:0}}
`;

/* ═══════════════════════════════════════════════════════════════════════════
   §12 MAIN APP
   ═══════════════════════════════════════════════════════════════════════════ */

export default function Astral() {
  const { raw, smooth, velocity, scrolling, chapter } = useLocoScroll();
  const mouse = useMouseSystem();
  const [loaded, setLoaded] = useState(false);
  const [isScrolling, setIsScrolling] = useState(true);
  const onLoad = useCallback(() => setLoaded(true), []);

  useEffect(() => {
    let raf;
    const tick = () => { setIsScrolling(scrolling.current); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [scrolling]);

  return <>
    <style>{CSS}</style>
    {!loaded && <Loader onDone={onLoad} />}
    <Cursor chapter={chapter} scrolling={isScrolling} />
    <ThreeCanvas progressRef={smooth} mouseRef={mouse.smooth} scrollingRef={scrolling} dragRef={mouse.drag} isDownRef={mouse.down} velocityRef={velocity} />
    <div id="astral-scroll-space" />
    {loaded && <>
      <Header chapter={chapter} />
      <ChapterOverlay chapter={chapter} />
      <ProgressBar progress={raw.current} chapter={chapter} />
      <MetricsTicker chapter={chapter} />
      <ScrollHint progress={raw.current} />
      <CameraMode scrolling={isScrolling} />
      <Corners chapter={chapter} />
    </>}
    <Vignettes />
    <Grain />
  </>;
}