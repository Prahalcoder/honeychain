"""Re-colours the Honey Chain apps from yellow / black / green to TEAL, BLUE and CORAL.

TEAL #0F766E, BLUE #2563EB, CORAL #F97360.

Every colour found in the source (#rrggbb, rgb()/rgba() and url-encoded %23rrggbb) is looked at by hue:
  - creams and pale yellows            -> pale teal tints
  - bright yellows and oranges         -> coral
  - dark ambers, browns and their text -> deep teal
  - greens                             -> teal
  - near-black neutrals and dark greens-> a deep blue-teal ink
Blues, reds, purples, greys and whites are left alone. Running it twice changes nothing more.

    python tools/recolor.py            # rewrite the files
    python tools/recolor.py --report   # only list what would change
"""
import colorsys
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
TARGETS = [
    'APICtech/frontend/src', 'apictech-admin/src', 'honeychain-web/src', 'tools',
    'APICtech/frontend/index.html', 'apictech-admin/index.html', 'honeychain-web/index.html',
]
SKIP_DIRS = {'lang', 'node_modules', '.demo'}
EXTENSIONS = {'.jsx', '.js', '.css', '.html', '.mjs'}
SKIP_FILES = {'hi.js', 'schemesData.js', 'content.js', 'recolor.py'}


def convert(r, g, b):
    """Returns the new (r, g, b) for a colour, or the same one."""
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    hue = h * 360

    def out(nh, ns, nl):
        nr, ng, nb = colorsys.hls_to_rgb((nh % 360) / 360, max(0, min(1, nl)), max(0, min(1, ns)))
        return round(nr * 255), round(ng * 255), round(nb * 255)

    if 20 <= hue < 70 and s >= 0.12:                      # yellow / orange / brown / cream
        if l >= 0.93:
            return out(176, min(0.5, max(0.25, s)), l)
        if l >= 0.80:
            return out(176, 0.32, l)
        if l >= 0.55 and s >= 0.5:
            return out(8, 0.92, min(0.72, max(0.60, l)))
        if l >= 0.30:
            return out(178, 0.72, min(0.40, max(0.22, l))) if s >= 0.5 else out(185, s * 0.6, l)
        return out(190, 0.45, l)
    if 70 <= hue < 172 and s >= 0.25:                      # brand greens
        return out(176, s, l)
    if s < 0.25 and l < 0.30 and not (r == g == b and l < 0.02):   # near-black neutrals
        return out(195, 0.38, l)
    return r, g, b


HEX = re.compile(r'(#|%23)([0-9a-fA-F]{6})(?![0-9a-fA-F])')
RGB = re.compile(r'rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)')
TAILWIND = [
    (re.compile(r'\b(bg|text|border|from|to|via|ring|fill|stroke|divide|outline|decoration|accent|shadow)-(amber|yellow)-(\d{2,3})\b'), r'\1-orange-\3'),
    (re.compile(r'\b(bg|text|border|from|to|via|ring|fill|stroke|divide|outline|decoration|accent|shadow)-(green|emerald|lime)-(\d{2,3})\b'), r'\1-teal-\3'),
]


def fix_hex(match):
    prefix, digits = match.group(1), match.group(2)
    r, g, b = (int(digits[i:i + 2], 16) for i in (0, 2, 4))
    nr, ng, nb = convert(r, g, b)
    new = f'{nr:02x}{ng:02x}{nb:02x}'
    return match.group(0) if new == digits.lower() else f'{prefix}{new}'


def fix_rgb(match):
    r, g, b = (int(match.group(i)) for i in (1, 2, 3))
    nr, ng, nb = convert(r, g, b)
    return match.group(0).replace(match.group(1), str(nr), 1).replace(match.group(2), str(ng), 1).replace(match.group(3), str(nb), 1) if (nr, ng, nb) != (r, g, b) else match.group(0)


def process(path, report):
    with open(path, encoding='utf-8', newline='') as handle:
        text = handle.read()
    new = HEX.sub(fix_hex, text)
    new = RGB.sub(fix_rgb, new)
    for pattern, replacement in TAILWIND:
        new = pattern.sub(replacement, new)
    if new != text:
        if not report:
            with open(path, 'w', encoding='utf-8', newline='') as handle:
                handle.write(new)
        return True
    return False


def main():
    report = '--report' in sys.argv
    changed = []
    for target in TARGETS:
        full = os.path.join(ROOT, target)
        if os.path.isfile(full):
            files = [full]
        else:
            files = []
            for folder, dirs, names in os.walk(full):
                dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
                files += [os.path.join(folder, n) for n in names if os.path.splitext(n)[1] in EXTENSIONS and n not in SKIP_FILES]
        for path in files:
            if process(path, report):
                changed.append(os.path.relpath(path, ROOT))
    print(('Would change ' if report else 'Changed ') + f'{len(changed)} files')
    for name in changed:
        print('  ' + name)


if __name__ == '__main__':
    main()
