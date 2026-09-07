#!/usr/bin/env python3
"""webdesign cut - turn a photograph into parallax planes.

    python cut.py <photo> [--out DIR] [--name base] [--model u2net|isnet-general-use]

Writes <name>-fg.png (the subject, transparent background), <name>-bg.jpg (the
photo with the subject's hole filled by a blur, so it can sit behind the cut-out
without a ghost), and <name>-mask.png. Feed the planes to a .layers stack with
different data-px values and the photograph gains real depth, the way the
reference sites do it.

Needs rembg:  python -m pip install "rembg[cpu]"   (first run downloads ~170 MB)
"""
import sys, os, argparse, io

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('photo')
    ap.add_argument('--out', default=None)
    ap.add_argument('--name', default=None)
    ap.add_argument('--model', default='isnet-general-use',
                    help='u2net (fast), isnet-general-use (cleaner edges), u2net_human_seg')
    ap.add_argument('--alpha-matting', action='store_true', help='softer hair/foliage edges, slower')
    a = ap.parse_args()

    try:
        from rembg import remove, new_session
        from PIL import Image, ImageFilter
    except ImportError:
        sys.stderr.write('webdesign cut: rembg is not installed.\n'
                         '  python -m pip install "rembg[cpu]"\n')
        sys.exit(2)

    src = a.photo
    if not os.path.exists(src):
        sys.stderr.write(f'webdesign cut: no such file: {src}\n'); sys.exit(2)
    out = a.out or os.path.dirname(os.path.abspath(src))
    base = a.name or os.path.splitext(os.path.basename(src))[0]
    os.makedirs(out, exist_ok=True)

    img = Image.open(src).convert('RGBA')
    session = new_session(a.model)
    fg = remove(img, session=session, alpha_matting=a.alpha_matting,
                alpha_matting_foreground_threshold=240, alpha_matting_background_threshold=10,
                alpha_matting_erode_size=8)

    # mask, then a background with the subject dissolved into a blur so the
    # cut-out can move over it without a hard-edged hole showing behind
    mask = fg.split()[3]
    blurred = img.filter(ImageFilter.GaussianBlur(28))
    bg = Image.composite(blurred, img, mask.filter(ImageFilter.GaussianBlur(6)))

    fg_path = os.path.join(out, f'{base}-fg.png')
    bg_path = os.path.join(out, f'{base}-bg.jpg')
    mk_path = os.path.join(out, f'{base}-mask.png')
    fg.save(fg_path, optimize=True)
    bg.convert('RGB').save(bg_path, quality=82, optimize=True)
    mask.save(mk_path, optimize=True)

    bbox = mask.getbbox()
    w, h = img.size
    cov = 0
    if bbox:
        cov = round(100 * (bbox[2]-bbox[0]) * (bbox[3]-bbox[1]) / (w*h))
    # A cut that fills the frame, or one whose box runs off an edge, is not a
    # cut-out - it is the original rectangle, and compositing it produces a
    # collage with a hard straight edge. Refuse it here rather than let it ship.
    edge = bbox and (bbox[0] <= 2 or bbox[1] <= 2 or bbox[2] >= w - 2 or bbox[3] >= h - 2)
    bad = (not bbox) or cov >= 90 or cov <= 8 or edge
    print(f'{base}: {w}x{h}, subject covers ~{cov}% of the frame'
          + (f', bbox {bbox}' if bbox else ', NO SUBJECT FOUND'))
    if bad:
        why = ('no subject' if not bbox else
               'fills the frame - nothing to cut away' if cov >= 90 else
               'almost nothing found' if cov <= 8 else
               'subject is cropped by the frame edge, so the cut-out has a straight side')
        sys.stderr.write(
            f'webdesign cut: {why}.\n'
            '  This photo has no usable subject. Pick one with clear sky or wall\n'
            '  around it, or use the photograph whole. Files written for inspection.\n')
    print(f'  fg   {fg_path}')
    print(f'  bg   {bg_path}')
    print(f'  mask {mk_path}')
    if bad:
        sys.exit(3)

if __name__ == '__main__':
    main()
