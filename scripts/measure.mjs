/* What the source cannot tell you about a page you have already built.
 *
 * The audit reads the files. The debug pass takes pictures. Neither answers the
 * three questions that actually decide whether a cinematic page is any good:
 *
 *   Does it move?     A parallax declared in the markup and a parallax that
 *                     happens on screen are different things. Three planes with
 *                     the same measured rate is a flat page with extra markup,
 *                     and it looks exactly like the real thing in a screenshot.
 *   Does it cost?     Sixty frames a second is the whole budget. A hero that
 *                     renders at 24 is not "cinematic", it is broken, and the
 *                     117 KB of animation library the page loaded and never
 *                     called is dead weight in the critical path.
 *   Does it read?     Fifteen distinct type sizes is not a typographic scale.
 *                     A 140-character measure is not a column. These are
 *                     computed values, so they can be counted rather than
 *                     argued about.
 *
 * Everything here runs in the page, against the render, and returns numbers.
 * The numbers are not the judgement - the screenshots are still the judgement -
 * but they catch the failures a screenshot cannot show, because a still frame
 * of a dead animation is indistinguishable from a still frame of a live one.
 */

/* Installed before any document runs. Observers have to exist before the thing
 * they observe, so long tasks and layout shifts are collected from the first
 * frame rather than from whenever the probe happens to arrive. */
export const MEASURE_INIT = `(() => {
  const state = { longTasks: [], shifts: 0, errors: [] };
  Object.defineProperty(window, '__measure', { value: state, configurable: true });
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.longTasks.push(Math.round(entry.duration));
    }).observe({ type: 'longtask', buffered: true });
  } catch (err) { state.errors.push('longtask: ' + err.message); }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) state.shifts += entry.value;
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (err) { state.errors.push('layout-shift: ' + err.message); }
})()`;

/* Two seconds of frames, and whether anything on the canvas changed across
 * them. Both halves matter: a canvas can repaint sixty times a second and paint
 * the same thing every time, and a page can animate beautifully at nineteen
 * frames a second. */
const MOTION = (ms) => `(async () => {
  const canvases = [...document.querySelectorAll('canvas')];
  const fingerprint = () => canvases.map((canvas) => {
    try {
      const copy = document.createElement('canvas');
      copy.width = copy.height = 8;
      const ctx = copy.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(canvas, 0, 0, 8, 8);
      return Array.from(ctx.getImageData(0, 0, 8, 8).data).join(',');
    } catch (err) { return null; }
  });
  const before = fingerprint();
  const frames = [];
  await new Promise((resolve) => {
    const start = performance.now();
    let last = start;
    const tick = (now) => {
      frames.push(now - last);
      last = now;
      if (now - start < ${ms}) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
  const after = fingerprint();
  const timed = frames.slice(1).filter((value) => value > 0);
  const sorted = timed.slice().sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  return JSON.stringify({
    frames: timed.length,
    fps: median ? Math.round(1000 / median) : null,
    worstFrameMs: sorted.length ? Math.round(sorted[sorted.length - 1]) : null,
    // A frame over 32 ms is a visible stutter at 60 Hz: one dropped, or more.
    dropped: timed.filter((value) => value > 32).length,
    canvases: canvases.map((canvas, i) => ({
      context: canvas.__inspectContext || null,
      animating: before[i] !== null && after[i] !== null ? before[i] !== after[i] : null,
      width: Math.round(canvas.getBoundingClientRect().width),
    })),
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  });
})()`;

/* Parallax, measured rather than declared. Scroll a fixed distance, watch where
 * every plane actually went, and express it as a rate: 1 is page speed, under 1
 * lags behind the page, over 1 leads it. Three planes that all read 1.00 are
 * three planes in name only. */
const DEPTH = (distance) => `(async () => {
  const planes = [...document.querySelectorAll('[data-depth], [data-parallax], .plane, .layer')];
  const named = (el) => (el.dataset.depth || el.dataset.parallax || el.className || el.tagName).toString().slice(0, 40);
  // A page can have two elements called .layer that were never meant to move.
  // Only an element that DECLARES a depth is promising anything, so only those
  // can be accused of not delivering it; the rest are reported and not judged.
  const declared = (el) => el.dataset.depth !== undefined || el.dataset.parallax !== undefined;
  const top = (el) => el.getBoundingClientRect().top;
  const start = window.scrollY;
  window.scrollTo({ top: 0, behavior: 'instant' });
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const before = planes.map(top);
  window.scrollTo({ top: ${distance}, behavior: 'instant' });
  window.dispatchEvent(new Event('scroll'));
  await new Promise((resolve) => setTimeout(resolve, 260));
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const after = planes.map(top);
  window.scrollTo({ top: start, behavior: 'instant' });
  return JSON.stringify({
    distance: ${distance},
    planes: planes.map((el, i) => ({
      name: named(el),
      declared: el.dataset.depth !== undefined ? Number(el.dataset.depth) : null,
      promises: declared(el),
      rate: ${distance} > 0 ? Number(((before[i] - after[i]) / ${distance}).toFixed(3)) : null,
      fixed: getComputedStyle(el).position === 'fixed',
    })),
  });
})()`;

/* What the page cost to load, and what it loaded and then did not use. The
 * unused-library check is deliberately narrow: each entry names a global that
 * only exists if the script ran, and a test that is true only if something
 * actually used it. A library present and idle is the most expensive kind of
 * dead code, because it is in the critical path. */
const COST = `(() => {
  const resources = performance.getEntriesByType('resource');
  const bytes = (entry) => entry.transferSize || entry.encodedBodySize || 0;
  const total = resources.reduce((sum, entry) => sum + bytes(entry), 0);
  const nav = performance.getEntriesByType('navigation')[0] || null;
  const idle = [];
  const check = (name, present, used) => {
    let here = false, active = false;
    try { here = Boolean(present()); } catch (err) { here = false; }
    if (!here) return;
    try { active = Boolean(used()); } catch (err) { active = false; }
    if (!active) idle.push(name);
  };
  check('GSAP', () => window.gsap, () => window.gsap.globalTimeline.getChildren(true, true, true).length || (window.ScrollTrigger && window.ScrollTrigger.getAll().length));
  // three is normally an ES module behind an import map, so window.THREE does
  // not exist even when the page is 160 KB heavier for it. Ask the network log
  // whether it was fetched instead of asking the global scope.
  const fetched = (pattern) => resources.some((entry) => pattern.test(entry.name));
  check('three.js', () => window.THREE || fetched(/three(\\.module)?(\\.min)?\\.js|three@/i),
    () => [...document.querySelectorAll('canvas')].some((c) => /webgl/.test(c.__inspectContext || '')));
  check('Lenis', () => window.Lenis, () => window.__lenis || document.documentElement.classList.contains('lenis'));
  check('anime.js', () => window.anime, () => window.anime.running && window.anime.running.length);
  check('Lottie', () => window.lottie, () => window.lottie.getRegisteredAnimations && window.lottie.getRegisteredAnimations().length);
  check('Matter.js', () => window.Matter, () => window.__matterEngine);
  check('PixiJS', () => window.PIXI, () => document.querySelector('canvas'));
  const heavy = resources
    .map((entry) => ({ url: entry.name.split('/').pop().slice(0, 48), kb: Math.round(bytes(entry) / 1024), type: entry.initiatorType }))
    .filter((entry) => entry.kb > 0)
    .sort((a, b) => b.kb - a.kb)
    .slice(0, 6);
  const measure = window.__measure || { longTasks: [], shifts: 0 };
  return JSON.stringify({
    requests: resources.length,
    totalKb: Math.round(total / 1024),
    scriptKb: Math.round(resources.filter((entry) => entry.initiatorType === 'script').reduce((sum, entry) => sum + bytes(entry), 0) / 1024),
    imageKb: Math.round(resources.filter((entry) => entry.initiatorType === 'img' || entry.initiatorType === 'css').reduce((sum, entry) => sum + bytes(entry), 0) / 1024),
    heavy,
    idleLibraries: idle,
    domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
    loadMs: nav ? Math.round(nav.loadEventEnd) : null,
    longTasks: measure.longTasks.length,
    longestTaskMs: measure.longTasks.length ? Math.max.apply(null, measure.longTasks) : 0,
    layoutShift: Number((measure.shifts || 0).toFixed(3)),
    nodes: document.getElementsByTagName('*').length,
  });
})()`;

/* Typography and ground, as computed values. Not taste - counts. A scale has a
 * handful of steps; a page with twenty distinct sizes has no scale, it has
 * twenty decisions nobody made together. */
const TYPE = `(() => {
  const sizes = new Map();
  const families = new Map();
  const colours = new Map();
  let measured = null;
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
  };
  for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,a,span,blockquote,figcaption,dt,dd,button,label')) {
    const text = (el.textContent || '').trim();
    if (!text || !visible(el)) continue;
    const own = [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim());
    if (!own) continue;
    const style = getComputedStyle(el);
    const size = Math.round(parseFloat(style.fontSize));
    sizes.set(size, (sizes.get(size) || 0) + 1);
    const family = style.fontFamily.split(',')[0].replace(/["']/g, '').trim();
    families.set(family, (families.get(family) || 0) + 1);
    colours.set(style.color, (colours.get(style.color) || 0) + 1);
    if (el.tagName === 'P' && text.length > 120 && measured === null) {
      // Characters per line, from the width the paragraph actually occupies
      // and the width one character actually takes.
      const probe = document.createElement('span');
      probe.textContent = 'abcdefghijklmnopqrstuvwxyz';
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:' + style.font;
      document.body.appendChild(probe);
      const per = probe.getBoundingClientRect().width / 26;
      probe.remove();
      if (per > 0) measured = Math.round(el.getBoundingClientRect().width / per);
    }
  }
  const body = getComputedStyle(document.body);
  const ordered = [...sizes.entries()].sort((a, b) => b[0] - a[0]);
  return JSON.stringify({
    distinctSizes: sizes.size,
    largestPx: ordered.length ? ordered[0][0] : null,
    smallestPx: ordered.length ? ordered[ordered.length - 1][0] : null,
    scale: ordered.slice(0, 12).map((entry) => entry[0]),
    families: [...families.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map((entry) => entry[0]),
    distinctTextColours: colours.size,
    measureChars: measured,
    background: body.backgroundColor,
    colour: body.color,
    fontsLoaded: document.fonts ? document.fonts.status : 'unknown',
  });
})()`;

async function evaluate(session, expression, awaitPromise) {
  const result = await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: Boolean(awaitPromise) });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'measurement failed');
  const value = result.result && result.result.value;
  if (typeof value !== 'string') throw new Error('measurement returned no report');
  return JSON.parse(value);
}

export async function measure(session, options = {}) {
  const { motionMs = 1600, depthDistance = 700 } = options;
  const out = {};
  out.motion = await evaluate(session, MOTION(motionMs), true).catch((err) => ({ error: err.message }));
  out.depth = await evaluate(session, DEPTH(depthDistance), true).catch((err) => ({ error: err.message }));
  out.cost = await evaluate(session, COST, false).catch((err) => ({ error: err.message }));
  out.type = await evaluate(session, TYPE, false).catch((err) => ({ error: err.message }));
  return out;
}

/* The thresholds, in one place, with the reason next to each. They are stated
 * as numbers so they can be argued with, which is the point: a report that says
 * "feels slow" cannot be checked and a report that says "38 fps, budget 55"
 * can. */
export const BUDGETS = {
  fps: 55,
  droppedRatio: 0.1,
  longestTaskMs: 200,
  layoutShift: 0.1,
  scriptKb: 500,
  totalKb: 2500,
  distinctSizes: 8,
  measureChars: [45, 80],
  depthSpread: 0.08,
};

export function judge(measured, context = {}) {
  const findings = [];
  const note = (level, text, detail) => findings.push({ level, text, detail: detail || null });
  const motion = measured.motion || {};
  const depth = measured.depth || {};
  const cost = measured.cost || {};
  const type = measured.type || {};

  if (motion.error) note('note', 'motion could not be measured: ' + motion.error);
  else {
    const animated = (motion.canvases || []).filter((canvas) => canvas.animating === true).length;
    const still = (motion.canvases || []).filter((canvas) => canvas.animating === false).length;
    if (motion.reducedMotion) {
      // Under reduced motion the right answer is the opposite one.
      if (animated) note('error', animated + ' canvas still animating under prefers-reduced-motion', 'draw one frame and stop');
      else if (still) note('ok', still + ' canvas correctly still under reduced motion');
    } else {
      if (still) note('warn', still + ' canvas painted once and never changed', 'if it is meant to be alive, it is not');
      if (animated) note('ok', animated + ' canvas is animating');
      if (Number.isFinite(motion.fps) && motion.fps < BUDGETS.fps) {
        note('error', 'median ' + motion.fps + ' fps, under the ' + BUDGETS.fps + ' budget', 'worst frame ' + motion.worstFrameMs + ' ms');
      } else if (Number.isFinite(motion.fps) && motion.fps > 120) {
        // Headless Chrome does not lock rAF to a display, so a number like this
        // is the ceiling the work leaves room for, not the rate anyone sees.
        // The frame that took longest is the honest half of this measurement.
        note('ok', 'frames cost ' + Math.round(1000 / motion.fps) + ' ms each (no vsync headless, so read the worst frame: ' + motion.worstFrameMs + ' ms)');
      } else if (Number.isFinite(motion.fps)) {
        note('ok', motion.fps + ' fps median');
      }
      if (motion.frames && motion.dropped / motion.frames > BUDGETS.droppedRatio) {
        note('warn', Math.round((motion.dropped / motion.frames) * 100) + '% of frames took over 32 ms');
      }
    }
  }

  if (depth.error) note('note', 'parallax could not be measured: ' + depth.error);
  else if ((depth.planes || []).length) {
    // A plane whose rate did not come back as a number was not measured, and
    // an unmeasured plane cannot fail: JSON turns NaN into null across the
    // page boundary, and null.toFixed() was a crash after a full browser run.
    const moving = depth.planes.filter((plane) => !plane.fixed && Number.isFinite(plane.rate));
    const rates = moving.map((plane) => plane.rate);
    const spread = rates.length ? Math.max.apply(null, rates) - Math.min.apply(null, rates) : 0;
    // Only planes that declared a depth are failing a promise. A page with two
    // elements happening to be called .layer is not making one, and an ERROR
    // there is the kind of false positive that gets a checker ignored.
    //
    // And the verdict on the promised planes is measured on the promised
    // planes: judging them by a spread that included the unlabelled ones let
    // a decorative .layer that happened to move hide two declared planes that
    // did not, and the reverse.
    const promised = moving.filter((plane) => plane.promises !== false);
    const promisedRates = promised.map((plane) => plane.rate);
    const promisedSpread = promisedRates.length ? Math.max.apply(null, promisedRates) - Math.min.apply(null, promisedRates) : 0;
    if (promised.length >= 2 && promisedSpread < BUDGETS.depthSpread) {
      note(
        'error',
        promised.length + ' declared planes all move at the same rate (' + promisedRates[0].toFixed(2) + ')',
        'the parallax is in the markup but not on the screen'
      );
    } else if (moving.length >= 2 && spread < BUDGETS.depthSpread) {
      note('note', moving.length + ' layer-like elements move together; none of them declares a depth');
    } else if (moving.length >= 2) {
      note('ok', moving.length + ' planes at ' + rates.map((rate) => rate.toFixed(2)).join(' / ') + ' (1.00 is page speed)');
    }
    for (const plane of depth.planes) {
      if (plane.declared !== null && plane.declared !== 0 && !plane.fixed && Math.abs(plane.rate - 1) < 0.02) {
        note('warn', 'plane "' + plane.name + '" declares depth ' + plane.declared + ' but moves at page speed');
      }
    }
  } else if (context.expectDepth) {
    note('warn', 'no parallax planes found', 'the house style layers foreground, middle and background');
  }

  // A probe that came back without a field is not a probe that measured zero.
  // Reading `.length` off a missing idleLibraries threw right here, which turned
  // an incomplete measurement into a crash instead of a quiet omission.
  if (!cost.error && Number.isFinite(cost.requests)) {
    const idle = cost.idleLibraries || [];
    if (idle.length) {
      note('error', 'loaded and never used: ' + idle.join(', '), 'this is bytes in the critical path buying nothing');
    }
    if (cost.scriptKb > BUDGETS.scriptKb) note('warn', cost.scriptKb + ' KB of script (budget ' + BUDGETS.scriptKb + ' KB)');
    if (cost.totalKb > BUDGETS.totalKb) note('warn', cost.totalKb + ' KB transferred over ' + cost.requests + ' requests');
    if (cost.longestTaskMs > BUDGETS.longestTaskMs) note('warn', 'longest main-thread task ' + cost.longestTaskMs + ' ms', 'the page cannot respond during it');
    if (cost.layoutShift > BUDGETS.layoutShift) note('warn', 'layout shift ' + cost.layoutShift + ' (budget ' + BUDGETS.layoutShift + ')');
    if (!idle.length && cost.scriptKb <= BUDGETS.scriptKb && cost.layoutShift <= BUDGETS.layoutShift) {
      note('ok', cost.totalKb + ' KB over ' + cost.requests + ' requests, no idle libraries, no shift');
    }
  }

  if (!type.error) {
    if (type.distinctSizes > BUDGETS.distinctSizes) {
      note('warn', type.distinctSizes + ' distinct type sizes', 'a scale has a handful of steps: ' + (type.scale || []).join(', '));
    } else if (type.distinctSizes) {
      note('ok', type.distinctSizes + ' type sizes, largest ' + type.largestPx + 'px');
    }
    if (Number.isFinite(type.measureChars)) {
      const [low, high] = BUDGETS.measureChars;
      if (type.measureChars > high) note('warn', 'body measure is ' + type.measureChars + ' characters (over ' + high + ' is hard to track)');
      else if (type.measureChars < low) note('warn', 'body measure is only ' + type.measureChars + ' characters');
      else note('ok', 'body measure ' + type.measureChars + ' characters');
    }
    if (Number.isFinite(type.largestPx) && type.largestPx < 40) {
      note('warn', 'largest type on the page is ' + type.largestPx + 'px', 'the house style opens at display scale');
    }
    if (type.distinctTextColours > 6) note('warn', type.distinctTextColours + ' distinct text colours');
  }

  return findings;
}

export function formatQuality(measured, findings) {
  const lines = [];
  const errors = findings.filter((finding) => finding.level === 'error').length;
  const warns = findings.filter((finding) => finding.level === 'warn').length;
  for (const finding of findings) {
    const tag = finding.level === 'error' ? 'ERROR' : finding.level === 'warn' ? 'warn ' : finding.level === 'ok' ? 'ok   ' : 'note ';
    lines.push('  ' + tag + ' ' + finding.text + (finding.detail ? '\n           ' + finding.detail : ''));
  }
  return { lines: lines.join('\n'), errors, warns };
}
