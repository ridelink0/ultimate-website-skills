Cinematic Web Design 3.0.0 now includes Atelier. [Migration and aliases](docs/merge.md) · [Claude Design setup](skills/cinematic-web-design/references/claude-design.md)

# cinematic-web-design

A pinned art direction for websites, plus the code that produces it.

Coding agents converge on the same page: Inter everywhere, an indigo-to-pink
gradient, three feature cards with icon circles, everything centred, 16px radius
on everything, and copy about unleashing your potential. It is recognisable
enough that people have built scanners for it.

cinematic-web-design replaces that default with a different one: editorial serif typography at
real optical sizes, warm-neutral and near-black grounds in OKLCH, cinematic
photography with eased scrims, layered scroll parallax, and exploded technical
views built from stacked 2D layers rather than a 3D engine.

**No more SVGs.** Hand-drawn vector silhouettes were how this plugin used to
fake depth, and they read as exactly that. Depth now comes from real WebGL and
real photography: an animated shader gradient, three parallax planes that blur
and haze with distance, and three.js for anything taken apart. SVG is kept for
what it is genuinely best at - line art, blueprints, icons - and nothing else.

It works in **Claude Code** and **Codex**.

## It wires itself

The scaffolder emits only the engines a page actually uses, so a page with no
3D never downloads three.js, and the audit checks it both ways: an engine's
markup with no script behind it is an error, and a script nothing uses is a
warning. `look` now captures console errors and uncaught exceptions too, so a
failed shader compile or a missing import fails the check instead of quietly
rendering less than it should.

## Install

```bash
git clone https://github.com/ridelink0/cinematic-web-design
node cinematic-web-design/scripts/install.mjs
```

That registers the plugin with both CLIs. Or do it by hand:

```bash
# Claude Code
claude plugin marketplace add ridelink0/cinematic-web-design
claude plugin install cinematic-web-design@cinematic-web-design
```

```toml
# Codex - ~/.codex/config.toml
[marketplaces.cinematic-web-design]
source_type = "git"
source = "https://github.com/ridelink0/cinematic-web-design.git"

[plugins."cinematic-web-design@cinematic-web-design"]
enabled = true
```

## Use

Ask for a website. The skill triggers on its own:

> Build me a landing page for a roofing company in Houston

Or drive it directly:

```
/webdesign a microsite for the Old Bridge at Mostar
/webdesign audit ./my-site
```

## What is in it

**`skills/cinematic-web-design/SKILL.md`** - the doctrine. Short, because the code carries the
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

**`assets/gradient.js`** - an animated WebGL mesh gradient. Layered simplex
noise with domain warping, mixed in linear space, dithered against banding,
paused off-screen, one static frame under reduced motion, CSS mesh fallback.

**`assets/depth.js`** - real three-plane parallax. A signed `data-depth` sets
each plane's rate against scroll AND pointer, and drives blur and haze from the
same number. Also single-photo 3D from a depth map.

**`assets/exploded.js`** - any made thing taken apart in three.js, reading its
layers from an `<ol>` so the semantic list is the no-JS fallback.

**`assets/sections.html`** - twenty-three section archetypes.

**`scripts/webdesign.mjs`** - the tool.

```
webdesign.mjs new <dir> [--preset bone|ink|cinema] [--name "X"] [--sections a,b,c]
webdesign.mjs sections                 list the library and the presets
webdesign.mjs add <id> [--to <file>]   insert one section
webdesign.mjs audit <dir>              source check: copy, semantics, the tells
webdesign.mjs look <dir|url>           RENDER it at two scroll positions: overlap, overflow, contrast, PNGs
webdesign.mjs cut <photo>              one photograph into parallax planes (rembg, local)
webdesign.mjs study --list editorial   render a batch of reference sites into contact sheets
webdesign.mjs serve <dir>              local preview
```

**`references/stack.md`** - which library for which job, with specifiers
verified against the registry and CDN URLs that resolve. anime.js v4 gets its
own section because every tutorial online is v3.

**`references/`** - typography, motion, imagery, composition, tells, and the
pre-ship checklist. Loaded only when needed, so they cost nothing the rest of the time.

## Looking, not just reading

`webdesign.mjs look` is the half that matters. It drives a real headless browser
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

`webdesign.mjs audit` is the part that keeps the output honest. It fails the build
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

## Website debugger

Run node scripts/webdesign.mjs debug <site-directory-or-url> --out review to capture desktop/mobile, scrolling, interactions and reduced motion in an HTML gallery. Claude and Codex must open the PNGs before reporting a visual pass. See [visual debugging](skills/cinematic-web-design/references/visual-debug.md) for action files and reference-video extraction.
