"""Read each lot's restriction class out of the Parking Lot Directory by sampling
the colour of its printed lot id. The class is encoded only as text colour."""
import xml.etree.ElementTree as ET, collections, json, re, subprocess, os, sys
from PIL import Image

DPI = 300
SCALE = DPI / 72.0
# Pass the PDF path as an argument; defaults to the 2025 map one folder up, which
# the column offsets below were tuned against.
PDF = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', 'Campus-parking-map.pdf')

if not os.path.exists('page1.png'):
    subprocess.run(['pdftoppm', '-f', '1', '-l', '1', '-r', str(DPI), '-png',
                    PDF, 'page1'], check=True)
    os.rename('page1-1.png', 'page1.png')

img = Image.open('page1.png').convert('RGB')
print('rendered:', img.size)

W = '{http://www.w3.org/1999/xhtml}word'
words = [(float(w.get('xMin')), float(w.get('yMin')), float(w.get('xMax')),
          float(w.get('yMax')), (w.text or '').strip())
         for w in ET.parse('p1.xml').getroot().iter(W)]

LOTID = re.compile(r'^(\d{1,2}[a-zA-Z]?|[A-Z]{1,3}\d?)$')
GRID = re.compile(r'^[A-H]\d{1,2}$')
LEFT = [14, 73, 132, 191, 249, 308, 367]
TOL = 12

# Map key colours, sampled from the legend swatches on page 1.
LEGEND = {
    'unrestricted_after_4pm': (0, 138, 79),
    'restricted_after_4pm':   (0, 174, 199),
    'modified_restricted':    (243, 146, 0),
    'restricted_24h':         (227, 6, 19),
    'special_restrictions':   (112, 48, 160),
}


def ink_colour(x0, y0, x1, y1):
    """Median colour of the darkest ink pixels inside a word's bounding box."""
    box = img.crop((int(x0 * SCALE) - 1, int(y0 * SCALE) - 1,
                    int(x1 * SCALE) + 1, int(y1 * SCALE) + 1))
    px = [p for p in box.getdata() if sum(p) < 600]   # drop white/near-white
    if not px:
        return None
    px.sort(key=sum)
    core = px[:max(1, len(px) // 3)]                  # darkest third = glyph core
    n = len(core)
    return tuple(sorted(c[i] for c in core)[n // 2] for i in range(3))


def classify(rgb):
    if rgb is None:
        return None, None
    r, g, b = rgb
    if max(rgb) - min(rgb) < 40 and sum(rgb) < 330:
        return 'black', 0            # black text = no colour category
    best, bd = None, 1e9
    for name, c in LEGEND.items():
        d = sum((a - b2) ** 2 for a, b2 in zip(rgb, c)) ** 0.5
        if d < bd:
            best, bd = name, d
    return best, round(bd, 1)


rows = collections.defaultdict(list)
for x0, y0, x1, y1, t in words:
    if y0 > 552 and x0 < 440:
        rows[round(y0 / 3)].append((x0, y0, x1, y1, t))

out = []
for k in sorted(rows):
    for lx in LEFT:
        cell = next((w for w in rows[k] if abs(w[0] - lx) <= TOL), None)
        if not cell:
            continue
        x0, y0, x1, y1, t = cell
        if not LOTID.match(t) or GRID.match(t):
            continue
        rgb = ink_colour(x0, y0, x1, y1)
        cls, dist = classify(rgb)
        out.append(dict(lot=t, rgb=rgb, restriction_class=cls, colour_distance=dist))

seen, ded = set(), []
for o in out:
    if o['lot'] not in seen:
        seen.add(o['lot'])
        ded.append(o)

print('lots sampled:', len(ded))
print()
for k, v in collections.Counter(o['restriction_class'] for o in ded).most_common():
    print(f'  {v:4d}  {k}')
print()
far = [o for o in ded if o['colour_distance'] and o['colour_distance'] > 60]
print('poor colour matches (need checking):', len(far))
for o in far[:12]:
    print('   ', o)
print()
print('samples:', [(o['lot'], o['restriction_class'], o['rgb']) for o in ded[:10]])
json.dump(ded, open('lot_restrictions.json', 'w'), indent=1)
