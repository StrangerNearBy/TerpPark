"""Pull the facts the printed map does not carry from UMD's own ArcGIS org and
write them into data/. Re-run whenever UMD updates its GIS:

    python3 tools_fetch_umd_gis.py

Writes
  data/lot_info.json      per-lot space counts, permits sold, lot type, UMD's own
                          restriction record, and where it disagrees with the map
  data/places.geojson     campus places: dining, libraries, transit, EV, …
  data/buildings.geojson  the 195 printed-map buildings, plus every other UMD GIS
                          building people actually visit (re-derived each run)

Source: services9.arcgis.com/1rOwFRpAwrxe0rBl (UMD's ArcGIS org, public).
Standard library only.
"""
import json, math, re, urllib.parse, urllib.request, datetime, pathlib

HERE = pathlib.Path(__file__).parent
DATA = HERE / 'data'
BASE = 'https://services9.arcgis.com/1rOwFRpAwrxe0rBl/ArcGIS/rest/services'
CENTRE = (-76.9447, 38.9860)          # McKeldin Mall
MAX_KM = 3.0                          # drops Shady Grove, Rivertech Ct, Adelphi, …


def query(service, layer, geometry=True):
    q = {'where': '1=1', 'outFields': '*', 'f': 'json', 'resultRecordCount': 2000,
         'returnGeometry': 'true' if geometry else 'false', 'outSR': 4326}
    url = f'{BASE}/{service}/FeatureServer/{layer}/query?' + urllib.parse.urlencode(q)
    req = urllib.request.Request(url, headers={'User-Agent': 'terp-parking/0.2'})
    with urllib.request.urlopen(req, timeout=90) as r:
        d = json.load(r)
    if 'error' in d:
        raise RuntimeError(f'{service}/{layer}: {d["error"]}')
    if d.get('exceededTransferLimit'):
        raise RuntimeError(f'{service}/{layer}: more than 2000 rows, add paging')
    return d['features']


def point_of(f):
    g = f.get('geometry') or {}
    if 'x' in g:
        return [round(g['x'], 7), round(g['y'], 7)]
    if 'rings' in g:                       # polygon -> mean of outer ring
        ring = g['rings'][0]
        return [round(sum(p[0] for p in ring) / len(ring), 7),
                round(sum(p[1] for p in ring) / len(ring), 7)]
    return None


def km_from_centre(c):
    dx = (c[0] - CENTRE[0]) * 111.32 * math.cos(math.radians(CENTRE[1]))
    dy = (c[1] - CENTRE[1]) * 110.57
    return math.hypot(dx, dy)


def clean(v):
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


# --------------------------------------------------------------------------- lots

UMD_CLASS = {
    'unrestricted after 4pm': 'unrestricted_after_4pm',
    'restricted after 4pm': 'restricted_after_4pm',
    'modified restricted': 'modified_restricted',
    '24-hour restricted': 'restricted_24h',
    '24 hour restricted': 'restricted_24h',
    'special restrictions': 'special_restrictions',
}
# Our lot id -> the name UMD's tables use, where they differ. Each one checked by
# hand (MV is also "Visitor Lot MV", capacity 69, in OpenStreetMap).
ALIAS = {'sdg': 'stadium drive garage', 'k5': 'k5 sorority', 'mv': 'mowatt visitor lot'}
INCOMPLETE_GARAGES = {'179'}   # building numbers whose UMD count is known partial


def self_consistent(cls, regulation):
    """UMD's table holds a restriction label AND a regulation sentence. Lot V says
    'Unrestricted After 4PM' next to '24 Hours-a-Day' — trust neither then."""
    if not cls or not regulation:
        return True
    says_24h = '24 hours' in regulation.lower()
    return says_24h == (cls == 'restricted_24h') or cls == 'special_restrictions'


def build_lot_info(parking, rules):
    counts = [x['attributes'] for x in query('CampusMapDefault_NoInsite', 11, False)]
    restr = [x['attributes'] for x in query('CampusMapDefault_NoInsite', 12, False)]
    by_count = {c['Lot'].strip().lower(): c for c in counts if c['Lot']}
    by_restr = {r['ParkingLotName'].strip().lower(): r for r in restr if r['ParkingLotName']}
    special = {k.lower() for k in rules.get('special_lots', {})}

    lots, used = {}, set()
    for f in parking['features']:
        p = f['properties']
        lot = p.get('lot')
        if not lot or lot in lots:
            continue
        key = lot.strip().lower()
        ck = key if key in by_count else ALIAS.get(key)
        rk = key if key in by_restr else ALIAS.get(key)
        c, r = by_count.get(ck), by_restr.get(rk)
        if ck in by_count:
            used.add(ck)

        umd_cls = UMD_CLASS.get((r or {}).get('Restriction', '') and r['Restriction'].strip().lower())
        regulation = clean((r or {}).get('Regulation'))
        consistent = self_consistent(umd_cls, regulation)
        pdf_cls = 'special_restrictions' if key in special else p.get('restriction_class')

        conflict = None
        if not consistent:
            conflict = (f"UMD's own records contradict each other for lot {lot}: "
                        f"'{r['Restriction']}' but \"{regulation}\"")
        elif pdf_cls and umd_cls and pdf_cls != umd_cls:
            conflict = (f"The printed map shows lot {lot} as "
                        f"{rules['classes'][pdf_cls]['label']}; UMD's parking database "
                        f"says {r['Restriction']}.")

        lots[lot] = {
            'total_spaces': c['Total_Spaces'] if c else None,
            'permits_sold': c['Permits'] if c else None,
            'lot_type': clean((r or {}).get('ParkingLotType')),
            'umd_restriction': clean((r or {}).get('Restriction')),
            'umd_regulation': regulation,
            'umd_additional': clean((r or {}).get('Additional')),
            # Only fill a rule the printed map leaves blank, and only from a record
            # that agrees with itself. Never override the map. 'Special' is not a
            # schedule on its own (each special lot has its own windows), so it
            # cannot fill a gap — the lot shows UMD's regulation text instead.
            'fill_class': umd_cls if (not p.get('restriction_class') and consistent
                                      and umd_cls and umd_cls != 'special_restrictions'
                                      and key not in special) else None,
            'conflict': conflict,
        }

    garages = {}
    for c in counts:
        if not c['GarageBldgNum']:
            continue
        g = garages.setdefault(c['GarageBldgNum'], {'name': c['GarageName'], 'total_spaces': 0, 'parts': []})
        g['total_spaces'] += c['Total_Spaces'] or 0
        g['parts'].append({'lot': c['Lot'], 'spaces': c['Total_Spaces'], 'permits_sold': c['Permits']})
    # Union Lane (179) lists only its 16 pay spaces; its permit floors are not in the
    # table. Stadium Drive (218) is one 780-space row with 0 permits, and 780 matches
    # Parkopedia, so it is complete. Checked by hand — no rule separates the two.
    for num, g in garages.items():
        g['complete'] = num not in INCOMPLETE_GARAGES

    other = sorted(({'name': c['Lot'], 'spaces': c['Total_Spaces']}
                    for k, c in by_count.items() if k not in used and not c['GarageBldgNum']),
                   key=lambda x: x['name'])
    return {
        '_source': 'UMD ArcGIS CampusMapDefault_NoInsite tables 11 (ParkingSpaceCount) '
                   'and 12 (ParkingRestriction)',
        '_fetched': datetime.date.today().isoformat(),
        '_note': 'permits_sold > total_spaces is normal: UMD oversells commuter lots '
                 '(it has said 1.5-1.8 permits per space). Space counts are UMD\'s '
                 'inventory, not live availability.',
        'campus_total_spaces': sum(c['Total_Spaces'] or 0 for c in counts),
        'lots': lots,
        'garages': garages,
        'other_spaces': other,   # service/curbside spaces UMD counts but does not map
    }


# ------------------------------------------------------------------------- places

# (service, layer, group, category label)
PLACE_LAYERS = [
    ('DiningServices', 1, 'food', 'Dining hall'),
    ('DiningServices', 0, 'food', 'Cafe'),
    ('DiningServices', 2, 'food', 'Food court'),
    ('DiningServices', 4, 'food', 'Restaurant'),
    ('DiningServices', 5, 'food', 'Shop'),
    ('DiningServices', 3, 'food', 'Food pantry'),
    ('DiningServices', 8, 'food', 'Farmers market'),
    ('CampusServices', 17, 'study', 'Library'),
    ('CampusServices', 8, 'study', 'Makerspace'),
    ('CampusServices', 16, 'study', 'Terrapin Tech'),
    ('Transportation', 10, 'vehicle', 'EV charging'),
    ('Transportation', 11, 'vehicle', 'Motorcycle & scooter parking'),
    ('Transportation', 9, 'vehicle', 'Zipcar'),
    ('Transportation', 6, 'transit', 'Shuttle-UM stop'),
    ('Transportation', 4, 'transit', 'Metro station'),
    ('CampusReference', 9, 'transit', 'Purple Line station'),
    ('Transportation', 16, 'bike', 'Capital Bikeshare'),
    ('Transportation', 1, 'bike', 'Bike repair station'),
    ('Transportation', 15, 'bike', 'Bike room'),
    ('Transportation', 0, 'bike', 'Bike rack'),
    ('Transportation', 3, 'bike', 'E-scooter & e-bike parking'),
    ('CampusServices', 7, 'services', 'Health'),
    ('CampusServices', 10, 'services', 'Health'),
    ('CampusServices', 3, 'services', 'Disability services'),
    ('CampusServices', 6, 'services', 'Hearing & speech'),
    ('CampusServices', 0, 'services', 'All-gender restroom'),
    ('CampusServices', 4, 'services', 'Family restroom'),
    ('CampusServices', 5, 'services', 'Lactation room'),
    ('CampusServices', 1, 'services', 'Baby changing'),
    ('CampusServices', 20, 'services', 'Adult changing table'),
    ('CampusServices', 14, 'services', 'Shower'),
    ('CampusServices', 11, 'services', 'LGBTQ+ resources'),
    ('CampusServices', 19, 'services', 'Unity Center'),
    ('Tours', 10, 'landmarks', 'Landmark'),
    ('Tours', 1, 'landmarks', 'Arts'),
    ('Tours', 13, 'landmarks', 'Research'),
    ('Tours', 16, 'landmarks', 'Student life'),
    ('Tours', 19, 'landmarks', 'Athletics'),
    ('Tours', 7, 'landmarks', 'Green campus'),
    ('Tours', 4, 'landmarks', 'Ghost tour'),
    ('CampusReference', 11, 'landmarks', 'Testudo statue'),
    ('CampusMapDefault_NoInsite', 2, 'landmarks', 'Area'),
    ('Residence_Community_Labels', 1, 'landmarks', 'Residential community'),
]
NAME_KEYS = ['NAME', 'Name', 'stop_name', 'STATIONNAME', 'STATIONNAM', 'LOCATION', 'BUILDINGNAME',
             'BuildingName', 'BUILDING', 'SERVICE']


def a(attrs, *keys):
    low = {k.lower(): v for k, v in attrs.items()}
    for k in keys:
        v = clean(low.get(k.lower()))
        if v is not None:
            return v
    return None


BLDG_NAMES = {}


def build_places():
    for f in json.load(open(DATA / 'buildings.geojson'))['features']:
        n = str(f['properties'].get('building_number') or '').lstrip('0')
        if n:
            BLDG_NAMES.setdefault(n, f['properties']['name'])
    out, dropped = [], 0
    for service, layer, group, cat in PLACE_LAYERS:
        for f in query(service, layer):
            c = point_of(f)
            if not c or km_from_centre(c) > MAX_KM:
                dropped += 1
                continue
            at = f['attributes']
            name = a(at, *NAME_KEYS) or cat
            # Racks have only a code like "051E1": building number + side + index.
            if cat == 'Bike rack':
                code = a(at, 'rackname') or ''
                bn = BLDG_NAMES.get(code[:3].lstrip('0'))
                name = f'Bike rack {code}' + (f' — {bn}' if bn else '')
            bldg = a(at, 'BUILDINGNAME', 'BuildingName', 'BUILDING')
            if bldg and bldg.isupper():
                bldg = bldg.title()
            room = a(at, 'ROOM', 'ROOM_NUM', 'Room_Num')
            if group == 'services' and bldg and name.lower() in (cat.lower(), (a(at, 'SERVICE') or '').lower()):
                name = f'{cat} — {bldg}'
            props = {
                'name': name, 'group': group, 'category': cat,
                'building': bldg if bldg and bldg.lower() != name.lower() else None,
                'room': room,
                'website': a(at, 'WEBSITE', 'Website1', 'MoreInformation', 'URL', 'LINK'),
                'description': a(at, 'DESCRIPTION', 'Description'),
                'spaces': a(at, 'SPACECOUNT'),
                'chargers': a(at, 'CHARGINGOPP'),
                'vehicles': a(at, 'NUMBEROFVEHICLES'),
                'phone': a(at, 'Contact', 'ContactInformation'),
                # bikes & motorcycles
                'loops': a(at, 'noloops'),
                'covered': {'Yes': True, 'No': False}.get(a(at, 'covered')),
                'access': a(at, 'Access') if group == 'bike' else None,
                'lock': {'Yes': True, 'No': False}.get(a(at, 'LOCKOPPORTUNITY')),
                'status': a(at, 'STATUS'),
                'hours': a(at, 'HRSAVAIL'),
            }
            out.append({'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': c},
                        'properties': {k: v for k, v in props.items() if v is not None}})
    return {'type': 'FeatureCollection',
            '_source': 'UMD ArcGIS — DiningServices, CampusServices, Transportation, '
                       'CampusReference, Tours, CampusMapDefault_NoInsite, Residence_Community_Labels',
            '_fetched': datetime.date.today().isoformat(),
            'features': out}, dropped


# ---------------------------------------------------------------------- buildings

# Buildings nobody parks for: storage, plant, utility, gate kiosks, booths, leased.
SKIP_BUILDING = re.compile(
    r'storage|shed|maint|substation|utilit|scub|repair shop|welding shop|shop facility|fleet|heavy equipment|'
    r'plant op|greenhouse|barn|pump|chemical|\bgate\b|gate house|concession|ticket booth|'
    r'toilet|wash station|drill tower|extinguisher|leased facility|^building \d+$|'
    r'mosquito|sample prep|energy plant|grounds|control building|support building',
    re.I)
HOUSING = re.compile(r'commons|courtyard|apartment|gardens|graduate hills|leonardtown|university house', re.I)


def build_buildings():
    path = DATA / 'buildings.geojson'
    fc = json.load(open(path))
    base = [f for f in fc['features'] if not f['properties'].get('added_from_gis')]
    have = {str(f['properties']['building_number']).lstrip('0') for f in base}
    have_names = {f['properties']['name'].lower() for f in base}
    added, skipped = [], []
    seen = set()
    for f in query('BuildingAllSearch', 1):
        at = f['attributes']
        name = re.sub(r'\s+', ' ', at.get('NAME') or '').strip()
        m = re.search(r'\(([0-9A-Za-z]+)\)\s*$', at.get('DISPLAYNAME') or '')
        num = m.group(1) if m else None
        key = (num or '').lstrip('0') or name.lower()
        if not name or key in have or key in seen or name.lower() in have_names:
            continue
        c = [round(at['POINT_X'], 7), round(at['POINT_Y'], 7)]
        if km_from_centre(c) > MAX_KM or SKIP_BUILDING.search(name):
            skipped.append(name)
            continue
        seen.add(key)
        added.append({'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': c},
                      'properties': {
                          'name': name, 'name_as_printed': None, 'building_number': num,
                          'map_category': None,
                          'building_class': 'Residence Halls and Apartments' if HOUSING.search(name) else None,
                          'grid_location': None, 'latitude': c[1], 'longitude': c[0],
                          'coordinate_source': 'UMD GIS (BuildingAllSearch)',
                          'match_method': 'not in the printed map directory',
                          'added_from_gis': datetime.date.today().isoformat(),
                      }})
    # Several GIS records share a name (seven 'Graduate Hills Apartment'): suffix the
    # building number so search results can be told apart.
    from collections import Counter
    dup = Counter(f['properties']['name'] for f in added)
    for f in added:
        p = f['properties']
        if dup[p['name']] > 1 and p['building_number']:
            p['name'] = f"{p['name']} {p['building_number']}"
    fc['features'] = base + sorted(added, key=lambda f: f['properties']['name'])
    return fc, len(base), len(added), skipped


if __name__ == '__main__':
    parking = json.load(open(DATA / 'parking.geojson'))
    rules = json.load(open(DATA / 'rules.json'))

    info = build_lot_info(parking, rules)
    json.dump(info, open(DATA / 'lot_info.json', 'w'), indent=1)
    L = info['lots'].values()
    print(f"lot_info: {len(info['lots'])} lots, {sum(1 for x in L if x['total_spaces'])} with space counts, "
          f"{sum(1 for x in L if x['fill_class'])} rules filled, "
          f"{sum(1 for x in L if x['conflict'])} conflicts; campus total {info['campus_total_spaces']}")
    for lot, x in info['lots'].items():
        if x['conflict']:
            print('   conflict', lot, '-', x['conflict'])

    places, dropped = build_places()
    json.dump(places, open(DATA / 'places.geojson', 'w'))
    from collections import Counter
    print(f"places: {len(places['features'])} ({dropped} beyond {MAX_KM} km dropped)",
          dict(Counter(f['properties']['group'] for f in places['features'])))

    fc, nbase, nadd, skipped = build_buildings()
    json.dump(fc, open(DATA / 'buildings.geojson', 'w'), indent=1)
    print(f'buildings: {nbase} from printed map + {nadd} from GIS = {nbase + nadd}; '
          f'{len(skipped)} skipped (storage/utility/off-campus)')
