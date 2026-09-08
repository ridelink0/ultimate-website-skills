import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { debugSite } from '../scripts/debug.mjs';
import { Session, findBrowser, inspect } from '../scripts/inspect.mjs';
import { writeReview } from '../scripts/review.mjs';
import { runVerify } from '../scripts/verify.mjs';
import { startServer } from '../scripts/preview-server.mjs';

test('CDP synchronous send failure removes pending requests', async () => {
  const s = new Session({ send() { throw new Error('socket unavailable'); }, close() {} });
  await assert.rejects(s.send('Page.enable'), /socket unavailable/);
  assert.equal(s.waiting.size, 0);
});
test('closing CDP rejects pending operations immediately', async () => {
  const s = new Session({ send() {}, close() {} });
  const result = s.send('Page.enable');
  s.close();
  await assert.rejects(result, /session closed/); assert.equal(s.waiting.size, 0);
});
test('empty viewport lists fail instead of producing a false clean report', async () => {
  await assert.rejects(inspect('http://localhost', { widths: [] }), /Widths/);
});
test('HTML review escapes untrusted target text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-escape-'));
  try {
    const result = writeReview([], dir, '<script>alert(1)</script>');
    assert.ok(readFileSync(result.file, 'utf8').includes('&lt;script&gt;'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('real browser captures scroll, interaction, reduced motion and canvas evidence', { skip: !findBrowser(), timeout: 60000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'visual-debug-'));
  try {
    const html = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:24px;background:#eeeeee;color:#222222;font:18px system-ui}main{height:2400px}button{padding:14px}canvas{display:block;width:200px;height:120px;margin-top:24px}#panel[hidden]{display:none}@media(prefers-reduced-motion:reduce){body{scroll-behavior:auto}}</style><main><h1>Visual fixture</h1><button id="toggle" onclick="document.querySelector(\'#panel\').hidden=false">Open details</button><p id="panel" hidden>Interaction passed</p><canvas width="200" height="120"></canvas><canvas id="gl" width="200" height="120"></canvas></main><script>const ctx=document.querySelector("canvas").getContext("2d");ctx.fillStyle="#305d89";ctx.fillRect(0,0,200,120);ctx.fillStyle="#e8be64";ctx.fillRect(30,20,100,60);const gl=document.querySelector("#gl").getContext("webgl",{preserveDrawingBuffer:true});gl.clearColor(0.2,0.4,0.6,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.enable(gl.SCISSOR_TEST);gl.scissor(30,20,100,60);gl.clearColor(0.9,0.6,0.2,1);gl.clear(gl.COLOR_BUFFER_BIT);</script></html>';
    writeFileSync(join(dir, 'index.html'), html);
    const result = await debugSite(dir, { out: join(dir, 'review'), widths: [800], wait: 20, motion: 'both', actions: [{ type: 'click', selector: '#toggle' }, { type: 'expect-visible', selector: '#panel' }, { type: 'expect-text', selector: '#panel', text: 'Interaction passed' }] });
    assert.equal(result.results.length, 12);
    assert.ok(result.results.some(r => r.scroll > 1000));
    assert.ok(result.results.some(r => r.visual?.reducedMotion === true));
    assert.ok(result.results.some(r => r.visual?.canvases?.filter(c => c.uniform === false).length === 2));
    assert.equal(result.results.flatMap(r => r.actionErrors || []).length, 0);
    assert.ok(result.results.every(r => readFileSync(r.file).length > 100));
    assert.ok(readFileSync(result.file, 'utf8').includes('Website visual review'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('a browser network error never becomes a passing inspection', { skip: !findBrowser(), timeout: 30000 }, async () => {
  await assert.rejects(inspect('http://127.0.0.1:1/', { widths: [800], wait: 0 }), /Navigation failed/);
});

test('post-click exceptions, HTTP errors and visually hidden assertions fail the review', { skip: !findBrowser(), timeout: 30000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'visual-negative-'));
  try {
    writeFileSync(join(dir, 'index.html'), '<!doctype html><html><meta name="viewport" content="width=device-width"><button style="padding:20px" id="fail">Run</button><div style="opacity:0"><p id="secret">Hidden text</p></div><script>document.querySelector("#fail").onclick=()=>{fetch("/missing-data.json");throw new Error("click regression");};</script></html>');
    const result = await debugSite(dir, { out: join(dir, 'review'), widths: [800], wait: 20, motion: 'normal', scrolls: [0], actions: [{ type: 'click', selector: '#fail' }, { type: 'expect-visible', selector: '#secret' }] });
    assert.ok(result.results.some(r => r.console?.some(c => c.text.includes('click regression'))));
    assert.ok(result.results.some(r => r.network?.some(n => n.error.includes('HTTP 404'))));
    assert.ok(result.results.some(r => r.actionErrors?.some(e => e.includes('not visible'))));
    assert.ok(result.errors >= 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// bgOf() correctly gives up the moment it meets a background-image - a flat
// linear-gradient counts, same as a photo - so this is exactly the case the
// solid-colour contrast path could never see. Two boxes with the same "image"
// background: one text colour illegible against it, one legible. Only the
// illegible one should be reported, and it must say it came from the sample.
test('contrast against an image background is measured from the actual pixels', { skip: !findBrowser(), timeout: 30000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'visual-photo-contrast-'));
  try {
    const html = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<div style="background:linear-gradient(#141414,#141414);padding:32px"><h2 style="color:#262626;font-size:16px;margin:0">Barely there</h2></div>' +
      '<div style="background:linear-gradient(#141414,#141414);padding:32px"><h2 style="color:#f5f5f5;font-size:16px;margin:0">Perfectly legible</h2></div>' +
      '</html>';
    writeFileSync(join(dir, 'index.html'), html);
    const result = await debugSite(dir, { widths: [800], wait: 60, motion: 'normal', scrolls: [0] });
    const found = result.results[0].contrast;
    const bad = found.find(c => c.el.includes('Barely there'));
    const good = found.find(c => c.el.includes('Perfectly legible'));
    assert.ok(bad, 'the illegible heading on the image background must be reported: ' + JSON.stringify(found));
    assert.equal(bad.method, 'photo');
    assert.ok(bad.ratio < bad.need);
    assert.equal(good, undefined, 'the legible heading must not be flagged');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// verify's whole point is reconciling audit + render/quality + security into
// one verdict. A page with a source-only defect (audit), a render defect
// (contrast) and nothing wrong with security should end up with an error in
// both of the first two sections, a clean third, and one exit code covering
// all of it.
test('verify merges audit, render and security into one verdict with one exit code', { skip: !findBrowser(), timeout: 30000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'verify-merge-'));
  try {
    // no <main>/<section>/<article> -> an audit ERROR; #222 on #141414 -> a
    // render/contrast warning; nothing here trips a high-severity security rule.
    writeFileSync(join(dir, 'index.html'),
      '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
      '<title>Verify fixture</title><meta name="description" content="A fixture page long enough to pass the meta-description length check comfortably.">' +
      '<h1>Verify fixture</h1><div style="background:#141414;padding:24px"><p style="color:#222222">low contrast</p></div></html>');
    const result = await runVerify(dir, { widths: [800], wait: 60 });
    assert.equal(result.exitCode, 1);
    assert.ok(result.sections.audit.errors >= 1, 'audit should flag the missing <main>/<section>/<article>');
    assert.ok(result.sections.render.warns >= 1, 'render should flag the low-contrast text on the dark box');
    assert.ok(!result.sections.security.skipped);
    assert.equal(result.totals.error, result.sections.audit.errors + result.sections.render.errors + (result.sections.security.errors || 0));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('verify skips the source-only sections for a URL target instead of guessing', { skip: !findBrowser(), timeout: 30000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'verify-url-'));
  try {
    writeFileSync(join(dir, 'index.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>t</title><meta name="description" content="A fixture page long enough to pass the meta-description length check comfortably."><main><h1>t</h1></main></html>');
    const server = startServer(dir, 0);
    await once(server, 'listening');
    try {
      const url = 'http://127.0.0.1:' + server.address().port + '/';
      const result = await runVerify(url, { widths: [800], wait: 60 });
      assert.ok(result.sections.audit.skipped);
      assert.ok(result.sections.security.skipped);
      assert.ok(!result.sections.render.skipped);
    } finally { await new Promise((r) => server.close(r)); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The fixture above asks for preserveDrawingBuffer itself, which is why the
// check passed while every real three.js hero read as blank: no library sets
// that flag, and a composited drawing buffer reads back as transparent black.
test('a WebGL canvas that never asked for a preserved buffer still reads as rendered', { skip: !findBrowser(), timeout: 30000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'visual-webgl-'));
  try {
    writeFileSync(join(dir, 'index.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><style>canvas{display:block;width:300px;height:200px}</style><h1>WebGL</h1><canvas id="live" width="300" height="200"></canvas><canvas id="dead" width="300" height="200"></canvas><script>const gl=document.querySelector("#live").getContext("webgl");gl.clearColor(0.1,0.2,0.4,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.enable(gl.SCISSOR_TEST);gl.scissor(40,30,120,90);gl.clearColor(0.9,0.7,0.3,1);gl.clear(gl.COLOR_BUFFER_BIT);</script></html>');
    const result = await debugSite(dir, { out: join(dir, 'review'), widths: [800], wait: 60, motion: 'normal', scrolls: [0] });
    const canvases = result.results[0].visual.canvases;
    const live = canvases.find(c => c.context === 'webgl' && c.uniform === false);
    assert.ok(live, 'a painted WebGL canvas must not read as a flat fill: ' + JSON.stringify(canvases));
    assert.ok(live.spread > 20, 'spread should measure the real range, got ' + live.spread);
    assert.equal(canvases.filter(c => c.uniform === true).length, 1, 'the untouched canvas must still be reported flat');
    assert.ok(canvases.every(c => c.readable === true));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
