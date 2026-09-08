/* Security and disclosure check for a built static site.
 *
 * What the audit reads for taste, this reads for harm: secrets that should
 * never have left a laptop, forms that mail personal data over GET, scripts
 * pulled from a CDN with nothing pinning what they contain, a header
 * configuration that leaves the page embeddable by anyone, and the small
 * disclosures - a build machine's username in a comment, a font request that
 * hands every visitor's address to a third party - that add up.
 *
 * Everything here runs offline over the files that would be deployed. The
 * research behind it (references/security.md) splits the problem in two: what
 * can be known from source, which is this file, and what can only be known
 * once the site is served - the real response headers, whether /.git/HEAD
 * resolves - which is a short list of curl commands the reference spells out.
 *
 * Severity is stated on every finding and the command exits 1 only on high.
 * A checker that fails the build over a console.log is a checker people turn
 * off, and then it catches nothing.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative, basename } from 'node:path';

/* Files never to deploy. Presence in the site directory is the finding. */
const NEVER_SHIP = [
  { test: (name) => /^\.env(\..+)?$/.test(name), level: 'high', text: 'environment file in the site directory', fix: 'keep .env files out of the publish directory and in .gitignore; a deploy copies what is there' },
  { test: (name) => name === '.git', level: 'high', text: 'a .git directory inside the site directory', fix: 'publish a build directory, not the repository root; with .git served, every secret ever committed is downloadable from /.git/' },
  { test: (name) => /\.map$/.test(name), level: 'medium', text: 'source map shipped', fix: 'keep maps out of production or upload them to the error tracker instead; a map carries original paths and unminified logic' },
  { test: (name) => name === '.DS_Store' || name === 'Thumbs.db' || name === 'desktop.ini', level: 'low', text: 'operating-system litter file', fix: 'delete it; it leaks directory listings and nothing else' },
  { test: (name) => /\.(pem|key|p12|pfx|jks|keystore)$/.test(name), level: 'high', text: 'key or certificate file', fix: 'remove it and rotate whatever it protected' },
];

/* The secret shapes worth a regex. Prefixed formats first: those are exact.
 * The generic assignment rule is the workhorse for everything without a
 * prefix, and the one most likely to be right about a hand-written config. */
const SECRETS = [
  { re: /\bAKIA[0-9A-Z]{16}\b/g, level: 'high', text: 'AWS access key id' },
  { re: /\b(?:sk|rk)_live_[0-9a-zA-Z]{20,}\b/g, level: 'high', text: 'Stripe live secret key' },
  { re: /\bsk_test_[0-9a-zA-Z]{20,}\b/g, level: 'medium', text: 'Stripe test secret key (still a secret)' },
  { re: /\bghp_[0-9A-Za-z]{36}\b|\bgithub_pat_[0-9A-Za-z]{22}_[0-9A-Za-z]{59}\b|\bgh[ousr]_[0-9A-Za-z]{36,}\b/g, level: 'high', text: 'GitHub token' },
  { re: /\bxox[baprs]-[0-9A-Za-z-]{10,72}\b/g, level: 'high', text: 'Slack token' },
  { re: /\bnfp_[A-Za-z0-9]{20,}\b/g, level: 'high', text: 'Netlify personal access token' },
  { re: /\bvcp_[A-Za-z0-9]{20,}\b/g, level: 'high', text: 'Vercel token' },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/g, level: 'medium', text: 'Google API key (public by design, but must be referrer-restricted in the console)' },
  { re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----/g, level: 'high', text: 'private key block' },
  // The optional quote before the colon is what makes this work on JSON and
  // YAML as well as JavaScript. Without it, "apiKey": "..." in a config file
  // fell through to the entropy note - the weakest finding there is - while
  // the same secret in a .js file was reported properly.
  { re: /\b(?:api[_-]?key|apikey|secret|client[_-]?secret|auth[_-]?token|access[_-]?token|password|passwd)\b['"]?\s*[:=]\s*['"][A-Za-z0-9\-_./+=]{16,}['"]/gi, level: 'medium', text: 'a secret-shaped value assigned in source' },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, level: 'low', text: 'a JWT in source (fine if short-lived and scoped; check its claims)' },
];

/* Public tracking ids. Not secrets, but each one obliges the page to say
 * what it collects. */
const TRACKERS = [
  { re: /\bG-[A-Z0-9]{8,12}\b/g, text: 'Google Analytics 4 measurement id' },
  { re: /\bGTM-[A-Z0-9]{6,8}\b/g, text: 'Google Tag Manager container' },
  { re: /\bUA-\d{4,10}-\d{1,4}\b/g, text: 'legacy Universal Analytics id' },
  { re: /fbq\(\s*['"]init['"]\s*,\s*['"]\d{15,16}['"]/g, text: 'Meta pixel' },
];

const SOURCE_EXT = new Set(['.html', '.htm', '.js', '.mjs', '.css', '.json', '.toml', '.txt', '.xml', '.svg', '.webmanifest']);

function walk(dir, out = [], depth = 0) {
  if (depth > 12) return out;
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = join(dir, e.name);
    const rule = NEVER_SHIP.find((r) => r.test(e.name));
    if (rule) out.push({ never: rule, file: full });
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      walk(full, out, depth + 1);
    } else if (SOURCE_EXT.has(extname(e.name).toLowerCase())) {
      out.push({ file: full });
    }
  }
  return out;
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

// The attribute being present is not the same as the subresource being pinned.
// integrity="" and integrity="notahash" both leave the browser verifying
// nothing, and a presence-only test called both of them safe.
function pinned(tag) {
  const found = /\bintegrity\s*=\s*["']([^"']*)["']/i.exec(tag);
  return Boolean(found && /\bsha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}/.test(found[1]));
}

/* Shannon entropy in bits per character. A content hash, a base64 image and
 * a real key all score high, so this is a note, never a failure. */
function entropy(s) {
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) || 0) + 1);
  let h = 0;
  for (const n of counts.values()) { const p = n / s.length; h -= p * Math.log2(p); }
  return h;
}

export function headersConfig(dir) {
  const found = {};
  for (const name of ['netlify.toml', '_headers', 'vercel.json']) {
    const file = join(dir, name);
    if (existsSync(file)) found[name] = readFileSync(file, 'utf8');
  }
  const all = Object.values(found).join('\n');
  const has = (name) => new RegExp(name.replace(/-/g, '[-_]?'), 'i').test(all);
  return {
    any: Boolean(all.trim()),
    files: Object.keys(found),
    csp: has('Content-Security-Policy'),
    hsts: has('Strict-Transport-Security'),
    nosniff: /X-Content-Type-Options/i.test(all) && /nosniff/i.test(all),
    referrer: has('Referrer-Policy'),
    permissions: has('Permissions-Policy'),
    framing: /frame-ancestors/i.test(all) || /X-Frame-Options/i.test(all),
    raw: all,
  };
}

export function securityAudit(dir) {
  const root = dir;
  const entries = walk(root);
  const findings = [];
  const add = (level, file, line, text, fix) => findings.push({ level, file: file ? relative(root, file) || basename(file) : null, line: line || null, text, fix });

  for (const e of entries.filter((x) => x.never)) add(e.never.level, e.file, null, e.never.text, e.never.fix);

  const pages = [];
  for (const e of entries.filter((x) => !x.never)) {
    let text;
    try { text = readFileSync(e.file, 'utf8'); } catch { continue; }
    const ext = extname(e.file).toLowerCase();
    const isHtml = ext === '.html' || ext === '.htm';
    const isJs = ext === '.js' || ext === '.mjs';
    if (isHtml) pages.push({ file: e.file, text });

    // Secrets, in anything textual. A data: URI or an integrity hash is not a
    // key, and the generic rule would otherwise fire on every inline SVG.
    const scrubbed = text.replace(/data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]+/g, 'data:...').replace(/integrity="[^"]*"/g, 'integrity=""');
    for (const rule of SECRETS) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(scrubbed))) {
        add(rule.level, e.file, lineOf(scrubbed, m.index), rule.text + ': ' + m[0].slice(0, 12) + '...', rule.level === 'high' ? 'remove it from the source and ROTATE it now - it is already in the deploy history' : 'move it out of client-side source; if it must be public, restrict it at the provider');
      }
    }
    // Long high-entropy literals, as a note. Real keys hide here; so do hashes.
    const literal = /['"`]([A-Za-z0-9+/=_-]{32,})['"`]/g;
    let lm;
    while ((lm = literal.exec(scrubbed))) {
      if (/^sha(256|384|512)-/.test(lm[1])) continue;
      if (entropy(lm[1]) > 4.6 && !/^[0-9a-f]+$/i.test(lm[1])) add('note', e.file, lineOf(scrubbed, lm.index), 'high-entropy string literal (' + lm[1].slice(0, 10) + '...) - a key, or a hash', 'if it is a credential, remove and rotate it; if it is a hash, ignore this');
    }
    // A developer's machine, named in the shipped files.
    const local = /(?:[A-Za-z]:\\Users\\[^\\\s"'<>]+|\/Users\/[A-Za-z0-9_-]+\/|\/home\/[A-Za-z0-9_-]+\/)/g;
    let pm;
    while ((pm = local.exec(text))) add('low', e.file, lineOf(text, pm.index), 'local machine path in shipped file: ' + pm[0].slice(0, 40), 'it names a person and an operating system; usually a source map or a bundler embedding __dirname');

    if (isJs || isHtml) {
      const code = text;
      const at = (re, level, msg, fix, opts = {}) => {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(code))) {
          if (opts.skip && opts.skip(m, code)) continue;
          add(level, e.file, lineOf(code, m.index), msg, fix);
          if (opts.once) break;
        }
      };
      // The lookahead excludes whitespace too, or \s* backtracks one space and
      // the quote check is skipped - which flagged every literal assignment.
      at(/\.(?:innerHTML|outerHTML)\s*=\s*(?![\s'"`])/g, 'high', 'innerHTML assigned from a non-literal', 'use textContent, or sanitise before assigning; anything from a URL, a form or a fetch is an injection here');
      // A backtick was treated as a literal and skipped, so the most common
      // way anyone actually writes an injection - `<div>${name}</div>` - was
      // the one form the check could not see.
      at(/\.(?:innerHTML|outerHTML)\s*=\s*`[^`]*\$\{/g, 'high', 'innerHTML assigned from a template literal with interpolation', 'the interpolated value is written as markup; use textContent for the value, or build the node and set its text');
      at(/document\.write\s*\(\s*(?![\s'"`)])/g, 'high', 'document.write with a non-literal', 'build nodes instead; this is both an injection and a CSP blocker');
      at(/postMessage\s*\([^)]*['"]\*['"]/g, 'high', 'postMessage to any origin ("*")', 'name the target origin');
      at(/addEventListener\s*\(\s*['"]message['"]/g, 'high', 'message listener with no origin check', 'compare event.origin against an allowlist before trusting event.data', { skip: (m, s) => /\.origin\b/.test(s.slice(m.index, m.index + 600)) });
      at(/\beval\s*\(|new\s+Function\s*\(/g, 'medium', 'eval or new Function', 'remove it; it also forces unsafe-eval into any CSP');
      at(/\bDEBUG\s*=\s*true\b|__DEBUG__\s*=\s*true/g, 'low', 'debug flag left on', 'turn it off for production');
      const logs = (code.match(/console\.log\s*\(/g) || []).length;
      if (logs >= 3) add('note', e.file, null, logs + ' console.log calls in shipped code', 'strip them; anything printed is visible to every visitor');
    }

    if (isHtml) {
      const h = text;
      const at = (re, level, msg, fix, opts = {}) => {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(h))) {
          if (opts.skip && opts.skip(m, h)) continue;
          add(level, e.file, lineOf(h, m.index), msg, fix);
          if (opts.once) break;
        }
      };
      at(/\son[a-z]+\s*=\s*["']/gi, 'medium', 'inline event handler', 'move it to a script file; a real Content-Security-Policy blocks it outright');
      at(/href\s*=\s*["']\s*javascript:/gi, 'medium', 'javascript: URL', 'use a button with a listener');
      // Mixed content: only a real fetch is one. Namespaces are not fetched.
      at(/(?:src|href|action)\s*=\s*["']http:\/\/(?!localhost|127\.0\.0\.1|www\.w3\.org|schema\.org|ogp\.me)[^"']+/gi, 'high', 'plain-http resource on a page that will be served over https', 'use https:// - active mixed content is blocked by every browser, passive marks the page insecure');
      at(/<a\b[^>]*target\s*=\s*["']_blank["'][^>]*>/gi, 'low', 'target="_blank" without rel="noopener"', 'add rel="noopener noreferrer"; evergreen browsers imply it, embedded webviews do not', { skip: (m) => /rel\s*=\s*["'][^"']*noopener/i.test(m[0]) });

      // Third-party scripts and styles, and what pins them.
      const scripts = [...h.matchAll(/<script\b[^>]*\bsrc\s*=\s*["'](https?:)?\/\/([^"'/]+)[^"']*["'][^>]*>/gi)];
      for (const m of scripts) {
        const tag = m[0];
        if (!pinned(tag)) add('medium', e.file, lineOf(h, m.index), 'cross-origin script from ' + m[2] + ' without a usable integrity hash', 'pin the exact version and add the integrity hash the CDN publishes, plus crossorigin="anonymous"');
        else if (!/\bcrossorigin\b/.test(tag)) add('medium', e.file, lineOf(h, m.index), 'integrity without crossorigin on ' + m[2], 'add crossorigin="anonymous" or the browser cannot verify the hash');
      }
      const styles = [...h.matchAll(/<link\b[^>]*rel\s*=\s*["']stylesheet["'][^>]*href\s*=\s*["'](https?:)?\/\/([^"'/]+)[^"']*["'][^>]*>/gi)];
      for (const m of styles) {
        // Font CSS is generated per user agent and cannot carry a stable hash.
        if (/fonts\.(googleapis|bunny)\.net|fonts\.googleapis\.com|fontshare|typekit/i.test(m[2])) continue;
        if (!pinned(m[0])) add('low', e.file, lineOf(h, m.index), 'cross-origin stylesheet from ' + m[2] + ' without a usable integrity hash', 'pin and add integrity, or self-host it');
      }
      const map = h.match(/<script\b[^>]*type\s*=\s*["']importmap["'][^>]*>([\s\S]*?)<\/script>/i);
      if (map && /https?:\/\//.test(map[1]) && !/"integrity"\s*:/.test(map[1])) {
        add('medium', e.file, lineOf(h, map.index), 'import map pulls modules from a CDN with no "integrity" block', 'add an "integrity" map keyed by URL - Chrome 127+, Firefox 138+ and Safari 18.4+ enforce it - or self-host the modules');
      }
      if (/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(h)) {
        add('note', e.file, null, 'fonts served from Google', 'every visitor\'s IP goes to Google before the page paints (Munich Regional Court, Jan 2022); self-host the woff2 files or use a same-origin mirror');
      }

      // Forms.
      const forms = [...h.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)];
      const hasPrivacy = /href\s*=\s*["'][^"']*privacy/i.test(h);
      for (const f of forms) {
        const attrs = f[1], body = f[2];
        const line = lineOf(h, f.index);
        const personal = /type\s*=\s*["'](?:email|tel|password)["']|<textarea\b/i.test(body);
        const method = (attrs.match(/method\s*=\s*["']?(\w+)/i) || [])[1];
        if (personal && (!method || method.toLowerCase() === 'get')) add('high', e.file, line, 'form sends personal data with GET', 'method="post" - GET puts the submission in the URL, the history, the logs and the referrer');
        if (/action\s*=\s*["']http:\/\//i.test(attrs)) add('high', e.file, line, 'form posts to plain http', 'use an https action');
        if (/data-netlify\s*=\s*["']true["']/i.test(attrs) && !/netlify-honeypot/i.test(attrs)) add('medium', e.file, line, 'Netlify form without a honeypot', 'add netlify-honeypot="bot-field" and a hidden input named bot-field; Akismet runs regardless, the honeypot is the cheap second layer');
        if (personal && !hasPrivacy) add('medium', e.file, line, 'form collects personal data and the page links no privacy policy', 'link a privacy page near the submit button and say what the data is for');
      }

      // Trackers oblige a notice.
      for (const t of TRACKERS) {
        t.re.lastIndex = 0;
        if (t.re.test(h)) add(hasPrivacy ? 'note' : 'medium', e.file, null, t.text + ' present' + (hasPrivacy ? '' : ' and no privacy policy is linked'), 'a tracker needs a notice, and for EEA visitors on Google tags a consent signal (Consent Mode v2)');
      }
    }
  }

  // Headers: the configuration is source too, and it is where clickjacking
  // and sniffing are decided.
  const cfg = headersConfig(root);
  if (pages.length) {
    if (!cfg.any) {
      add('medium', null, null, 'no header configuration (netlify.toml [[headers]], _headers or vercel.json)', 'add a baseline: Content-Security-Policy, Strict-Transport-Security, X-Content-Type-Options: nosniff, Referrer-Policy, Permissions-Policy, frame-ancestors');
    } else {
      // A real path, so the report line reads netlify.toml and not a relative
      // walk up to wherever the command was run from.
      const src = join(root, cfg.files[0]);
      if (!cfg.csp) add('medium', src, null, 'no Content-Security-Policy in the header configuration', 'start with Content-Security-Policy-Report-Only and tighten; allowlist the exact CDN hosts the page uses');
      if (!cfg.hsts) add('medium', src, null, 'no Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload (Vercel sets a default; Netlify and Cloudflare Pages do not)');
      if (!cfg.nosniff) add('medium', src, null, 'no X-Content-Type-Options: nosniff', 'add it; there is no reason to omit it on a static site');
      if (!cfg.referrer) add('low', src, null, 'no Referrer-Policy', 'strict-origin-when-cross-origin');
      if (!cfg.permissions) add('low', src, null, 'no Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=() unless the page uses them');
      if (!cfg.framing) add('medium', src, null, 'nothing forbids framing (no frame-ancestors, no X-Frame-Options)', "Content-Security-Policy: frame-ancestors 'none' - this is the clickjacking gap");
      if (cfg.csp && pages.some((p) => /\son[a-z]+\s*=|<script\b(?![^>]*\bsrc=)[^>]*>\s*[^\s<]/i.test(p.text))) {
        add('note', src, null, 'a CSP is configured and the pages carry inline scripts or handlers', "they will be blocked unless the policy carries 'unsafe-inline' or a nonce; test with the policy in report-only first");
      }
    }
  }

  const order = { high: 0, medium: 1, low: 2, note: 3 };
  findings.sort((a, b) => order[a.level] - order[b.level] || String(a.file).localeCompare(String(b.file)) || (a.line || 0) - (b.line || 0));
  return { findings, pages: pages.length, files: entries.filter((x) => !x.never).length, headers: cfg };
}

export function formatSecurity(result, target) {
  const lines = [];
  const counts = { high: 0, medium: 0, low: 0, note: 0 };
  lines.push(`\nwebdesign security  ${target}`);
  lines.push(`  ${result.pages} page(s), ${result.files} file(s) read, headers config: ${result.headers.any ? result.headers.files.join(', ') : 'none'}\n`);
  for (const f of result.findings) {
    counts[f.level]++;
    const tag = f.level === 'high' ? 'ERROR' : f.level === 'medium' ? 'warn ' : f.level === 'low' ? 'low  ' : 'note ';
    const where = f.file ? f.file + (f.line ? ':' + f.line : '') + '  ' : '';
    lines.push(`  ${tag} ${where}${f.text}`);
    lines.push(`         fix: ${f.fix}`);
  }
  if (!result.findings.length) lines.push('  ok    nothing found from source; the live checks below still apply');
  lines.push('');
  lines.push(`  ${counts.high} error(s), ${counts.medium} warning(s), ${counts.low} low, ${counts.note} note(s)`);
  lines.push('  Once deployed, three things only the server can answer:');
  lines.push('    curl -sI https://<site>/ | grep -iE "content-security|strict-transport|x-content-type|referrer|permissions|frame"');
  lines.push('    curl -s -o /dev/null -w "%{http_code}\\n" https://<site>/.git/HEAD      (must be 404)');
  lines.push('    curl -s -o /dev/null -w "%{http_code}\\n" https://<site>/.env           (must be 404)');
  return { text: lines.join('\n'), ...counts };
}
