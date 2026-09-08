/* ultimate-website-skills/verify - one command, one verdict.
   audit, debug/quality and security each print their own ad-hoc format with
   their own exit code, and "is this page done" today means running all three
   and reconciling them by hand. This runs them, folds every finding into one
   set of severities, and returns a single object a human or a script can act
   on without knowing the shape of any of the underlying checkers. */

import { existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { runAudit } from './audit.mjs';
import { debugSite } from './debug.mjs';
import { securityAudit, formatSecurity } from './security.mjs';

// The render/quality checkers already print in the "  TAG  message" shape
// (formatReport and formatQuality both use it - see inspect.mjs/measure.mjs).
// Reading that back into structured findings means verify does not need to
// change either checker's return shape to get one out of it.
function classifyLines(text) {
  const findings = [];
  for (const raw of text.split('\n')) {
    const m = raw.match(/^\s*(ERROR|warn|note)\s+(.*)$/);
    if (!m) continue;
    findings.push({
      severity: m[1] === 'ERROR' ? 'error' : m[1] === 'warn' ? 'warning' : 'note',
      text: m[2].trim(),
    });
  }
  return findings;
}

export async function runVerify(target, opts = {}) {
  const isUrl = /^https?:\/\//i.test(target);
  const resolved = isUrl ? target : resolve(target);
  if (!isUrl && !existsSync(resolved)) throw new Error(`no such path: ${resolved}`);

  const sections = {};

  // Source-only checks need files on disk; a URL target skips them rather
  // than fetching and reconstructing a tree it was never given.
  if (isUrl) {
    sections.audit = { skipped: 'a URL target has no source files to audit' };
    sections.security = { skipped: 'a URL target has no source files to scan' };
  } else {
    try {
      const r = runAudit(resolved);
      sections.audit = {
        errors: r.errors, warns: r.warns,
        findings: r.findings.map((f) => ({ severity: f.level === 'error' ? 'error' : 'warning', text: f.text })),
      };
    } catch (e) {
      // no .html found, or an unreadable path - not a crash, a skipped section.
      sections.audit = { skipped: e.message };
    }
    const sec = securityAudit(resolved);
    const shown = formatSecurity(sec, relative(process.cwd(), resolved) || '.');
    sections.security = {
      errors: shown.high, warns: shown.medium, low: shown.low, note: shown.note,
      findings: sec.findings.map((f) => ({
        severity: f.level === 'high' ? 'error' : f.level === 'medium' ? 'warning' : f.level,
        text: (f.file ? `${f.file}${f.line ? ':' + f.line : ''}: ` : '') + f.text,
      })),
    };
  }

  // Render + quality are one browser pass: formatReport already folds the
  // frame-rate/script-weight/type-scale judge in whenever `measured` is on
  // (see inspect.mjs formatReport), so this is audit+debug+quality's browser
  // half in a single navigation per width instead of three.
  const debugResult = await debugSite(target, {
    widths: opts.widths || [1440, 390],
    wait: opts.wait ?? 1800,
    motion: 'both',
    scrolls: 'auto',
    measured: true,
  });
  sections.render = {
    errors: debugResult.errors, warns: debugResult.warns,
    findings: classifyLines(debugResult.text),
    reviewFile: debugResult.file,
  };

  const totals = { error: 0, warning: 0, low: 0, note: 0 };
  for (const s of Object.values(sections)) {
    if (!s.findings) continue;
    for (const f of s.findings) totals[f.severity] = (totals[f.severity] || 0) + 1;
  }
  // Exactly what already exits 1 today: audit errors, a render/quality ERROR,
  // and a high-severity security finding. Nothing new is being made fatal.
  const exitCode = totals.error ? 1 : 0;
  return { target: isUrl ? target : relative(process.cwd(), resolved) || '.', sections, totals, exitCode };
}

export function formatVerify(result) {
  const lines = [];
  lines.push(`\nwebdesign verify  ${result.target}`);
  lines.push(`  ${result.totals.error} error(s), ${result.totals.warning} warning(s), ${result.totals.low} low, ${result.totals.note} note(s)`);
  for (const [name, s] of Object.entries(result.sections)) {
    lines.push(`\n  -- ${name} --`);
    if (s.skipped) { lines.push(`  skipped: ${s.skipped}`); continue; }
    if (!s.findings.length) { lines.push('  ok    nothing found'); continue; }
    for (const f of s.findings) {
      const tag = f.severity === 'error' ? 'ERROR' : f.severity === 'warning' ? 'warn ' : f.severity === 'low' ? 'low  ' : 'note ';
      lines.push(`  ${tag} ${f.text}`);
    }
  }
  if (result.sections.render?.reviewFile) lines.push(`\n  visual review: ${result.sections.render.reviewFile}`);
  return lines.join('\n');
}
