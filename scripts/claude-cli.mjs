import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { homedir } from 'node:os';

// Execute a real executable (or the older npm JS entry point), never a shell.
export function findClaude({ env = process.env, platform = process.platform, exists = existsSync } = {}) {
  const dirs = (env.PATH || env.Path || '').split(platform === 'win32' ? ';' : delimiter).filter(Boolean);
  if (platform === 'win32') {
    dirs.push(join(env.USERPROFILE || homedir(), '.local', 'bin'));
    if (env.APPDATA) dirs.push(join(env.APPDATA, 'npm'));
  }
  for (const dir of dirs) {
    for (const candidate of platform === 'win32'
      ? [join(dir, 'claude.exe'), join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')]
      : [join(dir, 'claude')]) {
      if (exists(candidate)) return { file: candidate, prefix: [] };
    }
    const js = join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
    if (exists(js)) return { file: process.execPath, prefix: [js] };
  }
  return null;
}
export function runClaude(cli, args, { spawn = spawnSync } = {}) {
  return spawn(cli.file, [...cli.prefix, ...args], { encoding: 'utf8', shell: false, windowsHide: true });
}
export function removeTables(text, headers) {
  const wanted = new Set(headers);
  let skip = false;
  return text.split(/(?<=\n)/).filter((line) => {
    const header = line.trim().match(/^(\[.*\])\s*(?:#.*)?$/);
    if (header) skip = wanted.has(header[1]);
    return !skip;
  }).join('');
}
