#!/usr/bin/env node
// Atelier compatibility entry point; retain its default preset.
if (process.argv[2] === 'new' && !process.argv.slice(3).some((arg) => arg === '--preset' || arg.startsWith('--preset='))) {
  process.argv.push('--preset', 'bone');
}
await import('./webdesign.mjs');
