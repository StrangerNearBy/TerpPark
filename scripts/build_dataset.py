import json, re, math

transform = json.load(open('grid_transform.json'))
lat_c, lng_c = transform['lat_coef'], transform['lng_coef']

def grid_to_xy(grid):
    if not grid:
        return None
    m = re.match(r'^([A-H])(\d{1,2})$', grid)
    if not m:
        return None
    return ord(m.group(1)) - ord('A'), int(m.group(2))

def grid_to_latlng(grid):
    xy = grid_to_xy(grid)
    if not xy:
        return None
    col, row = xy
    lat = lat_c[0]*col + lat_c[1]*row + lat_c[2]
    lng = lng_c[0]*col + lng_c[1]*row + lng_c[2]
    return round(lat, 6), round(lng, 6)

def meters(lat1, lng1, lat2, lng2):
    dlat = (lat2 - lat1) * 111320
    dlng = (lng2 - lng1) * 111320 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot(dlat, dlng)

# --- polygon centroids for real "Parking Lot" surface polygons ---
def poly_centroid(geom):
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
            return sum(xs)/len(xs), sum(ys)/len(ys), 0
        return cx/(6*a), cy/(6*a), abs(a)
    rings = [geom['coordinates'][0]] if geom['type'] == 'Polygon' else [p[0] for p in geom['coordinates']]
    best = max((ring_centroid(r) for r in rings), key=lambda t: t[2])
    return best[1], best[0]

polys = json.load(open('parkinglot_polys.geojson'))['features']
poly_data = [(*poly_centroid(f['geometry']), f['properties']['Shape__Area']) for f in polys]  # (lat, lng, area)

def snap_to_real_lot(lat, lng, radius_m=140):
    nearby = [(la, ln, ar) for la, ln, ar in poly_data if meters(lat, lng, la, ln) <= radius_m]
    if not nearby:
        return None
    avg_lat = sum(p[0] for p in nearby) / len(nearby)
    avg_lng = sum(p[1] for p in nearby) / len(nearby)
    total_area = sum(p[2] for p in nearby)
    return round(avg_lat, 6), round(avg_lng, 6), len(nearby), round(total_area)

# --- Buildings: GIS-matched (authoritative) + grid-estimated fallback for the rest ---
buildings = json.load(open('buildings_matched.json'))
for b in buildings:
    b['coord_source'] = 'gis'

gis_raw = json.load(open('buildings_raw.geojson'))['features']

def area_center(keywords):
    pts = [poly_centroid(f['geometry']) for f in gis_raw
           if any(kw.lower() in f['properties']['NAME'].lower() for kw in keywords)]
    if not pts:
        return None
    return round(sum(p[0] for p in pts) / len(pts), 6), round(sum(p[1] for p in pts) / len(pts), 6)

# Insets on page 2 of the map (no grid ref on the main page) get a rough
# fallback: the centroid of GIS buildings whose name matches the inset area.
# Anacostia and Severn share one small inset with no buildings of their own
# name in the (2013-vintage) GIS layer, so they're pooled together.
INSET_KEYWORDS = {
    'ANACOSTIA': ['Anacostia', 'Severn'], 'SEVERN': ['Anacostia', 'Severn'],
    'PATAPSCO': ['Patapsco', 'Tech Vent'], 'TECH VENTURES': ['Patapsco', 'Tech Vent'],
    'GREENMEAD': ['Courtyard'],
    'GRADUATE GARDENS': ['Graduate Gardens'], 'GRADUATE HILLS': ['Graduate Hills'],
}

unmatched = json.load(open('buildings_unmatched.json'))
for b in unmatched:
    ll = grid_to_latlng(b['grid']) if not b['grid'].endswith('INSET') else None
    if ll:
        b['lat'], b['lng'] = ll
        b['coord_source'] = 'estimated'
    else:
        area_ll = None
        for kw, gis_kw in INSET_KEYWORDS.items():
            if kw in (b['grid'] or ''):
                area_ll = area_center(gis_kw)
                if area_ll:
                    b['coord_source'] = f'area_estimate:{kw.title()}'
                    break
        if area_ll:
            b['lat'], b['lng'] = area_ll
        else:
            b['lat'], b['lng'] = None, None
            b['coord_source'] = 'unknown'
    buildings.append(b)

buildings_out = []
seen_ids = {}
for b in buildings:
    if b['lat'] is None:
        continue
    entry = {
        'id': b['id'], 'name': b.get('gis_name') or b['name'].title(),
        'category': b.get('category', 'Academic/Administrative'),
        'grid': b.get('grid'),
        'lat': b['lat'], 'lng': b['lng'], 'source': b['coord_source']
    }
    # The source PDF lists a few buildings (e.g. Regents Drive Parking Garage)
    # twice under different sections; keep one record, preferring the more
    # specific category.
    prior = seen_ids.get(entry['id'])
    if prior is None or entry['category'] == 'Parking Garage':
        seen_ids[entry['id']] = entry
buildings_out = sorted(seen_ids.values(), key=lambda x: x['id'])

buildings_by_id = {b['id']: b for b in buildings_out}

# --- Lots: grid-estimate then snap to nearest real paved "Parking Lot" polygon(s) ---
lotdir = json.load(open('lots_directory.json'))
lots_out = []
snapped_ct = 0
for lot in lotdir['lots']:
    coord_source = 'unknown'
    lat = lng = None
    pavement_area_sqm = None
    if 'building_id' in lot:
        # Visitor garages etc: reuse the building's own real (GIS) coordinate
        # directly rather than re-deriving one from the map grid.
        src = buildings_by_id.get(lot['building_id'])
        if src:
            lat, lng = src['lat'], src['lng']
            coord_source = f"from_building:{lot['building_id']}({src['source']})"
        cat = lotdir['categories'][lot['category']]
        entry = {
            'code': lot['code'], 'name': lot.get('name'),
            'lat': lat, 'lng': lng, 'coord_source': coord_source,
            'category': lot['category'], 'category_label': cat['label'], 'rule': cat['rule'],
            'gated': False, 'overflow_faculty_staff': False, 'overflow_student': False,
            'lot_type': None,  # the letter/number = faculty/staff/student rule doesn't apply to pay garages
        }
        lots_out.append(entry)
        continue
    if 'building_ids' in lot:
        # Satellite/inset-only lots pinpointed against specific nearby real
        # (GIS) buildings identified on the page-2 detail inset - averaging
        # those buildings' real coordinates is far more precise than a
        # whole-neighborhood centroid.
        srcs = [buildings_by_id[bid] for bid in lot['building_ids'] if bid in buildings_by_id]
        if srcs:
            lat = round(sum(s['lat'] for s in srcs) / len(srcs), 6)
            lng = round(sum(s['lng'] for s in srcs) / len(srcs), 6)
            coord_source = f"from_buildings:{'+'.join(lot['building_ids'])}"
    else:
        ll = grid_to_latlng(lot['grid'])
        if ll:
            lat, lng = ll
            coord_source = 'estimated_grid'
            snap = snap_to_real_lot(lat, lng)
            if snap:
                lat, lng, n, pavement_area_sqm = snap
                coord_source = f'snapped_to_gis_pavement(n={n})'
                snapped_ct += 1
    cat = lotdir['categories'][lot['category']]
    # Per the map's "How to Read a Parking Lot Sign" panel: signs starting
    # with a LETTER are Faculty/Staff lots; signs starting with a NUMBER are
    # Student lots, regardless of any sub-number/letter that follows.
    lot_type = 'faculty_staff' if lot['code'][0].isalpha() else 'student'
    entry = {
        'code': lot['code'],
        'lat': lat, 'lng': lng,
        'coord_source': coord_source,
        'category': lot['category'],
        'category_label': cat['label'],
        'rule': cat['rule'],
        'lot_type': lot_type,
    }
    if 'special' in lot:
        entry['special_rule'] = lotdir['special_rules'].get(lot['special'])
    if 'note' in lot:
        entry['note'] = lot['note']
    if pavement_area_sqm:
        entry['approx_pavement_area_sqft'] = round(pavement_area_sqm * 10.7639)
    prefix = re.match(r'^[A-Za-z]+|^\d+', lot['code'])
    prefix = prefix.group(0) if prefix else lot['code']
    entry['gated'] = lot['code'] in lotdir['gated_lots']
    entry['overflow_faculty_staff'] = prefix in lotdir['overflow_faculty_staff_prefixes']
    entry['overflow_student'] = prefix in lotdir['overflow_student_prefixes']
    lots_out.append(entry)

print(f"Buildings with coords: {len(buildings_out)} / {len(buildings)}")
print(f"Lots with coords: {sum(1 for l in lots_out if l['lat'])} / {len(lots_out)}  (snapped to real pavement: {snapped_ct})")

json.dump(buildings_out, open('buildings_final.json', 'w'), indent=2)
json.dump({'categories': lotdir['categories'], 'general_rule': lotdir['general_rule'],
           'pay_area_rule': lotdir['pay_area_rule'], 'lots': lots_out},
          open('lots_final.json', 'w'), indent=2)

no_coord = [l['code'] for l in lots_out if not l['lat']]
print('Lots with no coord:', no_coord)
