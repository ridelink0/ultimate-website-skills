/* atelier/inspect - render a page in a real headless browser, screenshot it,
   and report what is actually wrong with the LAYOUT rather than the source.

   Static analysis cannot see an overlap. This can: it walks the rendered box
   tree and reports text colliding with text, content past the viewport,
   unreadable contrast, collapsed elements and broken images - the class of bug
   you only find by looking.

   Zero dependencies. Drives the browser over CDP using Node 18+'s built-in
   fetch and Node 22's built-in WebSocket. */

import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/* ------------------------------------------------------------- browser ---- */

const CANDIDATES = process.platform === 'win32'
  ? [
      `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ]
  : process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
       '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
       '/Applications/Chromium.app/Contents/MacOS/Chromium']
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
       '/usr/bin/microsoft-edge', '/snap/bin/chromium'];

export function findBrowser() {
  if (process.env.ATELIER_BROWSER && existsSync(process.env.ATELIER_BROWSER))
    return process.env.ATELIER_BROWSER;
  return CANDIDATES.find((p) => p && existsSync(p)) || null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(bin) {
  const udd = mkdtempSync(join(tmpdir(), 'atelier-cdp-'));
  const proc = spawn(bin, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--disable-sync', '--disable-features=Translate',
    `--user-data-dir=${udd}`, '--remote-debugging-port=0', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore'] });

  const portFile = join(udd, 'DevToolsActivePort');
  for (let i = 0; i < 150; i++) {
    if (existsSync(portFile)) {
      const port = readFileSync(portFile, 'utf8').split('\n')[0].trim();
      if (port) return { proc, udd, port: +port };
    }
    await sleep(100);
  }
  try { proc.kill(); } catch {}
  rmSync(udd, { recursive: true, force: true });
  throw new Error('browser did not expose a debugging port');
}

/* ----------------------------------------------------------------- CDP ---- */

class Session {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); this.events = []; }
  static async open(port) {
    let target;
    for (let i = 0; i < 60; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (target) break;
      } catch {}
      await sleep(100);
    }
    if (!target) throw new Error('no page target');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('cdp socket failed')), { once: true });
    });
    const s = new Session(ws);
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && s.waiting.has(msg.id)) {
        const { res, rej } = s.waiting.get(msg.id);
        s.waiting.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      } else if (msg.method) s.events.push(msg);
    });
    return s;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.waiting.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.waiting.has(id)) { this.waiting.delete(id); rej(new Error(method + ' timed out')); }
      }, 45000);
    });
  }
  async waitForEvent(method, ms = 25000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const i = this.events.findIndex((e) => e.method === method);
      if (i !== -1) return this.events.splice(i, 1)[0];
      await sleep(50);
    }
    return null;
  }
  close() { try { this.ws.close(); } catch {} }
}

/* ------------------------------------------------- the in-page analysis ---- */
/* Runs inside the page. Everything it needs must be self-contained. */
const PROBE = `(() => {
  const out = { overlaps: [], overflow: [], contrast: [], collapsed: [], broken: [],
                tiny: [], offscreen: [], stats: {} };
  const vw = innerWidth, vh = innerHeight;

  const vis = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    // [hidden], display:none on an ancestor, and the slot of a closed <details>
    // all leave a rect behind; offsetParent is how you tell they are not painted.
    if (!el.offsetParent && cs.position !== 'fixed' && el !== document.body) return false;
    if (el.closest('details:not([open])') && !el.closest('summary')) return false;
    if (el.closest('[hidden]')) return false;
    return true;
  };
  const label = (el) => {
    const id = el.id ? '#' + el.id : '';
    const cls = (el.className && typeof el.className === 'string')
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
    const txt = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 34);
    return el.tagName.toLowerCase() + id + cls + (txt ? ' "' + txt + '"' : '');
  };
  // getComputedStyle hands back oklch() and color-mix() verbatim now, so naive
  // number-grabbing reads "oklch(0.5 0.018 75)" as rgb(0, 0, 75) and every
  // colour in a modern palette fails contrast. Let the canvas normalise any
  // CSS Color 4 value into something parseable.
  // Reading the string is not enough: a computed oklch() or color-mix() comes
  // back verbatim, and canvas fillStyle hands it straight back too. Painting
  // the colour and reading the pixel is the only conversion that always works,
  // for every CSS Color 4 value the browser can render.
  const _cv = document.createElement('canvas');
  _cv.width = _cv.height = 1;
  const _cx = _cv.getContext('2d', { willReadFrequently: true });
  const _memo = new Map();
  const parseRGB = (str) => {
    if (!str || str === 'transparent') return null;
    if (_memo.has(str)) return _memo.get(str);
    let out = null;
    try {
      _cx.clearRect(0, 0, 1, 1);
      _cx.fillStyle = '#000';
      _cx.fillStyle = str;
      _cx.fillRect(0, 0, 1, 1);
      const d = _cx.getImageData(0, 0, 1, 1).data;
      out = { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
    } catch { out = null; }
    _memo.set(str, out);
    return out;
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  // Returns the solid colour actually behind the element, or null when we
  // genuinely cannot tell - a background image, or a positioned sibling layer
  // painting underneath (a hero photo, a gradient plate). Guessing there
  // produces a page full of false 1:1 failures, which is worse than silence.
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      for (const sib of n.children) {
        if (sib === el || sib.contains(el)) continue;
        const scs = getComputedStyle(sib);
        if (scs.position === 'absolute' || scs.position === 'fixed') return null;
      }
      const c = parseRGB(cs.backgroundColor);
      if (c && c.a > 0.85) return c;
      n = n.parentElement;
    }
    const c = parseRGB(getComputedStyle(document.body).backgroundColor);
    return c && c.a > 0.85 ? c : null;
  };

  // Elements whose own text is painted (not just inherited from a child).
  const textEls = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!own) continue;
    // A fixed or sticky header sits over whatever scrolls under it by design.
    // That is not the overlap this check exists to find.
    let pinned = false;
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const pos = getComputedStyle(a).position;
      if (pos === 'fixed' || pos === 'sticky') { pinned = true; break; }
    }
    if (pinned) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    textEls.push({ el, r, cs: getComputedStyle(el) });
  }
  out.stats.textElements = textEls.length;

  const related = (a, b) => a.contains(b) || b.contains(a);
  const area = (r) => r.width * r.height;

  // TEXT OVER TEXT. Two painted text boxes intersecting, neither containing the
  // other, is almost always a bug - and it is the one class static analysis and
  // a source read can never see.
  for (let i = 0; i < textEls.length; i++) {
    for (let j = i + 1; j < textEls.length; j++) {
      const A = textEls[i], B = textEls[j];
      if (related(A.el, B.el)) continue;
      const x = Math.max(0, Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left));
      const y = Math.max(0, Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top));
      const ov = x * y;
      if (ov < 240) continue;
      const frac = ov / Math.min(area(A.r), area(B.r));
      if (frac < 0.12) continue;
      out.overlaps.push({
        a: label(A.el), b: label(B.el),
        pct: Math.round(frac * 100),
        px: Math.round(ov),
        at: Math.round(A.r.top + scrollY),
      });
    }
  }
  out.overlaps.sort((p, q) => q.pct - p.pct);
  out.overlaps = out.overlaps.slice(0, 12);

  // Anything wider than the viewport, and the page itself scrolling sideways.
  if (document.documentElement.scrollWidth > vw + 1)
    out.overflow.push({ what: 'document', by: document.documentElement.scrollWidth - vw });
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    // An element only overflows the page if nothing between it and the root
    // clips it. An svg clips its own geometry; so does any overflow:hidden or
    // clip ancestor. Reporting the raw box there is a false alarm.
    const svg = el.ownerSVGElement;
    if (svg && getComputedStyle(svg).overflow !== 'visible') continue;
    let clipped = false;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const o = getComputedStyle(a).overflowX;
      if (o === 'hidden' || o === 'clip' || o === 'auto' || o === 'scroll') { clipped = true; break; }
    }
    if (clipped) continue;
    const r = el.getBoundingClientRect();
    if (r.width > vw + 2 && getComputedStyle(el).position !== 'fixed')
      out.offscreen.push({ el: label(el), width: Math.round(r.width), vw });
    if (r.right > vw + 2 && r.left >= 0 && r.width < vw)
      out.overflow.push({ what: label(el), by: Math.round(r.right - vw) });
  }
  out.offscreen = out.offscreen.slice(0, 8);
  out.overflow = out.overflow.slice(0, 8);

  // Contrast, only where the background is a solid colour we can actually read.
  for (const { el, cs, r } of textEls) {
    const fg = parseRGB(cs.color);
    const bg = bgOf(el);
    if (!fg || !bg || fg.a < 0.9) continue;
    const size = parseFloat(cs.fontSize);
    const bold = +cs.fontWeight >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const cr = ratio(fg, bg);
    const need = large ? 3 : 4.5;
    if (cr < need)
      out.contrast.push({ el: label(el), ratio: +cr.toFixed(2), need, size: Math.round(size) });
  }
  out.contrast.sort((a, b) => a.ratio - b.ratio);
  out.contrast = out.contrast.slice(0, 10);

  // Content that is present but has collapsed to nothing.
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if ((el.textContent || '').trim().length > 8 && (r.height < 1 || r.width < 1))
      out.collapsed.push(label(el));
  }
  out.collapsed = out.collapsed.slice(0, 8);

  // Images that did not load, and tap targets under 24px.
  for (const img of document.images) {
    if (img.complete && img.naturalWidth > 0) continue;
    // A lazy image still below the viewport has not failed; it has not been
    // asked for yet. Only an image the browser should have fetched counts.
    const r = img.getBoundingClientRect();
    if (img.loading === 'lazy' && r.top > vh * 1.5) continue;
    out.broken.push(img.getAttribute('src') || '(no src)');
  }
  for (const el of document.querySelectorAll('a, button, input, select, textarea, [role=button]')) {
    if (!vis(el)) continue;
    // WCAG 2.5.8 exempts targets in a sentence or block of text. An inline link
    // in a paragraph is not a 24px failure.
    if (getComputedStyle(el).display === 'inline' && el.closest('p, li, .prose')) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24))
      out.tiny.push({ el: label(el), w: Math.round(r.width), h: Math.round(r.height) });
  }
  out.tiny = out.tiny.slice(0, 8);

  out.stats.scrollHeight = document.documentElement.scrollHeight;
  out.stats.viewport = vw + 'x' + vh;
  return JSON.stringify(out);
})()`;

/* ------------------------------------------------------------- the API ---- */

export async function inspect(url, { widths = [1440, 390], out = null, full = false, wait = 1800, scrolls = [0] } = {}) {
  const bin = findBrowser();
  if (!bin) {
    const err = new Error(
      'no Chrome, Edge or Chromium found.\n' +
      '  Windows: winget install --id Microsoft.Edge (usually already present)\n' +
      '  macOS:   brew install --cask google-chrome\n' +
      '  Linux:   apt-get install chromium\n' +
      'Or set ATELIER_BROWSER to the executable.');
    err.code = 'no-browser';
    throw err;
  }

  const { proc, udd, port } = await launch(bin);
  const results = [];
  let session;
  try {
    session = await Session.open(port);
    await session.send('Page.enable');
    await session.send('Runtime.enable');

    for (const w of widths) {
      const height = 1000;
      await session.send('Emulation.setDeviceMetricsOverride', {
        width: w, height, deviceScaleFactor: 1, mobile: w < 700,
      });
      session.events.length = 0;
      await session.send('Page.navigate', { url });
      await session.waitForEvent('Page.loadEventFired');
      // let fonts settle and any entrance animation finish
      await session.send('Runtime.evaluate', {
        expression: 'document.fonts ? document.fonts.ready.then(()=>1) : 1', awaitPromise: true,
      }).catch(() => {});
      await sleep(wait);

      // A parallax layer that is fine at the top of the page can be sitting on
      // the headline 400px later. Probe at every requested scroll position.
      for (const sy of scrolls) {
        await session.send('Runtime.evaluate', {
          expression: `window.scrollTo({top:${sy},behavior:'instant'}); window.dispatchEvent(new Event('scroll'));`,
        });
        await sleep(sy ? 700 : 0);
        const probe = await session.send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
        const report = JSON.parse(probe.result.value);

        let file = null;
        if (out) {
          mkdirSync(out, { recursive: true });
          const shot = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full });
          file = join(out, `w${w}${sy ? '-y' + sy : ''}.png`);
          writeFileSync(file, Buffer.from(shot.data, 'base64'));
        }
        results.push({ width: w, scroll: sy, file, ...report });
      }
    }
  } finally {
    if (session) session.close();
    try { proc.kill(); } catch {}
    setTimeout(() => { try { rmSync(udd, { recursive: true, force: true }); } catch {} }, 400);
  }
  return results;
}

export function formatReport(results) {
  const lines = [];
  let errors = 0, warns = 0;
  for (const r of results) {
    lines.push(`\n  ${r.width}px${r.scroll ? ' scrolled ' + r.scroll + 'px' : ''}  (${r.stats.textElements} text elements, page ${r.stats.scrollHeight}px tall)`);
    if (r.file) lines.push(`  shot: ${r.file}`);

    if (r.overlaps.length) {
      for (const o of r.overlaps) {
        errors++;
        lines.push(`  ERROR overlap ${o.pct}% at y=${o.at}: ${o.a}`);
        lines.push(`                          over: ${o.b}`);
      }
    } else lines.push('  ok    no text overlapping other text');

    for (const o of r.offscreen) { errors++; lines.push(`  ERROR ${o.el} is ${o.width}px in a ${o.vw}px viewport`); }
    for (const o of r.overflow) { errors++; lines.push(`  ERROR ${o.what} runs ${o.by}px past the right edge`); }
    for (const c of r.collapsed) { errors++; lines.push(`  ERROR collapsed to zero size but has text: ${c}`); }
    for (const b of r.broken) { errors++; lines.push(`  ERROR image failed to load: ${b}`); }
    for (const c of r.contrast) { warns++; lines.push(`  warn  contrast ${c.ratio}:1 (needs ${c.need}) at ${c.size}px: ${c.el}`); }
    for (const t of r.tiny) { warns++; lines.push(`  warn  tap target ${t.w}x${t.h}px (needs 24): ${t.el}`); }
  }
  return { text: lines.join('\n'), errors, warns };
}
