# Atelier consolidation

Cinematic Web Design 3.0.0 is the combined plugin. All 21 Atelier section IDs, its bone/ink/cinema presets, CSS/motion assets and supporting references are retained alongside Cinematic's newer tools and fable preset.

Use `/webdesign` or `/cinematic-web-design:atelier` in Claude Code. The CLI alias `node scripts/atelier.mjs` dispatches to the same implementation and retains the bone default. `node scripts/webdesign.mjs` is the canonical CLI. There is one design skill, so installing the combined plugin does not load competing copies.

Install the combined plugin:

```sh
claude plugin marketplace add ridelink0/cinematic-web-design
claude plugin install cinematic-web-design@cinematic-web-design
```

After confirming the combined plugin loads, remove the separate old installation with `claude plugin uninstall atelier@atelier`. Existing project files do not need migration. Codex users can run `node scripts/install.mjs` from the combined checkout and disable the old Atelier installation in their plugin controls.

The old Atelier repository remains available with the same preview/installer security fixes. New feature work belongs here. This release does not delete repositories or alter existing websites.

[Claude Design connection and handoff](../skills/cinematic-web-design/references/claude-design.md).
