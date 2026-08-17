import json

pdf_buildings = json.load(open('buildings_parsed.json'))
gis = json.load(open('buildings_gis_raw.geojson'))

def centroid(geom):
    def ring_centroid(ring):
        a = cx = cy = 0.0
        n = len(ring)
        for i in range(n - 1):
            x0, y0 = ring[i]; x1, y1 = ring[i + 1]
            cross = x0 * y1 - x1 * y0
            a += cross; cx += (x0 + x1) * cross; cy += (y0 + y1) * cross
        a *= 0.5
        if abs(a) < 1e-12:
            xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
            return sum(xs) / len(xs), sum(ys) / len(ys), 0
        return cx / (6 * a), cy / (6 * a), abs(a)
    rings = [geom['coordinates'][0]] if geom['type'] == 'Polygon' else [poly[0] for poly in geom['coordinates']]
    best = max((ring_centroid(r) for r in rings), key=lambda t: t[2])
    return best[1], best[0]

gis_by_id = {}
for f in gis['features']:
    bid = f['properties']['BUILDINGID']
    lat, lng = centroid(f['geometry'])
    gis_by_id.setdefault(bid, []).append((lat, lng, f['properties']['NAME']))

matched, unmatched = [], []
for b in pdf_buildings:
    bid = b['id']
    cand = gis_by_id.get(bid) or gis_by_id.get(bid.lstrip('0') or '0')
    if cand:
        lat, lng, gis_name = cand[0]
        matched.append({**b, 'lat': round(lat, 6), 'lng': round(lng, 6), 'gis_name': gis_name,
                         'source': 'gis', 'footprint_count': len(cand)})
    else:
        unmatched.append(b)

print(f"Matched: {len(matched)} / {len(pdf_buildings)}   Unmatched: {len(unmatched)}")
for b in unmatched:
    print('  UNMATCHED:', b)

json.dump(matched, open('buildings_matched.json', 'w'), indent=2)
json.dump(unmatched, open('buildings_unmatched.json', 'w'), indent=2)
