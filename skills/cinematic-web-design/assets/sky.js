/* cinematic-web-design/sky.js - the launch-page hero, as a WebGL scene.

   The Fable 5.1 hero is not a photograph. It is a three.js scene whose three
   palette dots do not crossfade images: they set a weight vector that the
   render loop eases every frame, and a barycentric blend rewrites every sky
   colour, light colour and the sun direction from it. The whole world
   re-lights, physically, from one vector. That is what this reproduces.

     <div class="sky" data-sky
          data-moods="Noon:#7ea9de|Night:#1a2237|Morning:#dcc4b3"></div>

   Adds its own palette buttons, keyboard-operable, labelled. Falls back to a
   CSS gradient with no WebGL, renders one still frame under reduced motion,
   and stops when it scrolls off screen. No photograph, no asset, no request. */
import * as THREE from 'three';

for (const root of document.querySelectorAll('[data-sky]')) {
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Noon / Night / Morning, verified off the reference page
  const MOODS = (root.dataset.moods || 'Noon:#7ea9de|Night:#1a2237|Morning:#dcc4b3')
    .split('|').map((s) => {
      const [label, hex] = s.split(':');
      return { label: label.trim(), hex: hex.trim() };
    });

  // each mood is a full lighting rig, not just a sky colour
  const RIG = [
    { top: 0x2f6fb8, hor: 0xe8d3b4, key: 0xffe6bd, amb: 0x9dc0e4, sun: [-0.5, 0.55, 0.68], power: 2.3 },
    { top: 0x0b1020, hor: 0x2a3550, key: 0xa8bcd8, amb: 0x2f3950, sun: [0.42, 0.34, -0.55], power: 0.85 },
    { top: 0x1e2b4d, hor: 0xdcc4b3, key: 0xffc490, amb: 0x6a6480, sun: [-0.78, 0.2, 0.4], power: 1.7 },
  ];
  const n = Math.min(MOODS.length, RIG.length);
  const W = RIG.map((_, i) => (i === 0 ? 1 : 0));
  const T = W.slice();

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
  } catch { renderer = null; }

  /* ── the dots. They exist either way: with no WebGL they still swap the
        CSS fallback, so the control is never a dead button. ────────────── */
  const bar = document.createElement('div');
  bar.className = 'sky__dots';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Time of day');
  const dots = MOODS.slice(0, n).map((m, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sky__dot';
    b.style.setProperty('--dot', m.hex);
    b.setAttribute('aria-label', m.label);
    b.setAttribute('aria-pressed', String(i === 0));
    b.addEventListener('click', () => {
      for (let k = 0; k < n; k++) T[k] = k === i ? 1 : 0;
      dots.forEach((d, k) => d.setAttribute('aria-pressed', String(k === i)));
      root.style.setProperty('--sky-fallback', MOODS[i].hex);
      root.dataset.mood = MOODS[i].label.toLowerCase();
      if (calm || !renderer) { for (let k = 0; k < n; k++) W[k] = T[k]; paintFallback(); }
      else kick();
    });
    bar.appendChild(b);
    return b;
  });
  root.appendChild(bar);

  const _c = new THREE.Color();
  const mix = (field) => {
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < n; i++) { _c.setHex(RIG[i][field]); r += _c.r * W[i]; g += _c.g * W[i]; b += _c.b * W[i]; }
    return [r, g, b];
  };
  const paintFallback = () => {
    const [tr, tg, tb] = mix('top'), [hr, hg, hb] = mix('hor');
    const css = (a) => `rgb(${a.map((x) => Math.round(x * 255)).join(' ')})`;
    root.style.background = `linear-gradient(178deg in oklab, ${css([tr, tg, tb])}, ${css([hr, hg, hb])})`;
  };

  if (!renderer) { paintFallback(); continue; }

  const stage = document.createElement('div');
  stage.className = 'sky__gl';
  root.prepend(stage);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;   // the reference post chain starts here
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 400);
  camera.position.set(0, 1.2, 0.001);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(200, 40, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uT: { value: 0 } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        varying vec3 vP; uniform vec3 uTop, uHor; uniform float uT;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
        float nz(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ return nz(p)*0.55 + nz(p*2.1)*0.28 + nz(p*4.3)*0.17; }
        void main(){
          vec3 d = normalize(vP);
          vec3 c = mix(uHor, uTop, smoothstep(-0.08, 0.7, d.y));
          vec2 q = d.xz / max(0.18, d.y + 0.35) * 1.5 + vec2(uT * 0.008, uT * 0.004);
          float cl = fbm(q);
          // cloud only above the horizon, and softened into it
          c = mix(c, c * 1.22 + 0.06, smoothstep(0.48, 0.92, cl) * smoothstep(0.0, 0.3, d.y) * 0.8);
          c += (h(gl_FragCoord.xy + uT) - 0.5) * 0.014;   // grain, and it dithers the ramp
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  scene.add(sky);

  const key = new THREE.DirectionalLight(0xffffff, 2);
  scene.add(key, new THREE.AmbientLight(0xffffff, 0.6));

  // a branch in the near corner: the reference has one, and it is what gives
  // the sky a foreground to be behind
  const branch = new THREE.Group();
  const bm = new THREE.MeshStandardMaterial({ color: 0x120f0d, roughness: 1 });
  let sd = 7;
  const rr = () => ((sd = (sd * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const twig = (x, y, z, len, ang, depth) => {
    const g = new THREE.Mesh(new THREE.CylinderGeometry(0.012 * depth, 0.02 * depth, len, 5), bm);
    g.position.set(x, y, z); g.rotation.z = ang; g.rotation.y = rr() * 3;
    branch.add(g);
    if (depth > 1) {
      const ex = x + Math.sin(ang) * -len * 0.5, ey = y + Math.cos(ang) * len * 0.5;
      twig(ex, ey, z + (rr() - 0.5) * 0.3, len * 0.72, ang + 0.5 + rr() * 0.4, depth - 1);
      twig(ex, ey, z + (rr() - 0.5) * 0.3, len * 0.68, ang - 0.5 - rr() * 0.4, depth - 1);
    }
  };
  twig(-2.6, 0.4, -3.4, 1.5, 0.5, 4);
  branch.position.set(0, -0.6, 0);
  scene.add(branch);

  const resize = () => {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
  };
  resize();
  if ('ResizeObserver' in window) new ResizeObserver(() => { resize(); kick(); }).observe(stage);
  else addEventListener('resize', () => { resize(); kick(); }, { passive: true });

  let running = false, last = 0;
  function kick() { if (!running) { running = true; last = 0; requestAnimationFrame(frame); } }

  function frame(ts) {
    running = false;
    const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016; last = ts;
    // the reference constant: frame-rate independent, no tween library
    const k = 1 - Math.exp(-dt * 2.2);
    let settling = false;
    for (let i = 0; i < n; i++) {
      W[i] += (T[i] - W[i]) * k;
      if (Math.abs(T[i] - W[i]) > 0.002) settling = true;
    }
    const u = sky.material.uniforms;
    u.uTop.value.setRGB(...mix('top'));
    u.uHor.value.setRGB(...mix('hor'));
    u.uT.value = ts / 1000;
    key.color.setRGB(...mix('key'));
    key.intensity = RIG.reduce((a, r, i) => a + r.power * W[i], 0);
    key.position.set(
      RIG.reduce((a, r, i) => a + r.sun[0] * W[i], 0),
      RIG.reduce((a, r, i) => a + r.sun[1] * W[i], 0),
      RIG.reduce((a, r, i) => a + r.sun[2] * W[i], 0),
    ).multiplyScalar(50);
    renderer.render(scene, camera);
    if (settling || !calm) { if (!calm) settling = true; }
    if (settling) kick();
  }

  if (calm) { for (let i = 0; i < n; i++) W[i] = T[i]; frame(0); running = false; }
  else new IntersectionObserver(([e]) => { if (e.isIntersecting) kick(); else running = true; })
    .observe(stage);
}
