# atelier

This repo is a plugin for Claude Code and Codex. It teaches a coding agent one
art direction for websites and ships the code that produces it.

## If you are building a website

Read `skills/atelier/SKILL.md` and follow it. That is the whole entry point.
It is written for agents that do not load skills automatically, so it stands on
its own.

The two rules that matter most, restated here in case you read no further:

1. **Nothing about the design goes in your reply.** No palette, no type scale, no
   rationale. Build the files, then say what you made in one or two sentences
   with the paths.
2. **No emoji anywhere** - not in the page, the copy, the commit, or the reply.
   Icons are inline SVG.

## If you are working ON this repo

Layout:

```
.claude-plugin/plugin.json      Claude Code manifest
.claude-plugin/marketplace.json Claude Code catalogue (Codex reads this too)
.codex-plugin/plugin.json       Codex manifest
skills/atelier/SKILL.md         the doctrine
skills/atelier/assets/          core.css, motion.js, sections.html
skills/atelier/references/      loaded on demand
scripts/atelier.mjs             new / sections / add / audit / look / serve
scripts/inspect.mjs             headless-browser render check, over CDP
scripts/cut.py                  photograph -> parallax planes via rembg
scripts/install.mjs             registers with both CLIs
commands/atelier.md             the /atelier slash command
hooks/                          UserPromptSubmit nudge
```

Constraints:

- **Zero dependencies.** Node 18+, built-ins only. Do not add a package.json
  dependency block.
- `core.css` and `motion.js` are copied verbatim into user projects. A change
  there lands in every site built afterwards, so treat them as public API.
- `inspect.mjs` talks to Chrome/Edge/Chromium over the DevTools protocol using
  Node 22's built-in `WebSocket` and `fetch`. Do not add puppeteer.
- Every change to `assets/` or `scripts/` must keep
  `node scripts/atelier.mjs audit` passing on a fresh scaffold:
  ```
  node scripts/atelier.mjs new /tmp/t --name "T" && node scripts/atelier.mjs audit /tmp/t
  ```
  A fresh scaffold is *expected* to fail on scaffold copy and the example email
  address - that is the audit doing its job. Everything else must be clean.
- Keep `SKILL.md` short. Depth belongs in `references/`, which is only read when
  needed. Frontmatter is loaded into every session; the body is not.
