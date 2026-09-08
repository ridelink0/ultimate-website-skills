import { existsSync, readFileSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { startServer } from './preview-server.mjs';
import { inspect } from './inspect.mjs';
import { writeReview } from './review.mjs';

export async function debugSite(target, { out, widths = [1440, 390], wait = 1800, motion = 'both', actions = [], scrolls = 'auto', measured = false } = {}) {
  if (!['normal', 'reduce', 'both'].includes(motion)) throw new Error('Motion must be normal, reduce or both.');
  const destination = resolve(out || mkdtempSync(join(tmpdir(), 'webdesign-review-')));
  let server, url = target;
  if (!/^https?:\/\//i.test(target)) {
    const dir = resolve(target);
    if (!existsSync(dir)) throw new Error('Directory does not exist: ' + dir);
    server = startServer(dir, 0);
    await once(server, 'listening');
    url = 'http://127.0.0.1:' + server.address().port + '/';
  }
  const results = [];
  try {
    for (const reduce of motion === 'both' ? [false, true] : [motion === 'reduce']) {
      results.push(...await inspect(url, { widths, wait, scrolls, actions, measured, reducedMotion: reduce, out: join(destination, reduce ? 'reduced' : 'normal') }));
    }
    return { ...writeReview(results, destination, target), results, out: destination };
  } finally { if (server) await new Promise(resolve => server.close(resolve)); }
}
export function readActions(file) {
  if (!file) return [];
  const data = JSON.parse(readFileSync(resolve(file), 'utf8'));
  if (!Array.isArray(data)) throw new Error('Actions file must contain a JSON array.');
  return data;
}
