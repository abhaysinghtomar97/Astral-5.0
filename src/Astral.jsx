/**
 * ASTRAL – Interactive 3D Satellite Collision Visualization
 *
 * Architecture:
 *  - React functional components (no class components)
 *  - Three.js with GLTFLoader for earth.glb + satellite.glb
 *  - 5-phase scroll-driven timeline (0→1 progress)
 *  - Camera FOV zoom creates zoom-in / zoom-out per phase
 *  - Camera position is FIXED; only FOV + scene objects animate
 *
 * Models expected in /public (or project root served as static):
 *   /earth.glb      – Earth globe model
 *   /satellite.glb  – Single satellite model (instanced for pool)
 *
 * Phase Map:
 *  Phase 0 (0.00–0.20): Normal Orbit  – 4 satellites, wide view
 *  Phase 1 (0.20–0.40): Congestion    – 200 sats, tight shell, zoomed OUT
 *  Phase 2 (0.40–0.60): Active Sats   – zoom IN, 12 highlighted
 *  Phase 3 (0.60–0.80): Risk Alert    – two red sats converge
 *  Phase 4 (0.80–1.00): Collision     – explosion + Kessler debris
 */

import { useRef, useEffect, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS & PALETTE
// ─────────────────────────────────────────────────────────────────────────────

const EARTH_RADIUS = 2.2;
const CAM_Z = 7.5;
const PHASES = { P0: 0, P1: 0.2, P2: 0.4, P3: 0.6, P4: 0.8 };

// Camera FOV per phase (lower = zoomed in, higher = zoomed out)
// Camera position NEVER moves — only FOV changes create the zoom feeling
const FOV_PHASE = {
  P0: 52,   // Normal orbit  – neutral wide view
  P1: 68,   // Congestion    – zoomed OUT to show dense shell around Earth
  P2: 44,   // Active sats   – zoomed IN, Earth fills frame
  P3: 46,   // Risk alert    – slightly zoomed in, dramatic
  P4: 50,   // Kessler       – neutral, debris fills space
};

// Satellite pool size — 200 for a truly suffocating congestion shell
const SAT_POOL = 200;

// Color palette
const COL = {
  earthDeep:    new THREE.Color("#0a1628"),
  earthMid:     new THREE.Color("#1a3a6b"),
  earthShallow: new THREE.Color("#2d6a8f"),
  earthLand:    new THREE.Color("#1c3d2b"),
  atmo:         new THREE.Color("#3a7fd5"),
  satNormal:    new THREE.Color("#a0c8ff"),
  satActive:    new THREE.Color("#00ffc8"),
  satDanger:    new THREE.Color("#ff3030"),
  satDim:       new THREE.Color("#334466"),
  debris:       new THREE.Color("#ff6020"),
  debrisCool:   new THREE.Color("#ff9944"),
  starFar:      new THREE.Color("#ffffff"),
  glow:         new THREE.Color("#4488ff"),
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/** Clamp a value between min and max */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Remap [a,b] → [0,1], clamped */
const remap = (v, a, b) => clamp((v - a) / (b - a), 0, 1);

/** Smooth easing (smoothstep) */
const smooth = (t) => t * t * (3 - 2 * t);

/** Linear interpolation */
const lerp = (a, b, t) => a + (b - a) * t;

/** Spherical uniform random point on sphere of radius r */
const randOnSphere = (r, rng = Math.random) => {
  const theta = rng() * Math.PI * 2;
  const phi   = Math.acos(2 * rng() - 1);
  return new THREE.Vector3(
    r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta)
  );
};

/** Seeded pseudo-random (LCG) for deterministic geometry */
const makePRNG = (seed = 42) => {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
};

// ─────────────────────────────────────────────────────────────────────────────
// SCROLL HOOK
// ─────────────────────────────────────────────────────────────────────────────

function useScrollProgress() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const handle = () => {
      const el   = document.documentElement;
      const max  = el.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? clamp(window.scrollY / max, 0, 1) : 0);
    };
    window.addEventListener("scroll", handle, { passive: true });
    return () => window.removeEventListener("scroll", handle);
  }, []);
  return progress;
}

// ─────────────────────────────────────────────────────────────────────────────
// SMOOTH SCROLL PROGRESS (lerped ref, updated in RAF)
// ─────────────────────────────────────────────────────────────────────────────

function useSmoothProgress(raw, speed = 0.07) {
  const ref = useRef(raw);
  useEffect(() => { ref.current = raw; }, [raw]);
  return ref; // consumers read ref.current each frame
}

// ─────────────────────────────────────────────────────────────────────────────
// ATMOSPHERE GEOMETRY (still procedural — wraps the GLTF earth model)
// ─────────────────────────────────────────────────────────────────────────────

function buildAtmoGeometry() {
  return new THREE.SphereGeometry(EARTH_RADIUS * 1.055, 64, 64);
}

// ─────────────────────────────────────────────────────────────────────────────
// SATELLITE DATA (static orbit params, generated once)
// ─────────────────────────────────────────────────────────────────────────────

function generateSatelliteData(count, rng) {
  return Array.from({ length: count }, (_, i) => ({
    id:          i,
    // Congestion shell: tighter orbital band so sats completely cover Earth
    // Range 1.28→1.55x Earth radius — dense, overlapping shell
    radius:      EARTH_RADIUS * (1.28 + rng() * 0.27),
    inclination: (rng() - 0.5) * Math.PI,      // full spherical coverage
    ascension:   rng() * Math.PI * 2,
    phase:       rng() * Math.PI * 2,
    speed:       0.14 + rng() * 0.18,           // varied orbital speeds
    size:        0.022 + rng() * 0.018,
  }));
}

/** Compute satellite world position from orbital params at time t */
function satPosition(sat, t) {
  const angle = sat.phase + sat.speed * t;
  // Orbit in XZ plane, rotated by inclination and ascension
  const x0 = Math.cos(angle) * sat.radius;
  const z0 = Math.sin(angle) * sat.radius;
  // Rotate by inclination
  const y1 = -z0 * Math.sin(sat.inclination);
  const z1 =  z0 * Math.cos(sat.inclination);
  // Rotate by right ascension
  const x2 = x0 * Math.cos(sat.ascension) - z1 * Math.sin(sat.ascension);
  const z2 = x0 * Math.sin(sat.ascension) + z1 * Math.cos(sat.ascension);
  return new THREE.Vector3(x2, y1, z2);
}

// ─────────────────────────────────────────────────────────────────────────────
// STAR FIELD (static, 3000 points)
// ─────────────────────────────────────────────────────────────────────────────

function buildStarField() {
  const rng = makePRNG(99);
  const N = 3000;
  const positions = new Float32Array(N * 3);
  const sizes     = new Float32Array(N);
  const alphas    = new Float32Array(N);

  for (let i = 0; i < N; i++) {
    const p = randOnSphere(120 + rng() * 60, rng);
    positions[i * 3]     = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;
    sizes[i]  = rng() * 2.2 + 0.4;
    alphas[i] = rng() * 0.7 + 0.3;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("size",     new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute("alpha",    new THREE.BufferAttribute(alphas, 1));
  return geo;
}

// ─────────────────────────────────────────────────────────────────────────────
// THREE.JS SCENE MANAGER (all rendering in one imperative class)
// ─────────────────────────────────────────────────────────────────────────────

class AstralScene {
  constructor(canvas) {
    this.canvas      = canvas;
    this.clock       = new THREE.Clock();
    this.progress    = 0;      // smoothed 0→1
    this.disposed    = false;
    this.currentFov  = FOV_PHASE.P0;   // current interpolated FOV
    this.earthReady  = false;  // true once earth.glb loaded
    this.satReady    = false;  // true once satellite.glb template loaded
    this.satTemplate = null;   // cloned for each instanced satellite

    this._initRenderer();
    this._initScene();
    this._initCamera();
    this._initLights();
    this._initStars();
    this._initEarth();       // async GLTF load
    this._initAtmosphere();
    this._initSatellites();  // async GLTF load for template
    this._initDebris();
    this._initPhase4Flash();

    this._raf = requestAnimationFrame(this._loop.bind(this));
  }

  // ── Renderer ──────────────────────────────────────────────────────────────
  _initRenderer() {
    const r = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
    });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.setSize(window.innerWidth, window.innerHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.1;
    this.renderer = r;

    this._resizeObs = new ResizeObserver(() => {
      r.setSize(window.innerWidth, window.innerHeight);
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });
    this._resizeObs.observe(document.body);
  }

  // ── Scene ─────────────────────────────────────────────────────────────────
  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#010812");
    // Subtle blue-black fog
    this.scene.fog = new THREE.FogExp2("#010812", 0.0055);

    // Root group – all animated objects live here
    this.earthSystem = new THREE.Group();
    this.scene.add(this.earthSystem);
  }

  // ── Camera ────────────────────────────────────────────────────────────────
  _initCamera() {
    // Camera position is PERMANENTLY FIXED at (0, 1.2, CAM_Z)
    // Zoom effect is achieved by animating camera.fov, NOT camera.position
    const cam = new THREE.PerspectiveCamera(FOV_PHASE.P0, window.innerWidth / window.innerHeight, 0.1, 500);
    cam.position.set(0, 1.2, CAM_Z);
    cam.lookAt(0, 0, 0);
    this.camera = cam;
    this.currentFov = FOV_PHASE.P0;
  }

  // ── Lights ────────────────────────────────────────────────────────────────
  _initLights() {
    // Key light (sun)
    const sun = new THREE.DirectionalLight(0xfff5e0, 2.8);
    sun.position.set(8, 4, 6);
    this.scene.add(sun);

    // Rim light (blue)
    const rim = new THREE.DirectionalLight(0x3a6fff, 0.6);
    rim.position.set(-6, -2, -4);
    this.scene.add(rim);

    // Ambient
    this.scene.add(new THREE.AmbientLight(0x0d1a2e, 1.2));

    this.sunLight = sun;
  }

  // ── Star Field ────────────────────────────────────────────────────────────
  _initStars() {
    const geo = buildStarField();
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        attribute float size;
        attribute float alpha;
        varying float vAlpha;
        uniform float uTime;
        void main() {
          vAlpha = alpha * (0.7 + 0.3 * sin(uTime * 0.4 + alpha * 20.0));
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (300.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.0, d) * vAlpha;
          gl_FragColor = vec4(1.0, 1.0, 1.0, a);
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    this.starMat   = mat;
    this.starField = new THREE.Points(geo, mat);
    this.scene.add(this.starField);
  }

  // ── Earth (GLTF) ──────────────────────────────────────────────────────────
  _initEarth() {
    const loader = new GLTFLoader();

    // Placeholder sphere shown while earth.glb loads
    const fallbackGeo = new THREE.SphereGeometry(EARTH_RADIUS, 64, 64);
    const fallbackMat = new THREE.MeshPhongMaterial({ color: 0x1a3a6b, shininess: 20 });
    this.earth  = new THREE.Mesh(fallbackGeo, fallbackMat);
    this.earthSystem.add(this.earth);

    // Subtle cloud sphere (always procedural, wraps around real earth model)
    const cloudGeo = new THREE.SphereGeometry(EARTH_RADIUS * 1.015, 64, 64);
    const cloudMat = new THREE.MeshPhongMaterial({
      color: 0xffffff, transparent: true, opacity: 0.07, depthWrite: false,
    });
    this.clouds = new THREE.Mesh(cloudGeo, cloudMat);
    this.earthSystem.add(this.clouds);

    loader.load(
      "/earth.glb",
      (gltf) => {
        // Remove placeholder
        this.earthSystem.remove(this.earth);

        const model = gltf.scene;

        // Auto-scale model to match EARTH_RADIUS world units
        const box = new THREE.Box3().setFromObject(model);
        const modelRadius = box.getBoundingSphere(new THREE.Sphere()).radius;
        const scale = EARTH_RADIUS / modelRadius;
        model.scale.setScalar(scale);
        model.position.set(0, 0, 0);

        // Ensure all meshes receive lighting properly
        model.traverse((child) => {
          if (child.isMesh) {
            child.castShadow    = true;
            child.receiveShadow = true;
            if (child.material) {
              child.material.needsUpdate = true;
            }
          }
        });

        this.earth = model;
        this.earthSystem.add(this.earth);
        this.earthReady = true;
      },
      undefined,
      (err) => {
        // earth.glb not found — keep procedural fallback
        console.warn("earth.glb not found, using fallback sphere.", err);
        this.earthReady = true;
      }
    );
  }

  // ── Atmosphere ────────────────────────────────────────────────────────────
  _initAtmosphere() {
    const geo = buildAtmoGeometry();
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uCameraPos: { value: this.camera.position },
        uColor:     { value: new THREE.Color("#3a7fd5") },
        uPhase:     { value: 0 },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vPos;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vPos    = (modelViewMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uPhase;
        varying vec3 vNormal;
        varying vec3 vPos;
        void main() {
          float rim = 1.0 - abs(dot(normalize(vNormal), normalize(-vPos)));
          rim = pow(rim, 3.2);
          // Phase 1: redder atmosphere from congestion heat
          vec3 col = mix(uColor, vec3(0.9, 0.2, 0.1), uPhase * 0.35);
          gl_FragColor = vec4(col, rim * 0.65);
        }
      `,
      transparent: true,
      side: THREE.FrontSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.atmoMesh = new THREE.Mesh(geo, mat);
    this.atmoMat  = mat;
    this.earthSystem.add(this.atmoMesh);
  }

  // ── Satellites (GLTF instanced) ───────────────────────────────────────────
  _initSatellites() {
    const rng = makePRNG(13);

    // Two "danger" satellites (Phase 3/4) — tight crossing orbits
    this.dangerA = { radius: EARTH_RADIUS * 1.42, inclination: 0.5,  ascension: 0.3, phase: 0.0,       speed: 0.19 };
    this.dangerB = { radius: EARTH_RADIUS * 1.42, inclination: -0.4, ascension: 0.3, phase: Math.PI,   speed: 0.21 };

    // Satellite orbital data pool
    this.satData = generateSatelliteData(SAT_POOL, rng);

    // Highlight indices (Phase 2 active satellites)
    this.activeIndices = [0, 7, 14, 22, 31, 38, 47, 55, 63, 74, 88, 101, 130, 155];

    // ── Instanced mesh (uses satellite.glb first mesh, fallback to sphere) ──
    this._buildSatInstancedMesh(new THREE.SphereGeometry(0.028, 6, 6)); // fallback while loading

    // Load satellite.glb — extract first mesh geometry for instancing
    const loader = new GLTFLoader();
    loader.load(
      "/earth.glb",
      (gltf) => {
        let satGeo = null;

        // Walk scene graph, grab first mesh geometry
        gltf.scene.traverse((child) => {
          if (child.isMesh && !satGeo) {
            satGeo = child.geometry.clone();
          }
        });

        if (satGeo) {
          // Auto-scale geometry so satellite fits ~0.055 world-unit radius
          satGeo.computeBoundingSphere();
          const geoRadius = satGeo.boundingSphere.radius;
          const scale = 0.055 / geoRadius;
          satGeo.scale(scale, scale, scale);

          // Rebuild instanced mesh with real geometry
          this.earthSystem.remove(this.satInstanced);
          this.satInstanced.dispose?.();
          this._buildSatInstancedMesh(satGeo);
          this.satReady = true;
        }
      },
      undefined,
      (err) => {
        console.warn("satellite.glb not found, using fallback sphere.", err);
        this.satReady = true;
      }
    );

    // ── Danger satellite meshes (individual, also load satellite.glb) ────────
    // Start with sphere fallback; replaced after load
    const dGeoFallback = new THREE.SphereGeometry(0.055, 8, 8);
    this.dangerMatA = new THREE.MeshPhongMaterial({ color: COL.satNormal, emissive: COL.satNormal, emissiveIntensity: 0.4, shininess: 120 });
    this.dangerMatB = this.dangerMatA.clone();
    this.dangerMeshA = new THREE.Mesh(dGeoFallback, this.dangerMatA);
    this.dangerMeshB = new THREE.Mesh(dGeoFallback.clone(), this.dangerMatB);
    this.earthSystem.add(this.dangerMeshA);
    this.earthSystem.add(this.dangerMeshB);

    // Re-use the same GLTF load result for danger sat meshes
    const loader2 = new GLTFLoader();
    loader2.load(
      "/satellite.glb",
      (gltf) => {
        let satGeo = null;
        gltf.scene.traverse((child) => {
          if (child.isMesh && !satGeo) satGeo = child.geometry.clone();
        });
        if (satGeo) {
          satGeo.computeBoundingSphere();
          const scale = 0.055 / satGeo.boundingSphere.radius;
          satGeo.scale(scale, scale, scale);

          this.earthSystem.remove(this.dangerMeshA);
          this.earthSystem.remove(this.dangerMeshB);
          this.dangerMeshA = new THREE.Mesh(satGeo, this.dangerMatA);
          this.dangerMeshB = new THREE.Mesh(satGeo.clone(), this.dangerMatB);
          this.earthSystem.add(this.dangerMeshA);
          this.earthSystem.add(this.dangerMeshB);
        }
      },
      undefined, () => {}
    );

    // ── Glow sprites ──────────────────────────────────────────────────────────
    const glowTex  = this._makeGlowTexture();
    const glowMatA = new THREE.SpriteMaterial({ map: glowTex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const glowMatB = glowMatA.clone();
    this.dangerGlowA = new THREE.Sprite(glowMatA);
    this.dangerGlowB = new THREE.Sprite(glowMatB);
    this.dangerGlowA.scale.setScalar(0);
    this.dangerGlowB.scale.setScalar(0);
    this.glowMatA = glowMatA;
    this.glowMatB = glowMatB;
    this.earthSystem.add(this.dangerGlowA);
    this.earthSystem.add(this.dangerGlowB);

    // ── Orbit rings for risk phase ────────────────────────────────────────────
    const ringGeo = new THREE.TorusGeometry(EARTH_RADIUS * 1.42, 0.004, 8, 120);
    this.riskRingA = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0 }));
    this.riskRingB = new THREE.Mesh(ringGeo.clone(), new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0 }));
    this.riskRingA.rotation.x = this.dangerA.inclination;
    this.riskRingB.rotation.x = this.dangerB.inclination;
    this.riskRingA.rotation.z = this.dangerA.ascension;
    this.riskRingB.rotation.z = this.dangerB.ascension;
    this.earthSystem.add(this.riskRingA);
    this.earthSystem.add(this.riskRingB);
    this.riskRingMatA = this.riskRingA.material;
    this.riskRingMatB = this.riskRingB.material;

    // ── Active satellite glow meshes (Phase 2) ────────────────────────────────
    // 14 individual glowing cyan spheres placed on the active orbit positions
    // These are separate from the instanced pool so they can be individually bright
    const activeGlowGeo = new THREE.SphereGeometry(0.055, 8, 8);
    const activeGlowMat = new THREE.MeshPhongMaterial({
      color: COL.satActive, emissive: COL.satActive, emissiveIntensity: 2.2,
      shininess: 120, transparent: true, opacity: 1.0,
    });
    this.activeGlowMeshes = this.activeIndices.map(() => {
      const m = new THREE.Mesh(activeGlowGeo.clone(), activeGlowMat.clone());
      m.visible = false;
      this.earthSystem.add(m);
      return m;
    });

    // Cyan glow sprites behind each active sat
    const activeGlowTex = this._makeActiveGlowTexture();
    this.activeGlowSprites = this.activeIndices.map(() => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: activeGlowTex, color: 0x00ffc8,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        opacity: 0,
      }));
      sp.scale.setScalar(0.5);
      this.earthSystem.add(sp);
      return sp;
    });
  }

  /** Build / rebuild the instanced mesh from a given geometry */
  _buildSatInstancedMesh(geo) {
    const satMat = new THREE.MeshPhongMaterial({
      color: 0xffffff,           // must be white so vertexColors (instance colors) show correctly
      vertexColors: false,       // Three.js InstancedMesh uses instanceColor, not vertexColors
      emissive: new THREE.Color(0x223355),
      emissiveIntensity: 0.4,
      shininess: 80,
    });
    this.satMat = satMat;
    this.satInstanced = new THREE.InstancedMesh(geo, satMat, SAT_POOL);
    this.satInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Allocate instanceColor buffer — Three.js uses this with setColorAt()
    this.satInstanced.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(SAT_POOL * 3).fill(1), // init to white
      3
    );
    this.earthSystem.add(this.satInstanced);
  }

  /** Generate a radial glow texture */
  _makeGlowTexture() {
    const size = 128;
    const cv   = document.createElement("canvas");
    cv.width = cv.height = size;
    const ctx = cv.getContext("2d");
    const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    g.addColorStop(0,   "rgba(255,80,80,1)");
    g.addColorStop(0.3, "rgba(255,40,40,0.6)");
    g.addColorStop(1,   "rgba(255,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(cv);
  }

  /** Cyan glow texture for active satellites (Phase 2) */
  _makeActiveGlowTexture() {
    const size = 128;
    const cv   = document.createElement("canvas");
    cv.width = cv.height = size;
    const ctx = cv.getContext("2d");
    const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    g.addColorStop(0,   "rgba(0,255,200,1)");
    g.addColorStop(0.35,"rgba(0,200,160,0.6)");
    g.addColorStop(1,   "rgba(0,100,80,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(cv);
  }

  // ── Debris / Particle System ───────────────────────────────────────────────
  _initDebris() {
    const N   = 800;
    const rng = makePRNG(55);

    // Each debris particle: position, velocity, life
    this.debrisParticles = Array.from({ length: N }, () => ({
      pos:   new THREE.Vector3(),
      vel:   new THREE.Vector3(),
      life:  0,
      size:  rng() * 0.03 + 0.01,
      col:   rng() > 0.5 ? COL.debris.clone() : COL.debrisCool.clone(),
    }));

    const positions = new Float32Array(N * 3);
    const sizes     = new Float32Array(N);
    const colBuf    = new Float32Array(N * 3);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("pSize",    new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("pColor",   new THREE.BufferAttribute(colBuf, 3).setUsage(THREE.DynamicDrawUsage));

    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        attribute float pSize;
        attribute vec3 pColor;
        varying vec3 vColor;
        varying float vLife;
        void main() {
          vColor = pColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = pSize * (350.0 / -mv.z);
          gl_Position  = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vColor, a);
        }
      `,
      transparent: true,
      depthWrite:  false,
      blending:    THREE.AdditiveBlending,
    });
    this.debrisMat  = mat;
    this.debrisGeo  = geo;
    this.debrisPoints = new THREE.Points(geo, mat);
    this.earthSystem.add(this.debrisPoints);
    this.debrisExploded = false;
    this.debrisExpTime  = 0;

    // Kessler chain debris ring (persistent after explosion)
    this._initKesslerRing();
  }

  _initKesslerRing() {
    const N   = 1200;
    const rng = makePRNG(77);
    const pos = new Float32Array(N * 3);
    const sz  = new Float32Array(N);
    const col = new Float32Array(N * 3);

    for (let i = 0; i < N; i++) {
      const p = randOnSphere(EARTH_RADIUS * (1.35 + rng() * 0.45), rng);
      pos[i*3]   = p.x; pos[i*3+1] = p.y; pos[i*3+2] = p.z;
      sz[i] = rng() * 2.5 + 0.5;
      const c = rng() > 0.6 ? COL.debris : COL.debrisCool;
      col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("size",     new THREE.BufferAttribute(sz, 1));
    geo.setAttribute("color",    new THREE.BufferAttribute(col, 3));

    const mat = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 } },
      vertexShader: `
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        uniform float uTime;
        void main() {
          vColor = color;
          float s = size * (0.8 + 0.2 * sin(uTime + position.x * 5.0));
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = s * (300.0 / -mv.z);
          gl_Position  = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        uniform float uOpacity;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          gl_FragColor = vec4(vColor, smoothstep(0.5, 0.0, d) * uOpacity);
        }
      `,
      transparent: true,
      depthWrite:  false,
      blending:    THREE.AdditiveBlending,
    });
    this.kesslerMat    = mat;
    this.kesslerPoints = new THREE.Points(geo, mat);
    this.earthSystem.add(this.kesslerPoints);
  }

  _initPhase4Flash() {
    // Camera shake state
    this.shakeActive    = false;
    this.shakeStartTime = 0;
    this.shakeDuration  = 1.4;      // seconds
    this.shakeIntensity = 0.28;     // world-unit amplitude (increased)
    this.camBaseX = this.camera.position.x;
    this.camBaseY = this.camera.position.y;
    this.camBaseZ = this.camera.position.z;

    // Red vignette flash div (much less aggressive than white, but confirms impact)
    this.flashDiv = document.createElement("div");
    Object.assign(this.flashDiv.style, {
      position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
      background: "radial-gradient(ellipse at center, transparent 40%, rgba(255,60,0,0.55) 100%)",
      opacity: "0", pointerEvents: "none", zIndex: "50",
      transition: "opacity 0.06s ease-out",
    });
    document.body.appendChild(this.flashDiv);
  }

  // Per-frame camera shake — exponential decay, high-freq noise
  _applyCameraShake(t) {
    if (!this.shakeActive) return;

    const elapsed = t - this.shakeStartTime;
    if (elapsed > this.shakeDuration) {
      this.camera.position.set(this.camBaseX, this.camBaseY, this.camBaseZ);
      this.camera.lookAt(0, 0, 0);
      this.shakeActive = false;
      return;
    }

    // Envelope: sharp at t=0, fully decayed by shakeDuration
    const envelope = Math.exp(-elapsed * (5.0 / this.shakeDuration));
    const amp = this.shakeIntensity * envelope;

    // Multi-frequency noise on X and Y axes (Z shake looks like zoom, avoid)
    const ox = amp * (Math.sin(t * 93.1) * 0.55 + Math.sin(t * 47.3) * 0.30 + Math.sin(t * 211.7) * 0.15);
    const oy = amp * (Math.sin(t * 78.6) * 0.50 + Math.sin(t * 34.2) * 0.35 + Math.sin(t * 157.3) * 0.15);

    this.camera.position.set(
      this.camBaseX + ox,
      this.camBaseY + oy,
      this.camBaseZ            // keep Z fixed — no zoom artifact
    );
    this.camera.lookAt(0, 0, 0);
  }

  // ── Main Loop ─────────────────────────────────────────────────────────────
  _loop(ts) {
    if (this.disposed) return;
    this._raf = requestAnimationFrame(this._loop.bind(this));

    const t = this.clock.getElapsedTime();
    const p = this.progress; // smoothed scroll progress 0→1

    // Per-phase normalized progress values (0→1 within each phase)
    const p0 = smooth(remap(p, PHASES.P0, PHASES.P1)); // P0 → P1
    const p1 = smooth(remap(p, PHASES.P1, PHASES.P2)); // P1 → P2
    const p2 = smooth(remap(p, PHASES.P2, PHASES.P3)); // P2 → P3
    const p3 = smooth(remap(p, PHASES.P3, PHASES.P4)); // P3 → P4
    const p4 = smooth(remap(p, PHASES.P4, 1.0));       // P4 → end

    // Which chapter are we in?
    const chapter = p < PHASES.P1 ? 0
                  : p < PHASES.P2 ? 1
                  : p < PHASES.P3 ? 2
                  : p < PHASES.P4 ? 3
                  :                 4;

    // ── Smooth FOV zoom (interpolate toward target FOV for current chapter) ──
    // Determines zoom level: lower FOV = zoomed IN, higher FOV = zoomed OUT
    const targetFov = [FOV_PHASE.P0, FOV_PHASE.P1, FOV_PHASE.P2, FOV_PHASE.P3, FOV_PHASE.P4][chapter];
    this.currentFov += (targetFov - this.currentFov) * 0.04; // smooth lerp
    this.camera.fov = this.currentFov;
    this.camera.updateProjectionMatrix();

    this._updateStars(t);
    this._updateEarth(t, chapter, p0, p1);
    this._updateAtmosphere(p1);
    this._updateSatellites(t, chapter, p0, p1, p2, p3, p4);
    this._updateDebris(t, chapter, p3, p4);
    this._applyCameraShake(t);   // camera shake on collision (Mod 3)

    this.renderer.render(this.scene, this.camera);
  }

  _updateStars(t) {
    this.starMat.uniforms.uTime.value = t;
    this.starField.rotation.y = t * 0.005;
  }

  _updateEarth(t, chapter, p0, p1) {
    // ── Continuous slow rotation ──────────────────────────────────────────────
    // Rotate the earth group (handles both GLTF model and fallback sphere)
    if (this.earth) {
      this.earth.rotation.y = t * 0.04;
    }
    if (this.clouds) {
      this.clouds.rotation.y = t * 0.048;
      this.clouds.rotation.x = t * 0.008;
    }

    // ── Earth scale: no longer used for zoom (FOV handles that now) ──────────
    // Earth scale stays at 1.0 always — pure and stable at center
    // The ZOOM IN / ZOOM OUT effect is done via camera.fov in _loop()
    if (this.earth) this.earth.scale.setScalar(1.0);
    if (this.clouds) this.clouds.scale.setScalar(1.0);
    if (this.atmoMesh) this.atmoMesh.scale.setScalar(1.0);
  }

  _updateAtmosphere(p1) {
    // Atmosphere gets orange tint in congestion phase
    this.atmoMat.uniforms.uPhase.value = lerp(this.atmoMat.uniforms.uPhase.value, p1, 0.05);
  }

  // ── Satellite Update ───────────────────────────────────────────────────────
  _updateSatellites(t, chapter, p0, p1, p2, p3, p4) {
    const dummy = new THREE.Object3D();

    // Visible count:
    //  Phase 0 → 4 calm satellites
    //  Phase 1 → all SAT_POOL (200), completely covering Earth
    //  Phase 2+ → all remain, but most are dimmed
    const showNormal    = 4;
    const showCongested = SAT_POOL;

    let visibleCount;
    if (chapter === 0) {
      visibleCount = showNormal;
    } else if (chapter === 1) {
      // Rapid ramp from 4 → 200 during Phase 1 transition
      visibleCount = Math.round(lerp(showNormal, showCongested, smooth(remap(this.progress, PHASES.P1, PHASES.P2))));
    } else {
      visibleCount = showCongested;
    }

    for (let i = 0; i < SAT_POOL; i++) {
      const sat      = this.satData[i];
      const pos      = satPosition(sat, t);
      const isActive = this.activeIndices.includes(i);
      const isVis    = i < visibleCount;

      if (isVis) {
        dummy.position.copy(pos);
        // Orient satellite body tangentially (looks at Earth center)
        dummy.lookAt(new THREE.Vector3(0, 0, 0));
        // Small per-sat rotation for variety
        dummy.rotation.z += sat.phase * 0.5;
        dummy.updateMatrix();
        this.satInstanced.setMatrixAt(i, dummy.matrix);
      } else {
        // Park invisible instances far offscreen
        dummy.position.set(10000, 10000, 10000);
        dummy.updateMatrix();
        this.satInstanced.setMatrixAt(i, dummy.matrix);
      }

      // Color logic per chapter
      let col;
      if (chapter === 0) {
        col = COL.satNormal.clone();
      } else if (chapter === 1) {
        // Congestion: shift from blue-white → warning orange-yellow
        col = COL.satNormal.clone().lerp(new THREE.Color("#ffbb33"), p1 * 0.75);
      } else if (chapter === 2) {
        // Active phase: 14 glow cyan, rest near-invisible
        col = isActive ? COL.satActive.clone() : COL.satDim.clone();
      } else if (chapter >= 3) {
        // Risk / collision: active fade to grey, rest dark
        col = isActive
          ? COL.satActive.clone().lerp(new THREE.Color("#666688"), p3 * 0.6)
          : COL.satDim.clone();
      }

      this.satInstanced.setColorAt(i, col);
    }

    this.satInstanced.instanceMatrix.needsUpdate = true;
    if (this.satInstanced.instanceColor) this.satInstanced.instanceColor.needsUpdate = true;

    // ── Active satellite glow meshes (Phase 2 only) ───────────────────────────
    const showActive = chapter === 2 || chapter === 3;
    this.activeIndices.forEach((satIdx, ai) => {
      const sat    = this.satData[satIdx];
      const pos    = satPosition(sat, t);
      const mesh   = this.activeGlowMeshes[ai];
      const sprite = this.activeGlowSprites[ai];

      if (showActive) {
        const pulse = 0.7 + 0.3 * Math.sin(t * 2.5 + ai * 0.8);
        // Fade in during chapter 2, fade out during chapter 3
        const alpha = chapter === 2
          ? clamp(p2 * 3, 0, 1)           // fade in fast
          : clamp(1 - p3 * 2, 0, 1);      // fade out during risk

        mesh.visible = true;
        mesh.position.copy(pos);
        mesh.lookAt(0, 0, 0);
        mesh.material.emissiveIntensity = 2.0 * pulse * alpha;
        mesh.material.opacity = alpha;

        sprite.position.copy(pos);
        sprite.material.opacity = 0.7 * pulse * alpha;
        sprite.scale.setScalar(0.55 * (0.85 + 0.15 * pulse));
      } else {
        mesh.visible = false;
        sprite.material.opacity = 0;
      }
    });

    // ── Danger Satellites A & B ────────────────────────────────────────────
    const posA0 = satPosition(this.dangerA, t);
    const posB0 = satPosition(this.dangerB, t);

    if (chapter < 3) {
      this.dangerMeshA.visible = false;
      this.dangerMeshB.visible = false;
      this.dangerGlowA.visible = false;
      this.dangerGlowB.visible = false;
      this.riskRingMatA.opacity = 0;
      this.riskRingMatB.opacity = 0;
    } else if (chapter === 3) {
      this.dangerMeshA.visible = true;
      this.dangerMeshB.visible = true;
      this.dangerGlowA.visible = true;
      this.dangerGlowB.visible = true;

      // Converge toward midpoint collision
      const midPt    = new THREE.Vector3().addVectors(posA0, posB0).multiplyScalar(0.5);
      const approachA = posA0.clone().lerp(midPt, p3 * 0.65);
      const approachB = posB0.clone().lerp(midPt, p3 * 0.65);

      this.dangerMeshA.position.copy(approachA);
      this.dangerMeshB.position.copy(approachB);
      this.dangerMeshA.lookAt(0, 0, 0);
      this.dangerMeshB.lookAt(0, 0, 0);
      this.dangerGlowA.position.copy(approachA);
      this.dangerGlowB.position.copy(approachB);

      // Pulsing red
      const pulse = 0.6 + 0.4 * Math.sin(t * 7);
      const dangerCol = new THREE.Color().setHSL(0, 1, 0.42 + 0.18 * pulse);
      this.dangerMatA.color.copy(dangerCol);
      this.dangerMatA.emissive.copy(dangerCol);
      this.dangerMatA.emissiveIntensity = 1.4 * pulse;
      this.dangerMatB.color.copy(dangerCol);
      this.dangerMatB.emissive.copy(dangerCol);
      this.dangerMatB.emissiveIntensity = 1.4 * pulse;

      // Glow scale grows as they approach
      const gs = 0.3 + p3 * 0.9;
      this.dangerGlowA.scale.setScalar(gs);
      this.dangerGlowB.scale.setScalar(gs);
      this.glowMatA.color.setHSL(0, 1, 0.5 + 0.3 * pulse);
      this.glowMatB.color.setHSL(0, 1, 0.5 + 0.3 * pulse);
      this.glowMatA.opacity = 0.8 * pulse;
      this.glowMatB.opacity = 0.8 * pulse;

      this.riskRingMatA.opacity = p3 * 0.55 * pulse;
      this.riskRingMatB.opacity = p3 * 0.55 * pulse;

    } else {
      // Phase 4: exploded — hide danger sats
      this.dangerMeshA.visible = false;
      this.dangerMeshB.visible = false;
      this.dangerGlowA.visible = false;
      this.dangerGlowB.visible = false;
      this.riskRingMatA.opacity = 0;
      this.riskRingMatB.opacity = 0;
    }
  }

  // ── Debris Update ──────────────────────────────────────────────────────────
  _updateDebris(t, chapter, p3, p4) {
    const posBuf = this.debrisGeo.attributes.position.array;
    const szBuf  = this.debrisGeo.attributes.pSize.array;
    const colBuf = this.debrisGeo.attributes.pColor.array;

    if (chapter === 4 && !this.debrisExploded) {
      // ── Trigger explosion (fires exactly once when entering chapter 4) ──
      this.debrisExploded  = true;
      this.debrisExpTime   = t;
      this._prevChapter4   = true;   // track that we were in chapter 4
      const rng    = makePRNG(99);
      const origin = new THREE.Vector3(EARTH_RADIUS * 1.42, 0, 0);
      this.debrisParticles.forEach(d => {
        d.pos.copy(origin);
        d.vel.set((rng()-0.5)*6, (rng()-0.5)*6, (rng()-0.5)*6);
        d.life = rng();
      });
      // Trigger camera shake
      this.shakeActive    = true;
      this.shakeStartTime = t;

      // Red vignette flash (brief, not white-screen)
      this.flashDiv.style.opacity = "1";
      setTimeout(() => { this.flashDiv.style.opacity = "0"; }, 350);
    }

    // Only reset debrisExploded when user scrolls BACK out of chapter 4
    if (chapter < 4 && this._prevChapter4) {
      this._prevChapter4  = false;
      this.debrisExploded = false;
    }

    if (chapter >= 4) {
      const dt = Math.max(0, t - this.debrisExpTime);

      this.debrisParticles.forEach((d, i) => {
        // Exponential slowdown from initial burst
        const decay = Math.exp(-dt * 0.22);
        d.pos.x += d.vel.x * decay * 0.016;
        d.pos.y += d.vel.y * decay * 0.016;
        d.pos.z += d.vel.z * decay * 0.016;

        // Clamp to orbital shell — Kessler debris stays trapped
        const len = d.pos.length();
        if (len > EARTH_RADIUS * 2.2)  d.pos.setLength(EARTH_RADIUS * 2.2);
        if (len < EARTH_RADIUS * 1.18) d.pos.setLength(EARTH_RADIUS * 1.18);

        // Slow orbital drift — debris keeps moving, not static
        const driftAngle = t * 0.06 + i * 0.031;
        d.pos.x += Math.sin(driftAngle + i) * 0.002;
        d.pos.z += Math.cos(driftAngle + i * 0.7) * 0.002;

        posBuf[i*3]   = d.pos.x;
        posBuf[i*3+1] = d.pos.y;
        posBuf[i*3+2] = d.pos.z;

        // pSize must be large enough to produce visible pixels at this distance
        // Camera is at z=7.5, debris at ~r=3.5 → distance ≈ 4–7 units
        // gl_PointSize = pSize * (350 / distance) → need pSize ≥ 4 for 2px at dist 7
        const coolFactor = clamp(1.0 - dt * 0.04, 0.35, 1.0);
        szBuf[i] = (4.5 + d.life * 5.0) * coolFactor * (0.8 + 0.2 * Math.sin(t * 4 + i * 0.9));

        // Hot orange → cooling red-brown
        const hotness = clamp(1.0 - dt * 0.08, 0, 1);
        colBuf[i*3]   = lerp(d.col.r * 0.6, d.col.r, hotness);
        colBuf[i*3+1] = lerp(0.05,           d.col.g, hotness);
        colBuf[i*3+2] = lerp(0.0,            d.col.b, hotness * 0.3);
      });

      this.debrisGeo.attributes.position.needsUpdate = true;
      this.debrisGeo.attributes.pSize.needsUpdate    = true;
      this.debrisGeo.attributes.pColor.needsUpdate   = true;

      // Kessler ring: fade in quickly and hold solid
      const kesslerOpacity = clamp(p4 * 2.5, 0, 0.92);
      this.kesslerMat.uniforms.uOpacity.value = kesslerOpacity;
      this.kesslerMat.uniforms.uTime.value    = t;

    } else {
      // Pre-explosion: park all debris far offscreen
      for (let i = 0; i < this.debrisParticles.length; i++) {
        posBuf[i*3] = 9999; posBuf[i*3+1] = 9999; posBuf[i*3+2] = 9999;
      }
      this.debrisGeo.attributes.position.needsUpdate = true;
      this.kesslerMat.uniforms.uOpacity.value = 0;
    }
  }

  setProgress(p) { this.progress = p; }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this._raf);
    this.renderer.dispose();
    this._resizeObs.disconnect();
    this.camera.position.set(this.camBaseX, this.camBaseY, this.camBaseZ);
    if (this.flashDiv && this.flashDiv.parentNode) {
      this.flashDiv.parentNode.removeChild(this.flashDiv);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CHAPTER TEXT DATA
// ─────────────────────────────────────────────────────────────────────────────

const CHAPTERS = [
  {
    id: 0,
    tag: "PHASE 00",
    title: "Normal\nOrbit",
    body: "4 satellites trace clean paths above Earth. The orbital shell is peaceful, organized — a marvel of human engineering stretching across low Earth orbit.",
    accent: "#4a90e2",
  },
  {
    id: 1,
    tag: "PHASE 01",
    title: "Orbital\nCongestion",
    body: "Over 9,000 active satellites now share orbital space. The shell around Earth grows dense — a crowded highway with no traffic control, no lanes, no margin for error.",
    accent: "#ff8800",
  },
  {
    id: 2,
    tag: "PHASE 02",
    title: "Active\nSatellites",
    body: "Among thousands of objects, only a fraction remain operational. These are the critical assets — communications, navigation, weather monitoring — that modern civilization depends upon.",
    accent: "#00ffc8",
  },
  {
    id: 3,
    tag: "PHASE 03",
    title: "Collision\nRisk",
    body: "ASTRAL's ML systems detect two objects on converging trajectories. At orbital velocities of 7.8 km/s, even centimeter-scale debris carries the energy of a hand grenade.",
    accent: "#ff3030",
  },
  {
    id: 4,
    tag: "PHASE 04",
    title: "Kessler\nSyndrome",
    body: "One collision becomes ten. Ten become a thousand. The cascade of debris renders entire orbital bands permanently unusable. This is not science fiction — this is physics.",
    accent: "#ff6020",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// CHAPTER DETECTOR
// ─────────────────────────────────────────────────────────────────────────────

function getChapter(p) {
  if (p < PHASES.P1) return 0;
  if (p < PHASES.P2) return 1;
  if (p < PHASES.P3) return 2;
  if (p < PHASES.P4) return 3;
  return 4;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROGRESS BAR COMPONENT — single continuous vertical scrollbar
// ─────────────────────────────────────────────────────────────────────────────

function ProgressBar({ progress, chapter }) {
  const ch = CHAPTERS[chapter];
  const fillPct = (progress * 100).toFixed(2);

  return (
    <div style={{
      position: "fixed", right: "32px", top: "50%", transform: "translateY(-50%)",
      display: "flex", flexDirection: "column", alignItems: "center", gap: "8px",
      zIndex: 20,
    }}>
      {/* Phase label */}
      <div style={{
        color: ch.accent, fontSize: "8px", letterSpacing: "0.22em",
        fontFamily: "'Courier New', monospace",
        writingMode: "vertical-rl", textOrientation: "mixed",
        transform: "rotate(180deg)", marginBottom: "6px",
        textShadow: `0 0 10px ${ch.accent}`,
        transition: "color 0.4s ease", opacity: 0.8,
      }}>
        {ch.tag}
      </div>

      {/* Single track */}
      <div style={{
        width: "2px", height: "160px",
        background: "rgba(255,255,255,0.07)",
        borderRadius: "2px", position: "relative", overflow: "visible",
      }}>
        {/* Filled portion */}
        <div style={{
          position: "absolute", top: 0, left: 0, width: "100%",
          height: `${fillPct}%`,
          background: `linear-gradient(to bottom, ${ch.accent}, ${ch.accent}66)`,
          borderRadius: "2px",
          boxShadow: `0 0 5px ${ch.accent}`,
          transition: "background 0.4s ease, box-shadow 0.4s ease",
        }} />
        {/* Glowing tip */}
        <div style={{
          position: "absolute", left: "50%", transform: "translateX(-50%)",
          top: `calc(${fillPct}% - 4px)`,
          width: "7px", height: "7px", borderRadius: "50%",
          background: ch.accent,
          boxShadow: `0 0 10px 3px ${ch.accent}99`,
          transition: "background 0.4s ease",
        }} />
      </div>

      {/* Percentage */}
      <div style={{
        color: "rgba(160,190,255,0.3)", fontSize: "8px",
        fontFamily: "'Courier New', monospace",
        letterSpacing: "0.1em", marginTop: "4px",
      }}>
        {Math.round(progress * 100)}%
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHAPTER OVERLAY COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

function ChapterOverlay({ chapter, progress }) {
  const ch = CHAPTERS[chapter];
  const [visible, setVisible] = useState(true);
  const [prevChapter, setPrevChapter] = useState(chapter);
  const [fade, setFade] = useState(1);

  useEffect(() => {
    if (chapter !== prevChapter) {
      setFade(0);
      const t1 = setTimeout(() => { setPrevChapter(chapter); setFade(1); }, 300);
      return () => clearTimeout(t1);
    }
  }, [chapter, prevChapter]);

  const displayCh = CHAPTERS[prevChapter];

  return (
    <div style={{
      position: "fixed", left: "60px", bottom: "80px",
      maxWidth: "400px", zIndex: 20,
      opacity: fade, transition: "opacity 0.3s ease",
      fontFamily: "'Courier New', monospace",
    }}>
      {/* Tag */}
      <div style={{
        color: displayCh.accent, fontSize: "11px", fontWeight: "700",
        letterSpacing: "0.3em", marginBottom: "12px",
        textShadow: `0 0 20px ${displayCh.accent}`,
      }}>
        {displayCh.tag} ── ASTRAL
      </div>

      {/* Title */}
      <div style={{
        color: "#ffffff", fontSize: "clamp(28px, 3.5vw, 48px)",
        fontFamily: "'Georgia', serif", fontWeight: "300",
        lineHeight: "1.1", marginBottom: "20px",
        textShadow: "0 2px 30px rgba(0,0,0,0.8)",
        whiteSpace: "pre-line",
      }}>
        {displayCh.title}
      </div>

      {/* Body */}
      <div style={{
        color: "rgba(200,220,255,0.75)", fontSize: "13px",
        lineHeight: "1.75", fontFamily: "'Courier New', monospace",
        maxWidth: "320px", textShadow: "0 1px 10px rgba(0,0,0,0.9)",
      }}>
        {displayCh.body}
      </div>

      {/* Accent line */}
      <div style={{
        marginTop: "24px", width: "40px", height: "2px",
        background: displayCh.accent,
        boxShadow: `0 0 12px ${displayCh.accent}`,
        transition: "background 0.4s ease",
      }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HUD — Header
// ─────────────────────────────────────────────────────────────────────────────

function Header({ chapter }) {
  const ch = CHAPTERS[chapter];
  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0,
      padding: "28px 60px",
      display: "flex", justifyContent: "space-between", alignItems: "flex-start",
      zIndex: 20, pointerEvents: "none",
      background: "linear-gradient(to bottom, rgba(1,8,18,0.7) 0%, transparent 100%)",
    }}>
      {/* Logo */}
      <div>
        <div style={{
          fontSize: "22px", fontFamily: "'Georgia', serif",
          fontWeight: "300", color: "#fff",
          letterSpacing: "0.22em", marginBottom: "3px",
        }}>
          ASTRAL
        </div>
        <div style={{
          fontSize: "9px", letterSpacing: "0.4em",
          color: "rgba(160,190,255,0.5)", fontFamily: "'Courier New', monospace",
          textTransform: "uppercase",
        }}>
          Orbital Risk Intelligence
        </div>
      </div>

      {/* Status */}
      <div style={{ textAlign: "right", fontFamily: "'Courier New', monospace" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: "8px", justifyContent: "flex-end",
          marginBottom: "4px",
        }}>
          <div style={{
            width: "6px", height: "6px", borderRadius: "50%",
            background: ch.accent, boxShadow: `0 0 8px ${ch.accent}`,
            animation: "pulse 1.5s ease-in-out infinite",
          }} />
          <span style={{ color: ch.accent, fontSize: "10px", letterSpacing: "0.25em" }}>
            {["NOMINAL", "WARNING", "MONITORING", "CRITICAL", "CASCADE"][chapter]}
          </span>
        </div>
        <div style={{ color: "rgba(180,200,230,0.4)", fontSize: "9px", letterSpacing: "0.2em" }}>
          LEO TRACKING ACTIVE
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SCROLL HINT
// ─────────────────────────────────────────────────────────────────────────────

function ScrollHint({ progress }) {
  const opacity = progress < 0.03 ? 1 : Math.max(0, 1 - (progress / 0.08));
  return (
    <div style={{
      position: "fixed", bottom: "40px", left: "50%", transform: "translateX(-50%)",
      display: "flex", flexDirection: "column", alignItems: "center", gap: "8px",
      zIndex: 20, opacity, transition: "opacity 0.5s ease",
      fontFamily: "'Courier New', monospace",
    }}>
      <div style={{ color: "rgba(160,190,255,0.5)", fontSize: "9px", letterSpacing: "0.4em" }}>
        SCROLL TO EXPLORE
      </div>
      <div style={{
        width: "20px", height: "32px", border: "1px solid rgba(160,190,255,0.3)",
        borderRadius: "10px", display: "flex", justifyContent: "center", paddingTop: "5px",
      }}>
        <div style={{
          width: "3px", height: "7px", borderRadius: "2px",
          background: "rgba(160,190,255,0.5)",
          animation: "scrollDot 1.8s ease-in-out infinite",
        }} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// METRICS TICKER (Phase-dependent stats)
// ─────────────────────────────────────────────────────────────────────────────

const METRICS = [
  { label: "TRACKED OBJECTS", values: ["8,900", "9,400+", "9,400+", "9,403", "9,403+"] },
  { label: "COLLISION ALERTS", values: ["0", "0", "12", "1 CRITICAL", "CASCADE"] },
  { label: "ORBITAL BANDS",    values: ["CLEAR", "DENSE", "DENSE", "COMPROMISED", "UNUSABLE"] },
];

function MetricsTicker({ chapter }) {
  return (
    <div style={{
      position: "fixed", right: "60px", bottom: "80px",
      fontFamily: "'Courier New', monospace",
      textAlign: "right", zIndex: 20,
    }}>
      {METRICS.map((m, i) => (
        <div key={i} style={{ marginBottom: "14px" }}>
          <div style={{ color: "rgba(160,190,255,0.4)", fontSize: "8px", letterSpacing: "0.35em" }}>
            {m.label}
          </div>
          <div style={{
            color: CHAPTERS[chapter].accent, fontSize: "14px",
            fontWeight: "700", letterSpacing: "0.05em",
            textShadow: `0 0 15px ${CHAPTERS[chapter].accent}44`,
            transition: "color 0.5s ease",
          }}>
            {m.values[chapter]}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CANVAS (pure Three.js, mounts once)
// ─────────────────────────────────────────────────────────────────────────────

function ThreeCanvas({ progressRef }) {
  const canvasRef = useRef(null);
  const sceneRef  = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    sceneRef.current = new AstralScene(canvasRef.current);
    return () => { sceneRef.current?.dispose(); };
  }, []);

  // Feed smooth progress to scene every RAF
  useEffect(() => {
    let raf;
    const tick = () => {
      if (sceneRef.current) {
        sceneRef.current.setProgress(progressRef.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [progressRef]);

  return (
    <canvas ref={canvasRef} style={{
      position: "fixed", top: 0, left: 0,
      width: "100%", height: "100%",
      zIndex: 1,
    }} />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────────────

export default function AstralApp() {
  const rawProgress   = useScrollProgress();
  const smoothRef     = useRef(0);
  const chapter       = getChapter(rawProgress);

  // Smooth the progress value in a ref (no re-renders)
  useEffect(() => {
    let raf;
    const update = () => {
      smoothRef.current += (rawProgress - smoothRef.current) * 0.07;
      raf = requestAnimationFrame(update);
    };
    raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
  }, [rawProgress]);

  return (
    <>
      {/* ── CSS injections ── */}
      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html { scroll-behavior: auto; }
        body {
          background: #010812;
          overflow-x: hidden;
        }
        /* Scroll space: 500vh gives 5 chapters */
        #astral-scroll-space { height: 500vh; }

        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.5; transform: scale(0.85); }
        }
        @keyframes scrollDot {
          0%   { transform: translateY(0); opacity: 1; }
          100% { transform: translateY(12px); opacity: 0; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        ::selection { background: rgba(74,144,226,0.3); }
        ::-webkit-scrollbar { width: 0; }
      `}</style>

      {/* Three.js canvas (fixed, behind everything) */}
      <ThreeCanvas progressRef={smoothRef} />

      {/* Scroll space (creates the scrollable height) */}
      <div id="astral-scroll-space" />

      {/* HUD Layer */}
      <Header chapter={chapter} />
      <ChapterOverlay chapter={chapter} progress={rawProgress} />
      <ProgressBar progress={rawProgress} chapter={chapter} />
      <MetricsTicker chapter={chapter} />
      <ScrollHint progress={rawProgress} />

      {/* Bottom gradient vignette */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, height: "180px",
        background: "linear-gradient(to top, rgba(1,8,18,0.6) 0%, transparent 100%)",
        pointerEvents: "none", zIndex: 10,
      }} />
      {/* Top gradient vignette */}
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, height: "120px",
        background: "linear-gradient(to bottom, rgba(1,8,18,0.5) 0%, transparent 100%)",
        pointerEvents: "none", zIndex: 10,
      }} />
    </>
  );
}