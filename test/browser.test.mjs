import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { debugSite } from '../scripts/debug.mjs';
import { Session, findBrowser, inspect } from '../scripts/inspect.mjs';
import { writeReview } from '../scripts/review.mjs';

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
