# Historical baseline — before the fixes

This records the original findings. Original reproduction command names describe the historical local run; the shipped regression tests cover the repaired behavior. Read [the final verification report](README.md) for their resolution and the final tested scope. Source permalinks intentionally point to the reviewed pre-fix commits.

# GitHub plugin bug audit — 7 September 2026

Reviewed all 11 repositories exposed by the connected GitHub account, **ridelink0**, at the default-branch commits listed below. Found **9 actionable bug categories across 7 repositories**. The highest priorities are file disclosure in the two design preview servers and invalid paths throughout the Toolkit marketplace.

This is a broad structural review with targeted runtime testing. It is not an exhaustive behavior or security audit of every bundled plugin. Three repositories contain reference lists rather than executable plugins. No GitHub changes were made and no product source files were edited.

## Confirmed findings

### 1. High — Preview servers can disclose files outside the served directory

**Atelier and Cinematic Web Design.** The containment check compares string prefixes after joining the requested path. A sibling directory named `site-private` passes the check for a served directory named `site`. Requesting `/..%2fsite-private%2fmarker.txt` returned HTTP 200 and the dummy marker from that sibling directory in both implementations. The servers also listen without an explicit loopback address, so reachability may extend beyond the local machine depending on networking and firewall settings.

Use a directory-boundary-aware containment check, account for symbolic links, and bind local previews explicitly to loopback. Handle file-read failures as HTTP errors.

Sources: [Atelier, lines 538–547](https://github.com/ridelink0/atelier/blob/c1387191e0f3a46a59cc58cffbd0db6d0af6b240/scripts/atelier.mjs#L538-L547), [Cinematic Web Design, lines 593–603](https://github.com/ridelink0/cinematic-web-design/blob/763dc5981d06bfce7e0572d9df43ce33d88102d0/scripts/webdesign.mjs#L593-L603). Reproduction: `node reproduce-servers.cjs`; evidence: [server-results.json](baseline-evidence/server-results.json). Only audit fixtures were requested.

### 2. High — Toolkit's marketplace and all 120 bundled plugins fail manifest validation

**awesome-claude-code-toolkit.** All 120 marketplace sources use paths such as `plugins/a11y-audit`, and all 120 plugin command declarations use paths such as `commands/debug.md`. These lack the required `./` prefix. Claude Code 2.1.261 rejects both the marketplace and the individual manifests. The root plugin also declares `author` as a string instead of an object, and fails validation independently.

Prefix local paths with `./` and convert the root author to `{ "name": "Rohit Ghumare" }`. Confirm both catalog and individual plugin validation after correcting them. The path requirement is documented in the [official plugin reference](https://code.claude.com/docs/en/plugins-reference).

Sources: [marketplace source](https://github.com/ridelink0/awesome-claude-code-toolkit/blob/ebdf1d596d2cde5c5cceb32177e8d1cf4829e7d9/.claude-plugin/marketplace.json#L20-L23), [representative plugin](https://github.com/ridelink0/awesome-claude-code-toolkit/blob/ebdf1d596d2cde5c5cceb32177e8d1cf4829e7d9/plugins/bug-detective/.claude-plugin/plugin.json#L5), [root author](https://github.com/ridelink0/awesome-claude-code-toolkit/blob/ebdf1d596d2cde5c5cceb32177e8d1cf4829e7d9/.claude-plugin/plugin.json#L5). Evidence: [manifest-results.json](baseline-evidence/manifest-results.json) — 122 failed Toolkit targets, consisting of 120 plugins, the root plugin, and the marketplace.

### 3. Medium — One malformed URL terminates either preview server

**Atelier and Cinematic Web Design.** Requesting `/%ZZ` throws an uncaught `URIError` from `decodeURIComponent`. Both server processes exited with code 1, dropping the preview instead of returning an HTTP error.

Catch URL/percent-decoding errors and return HTTP 400 without stopping the server. Sources: [Atelier line 538](https://github.com/ridelink0/atelier/blob/c1387191e0f3a46a59cc58cffbd0db6d0af6b240/scripts/atelier.mjs#L538), [Cinematic line 593](https://github.com/ridelink0/cinematic-web-design/blob/763dc5981d06bfce7e0572d9df43ce33d88102d0/scripts/webdesign.mjs#L593). Evidence: [server-results.json](baseline-evidence/server-results.json).

### 4. Medium — Windows installers split source paths containing spaces

**Atelier and Cinematic Web Design.** The installers pass an argument array through `spawnSync(..., { shell: true })` on Windows without quoting the source argument. A harmless CLI stub received `C:\Audit`, `Fixtures\my`, and `plugin` as three arguments when the intended marketplace source was `C:\Audit Fixtures\my plugin`. This breaks installation from ordinary folders containing spaces.

Resolve an executable that can be invoked without a shell, or implement correct Windows shell quoting when a command shim requires the shell. Sources: [Atelier installer line 54](https://github.com/ridelink0/atelier/blob/c1387191e0f3a46a59cc58cffbd0db6d0af6b240/scripts/install.mjs#L54), [Cinematic installer line 54](https://github.com/ridelink0/cinematic-web-design/blob/763dc5981d06bfce7e0572d9df43ce33d88102d0/scripts/install.mjs#L54). Reproduction: `node reproduce-installers.cjs`; evidence: [installer-results.json](baseline-evidence/installer-results.json). The reproduction replaced the real installer integrations with stubs and did not edit application settings.

### 5. Medium — Computer Use cannot retry a failed host build

**claude-computer-use.** When `ensureHost()` throws synchronously, the Promise executor clears `this.starting`, but the outer assignment immediately replaces that null with the rejected Promise. Every subsequent `start()` returns that same rejection. Repairing a temporary compiler or filesystem problem does not trigger another build in that server session.

A fault-injected reproduction called `start()` twice and observed only one call to `ensureHost()`, with the original error returned twice. Clear the cached startup Promise after rejection, outside the synchronous executor assignment, so a later call can retry.

Source: [driver.mjs lines 38–47](https://github.com/ridelink0/claude-computer-use/blob/6126e81d623393e8ac9c73c0b899ae1f9724f7fc/server/driver.mjs#L38-L47). Reproduction: `node reproduce-driver.cjs`; evidence: [driver-results.json](baseline-evidence/driver-results.json). This uses the original Driver class with a stubbed build function; it does not manipulate desktop windows.

### 6. Medium — BuildWithClaude's validator rejects valid commands on Windows

**buildwithclaude.** `globSync()` supplies Windows paths containing backslashes, but `file.includes('/commands/')` only recognizes forward slashes. Commands are therefore validated against the agent schema. The unmodified validator failed with **512 errors**. Running an in-memory copy with only the path classification changed to `file.split(path.sep).includes('commands')` passed.

Normalize separators before classifying paths, and add Windows coverage to this validator's tests. Source: [validate-subagents.js lines 53–55](https://github.com/ridelink0/buildwithclaude/blob/d16bece4e3517554f09b4d66973090cd168b7ac6/scripts/validate-subagents.js#L53-L55). Evidence: [bwc-validate.log](baseline-evidence/bwc-validate.log), [bwc-normalized.log](baseline-evidence/bwc-normalized.log); reproduction: `node reproduce-bwc-validation.cjs`.

### 7. Medium — The bundled Claude HUD declares an invalid command directory

**buildwithclaude / claude-hud.** Its manifest sets `commands` to `${CLAUDE_PLUGIN_ROOT}/commands`. That placeholder is not a valid plugin-component path in this field. Claude's validator rejects the manifest and reports the literal path as missing; the containing marketplace validation also fails on this entry.

Set `commands` to `./commands`, or omit it and use the default directory. Source: [Claude HUD manifest line 13](https://github.com/ridelink0/buildwithclaude/blob/d16bece4e3517554f09b4d66973090cd168b7ac6/plugins/claude-hud/.claude-plugin/plugin.json#L13). Evidence: [manifest-results.json](baseline-evidence/manifest-results.json).

### 8. Medium — Malformed YAML causes metadata to be discarded in 16 files

**awesome-claude-plugins: 5 files; buildwithclaude: 11 files.** Unquoted descriptions contain colon-space sequences, producing YAML parse failures. Claude's validator explicitly reports that affected skills/commands load with empty metadata, while affected agents lose their frontmatter fields apart from a filename-derived name. This loses descriptions and, where present, tool settings.

Affected plugins include `backend-architect`, `frontend-developer`, `test-writer-fixer`, `create-pr`, `skill-bus`, `claude-ops`, `dsh-deepread`, and nine skills in `venture-capital-intelligence`. An independent YAML parser confirmed all 16 failures. Quote the descriptions or use YAML block scalars (`description: >-`).

Examples: [create-pr line 2](https://github.com/ridelink0/awesome-claude-plugins/blob/e521f7ada8d89abea888e67b93b4dcfbb977041f/create-pr/commands/create-pr.md#L2), [ops-package line 3](https://github.com/ridelink0/buildwithclaude/blob/d16bece4e3517554f09b4d66973090cd168b7ac6/plugins/claude-ops/skills/ops-package/SKILL.md#L3). The complete file list and precise parser lines are in [frontmatter-results.json](baseline-evidence/frontmatter-results.json) and the appendix below.

### 9. Medium — The nested skill marketplace points to 107 missing directories

**awesome-claude-skills.** Every one of the 107 local `source` entries in `composio-skills/.claude-plugin/marketplace.json` points to a directory that does not exist beneath that marketplace root. For example, it declares `./brand-guidelines`, but there is no `composio-skills/brand-guidelines`; `./slack-automation` is also absent there. Parsing the catalog successfully does not make those plugins installable.

Regenerate the catalog from the actual folder layout, remove stale entries, and validate source existence. Source: [nested marketplace, lines 11–15](https://github.com/ridelink0/awesome-claude-skills/blob/be2a406907dbc61b73e6827ded415c96139d13a2/composio-skills/.claude-plugin/marketplace.json#L11-L15). Evidence: all 107 missing-source records in [structure-results.json](baseline-evidence/structure-results.json).

## Coverage and test results

Inspected inventories totaling **4,609 tracked files**. Automated checks covered **378 JSON files**, **429 JavaScript files**, **177 Python files**, **2,327 YAML frontmatter blocks**, and **303 Claude plugin/catalog validation targets**. JavaScript and Python syntax checks passed. There are **16 confirmed malformed frontmatter blocks**.

The 303 Claude validation targets include an auxiliary root `awesome-claude-plugins/marketplace.json` that is invalid as a Claude marketplace, while that repository's actual `.claude-plugin/marketplace.json` passes. This auxiliary file is retained in the raw results but is not presented as an installation bug. Of the 303 targets, 133 report failures; those overlap by root cause and are not 133 distinct bugs. Four Codex manifests received JSON and file-path checks, not a live Codex installation test.

**751 existing tests/checks passed:**

| Test group | Result |
|---|---:|
| Usage Limits full Node test suite | 531 passed |
| Computer Use policy, sessions, Astra recovery, and private native build suites | 166 passed |
| BuildWithClaude repository unit tests | 17 passed |
| BuildWithClaude checkpoint and RAG skill tests | 17 passed |
| PDF bounding-box tests in both skill collections | 20 passed |

Both design scaffolds were generated and audited. Each reported only its expected placeholder-copy error and a short-description warning; those are not counted as bugs. BuildWithClaude's hooks and skills contribution validators passed, while its command/agent validator failed as described in finding 6.

Usage Limits' [GitHub CI run at the reviewed commit](https://github.com/ridelink0/claude-code-usage-limits/actions/runs/34141442244) also passed. GitHub returned zero workflow runs for the BuildWithClaude and Awesome Claude Skills forks. The remaining repositories have no tracked GitHub Actions workflows in the reviewed snapshots.

| Repository | Reviewed commit | Outcome |
|---|---|---|
| atelier | `c1387191e0f3` | Findings 1, 3, 4; manifest and scaffold checks passed |
| cinematic-web-design | `763dc5981d06` | Findings 1, 3, 4; manifest and scaffold checks passed |
| claude-computer-use | `6126e81d6233` | Finding 5; 166 existing checks passed |
| claude-code-usage-limits | `62ceb7a60a93` | No confirmed bug in this pass; 531 tests and current CI passed |
| awesome-claude-code-toolkit | `ebdf1d596d2c` | Finding 2; syntax and YAML checks passed |
| awesome-claude-plugins | e521f7ada8d89 | Finding 8; actual marketplace schema passes |
| awesome-claude-skills | `be2a406907db` | Finding 9; Python syntax, YAML, and PDF tests passed |
| buildwithclaude | `d16bece4e351` | Findings 6, 7, 8; unit and standalone skill tests passed |
| behisecc-acs | `e3d2916d0c4f` | Reference list; no executable plugin or manifest |
| jqs-acc | `f78e2ee334de` | Reference list; no executable plugin or manifest |
| travisvn-acs | `1da55aa810f2` | Reference list; no executable plugin or manifest |

Live desktop-control suites, macOS execution, remote service integrations, full web-app builds, and end-to-end installation of hundreds of plugins were not run. External links in reference lists were not exhaustively checked. Passing syntax or tests does not establish that a plugin is bug-free.

All reproduction scripts, raw JSON findings, and test logs are saved alongside this report. Start with findings 1 and 2, then fix the shared design installer/server issues and the isolated Windows/retry bugs. Add manifest and frontmatter validation to CI to prevent the packaging failures from returning.

## Appendix — malformed metadata

| Repository | File | Line |
|---|---|---:|
| awesome-claude-plugins | [backend-architect/agents/backend-architect.md](https://github.com/ridelink0/awesome-claude-plugins/blob/e521f7ada8d89abea888e67b93b4dcfbb977041f/backend-architect/agents/backend-architect.md#L3) | 3 |
| awesome-claude-plugins | [create-pr/commands/create-pr.md](https://github.com/ridelink0/awesome-claude-plugins/blob/e521f7ada8d89abea888e67b93b4dcfbb977041f/create-pr/commands/create-pr.md#L2) | 2 |
| awesome-claude-plugins | [frontend-developer/agents/frontend-developer.md](https://github.com/ridelink0/awesome-claude-plugins/blob/e521f7ada8d89abea888e67b93b4dcfbb977041f/frontend-developer/agents/frontend-developer.md#L3) | 3 |
| awesome-claude-plugins | [skill-bus/commands/complete.md](https://github.com/ridelink0/awesome-claude-plugins/blob/e521f7ada8d89abea888e67b93b4dcfbb977041f/skill-bus/commands/complete.md#L2) | 2 |
| awesome-claude-plugins | [test-writer-fixer/agents/test-writer-fixer.md](https://github.com/ridelink0/awesome-claude-plugins/blob/e521f7ada8d89abea888e67b93b4dcfbb977041f/test-writer-fixer/agents/test-writer-fixer.md#L3) | 3 |
| buildwithclaude | [plugins/claude-ops/skills/ops-package/SKILL.md](https://github.com/ridelink0/buildwithclaude/blob/d16bece4e3517554f09b4d66973090cd168b7ac6/plugins/claude-ops/skills/ops-package/SKILL.md#L3) | 3 |
| buildwithclaude | [plugins/dsh-deepread/skills/dsh-deepread/SKILL.md](https://github.com/ridelink0/buildwithclaude/blob/d16bece4e3517554f09b4d66973090cd168b7ac6/plugins/dsh-deepread/skills/dsh-deepread/SKILL.md#L3) | 3 |
| buildwithclaude | [plugins/venture-capital-intelligence/skills/analyze-pitch-deck/SKILL.md](https://github.com/ridelink0/buildwithclaude/blob/d16bece4e3517554f09b4d66973090cd168b7ac6/plugins/venture-capital-intelligence/skills/analyze-pitch-deck/SKILL.md#L3) | 3 |
| buildwithclaude | [plugins/venture-capital-intelligence/skills/cap-table-waterfall/SKILL.md](https://github.com/ridelink0/buildwithclaude/blob/d16bece4e3517554f09b4d66973090cd168b7ac6/plugins/venture-capital-intelligence/skills/cap-table-waterfall/SKILL.md#L3) | 3 |
| buildwithclaude | [plugins/venture-capital-intelligence/skills/deal-sourcing-signals/SKILL.md](https://github.com/ridelink0/buildwithclaude/blob/d16bece4e3517554f09b4d66973090cd168b7ac6/plugins/venture-capital-intelligence/skills/deal-sourcing-signals/SKILL.md#L3) | 3 |
| buildwithclaude | [plugins/venture-capital-intelligence/skills/explain-equity-terms/SKILL.md](https://github.com/ridelink0/buildwithclaude/blob/d16bece4e3517554f09b4d66973090cd168b7ac6/plugins/venture-capital-intelligence/skills/explain-equity-terms/SKILL.md#L3) | 3 |
| buildwithclaude | [plugins/venture-capital-intelligence/skills/financial-model/SKILL.md](https://github.com/ridelink0/buildwithclaude/blob/d16bece4e3517554f09b4d66973090cd168b7ac6/plugins/venture-capital-intelligence/skills/financial-model/SKILL.md#L3) | 3 |
| buildwithclaude | [plugins/venture-capital-intelligence/skills/fund-operations/SKILL.md](https://github.com/ridelink0/buildwithclaude/blob/d16bece4e3517554f09b4d66973090cd168b7ac6/plugins/venture-capital-intelligence/skills/fund-operations/SKILL.md#L3) | 3 |
| buildwithclaude | [plugins/venture-capital-intelligence/skills/hard-screening-startup/SKILL.md](https://github.com/ridelink0/buildwithclaude/blob/d16bece4e3517554f09b4d66973090cd168b7ac6/plugins/venture-capital-intelligence/skills/hard-screening-startup/SKILL.md#L3) | 3 |
| buildwithclaude | [plugins/venture-capital-intelligence/skills/market-size/SKILL.md](https://github.com/ridelink0/buildwithclaude/blob/d16bece4e3517554f09b4d66973090cd168b7ac6/plugins/venture-capital-intelligence/skills/market-size/SKILL.md#L3) | 3 |
| buildwithclaude | [plugins/venture-capital-intelligence/skills/soft-screening-startup/SKILL.md](https://github.com/ridelink0/buildwithclaude/blob/d16bece4e3517554f09b4d66973090cd168b7ac6/plugins/venture-capital-intelligence/skills/soft-screening-startup/SKILL.md#L3) | 3 |
