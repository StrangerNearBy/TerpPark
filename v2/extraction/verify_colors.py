from PIL import Image
from collections import Counter
import json

im = Image.open('crop_lotdir.png').convert('RGB')

REF = {
    'unrestricted_after_4pm': (128, 167, 63),
    'restricted_after_4pm': (90, 197, 203),
    'modified_restricted': (250, 168, 25),
    'twentyfour_hour': (227, 30, 38),
    'special_restrictions': (147, 80, 158),
}

# Fresh column reading from crop_lotdir.png (independent transcription for v2)
columns = {
    1: ['1a','1b','1c','1d','1f','22','2a','2b','3','4a','4b','4h','4J','4k','4m','4n','4t','6'],
    2: ['8','9b','10a','11b','12a','14a','14b','14c','15','16a','16b','16f','17a','19','A','B','BB','C1'],
    3: ['CC1','CC2','CY','D','DD','E','F','FF2','G','GG1','GG2','HC','HH','HP','J1','J2','JJ1','JJ3'],
    4: ['K3','K5','K7','KK','L','LL1','LL2','LL3','LL4','LL5','LL6','MM1','MM2','MM3','N','N3','N4','N6'],
    5: ['N7','N8','N9','NN','O1','O3','O5','P1','P2','PH1','PH2','Q','Q1','QQ','R2','R3','R4','RR'],
    6: ['RR2','S3','S7','S8','SDG','SS1','SS2','T','TT','TV','U1','UU','U2','V2','V3','W','W1','X1'],
    7: ['XX1','Y','YC','YY','Z'],
}
col_bounds = [17, 283, 534, 775, 1022, 1259, 1497, 1767]
col_x = {i + 1: col_bounds[i] + 45 for i in range(7)}
row_y0 = 24.5
row_dy = 47.5

def quantize(rgb, step=24):
    return tuple((c // step) * step for c in rgb)

def sample_dominant_color(cx, cy, half_x=13, half_y=13):
    counts = Counter()
    for x in range(cx - half_x, cx + half_x):
        for y in range(cy - half_y, cy + half_y):
            if 0 <= x < im.width and 0 <= y < im.height:
                r, g, b = im.getpixel((x, y))
                if r > 235 and g > 235 and b > 235:
                    continue
                counts[quantize((r, g, b))] += 1
    if not counts:
        return None
    return counts.most_common(1)[0][0]

def classify(rgb):
    if rgb is None:
        return 'blank'
    r, g, b = rgb
    mx, mn = max(r, g, b), min(r, g, b)
    if mx - mn < 22:
        return 'black_or_gray'
    best_cat, best_dist = None, 1e9
    for cat, ref in REF.items():
        d = sum((a - b) ** 2 for a, b in zip(rgb, ref))
        if d < best_dist:
            best_dist = d
            best_cat = cat
    return best_cat

results = {}
for col, codes in columns.items():
    for row, code in enumerate(codes):
        cx = col_x[col]
        cy = round(row_y0 + row * row_dy)
        rgb = sample_dominant_color(cx, cy)
        cat = classify(rgb)
        results[code] = {'pixel_category': cat, 'rgb': rgb}

json.dump(results, open('lot_colors_pixel_verified.json', 'w'), indent=2)
print(f"Classified {len(results)} lot codes.")
for code, r in results.items():
    print(f"  {code}: {r['pixel_category']}  {r['rgb']}")
