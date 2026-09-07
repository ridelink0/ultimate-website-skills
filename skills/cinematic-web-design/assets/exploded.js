/* cinematic-web-design/exploded.js - any made thing, taken apart, in real 3D.

   Reads its layers from the markup, so the semantic list IS the no-JS
   fallback and nothing is duplicated:

     <div class="exploded" data-spread="0.62" data-turn="0.9">
       <ol class="exploded__list">
         <li data-color="#9aa0a8" data-metal=".85" data-rough=".34" data-t=".030">Ridge vent</li>
         <li data-color="#4a423a" data-rough=".90" data-t=".046" data-lines="5">Architectural shingle</li>
         <li data-color="#8a6a42" data-rough=".92" data-t=".075" data-lines="3">Decking</li>
       </ol>
     </div>

   Bottom of the list = bottom of the stack. Callouts are projected onto each
   slab's real world position, so they track it through the turn. With no
   WebGL, reduced motion, or no three.js, the list stays and reads fine. */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

for (const root of document.querySelectorAll('.exploded')) {
  const items = [...root.querySelectorAll('li')];
  if (items.length < 2) continue;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) continue;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch { renderer = null; }
  if (!renderer) continue;

  const stage = document.createElement('div');
  stage.className = 'exploded__gl';
  root.prepend(stage);
  root.classList.add('is-live');

  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;   // keeps the palette honest
  renderer.toneMappingExposure = 1.05;
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const key = new THREE.DirectionalLight(0xffcf9a, 2.0);
  key.position.set(-3, 4, 2.5);
  scene.add(key, new THREE.AmbientLight(0x5b6a86, 0.5));

  const root3 = new THREE.Group();
  scene.add(root3);
  const W = 2.5, D = 1.7;
  const SPREAD = parseFloat(root.dataset.spread) || 0.62;
  const TURN = parseFloat(root.dataset.turn) || 0.9;

  // markup order is top-down; the 3D stack is bottom-up
  const layers = items.slice().reverse().map((li, i) => {
    const t = parseFloat(li.dataset.t) || 0.04;
    const g = new THREE.Group();
    g.add(new THREE.Mesh(
      new THREE.BoxGeometry(W, t, D),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(li.dataset.color || '#6b6156'),
        roughness: parseFloat(li.dataset.rough ?? 0.8),
        metalness: parseFloat(li.dataset.metal ?? 0),
      }),
    ));
    const n = parseInt(li.dataset.lines, 10) || 0;
    if (n > 1) {
      const lm = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1, transparent: true, opacity: 0.45 });
      for (let k = 1; k < n; k++) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(W * 0.995, t * 0.34, 0.012), lm);
        s.position.set(0, t * 0.36, -D / 2 + (D * k) / n);
        g.add(s);
      }
    }
    g.userData = { home: i * 0.05, apart: (i - (items.length - 1) / 2) * SPREAD };
    g.position.y = g.userData.home;
    root3.add(g);
    return g;
  });

  // callouts, one per layer, projected onto the real world point
  const tagLayer = document.createElement('div');
  tagLayer.className = 'exploded__tags';
  tagLayer.setAttribute('aria-hidden', 'true');
  stage.appendChild(tagLayer);
  const tags = items.slice().reverse().map((li) => {
    const p = document.createElement('p');
    p.className = 'exploded__tag';
    p.innerHTML = `<span>${li.textContent.trim()}</span>`;
    tagLayer.appendChild(p);
    return p;
  });

  const _v = new THREE.Vector3(), _c = new THREE.Vector3(), _w = new THREE.Vector3();
  const toScreen = (world, rect) => {
    _c.copy(world).applyMatrix4(camera.matrixWorldInverse);
    if (_c.z > -camera.near) return null;   // behind the camera: project() lies
    _v.copy(world).project(camera);
    return { x: (_v.x * 0.5 + 0.5) * rect.width, y: (-_v.y * 0.5 + 0.5) * rect.height };
  };

  const resize = () => {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  };
  resize();
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(stage);
  else addEventListener('resize', resize, { passive: true });

  const track = root.closest('[data-explode-track]') || root.parentElement;
  let target = 0, eased = 0, running = false;
  const read = () => {
    const r = track.getBoundingClientRect();
    const total = r.height - innerHeight;
    target = total <= 0
      ? Math.min(1, Math.max(0, 1 - (r.top + r.height) / (innerHeight + r.height)))
      : Math.min(1, Math.max(0, -r.top / total));
    if (!running) { running = true; requestAnimationFrame(frame); }
  };
  addEventListener('scroll', read, { passive: true });
  addEventListener('resize', read, { passive: true });

  function frame() {
    eased += (target - eased) * 0.11;
    const spread = Math.min(1, eased / 0.55);          // pull apart first
    const turn = Math.max(0, (eased - 0.4) / 0.6);     // then show the edges
    for (const g of layers) g.position.y = g.userData.home + (g.userData.apart - g.userData.home) * spread;
    root3.rotation.y = -0.32 + turn * TURN;
    camera.position.set(2.35, 1.55 + turn * 0.5, 3.05 - turn * 0.35);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    renderer.render(scene, camera);

    const rect = stage.getBoundingClientRect();
    layers.forEach((g, i) => {
      g.getWorldPosition(_w);
      _w.x += W / 2 + 0.12;
      const p = toScreen(_w, rect);
      const t = tags[i];
      if (!p || spread < 0.25) { t.style.opacity = '0'; return; }
      t.style.opacity = String(Math.min(1, (spread - 0.25) / 0.3));
      t.style.transform = `translate3d(${Math.round(p.x)}px, ${Math.round(p.y)}px, 0)`;
    });

    if (Math.abs(target - eased) > 0.0004) requestAnimationFrame(frame);
    else running = false;
  }
  renderer.compileAsync(scene, camera).then(read).catch(read);
}
