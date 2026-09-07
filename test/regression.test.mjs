import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request } from 'node:http';
import { startServer } from '../scripts/preview-server.mjs';
import { runClaude, findClaude, removeTables } from '../scripts/claude-cli.mjs';

test('preview confines files and symlinks, survives malformed URLs, and listens only on loopback', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'design-preview-'));
  const site = join(temp, 'site'), outside = join(temp, 'site-private');
  mkdirSync(site); mkdirSync(outside);
  writeFileSync(join(site, 'index.html'), 'public');
  writeFileSync(join(outside, 'marker.txt'), 'private');
  symlinkSync(outside, join(site, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const server = startServer(site, 0);
  try {
    await once(server, 'listening');
    assert.equal(server.address().address, '127.0.0.1');
    const get = (path, method = 'GET') => new Promise((resolve, reject) => {
      request({ hostname: '127.0.0.1', port: server.address().port, path, method }, res => {
        let text = ''; res.on('data', c => text += c); res.on('end', () => resolve({ status: res.statusCode, text }));
      }).on('error', reject).end();
    });
    assert.deepEqual(await get('/'), { status: 200, text: 'public' });
    for (const url of ['/..%2fsite-private%2fmarker.txt', '/..%5csite-private%5cmarker.txt', '/linked/marker.txt'])
      assert.equal((await get(url)).status, 404, url);
    for (const url of ['/%ZZ', '/%00']) assert.equal((await get(url)).status, 400, url);
    assert.deepEqual(await get('/', 'HEAD'), { status: 200, text: '' });
    assert.equal((await get('/', 'POST')).status, 405);
    assert.equal((await get('/')).text, 'public');
  } finally { await new Promise(resolve => server.close(resolve)); rmSync(temp, { recursive: true, force: true }); }
});
test('installer sends paths with spaces and shell characters as a single literal argument', () => {
  const temp = mkdtempSync(join(tmpdir(), 'design argv & '));
  try {
    const script = join(temp, 'echo args.cjs');
    writeFileSync(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
    const args = ['plugin', 'marketplace', 'add', join(temp, '[site] & quoted "path"')];
    const result = runClaude({ file: process.execPath, prefix: [script] }, args);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), args);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
test('Windows npm native executable is found without invoking a command shell', () => {
  const bin = join('fake', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  assert.deepEqual(findClaude({ env: { PATH: 'fake' }, platform: 'win32', exists: p => p === bin }), { file: bin, prefix: [] });
});
test('uninstall does not stop at brackets inside a marketplace source string', () => {
  const text = 'model = "example"\n[marketplaces.test]\nsource = "C:/[sites]/a"\n[plugins."test@test"]\nenabled = true\n[other]\narray = ["x"]\n';
  assert.equal(removeTables(text, ['[marketplaces.test]', '[plugins."test@test"]']), 'model = "example"\n[other]\narray = ["x"]\n');
});

import { parseArgs } from '../scripts/args.mjs';
test('flag values do not become paths or study URLs', () => {
  const a = parseArgs(['new', '--name', 'Example name', 'output', '--preset=ink']);
  assert.deepEqual(a.positional, ['output']); assert.equal(a.flag('preset'), 'ink');
  assert.throws(() => parseArgs(['new', '--name']), /Missing value/);
});
