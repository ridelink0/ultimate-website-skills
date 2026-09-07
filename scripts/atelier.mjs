#!/usr/bin/env node
/* atelier - scaffold and audit editorial websites.
   node atelier.mjs new <dir> [--preset bone|ink|cinema] [--name "X"] [--sections a,b,c]
   node atelier.mjs sections                     list section ids
   node atelier.mjs add <id> [--to <file>]       print a section, or append it to a file
   node atelier.mjs audit <dir|file>             quality + bug check, exits 1 on error
   node atelier.mjs serve <dir> [--port 4321]    local preview
   No dependencies. Node 18+. */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, extname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(HERE, '..', 'skills', 'atelier', 'assets');

const argv = process.argv.slice(2);
const cmd = argv[0];
const positional = argv.slice(1).filter((a) => !a.startsWith('--'));
const flag = (name, def = null) => {
  const i = argv.indexOf('--' + name);
  if (i === -1) return def;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};

const die = (msg, code = 1) => { console.error('atelier: ' + msg); process.exit(code); };
const ok = (s) => `  ok    ${s}`;
const warn = (s) => `  warn  ${s}`;
const err = (s) => `  ERROR ${s}`;

/* ------------------------------------------------------------- sections -- */
function loadSections() {
  const src = readFileSync(join(ASSETS, 'sections.html'), 'utf8');
  const out = new Map();
  const re = /<!--\s*@section\s+([\w-]+)\s*\|\s*([\s\S]*?)\s*-->\s*([\s\S]*?)\s*<!--\s*@end\s*-->/g;
  let m;
  while ((m = re.exec(src))) out.set(m[1], { note: m[2].trim(), body: m[3] });
  return out;
}

/* -------------------------------------------------------------- presets -- */
// Each preset is only a token override. The chassis never changes.
const PRESETS = {
  bone: {
    label: 'bone - warm paper ground, near-black type. The default.',
    css: `:root{--accent-h:62;--bg:var(--bone-100);--fg:var(--ink-800)}`,
    tone: '',
    themeColor: '#f2efe7',
  },
  ink: {
    label: 'ink - near-black ground throughout, bone type. For objects and night subjects.',
    css: `:root{--accent-h:48}\nbody{--bg:var(--ink-950);--fg:var(--bone-300);--fg-muted:var(--sand-400);\n  --bg-raised:var(--ink-900);--rule:color-mix(in oklab,var(--bone-300) 16%,transparent);\n  --rule-soft:color-mix(in oklab,var(--bone-300) 9%,transparent);color-scheme:dark}`,
    tone: ' data-tone="dark"',
    themeColor: '#0f0b09',
  },
  cinema: {
    label: 'cinema - photography carries the page; type sits on the image.',
    css: `:root{--accent-h:196;--section-y:clamp(6rem,3.5rem+10vw,13rem)}`,
    tone: '',
    themeColor: '#0f0b09',
  },
};

const DEFAULT_SECTIONS = ['nav', 'hero-photo', 'manifesto', 'services', 'stats', 'faq', 'contact', 'footer'];

/* ------------------------------------------------------------------ new -- */
function cmdNew() {
  const dir = resolve(positional[0] || die('new needs a target directory'));
  const presetName = String(flag('preset', 'bone'));
  const preset = PRESETS[presetName] || die(`unknown preset "${presetName}". Try: ${Object.keys(PRESETS).join(', ')}`);
  const name = String(flag('name', basename(dir).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())));
  const wanted = String(flag('sections', DEFAULT_SECTIONS.join(',')))
    .split(',').map((s) => s.trim()).filter(Boolean);

  const sections = loadSections();
  const missing = wanted.filter((s) => !sections.has(s));
  if (missing.length) die(`unknown section(s): ${missing.join(', ')}\nRun "atelier.mjs sections" for the list.`);

  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'img'), { recursive: true });

  for (const f of ['core.css', 'motion.js']) writeFileSync(join(dir, f), readFileSync(join(ASSETS, f)));

  const head = sections.get('head').body
    .replace(/SITE NAME/g, name)
    .replace('#f2efe7', preset.themeColor);

  let body = wanted
    .filter((s) => s !== 'head' && s !== 'foot')
    .map((s) => sections.get(s).body.replace(/Brand Name/g, name))
    .join('\n\n');

  // Point the nav at the sections that actually exist, so the scaffold never
  // ships a link to an anchor that is not there.
  const anchors = [...new Set([...body.matchAll(/\sid=["']([\w-]+)["']/g)].map((m) => m[1]))]
    .filter((id) => id !== 'top' && id !== 'main');
  const label = (id) => id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  body = body.replace(
    /<ul class="nav__links">[\s\S]*?<\/ul>/,
    anchors.length
      ? `<ul class="nav__links">\n` +
        anchors.slice(0, 4).map((id) => `    <li><a href="#${id}">${label(id)}</a></li>`).join('\n') +
        `\n  </ul>`
      : '',
  );
  const cta = anchors.includes('contact') ? 'contact' : anchors[anchors.length - 1];
  body = cta
    ? body.replace(/(<a class="btn btn--ghost" href=")#contact(")/, `$1#${cta}$2`)
    : body.replace(/<a class="btn btn--ghost"[\s\S]*?<\/a>/, '');
  // any remaining link to a section that was not included
  body = body.replace(/href="#([\w-]+)"/g, (m, id) =>
    anchors.includes(id) || id === 'top' || id === 'main' ? m : `href="#${cta || 'top'}"`);

  const html = `<!doctype html>
<html lang="en">
<head>
${head}
</head>
<body${preset.tone}>
<main id="main">
${body}
</main>
${sections.get('foot').body}
</body>
</html>
`;

  writeFileSync(join(dir, 'index.html'), html, 'utf8');
  writeFileSync(join(dir, 'site.css'),
`/* ${name} - project layer. core.css is the chassis; every choice specific to
   this subject belongs here. Do not edit core.css. */
${preset.css}

/* Derive --accent-h from the hero photograph: take the hue of the subject's
   own material, keep the L and C above. */
`, 'utf8');
  writeFileSync(join(dir, 'netlify.toml'),
`[build]
  publish = "."

[[headers]]
  for = "/*"
  [headers.values]
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"

[[headers]]
  for = "/*.css"
  [headers.values]
    Cache-Control = "public, max-age=0, must-revalidate"

[[headers]]
  for = "/*.js"
  [headers.values]
    Cache-Control = "public, max-age=0, must-revalidate"
`, 'utf8');

  console.log(`atelier: ${relative(process.cwd(), dir) || '.'} (${presetName})`);
  console.log(`  index.html  ${wanted.join(', ')}`);
  console.log(`  core.css motion.js site.css netlify.toml`);
  console.log(`\nNext: replace every word of placeholder copy, then "node atelier.mjs audit ${dir}".`);
}

/* ----------------------------------------------------------------- list -- */
function cmdSections() {
  const s = loadSections();
  const w = Math.max(...[...s.keys()].map((k) => k.length));
  for (const [id, { note }] of s) console.log(`  ${id.padEnd(w)}  ${note}`);
  console.log(`\n  presets:`);
  for (const [id, p] of Object.entries(PRESETS)) console.log(`  ${id.padEnd(w)}  ${p.label}`);
}

function cmdAdd() {
  const id = positional[0] || die('add needs a section id');
  const s = loadSections();
  if (!s.has(id)) die(`unknown section "${id}"`);
  const block = s.get(id).body;
  const to = flag('to');
  if (!to || to === true) { console.log(block); return; }
  const p = resolve(String(to));
  const cur = existsSync(p) ? readFileSync(p, 'utf8') : '';
  // insert before </main> when there is one, else append
  const out = cur.includes('</main>')
    ? cur.replace('</main>', `\n${block}\n</main>`)
    : cur + '\n' + block + '\n';
  writeFileSync(p, out, 'utf8');
  console.log(`atelier: added "${id}" to ${relative(process.cwd(), p)}`);
}

/* ---------------------------------------------------------------- audit -- */
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;
const PLACEHOLDERS = [
  'lorem ipsum', 'site name', 'brand name', 'placeholder', 'your text here',
  'first half of the claim', 'one sentence under the headline', 'two short paragraphs',
  'the line that reframes', 'coming soon', 'tbd', 'xxx', 'foo bar',
  'describe the geometry', 'a sentence someone actually said', 'one last sentence',
  'the question a real person asks', 'say the grade, not the adjective',
];

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function cmdAudit() {
  const target = resolve(positional[0] || '.');
  if (!existsSync(target)) die(`no such path: ${target}`);
  const files = statSync(target).isDirectory() ? walk(target) : [target];
  const htmls = files.filter((f) => extname(f) === '.html');
  const csss = files.filter((f) => extname(f) === '.css');
  const jss = files.filter((f) => extname(f) === '.js');
  if (!htmls.length) die('no .html found');

  let errors = 0, warns = 0;
  const E = (m) => { errors++; console.log(err(m)); };
  const W = (m) => { warns++; console.log(warn(m)); };

  const allCss = csss.map((f) => readFileSync(f, 'utf8')).join('\n');
  const allText = [...htmls, ...csss, ...jss].map((f) => readFileSync(f, 'utf8')).join('\n');

  /* --- project-wide ---------------------------------------------------- */
  console.log(`\natelier audit  ${relative(process.cwd(), target) || '.'}`);
  console.log(`  ${htmls.length} html, ${csss.length} css, ${jss.length} js\n`);

  if (EMOJI.test(allText)) {
    for (const f of [...htmls, ...csss, ...jss]) {
      readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
        if (EMOJI.test(l)) E(`emoji at ${basename(f)}:${i + 1} - use an SVG or plain text`);
      });
    }
  } else console.log(ok('no emoji'));

  if (!/prefers-reduced-motion/.test(allCss)) E('no prefers-reduced-motion block in any stylesheet');
  else console.log(ok('prefers-reduced-motion honoured'));

  // pure black / pure white as a colour value
  const purist = /(?:^|[^-\w])(?:color|background(?:-color)?|border[a-z-]*color|fill)\s*:\s*(#fff(?:fff)?|#000(?:000)?|white|black)\b/gi;
  const pureHits = [...allCss.matchAll(purist)];
  if (pureHits.length) W(`${pureHits.length} use(s) of pure white/black - warm them (bone-100 / ink-950)`);
  else console.log(ok('no pure #fff / #000'));

  // undefined custom properties. A var() with a fallback is fine by definition,
  // and JS may define one via setProperty.
  const defined = new Set([
    ...[...allText.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]),
    ...[...allText.matchAll(/setProperty\(\s*['"`](--[\w-]+)/g)].map((m) => m[1]),
  ]);
  const used = new Set(
    [...allText.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)]
      .filter((m) => m[2] === ')')
      .map((m) => m[1]),
  );
  const undef = [...used].filter((v) => !defined.has(v));
  if (undef.length) E(`undefined custom propert${undef.length > 1 ? 'ies' : 'y'}: ${undef.join(', ')}`);
  else console.log(ok(`${used.size} custom properties all defined`));

  // outline removal without a focus-visible replacement
  if (/outline\s*:\s*(?:none|0)\b/.test(allCss) && !/:focus-visible/.test(allCss))
    E('outline removed with no :focus-visible replacement');

  /* --- per html --------------------------------------------------------- */
  for (const f of htmls) {
    const h = readFileSync(f, 'utf8');
    const n = basename(f);
    const has = (re) => re.test(h);

    if (!has(/<html[^>]*\slang=/i)) E(`${n}: <html> has no lang attribute`);
    if (!has(/<meta[^>]+name=["']viewport["']/i)) E(`${n}: no viewport meta`);
    if (!has(/<meta[^>]+charset/i)) E(`${n}: no charset meta`);

    const title = (h.match(/<title>([\s\S]*?)<\/title>/i) || [, ''])[1].trim();
    if (!title) E(`${n}: empty <title>`);
    else if (title.length > 65) W(`${n}: <title> is ${title.length} chars (aim under 60)`);

    const desc = (h.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)/i) || [, ''])[1];
    if (!desc) E(`${n}: no meta description`);
    else if (desc.length < 60 || desc.length > 165) W(`${n}: meta description is ${desc.length} chars (aim 80-160)`);

    if (!has(/rel=["'][^"']*icon/i)) W(`${n}: no favicon`);
    if (!has(/property=["']og:title["']/i)) W(`${n}: no Open Graph tags`);

    const h1s = (h.match(/<h1[\s>]/gi) || []).length;
    if (h1s === 0) E(`${n}: no <h1>`);
    else if (h1s > 1) E(`${n}: ${h1s} <h1> elements - exactly one per page`);

    // heading order
    const levels = [...h.matchAll(/<h([1-6])[\s>]/gi)].map((m) => +m[1]);
    for (let i = 1; i < levels.length; i++)
      if (levels[i] > levels[i - 1] + 1) { W(`${n}: heading jumps h${levels[i - 1]} -> h${levels[i]}`); break; }

    // images
    const imgs = [...h.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
    let noAlt = 0, noDim = 0, noLazy = 0;
    imgs.forEach((tag, i) => {
      if (!/\salt\s*=/.test(tag)) noAlt++;
      if (!/\swidth\s*=/.test(tag) || !/\sheight\s*=/.test(tag)) noDim++;
      if (i > 0 && !/loading\s*=\s*["']lazy/.test(tag) && !/fetchpriority/.test(tag)) noLazy++;
    });
    if (noAlt) E(`${n}: ${noAlt} <img> without alt`);
    if (noDim) E(`${n}: ${noDim} <img> without width/height - guaranteed layout shift`);
    if (noLazy) W(`${n}: ${noLazy} below-the-fold <img> without loading="lazy"`);
    if (imgs.length && !/fetchpriority\s*=\s*["']high/.test(h)) W(`${n}: no fetchpriority="high" on the hero image`);

    // duplicate ids
    const ids = [...h.matchAll(/\sid=["']([^"']+)["']/g)].map((m) => m[1]);
    const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
    if (dupes.length) E(`${n}: duplicate id(s): ${[...new Set(dupes)].join(', ')}`);

    // dead anchors + broken in-page links
    const dead = (h.match(/href=["']#["']/g) || []).length;
    if (dead) E(`${n}: ${dead} dead href="#" link(s)`);
    for (const m of h.matchAll(/href=["']#([\w-]+)["']/g))
      if (!ids.includes(m[1])) E(`${n}: link to #${m[1]} but no element has that id`);

    // form labels
    for (const m of h.matchAll(/<(input|textarea|select)\b[^>]*>/gi)) {
      const tag = m[0];
      if (/type\s*=\s*["'](hidden|submit|button)/i.test(tag)) continue;
      const id = (tag.match(/\sid=["']([^"']+)/) || [])[1];
      const before = h.slice(0, m.index);
      const wrapped = before.lastIndexOf('<label') > before.lastIndexOf('</label>');
      const labelled =
        (id && new RegExp(`for=["']${id}["']`).test(h)) || /aria-label/.test(tag) || wrapped;
      if (!labelled) E(`${n}: ${m[1]} without a label`);
    }

    // placeholder copy
    const low = h.toLowerCase();
    const left = PLACEHOLDERS.filter((p) => low.includes(p));
    if (left.length) E(`${n}: placeholder copy still present: "${left[0]}"${left.length > 1 ? ` (+${left.length - 1} more)` : ''}`);

    // wiring
    if (/data-(px|count|magnetic|tilt|split)=/.test(h) && !/motion\.js/.test(h))
      E(`${n}: uses data-px/count/magnetic/tilt but never loads motion.js`);
    if (/class=["'][^"']*\bgrain\b/.test(h) === false) W(`${n}: no .grain overlay - the page will look flat`);
    if (!/fonts\.(googleapis|gstatic|bunny|fontshare)/.test(h) && !/@font-face/.test(allCss))
      W(`${n}: no webfont loaded - the whole system depends on the serif`);
    if (/Instrument\+Serif/.test(h))
      W(`${n}: Instrument Serif is the most-generated display face on the web right now - prefer Newsreader or Fraunces`);
    if (/Playfair\+Display/.test(h))
      W(`${n}: Playfair Display reads as a template default - prefer Newsreader, Fraunces or Bodoni Moda`);

    // inline style volume
    const inline = (h.match(/\sstyle=["'][^"']+["']/g) || []).length;
    if (inline > 60) W(`${n}: ${inline} inline style attributes - move the repeated ones into site.css`);
  }

  /* --- css sanity ------------------------------------------------------- */
  if (csss.length) {
    if (!/clamp\(/.test(allCss)) W('no clamp() anywhere - type and spacing are not fluid');
    const lh = [...allCss.matchAll(/line-height\s*:\s*([\d.]+)/g)].map((m) => +m[1]);
    if (lh.length && !lh.some((v) => v < 1)) W('no display line-height below 1.0 - large serif will read as a blog');
    if (!/letter-spacing\s*:\s*-/.test(allCss)) W('no negative letter-spacing - large serif needs it');
    if (!/@media\s*\(\s*max-width|@media\s*\(\s*min-width|@container/.test(allCss))
      W('no responsive breakpoints found');
  }

  console.log(`\n  ${errors} error(s), ${warns} warning(s)\n`);
  process.exit(errors ? 1 : 0);
}

/* ---------------------------------------------------------------- serve -- */
function cmdServe() {
  const dir = resolve(positional[0] || '.');
  const port = parseInt(String(flag('port', '4321')), 10) || 4321;
  const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.avif': 'image/avif', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
  createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = join(dir, p);
    if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain' }); res.end('404'); return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream',
                         'cache-control': 'no-store' });
    res.end(readFileSync(file));
  }).listen(port, () => console.log(`atelier: http://localhost:${port}  (${dir})`));
}

/* ------------------------------------------------------------------ main -- */
switch (cmd) {
  case 'new': cmdNew(); break;
  case 'sections': case 'list': cmdSections(); break;
  case 'add': cmdAdd(); break;
  case 'audit': case 'check': cmdAudit(); break;
  case 'serve': cmdServe(); break;
  default:
    console.log(`atelier

  new <dir> [--preset bone|ink|cinema] [--name "X"] [--sections a,b,c]
  sections                        list section ids and presets
  add <id> [--to <file>]          print a section, or insert it before </main>
  audit <dir|file>                quality + bug check (exit 1 on error)
  serve <dir> [--port 4321]       local preview
`);
    process.exit(cmd ? 1 : 0);
}
