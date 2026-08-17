"""
Combines the verified v2 source-of-truth JSON files into docs/data.js.

Inputs:
  buildings_v2_stage1.json         -> BUILDINGS
  lots_v2_stage1.json              -> LOT_DATA.{categories,general_rule,pay_area_rule,lots}
  amenities_v2.json                -> AMENITIES (bike/moto/EV/repair/impound)
  offcampus_parking_v1.json        -> merged into LOT_DATA.lots as category
                                       'off_campus_parking' (only if present)

Re-run this any time one of those source files changes, instead of hand-editing
docs/data.js directly.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS_DATA_JS = os.path.join(HERE, '..', '..', 'docs', 'data.js')

AMENITY_TYPE_META = {
    'ev_charging':          {'label': 'EV Charging Station', 'icon': 'ev_station', 'color': '#2e7d32'},
    'motorcycle':           {'label': 'Motorcycle Parking',  'icon': 'two_wheeler', 'color': '#8a5a00'},
    'covered_bike_parking': {'label': 'Covered Bike Parking', 'icon': 'pedal_bike', 'color': '#2b6cb0'},
    'bike_repair_station':  {'label': 'Bike Repair Station',  'icon': 'build', 'color': '#6b46c1'},
    'dots_impound_lot':     {'label': 'DOTS Vehicle Impound Lot', 'icon': 'local_shipping', 'color': '#616161'},
}

OFF_CAMPUS_CATEGORY = {
    'label': 'Off-campus public parking',
    'color': '#607d8b',
    'rule': 'Not operated by UMD Transportation Services - a public facility near campus, run by its own operator (see each listing). Pricing, hours, and rules are set by that operator, not UMD, so always confirm current rates/hours before relying on it.'
}


def load(name):
    with open(os.path.join(HERE, name)) as f:
        return json.load(f)


def main():
    buildings = load('buildings_v2_stage1.json')
    lot_data = load('lots_v2_stage1.json')
    amenities_raw = load('amenities_v2.json')

    amenities = []
    for i, a in enumerate(amenities_raw):
        amenities.append({
            'id': f"AM{i+1}",
            'type': a['type'],
            'note': a.get('note'),
            'lat': a['lat'],
            'lng': a['lng'],
            'source': a.get('source'),
        })

    offcampus_path = os.path.join(HERE, 'offcampus_parking_v1.json')
    offcampus_count = 0
    if os.path.exists(offcampus_path):
        offcampus = load('offcampus_parking_v1.json')
        lot_data['categories']['off_campus_parking'] = OFF_CAMPUS_CATEGORY
        for i, o in enumerate(offcampus):
            offcampus_count += 1
            lot_data['lots'].append({
                'code': f"OC{i+1}",
                'name': o['name'],
                'lat': o['lat'],
                'lng': o['lng'],
                'coord_source': f"offcampus_research:{o.get('source', 'unknown')}",
                'category': 'off_campus_parking',
                'category_label': OFF_CAMPUS_CATEGORY['label'],
                'rule': OFF_CAMPUS_CATEGORY['rule'],
                'lot_type': None,
                'gated': False,
                'overflow_faculty_staff': False,
                'overflow_student': False,
                'address': o.get('address'),
                'operator': o.get('operator'),
                'pricing_summary': o.get('pricing_summary'),
                'hours_summary': o.get('hours_summary'),
                'confidence': o.get('confidence'),
                'note': o.get('note'),
            })

    out = []
    out.append("// v2 dataset: freshly re-extracted and independently re-verified from the source PDF + Maryland GIS + OSM cross-references. See v2/ for methodology.")
    out.append(f"const BUILDINGS = {json.dumps(buildings, separators=(',', ':'))};")
    out.append(f"const LOT_DATA = {json.dumps(lot_data, separators=(',', ':'))};")
    out.append(f"const AMENITY_TYPES = {json.dumps(AMENITY_TYPE_META, separators=(',', ':'))};")
    out.append(f"const AMENITIES = {json.dumps(amenities, separators=(',', ':'))};")

    with open(DOCS_DATA_JS, 'w') as f:
        f.write('\n'.join(out) + '\n')

    print(f"Wrote {DOCS_DATA_JS}")
    print(f"  buildings: {len(buildings)}")
    print(f"  lots: {len(lot_data['lots'])} (of which off-campus: {offcampus_count})")
    print(f"  amenities: {len(amenities)}")


if __name__ == '__main__':
    main()
