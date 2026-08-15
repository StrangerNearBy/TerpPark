import re, json

lines = open('buildings_section.txt', encoding='utf-8').read().splitlines()

# Drop header/noise lines
skip_exact = {
    "UNIVERSITY BUILDINGS", "0", "200", "Feet", "BUILDING NAME",
    "B U IL D IN G D IR E C TO RY", "GRID LOCATION/ INSET",
    "LIBRARIES", "VISITOR PARKING", "RECREATION AND ATHLETIC FACILITIES",
    "RESIDENTIAL FACILITIES", "APARTMENTS",
    "UMGC/ COLLEGE PARK MARRIOTT HOTEL AND",
    "CONFERENCE CENTER", "FRATERNITIES/ SORORITIES", "",
}

grid_re = re.compile(r'^([A-H]\d{1,2})$')
id_re = re.compile(r'^\d{3}$')

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
    if re.match(r'^\d+$', line):  # stray page/feet numbers
        continue
    tokens = line.split()
    if not tokens:
        continue
    # Leading id group. Only treat as a multi-id list if the first token
    # ends with a comma or is a dash range; otherwise the first token alone
    # is the id (a following digit token, e.g. a street number, is part of
    # the name, as in "815 7401 BALTIMORE AVE F13").
    idx = 0
    id_tokens = []
    tok0 = tokens[0]
    if not re.match(r'^\d+,?$|^\d+-\d+$', tok0):
        continue
    if '-' in tok0:
        id_tokens.append(tok0)
        idx = 1
    elif tok0.endswith(','):
        id_tokens.append(tok0.rstrip(','))
        idx = 1
        while idx < len(tokens) and re.match(r'^\d+,?$', tokens[idx]):
            t = tokens[idx]
            id_tokens.append(t.rstrip(','))
            idx += 1
            if not t.endswith(','):
                break
    else:
        id_tokens.append(tok0)
        idx = 1
    if not id_tokens:
        continue
    rest = tokens[idx:]
    if not rest:
        continue
    # grid ref: last token, or last two tokens if ends with INSET
    if rest[-1] == 'INSET':
        grid = rest[-2] + ' INSET'
        name = ' '.join(rest[:-2])
    else:
        m = grid_re.match(rest[-1])
        if m:
            grid = rest[-1]
            name = ' '.join(rest[:-1])
        else:
            # no recognizable grid, skip (probably a wrapped/garbage line)
            continue
    if not name:
        continue
    # expand id group (handle "974," "975," "981" already separate tokens; also "996-999" ranges)
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
for r in records[:10]:
    print(r)
print('...')
for r in records[-10:]:
    print(r)
