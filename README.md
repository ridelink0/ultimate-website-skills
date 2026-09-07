# atelier

A pinned art direction for websites, plus the code that produces it.

Coding agents converge on the same page: Inter everywhere, an indigo-to-pink
gradient, three feature cards with icon circles, everything centred, 16px radius
on everything, and copy about unleashing your potential. It is recognisable
enough that people have built scanners for it.

atelier replaces that default with a different one: editorial serif typography at
real optical sizes, warm-neutral and near-black grounds in OKLCH, cinematic
photography with eased scrims, layered scroll parallax, and exploded technical
views built from stacked 2D layers rather than a 3D engine.

It works in **Claude Code** and **Codex**.

## Install

```bash
git clone https://github.com/ridelink0/atelier
node atelier/scripts/install.mjs
```

That registers the plugin with both CLIs. Or do it by hand:

```bash
# Claude Code
claude plugin marketplace add ridelink0/atelier
claude plugin install atelier@atelier
```

```toml
# Codex - ~/.codex/config.toml
[marketplaces.atelier]
source_type = "git"
source = "https://github.com/ridelink0/atelier.git"

[plugins."atelier@atelier"]
enabled = true
```

## Use

Ask for a website. The skill triggers on its own:

> Build me a landing page for a roofing company in Houston

Or drive it directly:

```
/atelier a microsite for the Old Bridge at Mostar
/atelier audit ./my-site
```

## What is in it

**`skills/atelier/SKILL.md`** - the doctrine. Short, because the code carries the
design rather than the prose describing it.

**`assets/core.css`** - the chassis, copied into the project verbatim. Tokens,
reset, a fluid type scale computed to land exactly on its bounds, a 12-column
grid with breakout lines, nav, buttons, hero, dot-leader index, stats, glass
cards, frames, annotation callouts, the layered/exploded stack, spec table,
steps, accordion, form, marquee, grain, vignette, reveals, scroll progress.

**`assets/motion.js`** - dependency-free, one rAF loop for every scroll effect,
degrades to a fully visible page. `.r` reveals, `data-px` parallax, `data-tilt`
pointer parallax, `data-count` counters, `data-magnetic` buttons, `data-split`
per-word headline reveal, nav shrink, scroll progress.

**`assets/sections.html`** - eighteen section archetypes.

**`scripts/atelier.mjs`** - the tool.

```
atelier.mjs new <dir> [--preset bone|ink|cinema] [--name "X"] [--sections a,b,c]
atelier.mjs sections                 list the library and the presets
atelier.mjs add <id> [--to <file>]   insert one section
atelier.mjs audit <dir>              source check: copy, semantics, the tells
atelier.mjs look <dir|url>           RENDER it at two scroll positions: overlap, overflow, contrast, PNGs
atelier.mjs cut <photo>              one photograph into parallax planes (rembg, local)
atelier.mjs serve <dir>              local preview
```

**`references/`** - typography, motion, imagery, composition, and the pre-ship
checklist. Loaded only when needed, so they cost nothing the rest of the time.

## Looking, not just reading

`atelier.mjs look` is the half that matters. It drives a real headless browser
over CDP - no dependencies, using Node's built-in fetch and WebSocket - loads
the page at 1440 and 390, and reports the bugs that only exist once something is
painted: **text overlapping text**, content past the viewport, contrast measured
against the background actually behind an element (including `oklch()` and
`color-mix()`, which every naive checker gets wrong), elements collapsed to zero,
images that failed to load, and tap targets under 24px. It writes a PNG at each
width so the agent can look at what it built.

A layer covering half the composition passes every static check ever written.
This is how you catch it.

## The audit

`atelier.mjs audit` is the part that keeps the output honest. It fails the build
on placeholder copy, emoji, missing `alt`, missing image dimensions, pure black
or white, undefined custom properties, absent `prefers-reduced-motion` handling,
duplicate ids, dead `href="#"` links, anchors pointing at ids that do not exist,
unlabelled form controls, more than one `<h1>`, skipped heading levels, and
`data-px` without `motion.js`. It warns on Instrument Serif, Playfair Display,
a missing grain layer, no negative letter-spacing, and no display line-height
under 1.

Zero Node dependencies. Node 18+. `cut` needs Python with `rembg[cpu]`.

## Why it looks the way it does

Three reference sites, reverse-engineered: a product launch page with a
photographic hero and a dot-leader contents block; a watch brand alternating bone
and near-black with a blueprint section and an exploded view; a city microsite
with a giant wordmark parallaxing behind a bridge. The common language is one
serif family carrying the page, tiny letterspaced labels, enormous negative
space, a single accent taken from the photography, and depth built from layers
rather than effects.

The specific numbers - `line-height: 0.92` on the hero, `-0.030em` tracking,
`max-width: 16ch`, grain at 0.055 multiply on bone and 0.13 overlay on ink, the
ten-stop eased scrim - are in the reference files with their reasoning.

MIT.
