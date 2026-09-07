---
name: atelier
description: Use whenever a website, landing page, marketing site, portfolio, microsite, homepage, or any public-facing web page is being built, redesigned, restyled, or made to "look better" - including plain HTML/CSS pages, Next/React/Astro sites, and single-file pages. Supplies the house style (editorial serif typography, warm-neutral and near-black grounds, cinematic imagery, layered scroll parallax, exploded technical views) plus a copy-in CSS chassis, a motion runtime, a section library, a scaffolder, and an audit.
---

# atelier

The studio's house style, and the code that produces it. This is a pinned art
direction, not a menu: build in it unless the person names a different one.

## Rule zero

**Nothing about the design goes in your reply.** No palette, no type scale, no
tokens, no section list, no "I chose a warm bone ground because...", no design
vocabulary at all. Build the files. Then say what you made in one or two plain
sentences and give the paths. If they want the reasoning, they will ask for it.

Never use emoji - not in the page, the copy, the commit, or the reply. Icons are
inline SVG.

Do not present a design plan for approval first, and do not run a separate
brainstorming or moodboard pass. The direction is already decided. Build.

## Fix three things before you type

Hold these in your head, not on the screen: **the subject** (the actual thing,
named concretely), **the register** (is this an object, a place, a service, or
an argument), **the hero** (what the first screen shows). If the brief truly does
not say what the subject is, ask one question. Otherwise decide and go.

## Build

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/atelier.mjs" new <dir> \
  --preset bone --name "Subject Name" \
  --sections nav,hero-photo,manifesto,services,stats,faq,contact,footer
```

That writes `index.html`, `core.css`, `motion.js`, `site.css`, `netlify.toml`.
Then, in order:

1. **Rewrite every word.** Placeholder copy left in a page is a bug, and the
   audit fails on it. Write the real thing: concrete nouns, no adjectives a spec
   sheet would not use, no "elevate/seamless/unlock/transform".
2. **Set the hero image**, then set `--accent-h` in `site.css` to the hue of the
   subject's own material in that image (see `references/imagery.md`).
3. **Add the signature** - one element this page is remembered by, drawn from the
   subject's own world. One. Everything else stays quiet.
4. **Audit**: `node "${CLAUDE_PLUGIN_ROOT}/scripts/atelier.mjs" audit <dir>` -
   must exit 0.

Other commands: `sections` lists the library, `add <id> --to <file>` inserts one,
`serve <dir>` previews at localhost.

**No Node, or a framework project?** Copy `assets/core.css` and `assets/motion.js`
in as-is and take blocks out of `assets/sections.html` by hand. Everything works
as plain files; the script only saves typing. In React/Astro, import `core.css`
globally and translate the section markup to components - keep the class names.

## The rules that do the work

1. **One serif family, two optical sizes.** `opsz 72 wght 320` for display and
   `opsz 16 wght 400` for body of the *same* family beats any pairing. Default is
   Newsreader. Avoid Instrument Serif and Playfair Display - both now read as
   machine-made. See `references/typography.md` before choosing anything else.
2. **Display line-height under 1.0, tracking at or under -0.024em.** These two
   numbers separate editorial from blog more than the typeface does.
3. **`max-width: 16ch` on the hero headline.** Forcing it onto three lines is what
   creates the negative space. A one-line hero cannot look expensive.
4. **Never `#fff`, never `#000`, never a zero-chroma grey.** Every neutral sits in
   hue 60-95. One accent, visible on at most three elements in the whole page.
5. **Leave real air.** `--section-y` is the floor, not the target. If a section
   feels roomy in the editor it is about right in the browser.
6. **Grain is always on.** `<div class="grain">` before `</body>`. If you can see
   it, it is too strong.
7. **Motion earns its place.** Four defaults and nothing else unless the subject
   asks: reveal on enter (`.r`), one parallax relationship, nav shrink, and the
   page's single orchestrated moment. Scattered effects read as generated.
8. **Copy is design material.** Write the words before you fine-tune the spacing.
9. **Quality floor, unannounced.** One `<h1>`, visible keyboard focus, `alt` on
   every image, `width`/`height` on every image, reduced motion respected,
   readable at 360px.
10. **Spend boldness once.** Chanel's rule: before shipping, remove one thing.

## What is in the box

`assets/core.css` is the chassis: tokens, reset, type scale, 12-column grid with
breakout lines, nav, buttons, hero, dot-leader index, stats, glass cards, frames,
callouts, layered/exploded stack, spec table, steps, accordion, form, marquee,
grain, vignette, reveals, progress. **Never edit it inside a project** - put
project choices in `site.css`, which loads after.

`assets/motion.js` is dependency-free and degrades to a fully visible page:
`.r` reveals, `data-px` parallax, `data-tilt` pointer parallax, `data-count`
counters, `data-magnetic` buttons, `data-split` per-word headline reveal, nav
shrink, scroll progress. It respects `prefers-reduced-motion` and uses one rAF
loop for every scroll effect.

Presets (token overrides only): `bone` warm paper, `ink` near-black throughout,
`cinema` photography carries the page.

Sections: `nav`, `hero-photo`, `hero-split`, `hero-layered`, `index`,
`manifesto`, `blueprint`, `exploded`, `stats`, `cards-rail`, `services`, `steps`,
`quote`, `spec`, `gallery`, `faq`, `contact`, `cta`, `footer`.

Choose by register, not by taste:

| Register | Hero | Middle | Close |
|---|---|---|---|
| An object | `hero-split` | `blueprint`, `exploded`, `spec` | `cta` |
| A place | `hero-layered` | `stats`, `cards-rail`, `gallery` | `cta` |
| A service | `hero-photo` | `services`, `steps`, `stats`, `faq` | `contact` |
| An argument | `hero-photo` + `index` | `manifesto`, `quote` | `footer` |

## Depth without a 3D engine

The exploded view and the layered hero are the same trick: stack elements in one
grid cell (`.layers` / `.exploded`), give each a different `data-px`, and they
separate as the page scrolls. Foreground silhouettes can be hand-written SVG, so
a convincing layered hero needs no image asset at all. Reach for three.js only
when the subject is genuinely a 3D object the visitor must turn -
`references/motion.md` has that path and the annotation-callout projection math.

## References

Read one only when you need it. Each is self-contained.

| File | When |
|---|---|
| `references/typography.md` | Choosing or pairing faces, scale, italics, small caps |
| `references/motion.md` | Any scroll animation beyond the four defaults, 3D, pinning |
| `references/imagery.md` | Sourcing, grading, deriving the accent, zero-asset backdrops |
| `references/sections.md` | Composing a section the library does not have |
| `references/checklist.md` | The pre-ship pass, and what the audit cannot see |

## Before you call it done

Run the audit; it must exit 0. Then walk `references/checklist.md`. Then look at
the page at 360px and at 1600px - if you can drive a browser, do, and actually
look at it. Then write your two sentences and stop.
