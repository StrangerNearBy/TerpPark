import json

gis = json.load(open('buildings_raw.geojson'))

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
            xs=[p[0] for p in ring]; ys=[p[1] for p in ring]
            return sum(xs)/len(xs), sum(ys)/len(ys), 0
        return cx/(6*a), cy/(6*a), abs(a)
    rings = [geom['coordinates'][0]] if geom['type']=='Polygon' else [p[0] for p in geom['coordinates']]
    best = max((ring_centroid(r) for r in rings), key=lambda t: t[2])
    return best[1], best[0]

def area_center(keyword):
    pts = []
    for f in gis['features']:
        if keyword.lower() in f['properties']['NAME'].lower():
            pts.append(centroid(f['geometry']))
    if not pts:
        return None
    return round(sum(p[0] for p in pts)/len(pts), 6), round(sum(p[1] for p in pts)/len(pts), 6)

areas = {
    'Tech Ventures & Patapsco area': area_center('Patapsco') or area_center('Tech Vent'),
    'Greenmead Dr / Courtyards area': area_center('Courtyard'),
    'Anacostia/Severn area': None,
    'Graduate Gardens area': area_center('Graduate Gardens'),
}
anac = area_center('Anacostia')
sev = area_center('Severn')
if anac and sev:
    areas['Anacostia/Severn area'] = (round((anac[0]+sev[0])/2,6), round((anac[1]+sev[1])/2,6))
else:
    areas['Anacostia/Severn area'] = anac or sev

print("Area centers found:")
for k, v in areas.items():
    print(' ', k, v)

lots = json.load(open('lots_final.json'))
# Match by keyword substring in the note (robust to wording tweaks), not an exact string.
note_keyword_to_area = {
    'Tech Ventures': 'Tech Ventures & Patapsco area',
    'Greenmead': 'Greenmead Dr / Courtyards area',
    'Anacostia': 'Anacostia/Severn area',
    'Severn': 'Anacostia/Severn area',
    'Graduate Gardens': 'Graduate Gardens area',
}

filled = 0
for lot in lots['lots']:
    if lot['lat'] is not None:
        continue
    note = lot.get('note', '')
    area_key = next((v for k, v in note_keyword_to_area.items() if k in note), None)
    if area_key and areas.get(area_key):
        lot['lat'], lot['lng'] = areas[area_key]
        lot['coord_source'] = f'area_estimate:{area_key}'
        filled += 1

print(f"Backfilled {filled} satellite lots")
still_missing = [l['code'] for l in lots['lots'] if l['lat'] is None]
print('Still missing:', still_missing)

json.dump(lots, open('lots_final.json', 'w'), indent=2)
