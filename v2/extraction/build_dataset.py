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

polys = json.load(open('parkinglot_polys_gis.geojson'))['features']
poly_data = [(*poly_centroid(f['geometry']), f['properties']['Shape__Area']) for f in polys]

def snap_to_real_lot(lat, lng, radius_m=140):
    nearby = [(la, ln, ar) for la, ln, ar in poly_data if meters(lat, lng, la, ln) <= radius_m]
    if not nearby:
        return None
    avg_lat = sum(p[0] for p in nearby) / len(nearby)
    avg_lng = sum(p[1] for p in nearby) / len(nearby)
    total_area = sum(p[2] for p in nearby)
    return round(avg_lat, 6), round(avg_lng, 6), len(nearby), round(total_area)

# Load final buildings (stage 1) for building_id / building_ids anchor lookups
buildings = json.load(open('buildings_v2_stage1.json'))
buildings_by_id = {b['id']: b for b in buildings}

lotdir = json.load(open('lots_directory.json'))
lots_out = []
snapped_ct = 0

for lot in lotdir['lots']:
    coord_source = 'unknown'
    lat = lng = None
    pavement_area_sqm = None

    if 'building_id' in lot:
        src = buildings_by_id.get(lot['building_id'])
        if src:
            lat, lng = src['lat'], src['lng']
            coord_source = f"from_building:{lot['building_id']}({src['source']})"
        cat = lotdir['categories'][lot['category']]
        lots_out.append({
            'code': lot['code'], 'name': lot.get('name'),
            'lat': lat, 'lng': lng, 'coord_source': coord_source,
            'category': lot['category'], 'category_label': cat['label'], 'rule': cat['rule'],
            'gated': False, 'overflow_faculty_staff': False, 'overflow_student': False,
            'lot_type': None,
        })
        continue

    if 'building_ids' in lot:
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
    if lot['category'] == 'visitor_pay_parking':
        lot_type = None  # letter/number lot-type convention doesn't apply to named visitor pay lots
    else:
        lot_type = 'faculty_staff' if lot['code'][0].isalpha() else 'student'
    entry = {
        'code': lot['code'], 'name': lot.get('name'), 'lat': lat, 'lng': lng, 'coord_source': coord_source,
        'category': lot['category'], 'category_label': cat['label'], 'rule': cat['rule'],
        'lot_type': lot_type,
    }
    if 'special' in lot:
        entry['special_rule'] = lotdir['special_rules'].get(lot['special'])
    if 'note' in lot:
        entry['note'] = lot['note']
    if pavement_area_sqm:
        entry['approx_pavement_area_sqft'] = round(pavement_area_sqm * 10.7639)
    prefix_m = re.match(r'^[A-Za-z]+|^\d+', lot['code'])
    prefix = prefix_m.group(0) if prefix_m else lot['code']
    entry['gated'] = lot['code'] in lotdir['gated_lots']
    entry['overflow_faculty_staff'] = prefix in lotdir['overflow_faculty_staff_prefixes']
    entry['overflow_student'] = prefix in lotdir['overflow_student_prefixes']
    lots_out.append(entry)

print(f"Lots with coords: {sum(1 for l in lots_out if l['lat'])} / {len(lots_out)}  (snapped to real pavement: {snapped_ct})")
no_coord = [l['code'] for l in lots_out if not l['lat']]
print('Lots with no coord:', no_coord)

json.dump({'categories': lotdir['categories'], 'general_rule': lotdir['general_rule'],
           'pay_area_rule': lotdir['pay_area_rule'], 'lots': lots_out},
          open('lots_v2_stage1.json', 'w'), indent=2)
