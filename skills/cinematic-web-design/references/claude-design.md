# Claude Design with Cinematic Web Design

Verified 7 September 2026 against Anthropic's current documentation.

Claude Design can connect directly to Claude Code using Anthropic's HTTP MCP server. It supports design/code handoff and shares the Claude account's usage pool with chat, Code and Cowork; it no longer has a separate allowance. [Official setup and usage documentation](https://support.claude.com/en/articles/14604416-get-started-with-claude-design).

## Connect once

From this plugin checkout, run:

```sh
node scripts/design.mjs setup
```

The helper registers the official command below. If the server is already registered, inspect it with Claude Code's MCP controls instead of adding a duplicate.

```sh
claude mcp add --scope user --transport http claude-design https://api.anthropic.com/v1/design/mcp
```

In Claude Code, run `/design-login` to authenticate. Use `/design-sync` when you want to import your codebase's design system. These are host commands; the plugin does not store credentials or simulate a login. [Anthropic's connection steps](https://support.claude.com/en/articles/14604416-get-started-with-claude-design).

## Workflow for this plugin

1. Read the brief and existing project. Prefer the user's existing Design project and design system when provided.
2. Discover the connected Design server's available tools. Do not guess tool names or claim a remote operation succeeded without its result.
3. Use Design to develop the layout and visual direction, retaining a concrete project reference. Keep the iteration scoped to the requested page and its mobile behavior.
4. Import the chosen result or handoff bundle into the codebase. Retain its typography, spacing, composition, assets and components. Translate to the project's framework; replace prototype-only behavior with working interactions.
5. Use Cinematic's section library, CSS and motion only where compatible with that result. Its house style is a fallback, never a reason to overwrite the chosen Design direction.
6. Run source checks, framework checks and browser checks at desktop/mobile sizes. Fix overflow, broken controls, placeholder copy and reduced-motion behavior. Compare the rendered implementation with the Design reference.

A complete design system with real component examples gives Design stronger inputs than a loose color list. [Design-system setup](https://support.claude.com/en/articles/14604397-set-up-your-design-system-in-claude-design). The workflow above is this plugin's implementation recommendation, not a guarantee of a particular visual quality.

## If connection is unavailable

Check the current Claude Code version, account eligibility and organization settings. Use the Design app's export/handoff to a local coding agent, or supply its exported HTML/ZIP to Claude Code. Never call the service authenticated merely because the setup command succeeded. Local scaffolding remains usable without Design.

The official connection and handoff are documented; authenticated design creation was not exercised during this repository audit. Visual quality remains project-specific and needs an actual browser review.
