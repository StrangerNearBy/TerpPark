import json, urllib.request, urllib.parse, time

unmatched = json.load(open('buildings_unmatched.json'))

def nominatim_search(query):
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({
        'q': query, 'format': 'json', 'limit': 3, 'addressdetails': 1
    })
    req = urllib.request.Request(url, headers={'User-Agent': 'TerpParkV2-DataResearch/1.0'})
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)

results = []
for b in unmatched:
    name = b['name'].title()
    queries = [f"{name}, University of Maryland, College Park, MD"]
    found = None
    for q in queries:
        try:
            r = nominatim_search(q)
        except Exception as e:
            r = []
        time.sleep(1.1)  # respect Nominatim's 1 req/sec usage policy
        if r:
            found = r[0]
            break
    if found:
        results.append({**b, 'osm_lat': float(found['lat']), 'osm_lng': float(found['lon']),
                         'osm_display_name': found['display_name'], 'osm_type': found.get('type')})
        print(f"FOUND  {b['id']} {name}: {found['lat']}, {found['lon']}  ({found['display_name'][:70]})")
    else:
        results.append({**b, 'osm_lat': None, 'osm_lng': None})
        print(f"MISS   {b['id']} {name}")

json.dump(results, open('unmatched_geocoded.json', 'w'), indent=2)
