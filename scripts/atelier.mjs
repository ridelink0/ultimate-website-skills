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
import { tmpdir } from 'node:os';

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
  const heroes = wanted.filter((s) => s.startsWith('hero-'));
  if (heroes.length > 1)
    die(`pick one hero, not ${heroes.length} (${heroes.join(', ')}). A page has one opening statement.`);

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

  // Two sections can legitimately carry the same id (every hero is #top).
  // Whichever comes first keeps it; the rest lose the attribute so the page is
  // never scaffolded with a duplicate.
  const seen = new Set();
  body = body.replace(/\sid=(["'])([\w-]+)\1/g, (m, q, id) => {
    if (seen.has(id)) return '';
    seen.add(id);
    return m;
  });

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
// Copy that shipped from the scaffold and was never replaced. Deliberately
// specific: the bare word "placeholder" is a legitimate thing to write in prose.
const PLACEHOLDERS = [
  'lorem ipsum', 'site name', 'brand name', 'your text here', 'placeholder text',
  'first half of the claim', 'one sentence under the headline', 'two short paragraphs',
  'the line that reframes', 'coming soon', 'foo bar',
  'describe the geometry', 'a sentence someone actually said', 'one last sentence',
  'the question a real person asks', 'say the grade, not the adjective',
  'the single action', 'one or two lines', 'name, role',
];

// Invented specifics. A generated page reaches for these instead of leaving a
// field empty, and they are the fastest way to spot one.
const FAKE_DATA = [
  [/via\.placeholder\.com|placehold\.(it|co)|picsum\.photos|dummyimage\.com/i, 'placeholder image service'],
  [/\b[\w.+-]+@(example|test|domain|yoursite|yourcompany)\.(com|org|net)\b/i, 'example.com email address'],
  [/\b\(?555\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/, 'a 555 phone number'],
  [/\b123 (main|any) (st|street)\b/i, 'a fake street address'],
  [/\b(your ?company|company name|acme|your ?brand|business name)\b/i, 'an unfilled company name'],
  [/\b(john|jane) (doe|smith)\b/i, 'a placeholder person'],
];

// Marketing language that reads as machine-written.
const SLOP_COPY = [
  "in today's fast-paced", 'fast-paced world', 'unleash the power', 'unlock the power',
  'take it to the next level', 'elevate your', 'seamlessly integrat', 'revolutioniz',
  'cutting-edge solution', 'empower your team', 'game-changer', 'game changing',
  'best-in-class', 'world-class solution', 'transform your business', 'delve into',
  'in the ever-evolving', 'look no further', "we've got you covered", 'the future of',
];

/* The marks of a generated page. Weighted the way the public scanners weight
   them: the default font stack and the purple accent score highest, then the
   reflexive cream ground and sub-AA grey text, then the decorative devices. */

// Faces that now read as "nobody chose a typeface". Fraunces and Instrument
// Serif were the 2025 escape route and have since become the new default.
const SLOP_FONTS = [
  'Inter', 'Instrument Serif', 'Space Grotesk', 'Geist', 'Syne', 'Cal Sans',
  'DM Sans', 'Poppins', 'Roboto', 'Playfair Display', 'Montserrat', 'Fraunces',
];
// "VibeCode purple" plus the Tailwind blues.
const SLOP_HEX = /#(6366f1|4f46e5|818cf8|8b5cf6|7c3aed|a855f7|c084fc|2563eb|3b82f6|60a5fa|ec4899|f472b6)\b/gi;
const DIM_GREY = /#(888888|888|999999|999|9ca3af|a0aec0|aaaaaa|aaa|cccccc|ccc)\b/gi;
const BUILDERS = /(gpteng\.co|lovable-tagger|lovable-uploads|\.lovable\.app|\.bolt\.host|@base44\/sdk|\.base44\.app|Built with v0|\.repl\.co|\.replit\.app)/i;

function slopChecks(hRaw, css, n, E, W) {
  // Comments and data: URIs both carry markup and hex colours that are not the
  // rendered page. Neither should be able to fail a build.
  const h = hRaw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(?:href|src|content)="data:[^"]*"/gi, 'href="data:"')
    .replace(/(?:href|src|content)='data:[^']*'/gi, "href='data:'");
  const blob = h + '\n' + css;

  // 1. the display face
  const fontHit = SLOP_FONTS.filter(
    (f) => new RegExp(`font-family[^;{}]*["']?${f.replace(/ /g, '[+ ]')}["']?`, 'i').test(blob) ||
           new RegExp(`family=${f.replace(/ /g, '\\+')}`, 'i').test(h),
  );
  if (fontHit.length)
    W(`${n}: ${fontHit.join(', ')} - currently the most-generated face(s) on the web. See references/typography.md.`);

  // 2. the purple/blue accent
  const purple = [...new Set((blob.match(SLOP_HEX) || []).map((s) => s.toLowerCase()))];
  if (purple.length) E(`${n}: ${purple.join(', ')} - the single most recognisable generated-page colour`);

  // 3. gradient text
  if (/background-clip\s*:\s*text/i.test(blob) && /color\s*:\s*transparent/i.test(blob))
    W(`${n}: gradient text (background-clip:text) - a top-weighted tell`);

  // 4. aurora / blob backdrops. backdrop-filter on a card is not this, so the
  //    blur has to be a plain filter and the blobs have to be numerous.
  if ((blob.match(/radial-gradient/gi) || []).length >= 6 && /(^|[^-])filter\s*:\s*blur\(\s*\d{2,}/im.test(blob))
    W(`${n}: blurred multi-blob backdrop - the "aurora" tell`);

  // 5. transition: all
  if (/transition\s*:\s*all\b/i.test(css))
    W(`${n}: "transition: all" - name the properties you actually animate`);

  // 6. the eyebrow pill above the headline
  if (/border-radius\s*:\s*(999|9999)px[^}]*}[^<]*<[^>]*>[^<]{1,40}<\/[^>]+>\s*<h1/is.test(blob) ||
      /<(span|div|p)[^>]+class=["'][^"']*\b(badge|pill|chip|tag)\b[^"']*["'][^>]*>[\s\S]{0,60}?<\/\1>\s*<h1/i.test(h))
    W(`${n}: pill badge directly above the <h1> - the "Now in beta" reflex`);

  // 7. sub-AA grey body text
  const dim = [...new Set((css.match(DIM_GREY) || []).map((s) => s.toLowerCase()))];
  if (dim.length) W(`${n}: ${dim.join(', ')} - washed-out grey, almost certainly under 4.5:1`);

  // 8. the italic accent word, rationed. Count elements, not attributes: an
  //    <em class="it"> is one phrase, not two.
  const ems = (h.match(/<(?:em|i)\b/gi) || []).length +
    (h.match(/<(?!em\b|i\b)[a-z]+\b[^>]*class=["'][^"']*\bit\b/gi) || []).length;
  if (ems > 1) E(`${n}: ${ems} italic accent phrases - one per page. It is a known tell, so overusing it is the tell.`);

  // 9. centred everything
  const centred = (h.match(/\bcenter\b|text-align\s*:\s*center/g) || []).length;
  const sections = (h.match(/<section\b/g) || []).length || 1;
  if (centred > sections * 2)
    W(`${n}: ${centred} centring declarations across ${sections} sections - establish an alignment axis instead`);

  // 10. builder fingerprints
  const b = h.match(BUILDERS);
  if (b) W(`${n}: "${b[1]}" left in the source`);

  // 11. negative parallelism
  const np = (h.match(/not just [^.<]{1,50}?,? (it['’]s|but|it is)\b/gi) || []).length;
  if (np) W(`${n}: "not just X, it's Y" x${np} - now roughly three times its 2023 rate on the open web`);

  // 12. em dash density
  const words = (h.replace(/<[^>]+>/g, ' ').match(/\S+/g) || []).length || 1;
  const dashes = (h.match(/—/g) || []).length;
  if (words > 200 && (dashes / words) * 1000 > 20)
    W(`${n}: ${((dashes / words) * 1000).toFixed(1)} em dashes per 1000 words (over 20 reads as machine-written)`);

  // 13. semantics
  if (!/<(main|section|article)\b/i.test(h)) E(`${n}: no <main>, <section> or <article> - div soup`);
  if (/<div[^>]+onclick/i.test(h)) E(`${n}: <div onclick> - use a <button> or an <a>`);

  // 14. every <svg> is either decoration (aria-hidden) or content (role +
  //     accessible name). Inheriting from an ancestor works, but saying it on
  //     the element is unambiguous and survives the markup being moved.
  const bare = (h.match(/<svg\b[^>]*>/gi) || [])
    .filter((s) => !/aria-hidden|role=|aria-label/i.test(s)).length;
  if (bare) W(`${n}: ${bare} <svg> with neither aria-hidden nor an accessible name`);

  // 15. one radius for everything
  const radii = [...css.matchAll(/border-radius\s*:\s*([^;}]+)/gi)].map((m) => m[1].trim());
  const tally = radii.reduce((a, r) => ((a[r] = (a[r] || 0) + 1), a), {});
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 8 && radii.length && top[1] / radii.length > 0.6)
    W(`${n}: border-radius ${top[0]} on ${top[1]} rules - tier the radius by role`);

  // 16. headings that will not balance
  if (/<h1\b/i.test(h) && !/text-wrap\s*:\s*balance/i.test(css))
    W(`${n}: no text-wrap: balance on headings`);
}

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

    // copy that was never written
    const low = h.toLowerCase();
    const left = PLACEHOLDERS.filter((p) => low.includes(p));
    if (left.length) E(`${n}: scaffold copy still present: "${left[0]}"${left.length > 1 ? ` (+${left.length - 1} more)` : ''}`);

    for (const [re, what] of FAKE_DATA) if (re.test(h)) E(`${n}: ${what}`);

    const slop = SLOP_COPY.filter((s) => low.includes(s));
    if (slop.length) W(`${n}: marketing filler: "${slop[0]}"${slop.length > 1 ? ` (+${slop.length - 1} more)` : ''} - say the specific thing instead`);

    // a copyright year that has drifted
    const yr = new Date().getFullYear();
    for (const m of h.matchAll(/(?:&copy;|©|copyright)\s*(\d{4})/gi))
      if (+m[1] < yr) W(`${n}: copyright says ${m[1]}, this year is ${yr}`);

    // the three-equal-cards reflex
    if (/grid-template-columns\s*:\s*repeat\(\s*3\s*,\s*1fr\s*\)/.test(h + allCss))
      W('repeat(3, 1fr) - use repeat(auto-fit, minmax(...)) so the row is not locked to three');

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

    slopChecks(h, allCss, n, E, W);
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
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.avif': 'image/avif', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

function startServer(dir, port) {
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = join(dir, p);
    if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain' }); res.end('404'); return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream',
                         'cache-control': 'no-store' });
    res.end(readFileSync(file));
  });
  srv.listen(port);
  srv.unref();
  return srv;
}

function cmdServe() {
  const dir = resolve(positional[0] || '.');
  const port = parseInt(String(flag('port', '4321')), 10) || 4321;
  const srv = startServer(dir, port);
  srv.ref();
  console.log(`atelier: http://localhost:${port}  (${dir})`);
}

/* ----------------------------------------------------------------- look -- */
/* Renders the page in a real browser and reports what only a rendered page can
   show: text overlapping text, content past the viewport, unreadable contrast,
   collapsed elements, broken images. Static analysis cannot see any of it. */
async function cmdLook() {
  const target = positional[0] || '.';
  const out = String(flag('out', join(process.env.CLAUDE_SCRATCHPAD || tmpdir(), 'atelier-shots')));
  const widths = String(flag('widths', '1440,390')).split(',').map((s) => parseInt(s, 10)).filter(Boolean);
  const noShot = argv.includes('--no-shot');

  let url = target;
  let server = null;
  if (!/^https?:\/\//.test(target)) {
    const dir = resolve(target);
    if (!existsSync(dir)) die(`no such path: ${dir}`);
    const port = 4400 + Math.floor(Math.random() * 900);
    server = startServer(dir, port);
    url = `http://127.0.0.1:${port}/`;
  }

  try {
    const { inspect, formatReport } = await import('./inspect.mjs');
    const results = await inspect(url, { widths, out: noShot ? null : out });
    const { text, errors, warns } = formatReport(results);
    console.log(`\natelier look  ${target}`);
    console.log(text);
    console.log(`\n  ${errors} error(s), ${warns} warning(s)`);
    if (!noShot) console.log(`\n  Read the PNGs. The report cannot tell you whether it looks good.`);
    process.exitCode = errors ? 1 : 0;
  } catch (e) {
    if (e && e.code === 'no-browser') {
      console.error('atelier look: ' + e.message);
      process.exitCode = 2;
    } else throw e;
  } finally {
    if (server) server.close();
  }
}

/* ------------------------------------------------------------------ main -- */
switch (cmd) {
  case 'new': cmdNew(); break;
  case 'sections': case 'list': cmdSections(); break;
  case 'add': cmdAdd(); break;
  case 'audit': case 'check': cmdAudit(); break;
  case 'look': case 'shot': await cmdLook(); break;
  case 'serve': cmdServe(); break;
  default:
    console.log(`atelier

  new <dir> [--preset bone|ink|cinema] [--name "X"] [--sections a,b,c]
  sections                        list section ids and presets
  add <id> [--to <file>]          print a section, or insert it before </main>
  audit <dir|file>                source check: copy, semantics, the tells
  look <dir|url> [--widths 1440,390] [--out DIR] [--no-shot]
                                  RENDER it: overlap, overflow, contrast, PNGs
  serve <dir> [--port 4321]       local preview
`);
    process.exit(cmd ? 1 : 0);
}
