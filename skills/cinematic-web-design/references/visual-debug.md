# Review the rendered website

Run from the installed plugin directory with Node 22+ and Chrome, Edge or Chromium:
    
    node scripts/webdesign.mjs debug <site-directory-or-url> --out <review-directory>
    node scripts/webdesign.mjs debug <site> --actions actions.json --widths 1440,390 --motion both
    node scripts/webdesign.mjs video <local-video> --frames 8 --out <frames-directory>

Debug captures desktop/mobile at top, middle and bottom, then each interaction,
both with normal and reduced motion. It writes PNGs, review.html and review.json.
The local preview uses an isolated loopback port and closes when capture ends.
Video extraction additionally requires FFmpeg and ffprobe on PATH.

An actions file is a JSON array:

    [
      {"type":"click","selector":"button.menu-toggle"},
      {"type":"expect-visible","selector":"nav.mobile-menu"},
      {"type":"expect-text","selector":"nav.mobile-menu","text":"Contact"},
      {"type":"focus","selector":"a.contact"}
    ]

Supported actions: click, hover, focus, expect-visible, expect-text. Selectors
must come from the actual page. Use test data and test environments for actions
that submit or change data. Each action is replayed for every viewport and motion
mode. A failed action is an error, even when a later screenshot looks fine.

## Required AI review

1. Run the source audit and project tests. Run debug on the actual built website.
2. Open the PNGs using the host's image-viewing tool: Claude Code Read for local
   images, Codex view_image or an available browser screenshot tool. An HTML
   gallery is also provided for human review. Reading JSON alone is insufficient.
3. Inspect every affected viewport, scroll and interaction state. Check text
   clipping, occlusion, sticky headers, menus, focal point, image crops, spacing,
   fallback content, focus state and motion continuity. Compare reference frames
   in timestamp order. For sky scenes inspect lighting; for product scenes inspect
   rotation and separation; for landscapes inspect foreground/background movement.
4. Fix defects and repeat. Record the screenshot filenames actually opened,
   states exercised, findings fixed and any untested states. If the host cannot
   view images, report visual review as blocked; do not mark it passed.
5. A clean automated report means no detected errors in those sampled states.
   It does not establish design quality, reference fidelity, accessibility
   conformance, full keyboard coverage or animation smoothness.

Console exceptions and HTTP/network failures are captured after interactions too.
Canvas size and uniform-pixel checks supply clues, not a verdict: WebGL buffers can
read blank after compositing, and solid-color canvases can be intentional. Inspect
the screenshot and fallback. Reduced motion must retain readable content.
Cross-origin frames, native dialogs, drag gestures and typing are not automated by
this command; cover them with the host browser tools when applicable.

Keep captures local unless publication is requested and their content is suitable
for sharing. Do not commit authenticated pages, personal data or reference videos.
