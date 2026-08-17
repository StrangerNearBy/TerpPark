import json

lots = {l['code']: l for l in json.load(open('lots_v2_stage1.json'))['lots']}
blds = {b['id']: b for b in json.load(open('buildings_v2_stage1.json'))}

def lot(code):
    l = lots[code]
    return l['lat'], l['lng']

def bld(bid):
    b = blds[bid]
    return b['lat'], b['lng']

# Every icon sighting found in the systematic 12-section scan of page 1, plus
# the Anacostia inset on page 2. Each is anchored to the nearest labeled lot
# or building with a real coordinate - these are "icon spotted adjacent to X"
# positions (accurate to roughly that lot/building's scale), not
# independently surveyed points.
sightings = [
    # Electric Vehicle Charging
    ('ev_charging', 'near Mowatt Visitor Lot',        *lot('MVL')),
    ('ev_charging', 'near lot NN',                     *lot('NN')),
    ('ev_charging', 'near Stadium Drive Garage (SDG)', *lot('SDR')),
    ('ev_charging', 'near Union Lane Garage / lot HH', *lot('ULG')),
    ('ev_charging', 'near Regents Drive Garage',       *lot('RDG')),
    ('ev_charging', 'near lot C1 / bldg 079',          *lot('C1')),
    ('ev_charging', 'near bldg 003 (Hotel Dr)',        *bld('003')),  # 003 not in GIS; 001 is immediate neighbor, same cluster
    ('ev_charging', 'Anacostia inset, near bldg 816',  *bld('816')),

    # Motorcycle & Scooter
    ('motorcycle', 'near lot 1d',        *lot('1d')),
    ('motorcycle', 'near lot N9',        *lot('N9')),
    ('motorcycle', 'near lot S8',        *lot('S8')),
    ('motorcycle', 'near lot LL4',       *lot('LL4')),
    ('motorcycle', 'near lot S7',        *lot('S7')),
    ('motorcycle', 'near lot 1b (Alumni Dr)', *lot('1b')),
    ('motorcycle', 'near lot BB',        *lot('BB')),
    ('motorcycle', 'near lot HH / Union Lane Garage', *lot('HH')),
    ('motorcycle', 'near lot 1b (south, near lot 1d)', *lot('1d')),
    ('motorcycle', 'near lot PH1',       *lot('PH1')),
    ('motorcycle', 'near Regents Drive Garage', *lot('RDG')),
    ('motorcycle', 'near lot JJ1',       *lot('JJ1')),
    ('motorcycle', 'near lot O3',        *lot('O3')),
    ('motorcycle', 'near lot O1',        *lot('O1')),
    ('motorcycle', 'near lot A',         *lot('A')),
    ('motorcycle', 'near lot U1',        *lot('U1')),
    ('motorcycle', 'near lot Y',         *lot('Y')),
    ('motorcycle', 'near lot LL3',       *lot('LL3')),
    ('motorcycle', 'near lot J2 / K3',   *lot('J2')),
    ('motorcycle', 'near lot K5',        *lot('K5')),
    ('motorcycle', 'near lot 11b',       *lot('11b')),
    ('motorcycle', 'near lot 9b',        *lot('9b')),
    ('motorcycle', 'near lot XX1',       *lot('XX1')),

    # Covered Bicycle Parking
    ('covered_bike_parking', 'near lot 6 / Terrapin Trail Garage', *lot('6')),
    ('covered_bike_parking', 'near Stadium Drive Garage', *lot('SDR')),
    ('covered_bike_parking', 'near Union Lane Garage / lot HH', *lot('ULG')),
    ('covered_bike_parking', 'near lot LL5 (Denton area)', *lot('LL5')),
    ('covered_bike_parking', 'near lot 19 / U2',      *lot('19')),
    ('covered_bike_parking', 'near lots W / W1 (Chapel Ln)', *lot('W')),
    ('covered_bike_parking', 'near lot LL3 (Lehigh Rd)', *lot('LL3')),
    ('covered_bike_parking', 'near lot N6 / lot 15 (College Ave)', *lot('N6')),
    ('covered_bike_parking', 'near bldg 003 (Hotel Dr)', *bld('003')),
    ('covered_bike_parking', 'near bldg 111 / lot CC1 area', *lot('CC1')),

    # Bike Repair Station
    ('bike_repair_station', 'near lot LL5 (Denton area)', *lot('LL5')),
    ('bike_repair_station', 'near lot 6 / Terrapin Trail Garage', *lot('6')),
    ('bike_repair_station', 'near lot GG2',           *lot('GG2')),
    ('bike_repair_station', 'near bldg 082 (near lot TT)', *lot('TT')),
    ('bike_repair_station', 'near bldg 406/081',      *bld('081')),
    ('bike_repair_station', 'near Mowatt Visitor Lot / lot 19', *lot('MVL')),
    ('bike_repair_station', 'near lot LL1',           *lot('LL1')),
    ('bike_repair_station', 'near lot N6 / lot 15 (College Ave)', *lot('N6')),

    # DOTS Impound Lot (facility, singular)
    ('dots_impound_lot', 'at Regents Drive Garage',   *lot('RDG')),
]

out = []
for kind, note, lat, lng in sightings:
    out.append({'type': kind, 'note': note, 'lat': lat, 'lng': lng,
                'source': 'map_icon_anchored_to_nearest_known_lot_or_building'})

json.dump(out, open('amenities_v2.json', 'w'), indent=2)
print(f"Compiled {len(out)} amenity sightings")
from collections import Counter
print(Counter(x['type'] for x in out))
