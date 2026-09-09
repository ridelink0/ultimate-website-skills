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

/* Everything a fixture raised, flattened into one sorted list. Asserting on
   this rather than on a single count is the difference between a corpus and a
   pile of pages: a fixture that is meant to be broken in exactly one way but
   quietly also trips contrast and overlap teaches a checker nothing, and a
   "clean" fixture that raises two findings is itself a false positive nobody
   would notice. Both of those were true of this corpus when it was written. */
const findings = (r) => [
  ...r.overlaps.map(() => 'layout: text over text'),
  ...r.offscreen.map((o) => 'layout: wider than the viewport - ' + o.el),
  ...r.overflow.map((o) => 'layout: past the viewport - ' + o.what),
  ...r.contrast.map((c) => `contrast: ${c.ratio}:1 needs ${c.need} - ${c.el}`),
  ...r.collapsed.map((c) => 'layout: collapsed - ' + c.el),
  ...r.broken.map((b) => 'asset: broken - ' + b.el),
  ...r.tiny.map((t) => 'layout: tap target - ' + t.el),
  ...judge(r.measured).filter((f) => f.level !== 'ok').map((f) => f.level + ': ' + f.text),
].sort();

// Asserts the COMPLETE finding set, in sorted order: nothing named is missing
// and nothing else is there.
const raises = (r, ...expected) => {
  const got = findings(r);
  assert.equal(got.length, expected.length, 'fixture raised ' + JSON.stringify(got, null, 1));
  expected.forEach((re, i) => assert.match(got[i], re, 'fixture raised ' + JSON.stringify(got, null, 1)));
};

test('text overlapping text is caught, and only on the page that has it', { skip, timeout: 30000 }, async () => {
  raises(await measured('overlap.html'), /^layout: text over text$/);
  raises(await measured('clean-basic.html'));
});

test('content past the viewport is caught at 390px, and is gone at a width that fits it', { skip, timeout: 30000 }, async () => {
  raises(await measured('overflow-390.html', { widths: [390] }), /^layout: past the viewport - div/);
  // The same 600px-wide box fits inside 1440, so the finding has to disappear
  // entirely rather than change wording: an overflow check that fires at every
  // width is not measuring overflow.
  raises(await measured('overflow-390.html', { widths: [1440] }));
});

test('a canvas painted once reads as not animating', { skip, timeout: 30000 }, async () => {
  const r = await measured('canvas-once.html');
  assert.equal(r.measured.motion.canvases[0].animating, false);
  raises(r, /^warn: 1 canvas painted once/);
});

// The bug the multi-sample fingerprint fix exists for: two samples, spaced far
// enough apart, can both land on the same phase of a short loop and read a
// genuinely animating canvas as dead. Sampling five times through the window
// is what tells a blink from a still image.
test('a two-state blink is recognised as animating, not mistaken for a still image', { skip, timeout: 30000 }, async () => {
  const r = await measured('canvas-blink.html', { wait: 200 });
  assert.equal(r.measured.motion.canvases[0].animating, true);
  raises(r);
});

test('three data-depth planes with no engine behind them all move at the page rate, and it is flagged', { skip, timeout: 30000 }, async () => {
  const r = await measured('planes-same-rate.html');
  const rates = r.measured.depth.planes.map((p) => p.rate);
  assert.ok(rates.every((rate) => Math.abs(rate - 1) < 0.05), 'undriven planes should all read page rate: ' + JSON.stringify(rates));
  // The one defect, said once for the scene and once per plane, and nothing
  // else: the page is otherwise a legible, well-sized, non-overlapping layout.
  raises(r,
    /^error: 3 declared planes all move at the same rate/,
    /^warn: plane "0\.2" declares depth/,
    /^warn: plane "0\.5" declares depth/,
    /^warn: plane "0\.8" declares depth/);
});

test('three data-depth planes that really move at different rates are not flagged', { skip, timeout: 30000 }, async () => {
  const r = await measured('clean-depth.html');
  assert.equal(r.measured.depth.planes.length, 3, 'the fixture must actually declare three planes');
  raises(r);
});

test('a library loaded and never called is reported idle, and the same library actually running is not', { skip, timeout: 30000 }, async () => {
  const idle = await measured('idle-library.html');
  assert.ok(idle.measured.cost.idleLibraries.includes('GSAP'));
  raises(idle, /^error: loaded and never used: GSAP$/);
  const used = await measured('clean-library-used.html');
  assert.ok(!used.measured.cost.idleLibraries.includes('GSAP'));
  raises(used);
});

test('twenty distinct type sizes is over budget and named as such', { skip, timeout: 30000 }, async () => {
  const r = await measured('type-sizes-20.html');
  assert.equal(r.measured.type.distinctSizes, 20);
  assert.ok(r.measured.type.distinctSizes > BUDGETS.distinctSizes);
  // Twenty sizes topping out at 31px has a second, honest consequence: there
  // is no display size on the page at all. Both are named, and nothing else.
  raises(r, /^warn: 20 distinct type sizes$/, /^warn: largest type on the page is 31px$/);
});

test('a measure past the readable width is over budget and named as such', { skip, timeout: 30000 }, async () => {
  const r = await measured('measure-140.html');
  assert.ok(r.measured.type.measureChars > BUDGETS.measureChars[1],
    'fixture should measure well past the ' + BUDGETS.measureChars[1] + '-character budget, got ' + r.measured.type.measureChars);
  raises(r, /^warn: body measure is 1\d\d characters/);
});

test('a page with nothing wrong raises nothing', { skip, timeout: 30000 }, async () => {
  const r = await measured('clean-basic.html');
  assert.equal(r.measured.type.distinctSizes <= BUDGETS.distinctSizes, true);
  raises(r);
});

/* ------------------------------------------------ design parity fixtures --- */
/* Same discipline as the corpus above: one artboard, two implementations, and
   an assertion on the COMPLETE finding set. The match fixture is the important
   half - a parity check that cries wolf on a correct page is worse than no
   check at all, because it would send an agent off to damage work that was
   right. The drift fixture is named for exactly two things, and must report
   those two and nothing else. */

const DESIGN = join(FIXTURES, 'design');
const CANVAS = join(DESIGN, 'artboard-canvas.html');
const parity = async (impl, opts = {}) => {
  const { runParity } = await import('../scripts/parity.mjs');
  return runParity(join(DESIGN, impl), CANVAS, { wait: 1200, ...opts });
};
const texts = (result) => result.findings.map((f) => f.severity + ': ' + f.text).sort();

test('an implementation that kept the design reports no delta at all', { skip, timeout: 90000 }, async () => {
  const r = await parity('match');
  // Proof the artboard was what got measured. The canvas top document has four
  // toolbar labels; the design inside the frame has five text elements.
  assert.match(r.design.frame, /srcdoc/, 'parity must read the artboard frame, not the editor page');
  assert.equal(r.design.textElements, 5);
  assert.deepEqual(texts(r), []);
  assert.equal(r.errors, 0);
});

test('an implementation rebuilt in the house style reports exactly its type-scale and palette delta', { skip, timeout: 90000 }, async () => {
  const r = await parity('drift');
  assert.deepEqual(texts(r), [
    'error: this page does not implement the supplied design: 3 of 3 type sizes and 2 of 2 text colours are absent from it. A supplied design is preserved, not rebuilt in the house style.',
    'note: the design uses 48px, 20px, 16px; the page does not',
    // The ground is a warning, not a note, because it covers the whole page:
    // severity follows the area an off-palette colour actually paints.
    'warning: 1 background colour is not in the design: rgb(12, 10, 3) (covering 100% of what the page paints)',
    'warning: 2 text colours are not in the design: rgb(154, 154, 154), rgb(232, 196, 106)',
    'warning: 3 type sizes are not in the design: 30px, 13px, 11px',
    "warning: the largest type on the page is 30px; the design's is 48px",
    "warning: the largest type on the page is rgb(232, 196, 106); the design's is rgb(180, 83, 9)",
  ]);
  assert.equal(r.errors, 1);
});

test('a page whose palette is written in oklch matches a design written in hex', { skip, timeout: 90000 }, async () => {
  // The false positive this check can least afford. getComputedStyle returns
  // oklch() verbatim, so before the probes converted colours to sRGB, a page
  // carrying the design's exact colours was told three of them were "not in
  // the design" - and the plugin's own core.css is written in oklch, so every
  // page built in the house style hit it.
  const r = await parity('oklch');
  assert.deepEqual(texts(r), []);
  assert.equal(r.errors, 0);
});

test('a drifted display line is named even though a headline is used exactly once', { skip, timeout: 90000 }, async () => {
  // Only the h1 changed: 48px amber to 28px teal. The stray filter used to
  // drop both values before the comparison, which exempted the single element
  // a design is most about from the entire check.
  const r = await parity('hero-drift');
  assert.deepEqual(texts(r), [
    'note: 1 text colour is not in the design: rgb(63, 208, 201)',
    'note: 1 type size is not in the design: 28px',
    'note: the design uses 48px; the page does not',
    "warning: the largest type on the page is 28px; the design's is 48px",
    "warning: the largest type on the page is rgb(63, 208, 201); the design's is rgb(180, 83, 9)",
  ]);
  assert.equal(r.errors, 0);
});

test('measuring a canvas without frame awareness reads the editor chrome, not the design', { skip, timeout: 90000 }, async () => {
  // The failure this whole design exists to prevent, demonstrated rather than
  // described: aimed at the top document, the same correct implementation that
  // matches perfectly above now "fails" against a toolbar.
  const r = await parity('match', { frame: 'document' });
  assert.equal(r.design.frame, 'document');
  assert.equal(r.design.textElements, 4, 'the canvas top document is the toolbar');
  assert.ok(r.findings.length > 0, 'measuring the wrong frame must not look like a pass');
});

test('a bare .dc.html is refused rather than measured', { skip, timeout: 30000 }, async () => {
  const { runParity } = await import('../scripts/parity.mjs');
  await assert.rejects(
    () => runParity(join(DESIGN, 'match'), join(DESIGN, 'Main.dc.html'), { wait: 200 }),
    /not a renderable page/);
});
