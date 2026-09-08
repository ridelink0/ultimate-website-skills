import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { securityAudit, formatSecurity, headersConfig } from '../scripts/security.mjs';

function site(files) {
  const dir = mkdtempSync(join(tmpdir(), 'security-'));
  for (const [name, text] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, text);
  }
  return dir;
}
const texts = (r, level) => r.findings.filter((f) => !level || f.level === level).map((f) => f.text);

test('a leaked live key is high, and the fix says rotate', () => {
  // Assembled here so no key-shaped literal is ever committed (GitHub push
  // protection reads the diff); the fixture on disk is contiguous.
  const dir = site({ 'app.js': 'const stripe = "' + 'sk_live_' + 'x'.repeat(24) + '";' });
  try {
    const r = securityAudit(dir);
    assert.ok(texts(r, 'high').some((t) => /Stripe live secret key/.test(t)));
    assert.match(r.findings[0].fix, /ROTATE/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a publishable key, a content hash and a data URI are not secrets', () => {
  const dir = site({ 'index.html': '<script>const pk="pk_live_51H1234567890abcdefghijklmnop";</script><img src="data:image/png;base64,' + 'A'.repeat(200) + '"><script src="https://cdn.example.com/x.js" integrity="sha384-' + 'B'.repeat(64) + '" crossorigin="anonymous"></script>' });
  try {
    const r = securityAudit(dir);
    assert.equal(texts(r, 'high').length, 0, JSON.stringify(r.findings));
    assert.ok(!texts(r).some((t) => /Stripe/.test(t)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('files that must never ship are found by their presence alone', () => {
  const dir = site({ '.env': 'SECRET=1', 'main.js.map': '{}', 'index.html': '<h1>x</h1>' });
  try {
    const r = securityAudit(dir);
    assert.ok(texts(r, 'high').some((t) => /environment file/.test(t)));
    assert.ok(texts(r, 'medium').some((t) => /source map/.test(t)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a form that sends personal data over GET, to http, with no privacy link, is three findings', () => {
  const dir = site({ 'index.html': '<form action="http://example.com/send"><input type="email" name="e"><button>Go</button></form>' });
  try {
    const t = texts(securityAudit(dir));
    assert.ok(t.some((x) => /personal data with GET/.test(x)));
    assert.ok(t.some((x) => /posts to plain http/.test(x)));
    assert.ok(t.some((x) => /links no privacy policy/.test(x)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a correct form raises nothing about itself', () => {
  const dir = site({ 'index.html': '<a href="/privacy">Privacy</a><form method="post" action="https://example.com/send" data-netlify="true" netlify-honeypot="bot-field"><input type="email" name="e"></form>' });
  try {
    assert.equal(texts(securityAudit(dir)).filter((x) => /form/i.test(x)).length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CDN scripts are pinned or flagged; font CSS is exempt from integrity; import maps want an integrity block', () => {
  const dir = site({ 'index.html': [
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader">',
    '<script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>',
    '<script src="https://cdn.jsdelivr.net/npm/lenis@1.3.26/dist/lenis.min.js" integrity="sha384-abc"></script>',
    '<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js"}}</script>',
  ].join('\n') });
  try {
    const t = texts(securityAudit(dir));
    assert.ok(t.some((x) => /gsap|cdn\.jsdelivr\.net without integrity/.test(x)));
    assert.ok(t.some((x) => /integrity without crossorigin/.test(x)));
    assert.ok(t.some((x) => /import map.*no "integrity"/.test(x)));
    assert.ok(t.some((x) => /fonts served from Google/.test(x)));
    assert.ok(!t.some((x) => /stylesheet from fonts\.googleapis\.com without integrity/.test(x)), 'font CSS cannot carry a hash and must not be asked to');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('client-side holes: innerHTML from a variable, postMessage to *, an unchecked message listener, mixed content', () => {
  const dir = site({ 'index.html': '<img src="http://example.com/a.png"><svg xmlns="http://www.w3.org/2000/svg"></svg><a target="_blank" href="/x">x</a><button onclick="go()">go</button>',
    'app.js': 'el.innerHTML = location.hash; el.innerHTML = "<b>ok</b>"; window.postMessage(data, "*"); addEventListener("message", (e) => { use(e.data); });' });
  try {
    const t = texts(securityAudit(dir));
    assert.equal(t.filter((x) => /innerHTML assigned from a non-literal/.test(x)).length, 1, 'the literal assignment is fine');
    assert.ok(t.some((x) => /postMessage to any origin/.test(x)));
    assert.ok(t.some((x) => /message listener with no origin check/.test(x)));
    assert.equal(t.filter((x) => /plain-http resource/.test(x)).length, 1, 'the xmlns is a namespace, not a fetch');
    assert.ok(t.some((x) => /target="_blank" without rel="noopener"/.test(x)));
    assert.ok(t.some((x) => /inline event handler/.test(x)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a message listener that checks the origin is not flagged', () => {
  const dir = site({ 'app.js': 'addEventListener("message", (e) => { if (e.origin !== "https://a.example") return; use(e.data); });' });
  try {
    assert.ok(!texts(securityAudit(dir)).some((x) => /message listener/.test(x)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('header configuration is read from netlify.toml and each missing header is named', () => {
  const dir = site({ 'index.html': '<h1>x</h1>', 'netlify.toml': '[[headers]]\n  for = "/*"\n  [headers.values]\n    X-Content-Type-Options = "nosniff"\n' });
  try {
    const cfg = headersConfig(dir);
    assert.equal(cfg.nosniff, true);
    assert.equal(cfg.csp, false);
    const t = texts(securityAudit(dir));
    assert.ok(t.some((x) => /no Content-Security-Policy/.test(x)));
    assert.ok(t.some((x) => /nothing forbids framing/.test(x)));
    assert.ok(!t.some((x) => /nosniff/.test(x)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('no header configuration at all is one finding, not six', () => {
  const dir = site({ 'index.html': '<h1>x</h1>' });
  try {
    const t = texts(securityAudit(dir)).filter((x) => /header/i.test(x));
    assert.equal(t.length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the report exits on high only and always lists the live checks', () => {
  const dir = site({ 'index.html': '<h1>clean</h1>', 'netlify.toml': '[[headers]]\n for="/*"\n [headers.values]\n Content-Security-Policy="frame-ancestors \'none\'"\n Strict-Transport-Security="max-age=1"\n X-Content-Type-Options="nosniff"\n Referrer-Policy="no-referrer"\n Permissions-Policy="camera=()"\n' });
  try {
    const shown = formatSecurity(securityAudit(dir), 'clean');
    assert.equal(shown.high, 0);
    assert.match(shown.text, /\.git\/HEAD/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
