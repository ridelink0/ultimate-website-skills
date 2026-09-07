#!/usr/bin/env node
// Optional official Claude Design connection; no remote content is uploaded here.
import { findClaude, runClaude } from './claude-cli.mjs';
const args = process.argv.slice(2);
if (args.some(a => !['setup', '--dry-run'].includes(a)) || !args.includes('setup')) {
  console.log('Usage: node scripts/design.mjs setup [--dry-run]');
  process.exitCode = args.length ? 1 : 0;
} else {
  const command = ['mcp', 'add', '--scope', 'user', '--transport', 'http', 'claude-design', 'https://api.anthropic.com/v1/design/mcp'];
  if (args.includes('--dry-run')) console.log('claude ' + command.join(' '));
  else {
    const cli = findClaude();
    if (!cli) { console.error('Claude Code CLI not found. See skills/cinematic-web-design/references/claude-design.md.'); process.exitCode = 1; }
    else {
      const result = runClaude(cli, command);
      process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
      process.exitCode = result.status === 0 ? 0 : 1;
      if (result.status === 0) console.log('In Claude Code, run /design-login, then /design-sync when you want to import your design system.');
    }
  }
}
