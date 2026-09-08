/* The fixture corpus: small pages, each broken in exactly one way (or, for the
   "clean" set, deliberately not), driven through the real checkers. This is
   the test that would have caught the false positives and false negatives -
   every other test in this repo either exercises the judging logic on
   synthetic numbers or exercises the browser plumbing on unrelated pages;
   none of them assert that a KNOWN bug in a KNOWN fixture produces the ONE
   finding it is named for, and nothing else. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBrowser, inspect } from '../scripts/inspect.mjs';
import { judge, BUDGETS } from '../scripts/measure.mjs';
import { startServer } from '../scripts/preview-server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures');
const skip = !findBrowser();

// Every fixture is served from one directory so a relative <script src>
// (fake-lib.js) resolves, and so the whole file shares one server.
let server, base;
test.before(async () => {
  if (skip) return;
  server = startServer(FIXTURES, 0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port + '/';
});
test.after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); });

const measured = async (name, opts = {}) => {
  const [r] = await inspect(base + name, { widths: [800], wait: 200, scrolls: [0], measured: true, ...opts });
  return r;
};

test('text overlapping text is caught, and only on the page that has it', { skip, timeout: 30000 }, async () => {
  const broken = await measured('overlap.html');
  assert.ok(broken.overlaps.length >= 1, 'the two absolutely-positioned text boxes must be reported');
  const clean = await measured('clean-basic.html');
  assert.equal(clean.overlaps.length, 0);
});

test('content past the viewport is caught at 390px, and is gone at a width that fits it', { skip, timeout: 30000 }, async () => {
  const narrow = await measured('overflow-390.html', { widths: [390] });
  assert.ok(narrow.offscreen.length + narrow.overflow.length >= 1, 'the fixed-position box poking past x=390 must be reported');
  const wide = await measured('overflow-390.html', { widths: [1440] });
  assert.equal(wide.offscreen.length + wide.overflow.length, 0, 'the same 600px box fits inside 1440px');
});

test('a canvas painted once reads as not animating', { skip, timeout: 30000 }, async () => {
  const r = await measured('canvas-once.html');
  assert.equal(r.measured.motion.canvases[0].animating, false);
});

// The bug the multi-sample fingerprint fix exists for: two samples, spaced far
// enough apart, can both land on the same phase of a short loop and read a
// genuinely animating canvas as dead. Sampling five times through the window
// is what tells a blink from a still image.
test('a two-state blink is recognised as animating, not mistaken for a still image', { skip, timeout: 30000 }, async () => {
  const r = await measured('canvas-blink.html', { wait: 200 });
  assert.equal(r.measured.motion.canvases[0].animating, true);
});

test('three data-depth planes with no engine behind them all move at the page rate, and it is flagged', { skip, timeout: 30000 }, async () => {
  const r = await measured('planes-same-rate.html');
  const rates = r.measured.depth.planes.map((p) => p.rate);
  assert.ok(rates.every((rate) => Math.abs(rate - 1) < 0.05), 'undriven planes should all read page rate: ' + JSON.stringify(rates));
  const findings = judge(r.measured).filter((f) => f.level === 'error');
  assert.ok(findings.some((f) => /same rate/.test(f.text)), 'judge() must flag it: ' + JSON.stringify(findings));
});

test('three data-depth planes that really move at different rates are not flagged', { skip, timeout: 30000 }, async () => {
  const r = await measured('clean-depth.html');
  const findings = judge(r.measured);
  assert.ok(!findings.some((f) => /same rate/.test(f.text)), 'genuinely different rates must not be called flat: ' + JSON.stringify(r.measured.depth.planes));
});

test('a library loaded and never called is reported idle, and the same library actually running is not', { skip, timeout: 30000 }, async () => {
  const idle = await measured('idle-library.html');
  assert.ok(idle.measured.cost.idleLibraries.includes('GSAP'));
  const used = await measured('clean-library-used.html');
  assert.ok(!used.measured.cost.idleLibraries.includes('GSAP'));
});

test('twenty distinct type sizes is over budget and named as such', { skip, timeout: 30000 }, async () => {
  const r = await measured('type-sizes-20.html');
  assert.equal(r.measured.type.distinctSizes, 20);
  assert.ok(r.measured.type.distinctSizes > BUDGETS.distinctSizes);
  const findings = judge(r.measured).filter((f) => f.level === 'warn');
  assert.ok(findings.some((f) => /distinct type sizes/.test(f.text)));
});

test('a measure past the readable width is over budget and named as such', { skip, timeout: 30000 }, async () => {
  const r = await measured('measure-140.html');
  assert.ok(r.measured.type.measureChars > BUDGETS.measureChars[1],
    'fixture should measure well past the ' + BUDGETS.measureChars[1] + '-character budget, got ' + r.measured.type.measureChars);
  const findings = judge(r.measured).filter((f) => f.level === 'warn');
  assert.ok(findings.some((f) => /body measure is/.test(f.text)));
});

test('a page with nothing wrong raises nothing', { skip, timeout: 30000 }, async () => {
  const r = await measured('clean-basic.html');
  assert.equal(r.overlaps.length, 0);
  assert.equal(r.offscreen.length + r.overflow.length, 0);
  assert.equal(r.measured.type.distinctSizes <= BUDGETS.distinctSizes, true);
  const errors = judge(r.measured).filter((f) => f.level === 'error');
  assert.equal(errors.length, 0, JSON.stringify(errors));
});
