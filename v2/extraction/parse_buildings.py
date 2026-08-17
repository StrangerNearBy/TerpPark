import re, json

lines = open('buildings_raw_section.txt', encoding='utf-8').read().splitlines()

skip_exact = {
    "UNIVERSITY BUILDINGS", "0", "200", "Feet", "BUILDING NAME",
    "B U IL D IN G D IR E C TO RY", "GRID LOCATION/ INSET",
    "LIBRARIES", "VISITOR PARKING", "RECREATION AND ATHLETIC FACILITIES",
    "RESIDENTIAL FACILITIES", "APARTMENTS",
    "UMGC/ COLLEGE PARK MARRIOTT HOTEL AND",
    "CONFERENCE CENTER", "FRATERNITIES/ SORORITIES", "",
}

section_headers = {
    "UNIVERSITY BUILDINGS": "Academic/Administrative",
    "LIBRARIES": "Library",
    "VISITOR PARKING": "Parking Garage",
    "RECREATION AND ATHLETIC FACILITIES": "Recreation/Athletic",
    "RESIDENTIAL FACILITIES": "Residence Hall",
    "APARTMENTS": "Apartment",
    "UMGC/ COLLEGE PARK MARRIOTT HOTEL AND": "Hotel/UMGC",
    "FRATERNITIES/ SORORITIES": "Fraternity/Sorority",
}
current_section = "Academic/Administrative"

records = []
for raw in lines:
    line = raw.strip()
    if line in section_headers:
        current_section = section_headers[line]
        continue
    if line in skip_exact:
        continue
    if re.match(r'^\d+$', line):
        continue
    tokens = line.split()
    if not tokens:
        continue
    tok0 = tokens[0]
    if not re.match(r'^\d+,?$|^\d+-\d+$', tok0):
        continue
    id_tokens, idx = [], 0
    if '-' in tok0:
        id_tokens.append(tok0); idx = 1
    elif tok0.endswith(','):
        id_tokens.append(tok0.rstrip(',')); idx = 1
        while idx < len(tokens) and re.match(r'^\d+,?$', tokens[idx]):
            t = tokens[idx]; id_tokens.append(t.rstrip(',')); idx += 1
            if not t.endswith(','):
                break
    else:
        id_tokens.append(tok0); idx = 1
    rest = tokens[idx:]
    if not rest:
        continue
    if rest[-1] == 'INSET':
        grid = rest[-2] + ' INSET'
        name = ' '.join(rest[:-2])
    else:
        m = re.match(r'^[A-H]\d{1,2}$', rest[-1])
        if m:
            grid = rest[-1]
            name = ' '.join(rest[:-1])
        else:
            continue
    if not name:
        continue
    ids = []
    for t in id_tokens:
        if '-' in t and re.match(r'^\d+-\d+$', t):
            a, b = t.split('-')
            ids.extend(str(x).zfill(len(a)) for x in range(int(a), int(b) + 1))
        else:
            ids.append(t)
    for bid in ids:
        records.append({'id': bid.zfill(3) if bid.isdigit() and len(bid) < 3 else bid,
                         'name': name.strip(), 'grid': grid, 'category': current_section})

print(f"Parsed {len(records)} building records")
json.dump(records, open('buildings_parsed.json', 'w'), indent=2)
