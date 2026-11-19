# TerpPark — UMD campus parking rules

A general-purpose map of every UMD parking lot that states, for any lot and any
moment, **who may park there and when** — plus pay-to-park options and directions.

```
open docs/standalone.html                         # one file, no build, no server
# or, for development:
cd docs && python3 -m http.server 8777            # then localhost:8777
```

---

## Handoff notes — read this first

**Live at [terppark.com](https://terppark.com)**, served by GitHub Pages from
`docs/` on `main` (`docs/CNAME` holds the domain; never delete it). Every push to
`main` is live in about a minute.

### Deploying (manual, on purpose)

GitHub Pages' source is **GitHub Actions** (switched 2026-11-19), so pushing to any
branch publishes nothing. Work on `dev`, then publish when ready:

```
npm run build                  # rebuild docs/ from data/ + src/, then commit
git push origin dev
npm run deploy                 # or GitHub → Actions → "Deploy to terppark.com" → Run workflow
gh run watch -R StrangerNearBy/TerpPark   # follow it
```

The workflow (`.github/workflows/deploy.yml`) runs the tests, checks `docs/` is
rebuilt from current source, checks `docs/CNAME` = terppark.com, fast-forwards
`main` to your branch (so `main` always equals what is live), then uploads `docs/`
and publishes it. It refuses if any check fails or if `main` has commits your
branch lacks. Don't commit to `main` directly; the deploy moves it.

The `github-pages` environment allows deploys from runs started on `main` (which
`npm run deploy` does) or `gh-pages`.

This is TerpPark v3. It replaced the original TerpPark app in this repo on
2026-11-19. The original is preserved at tag **`legacy-v2`**; to bring it back:
`git checkout legacy-v2 -- . && git commit -m "Restore v2"` (or revert the v3 merge).


This section is the context a fresh session needs. The rest is reference.

### What this is (and is not)

It is an **informational** tool: pick a building (or use your location), pick a
time, see every nearby lot with its rules stated plainly.

It is **not personalised**. An earlier version ranked lots against the user's own
permit; that was deliberately removed. UMD publishes no permit→lot eligibility
table anywhere, so the whole feature rested on an inference (leading letter =
faculty/staff, leading digit = student). Dropping it removed the weakest
assumption in the system. **Do not add it back without a real DOTS data source.**

### Current state — working

- 273 buildings (195 from the printed map + 78 more from UMD GIS), 203 lot/garage
  features, 48 pay stations, 129 lot polygons
- **Space counts for 123 of 127 lots** and every garage, plus permits sold and lot
  type (Student / Faculty/Staff / Visitor), in `data/lot_info.json`. Campus total
  16,341, which matches the ~16,500 DOTS publishes.
- 1,182 campus places (dining, libraries, EV, motorcycle, Zipcar, shuttle, Metro,
  Purple Line, bikes, restrooms, health, landmarks) in `data/places.geojson`,
  toggled from the map's pin button, searchable from the search box
- Restriction rules for all 5 classes + 8 special lots, in `data/rules.json`; 5
  more lots filled from UMD's parking database; 5 lots flagged where sources disagree
- Leaflet map on greyed OpenStreetMap tiles, pill markers (`● JJ3 128` = status, lot,
  spaces); click for full schedule. Mobile-first layout (see Design direction)
- Apple / Google Maps directions deep links, platform-aware
- Light-only UMD palette; responsive desktop panel ↔ mobile bottom sheet
- `node test.mjs` passes (window-wrap boundaries + 15 lot-family cases)

### Palette (v3.2, 2026-11-19): UMD colours, not UMD branding

User decision: use Maryland's colours and styling so the app *feels* like campus,
but **never UMD's wordmark, logos, Testudo artwork or other brand marks**. TerpPark
keeps its own red "P" mark, and the disclaimer stays.

- UMD red `#E21833`: primary buttons, logo, red-sign lots, top strip
- UMD gold `#FFD200`: Beta tag, Bike-mode pins (black text), selected-chip icons,
  EV filter; gold *text* uses `#7A6000` for contrast
- Black `#141414` and white: text, selected modes and chips, Motorcycle pins
- Status keeps meaning-colours, softened: free `#1E7A47`, pay `#C9820A`, permit grey;
  blue `#1A73E8` only for "you"
- Places and Explore: gold, black and greys only (no violet, cyan or pink)

### Design direction (redesigned 2026-11-18, v3)

Two earlier attempts were rejected. v2 (red/gold, red permit pills) worked but the
user found it "complicated": in the daytime almost every lot is permit-only, so the
map became a sea of red. v3 is the clean, mobile-first version, borrowing the calm
list-first feel of a friend's app (terppark.com):

- **Colour roles (v3.1, user asked for more colour and a clear "you are here"):**
  - **status**, as a tinted pill and a dot: green = free now, **amber** = pay to park,
    grey = permit needed;
  - **lot sign**, as a solid capsule with white text: red or black, as on the real
    sign (pins and card titles);
  - **you / your destination: blue**, the maps-app convention: a pulsing dot for
    your location, a labelled blue pin for a chosen building. Pay moved from blue
    to amber so blue means only "you".
  - Campus places use hollow rings in colours outside all three roles.
- Earlier v3 note: three status colours, green = free now, blue = pay to park,
  grey = permit needed (lot permit *or* faculty/staff, which drivers see as one).
  Red is the brand mark and the single primary button (Directions) — never a status.
- **Light only.** No dark mode: an auto dark block once turned the app black.
- **Summary card is the filter:** `All · Free · Pay · Permit` counts are tappable.
  The time picker is hidden behind the "Now" button.
- **Each card says when it changes:** "Permit only · free from 4 PM". Changes are
  measured in those three states, so lot-permit → faculty/staff is not a "change".
- **Mobile:** a List / Map switch (not a map under a sheet); detail opens as its
  own full screen with a back button. Desktop: list panel left, map right.
- **Map stays quiet:** OpenStreetMap tiles desaturated with CSS, grey lot outlines
  (only the selected lot is coloured), white pills `● JJ3 128` for the nearest 12,
  status dots for the rest. Campus places are small hollow rings in hues that never
  collide with the status colours.
- Lot codes are searchable ("LL4"), as are buildings and places.

### Non-obvious things that cost real effort

1. **Restriction classes are encoded as ink colour, nowhere as text.** The PDF
   directory prints each lot ID in one of 5 colours. `tools_extract_restrictions.py`
   renders page 1 at 300 dpi and samples the glyph colour of each lot ID. It
   resolves to exactly 5 distinct RGB values across all 112 lots — that clean
   split is why this is trustworthy. Re-run it if the map is ever reissued.
2. **Lot families.** The map says "Overflow: Lot 4" but real IDs are
   `4a 4b 4h 4k 4m 4n 4t 4J`. Prefix matching is *wrong*: `K` must not match `KK`,
   `X` must not match `XX1`. `lotBase()` takes the leading run of letters **or**
   digits; a bare reference expands to a family, anything else matches exactly.
3. **`BLDG_NUM` is null on some GIS records** where `BUILDINGID` still holds the
   number. Index on both or you lose buildings (this is how 408 went missing).
4. **Building 352** is in no dataset. Identified as Discovery House (opened Aug
   2026) via grid ref G11 + Google Maps. Flagged `identity_inferred: true`.
5. **Window wrapping.** A window like `16:00 → 07:00` belongs to the day it
   *starts*, so Saturday 6 AM is still governed by the Friday `mon-fri` rule.
   Tested explicitly; easy to break.

### Car / Motorcycle / Bike modes

A switch under the search bar picks the vehicle. The choice is remembered in
localStorage (a convenience only; the app works without it). Each mode has its own
counts, list, map pins and detail screen.

- **Car**: everything above, plus an **EV charging** filter. 14 UMD chargers are
  attached to their lot: "Lot NN" by code, "X Garage" to that garage's lots, others
  to a lot within 60 m. "Lot EE" (no such lot in the data) and "Service Building
  Alley" (119 m away) stay as map dots only.
- **Motorcycle**: 32 UMD motorcycle/scooter areas (6 with a lock point, 9 with a
  space count). Rules from UMD's Motorized Cycle page: motorcycles need a CLPR
  permit and may use your assigned lot or a designated area; scooters and mopeds
  need a DOTS plate and designated areas only.
- **Bike**: 401 racks with loop counts (2,974 loops) and UMD's own `covered` flag
  (36 covered), 35 e-scooter/e-bike parking sites (closed ones hidden), bike rooms
  with their access rule, repair stations and Capital Bikeshare. TerpPark's
  approximate covered-bike points were dropped in favour of UMD's. The e-bike and
  bike rule pages block automated reads, so their wording comes from search results
  that quote them, and the app links to both pages.

### Paying: ParkMobile zones

UMD pay areas use ParkMobile. `data/parkmobile_zones.json` holds the zones from
UMD's *ParkMobile Zones* map (Aug 2026), with its method:

| Zone | Where |
|---|---|
| 6102 | Union Lane Garage |
| 6103 | Mowatt Lane Garage |
| 6104 | Regents Drive Garage |
| 6105 | Stadium Drive Garage |
| 6115 | Valley Dr, Eppley Rec Center |
| 6116 | Valley Dr, School of Public Health |
| 6101 | Xfinity Center Visitor Lot |

Zones 6124 and 6127 (and the off-map inset 6119/6120) matched no UMD pay station,
so they are not assigned. Every pay lot's detail has a **Pay in ParkMobile**
button (`app.parkmobile.io/zone/start`) and, where known, the zone with a copy
button. ParkMobile documents no URL parameter that pre-fills a zone, so none is
used. Pay lots without a known zone say to use the zone on the sign. The City
garage links to collegeparkmd.gov/parking, because the City says "mobile app" but
does not name one. An older notice names MobileNOW!, so ParkMobile is not assumed.

### Visitor garages hold two kinds of space

Mowatt Lane, Regents Drive, Stadium Drive and Union Lane each contain a permit lot
(B and RR in Regents, 19 and U2 in Mowatt, …) **and** visitor pay-station spaces.
Regents' visitor spaces are numbered, on the top floor, per UMD's visitor page. Lot B is
*Unrestricted after 4PM* on both the printed map and UMD's database, so "Free now"
after 4 PM is correct **for lot B's spaces only**. The 345 visitor spaces still
charge $4/hr from 7 AM to midnight daily. Cards, details and pins (`· $`) now say
which spaces the status covers. A user caught this ("Regents drive garage free??").

### Lot signs: black vs red, letter vs number (map page 2)

Page 2 of the printed map explains the sign at every lot entrance, and the app
now mirrors it:

- **Black text** means anyone may park after 4 PM on weekdays and all day on
  weekends (the *Unrestricted after 4PM* class). **Red text** means extra
  restrictions, named on the strip under the lot code (24-hour, modified,
  faculty/staff, or a lot-specific rule). Lot codes in cards and map pins use
  that ink, and the lot detail draws the sign. This is the only red text in the
  UI, because it is what drivers see.
- **Letter means faculty/staff, number means student** is UMD's own printed rule,
  not an inference (earlier notes called it a guess). The app uses UMD's database
  lot type first and this rule as the fallback, both in the "I need" filter and
  the lot type shown.
- **Special events / game days** can restrict any lot, black ones included. This
  is noted in every lot's details and on the Rules screen, with the athletics
  parking link.

### From the original TerpPark (terppark.com) — imported 2026-11-18

A friend's app built from the same printed map (`github.com/StrangerNearBy/TerpPark`).
Compared field by field: all of its on-campus lots and buildings were already here,
and its restriction readings agree with ours (its TV differs only on paper; our
special-lot rule already gives TV its own schedule). What it had that this app
lacked, and what was taken (no attribution in the UI, since the same team built both):

- **10 off-campus lots** (City of College Park garage + zone parking, Cambria
  hotel garage) with address, price, hours, operator and TerpPark's confidence
  rating. Only the City garage's paid hours (Mon–Sat 8–10pm) and Cambria (paid)
  become schedules; everything else shows "Hours unconfirmed", never "Free".
- **Covered bike parking (10) and the DOTS impound lot**, as campus places,
  marked as approximate (TerpPark anchors them to the nearest lot).
- **"I need: Anyone / Visitor / Student / Faculty-staff" picker.** It is a
  *filter*, not a ranking. Ours uses UMD's official lot-type field and the
  overflow lists, not TerpPark's letter/number guess, and it says plainly that
  your permit must still match the lot on the sign.
- **Rules screen**, which explains every restriction class.

`node tools_import_terppark.mjs` re-pulls it into `data/terppark_import.json`. It
parses TerpPark's `data.js` as JSON and never executes it. `build.mjs` merges it in.

### Space counts — they DO exist (corrected 2026-11-18)

An earlier version of these notes said per-lot space counts do not exist. **That
was wrong.** They are two *tables* (not layers, which is why a layer search
missed them) in `CampusMapDefault_NoInsite/FeatureServer`:

- `/11` **ParkingSpaceCount**: `Lot, Total_Spaces, Permits, Display`, 201 rows.
  `Display=False` rows are service/curbside spaces by building (e.g. "COLE FIELD
  HOUSE" 18). UMD counts them, but they have no lot on the map; they are kept in
  `lot_info.json → other_spaces`.
- `/12` **ParkingRestriction**: lot type, restriction label, regulation sentence.
  Agrees with the PDF ink colour on 104 of 109 overlapping lots.

Garages are several rows sharing a `GarageBldgNum`. Mowatt Lane = 19 + U2 + visitor
= 1,626, which matches OpenStreetMap's 1,628. **Union Lane (179) lists only 16 pay
spaces, so it is marked incomplete** and shows no number on its pill.

`tools_fetch_umd_gis.py` re-pulls all of this. The printed map always wins. UMD's
record only *fills* a lot the map leaves blank, and only when the record agrees
with itself. Conflicts are shown in the app as "Sources disagree":
`K3`, `V2` (map: unrestricted after 4PM; database: 24-hour), `HP` (map: special/ADA;
database: modified restricted), and `V`, `HC` (the database contradicts itself).

### What does not exist — stop looking

Each of these was checked directly against the sources, not assumed:

- **Individual stalls (single/double, stall outlines).** Not in UMD GIS; OpenStreetMap
  has 0 `amenity=parking_space` on campus and capacity on only 7 lots. Google and
  Apple expose no space layouts, and their APIs need paid keys. Lot totals are
  the finest real number.
- **Live availability.** Nothing real-time anywhere in UMD's data.
- **Permit → lot eligibility.** Not published. The database's lot *type*
  (Student / Faculty/Staff) is the closest official signal; it is displayed, not
  used for ranking.
- **ADA space locations/counts.** The `CampusServices/Disability` layer is
  disability *service offices*, not parking. Only lots BB, D, E, GG2, HP are
  identified as ADA, and only because the map's legend says so.

### Open items

- Tiles moved from Carto (now watermarked "API KEY REQUIRED") to the standard
  OpenStreetMap server. Its usage policy allows light use only: before a real
  launch, use a paid or self-hosted tile provider.
- A September 2026 edition of the printed map exists (`../Campus-parking-map-2026-09.pdf`);
  rule text is unchanged, but `tools_extract_restrictions.py` (PDF path as its
  argument; defaults to `../Campus-parking-map.pdf`, the 2025 map) has column
  offsets tuned to the 2025 layout. Re-tune, then re-run, to check K3/V2 and the new
  lot `4c`.
- Overflow vs 24-hour-restricted conflict: some faculty/staff overflow lots (e.g.
  `16b`) are also 24-hour restricted. Overflow currently wins, per the map's
  overflow panel. Unverified with DOTS.
- 24 lots exist in UMD's GIS but not on the printed map, so have no published
  rule. They surface as "No published rule".
- `data/parking.geojson` still carries vestigial permit-era fields.

---

## Layout

```
data/                  the facts — swap these, behaviour follows
  buildings.geojson      195 buildings, WGS 84
  parking.geojson        203 lot/garage features, 179 with a restriction class
  pay_parking.geojson    48 pay stations & meters, keyed to nearest building
  lot_polygons.geojson   129 lot outlines
  rules.json             restriction windows, overflow, special lots, ADA, pay
  lot_info.json          space counts, permits sold, lot type, UMD restriction
                         record, conflicts (generated by tools_fetch_umd_gis.py)
  places.geojson         1,182 campus places in 7 groups (generated)
  terppark_import.json   off-campus lots + amenities from TerpPark (generated)
src/engine.js          reasoning — pure, zero deps, no DOM
docs/                  UI and the deployed site (GitHub Pages) — Leaflet map + panel;
                       vendor/ holds Leaflet 1.9.4; CNAME, robots.txt, sitemap.xml
tools_extract_restrictions.py   re-derives restriction classes from the PDF
tools_fetch_umd_gis.py          re-pulls lot_info, places, and extra buildings
tools_import_terppark.mjs       re-pulls off-campus lots + amenities from TerpPark
```

`python3 tools_fetch_umd_gis.py` regenerates `lot_info.json` and `places.geojson`,
and rebuilds `buildings.geojson` as the 195 printed-map buildings plus GIS
buildings tagged `added_from_gis` (storage, utility, gates, and anything over 3 km
away are skipped). It is safe to re-run.

`rules.json` is data, not code. Changing when a lot opens is a data edit.

Hosting: GitHub Pages serves `docs/` as-is, with no build step on GitHub's side, so
**rebuild locally and commit `docs/` before pushing**.

Build: `node build.mjs` (data → `docs/data.bundle.js`), then
`node bundle-standalone.mjs` (→ `docs/standalone.html`, Leaflet inlined).
Run `cp src/engine.js docs/engine.js` after editing the engine.

## Data provenance

All coordinates WGS 84 / EPSG:4326, `[lon, lat]`.

- **UMD ArcGIS org** `services9.arcgis.com/1rOwFRpAwrxe0rBl` (~91 services):
  - `BuildingAllSearch/0` — buildings, keyed by `BLDG_NUM`
  - `CampusMapDefault_NoInsite/{1,5,6}` — lot polygons, garage points, lot points
  - `Transportation/13` — `PayPublicParking`
  - `CampusMapDefault_NoInsite/{11,12}` — ParkingSpaceCount, ParkingRestriction tables
  - `BuildingAllSearch/1` — all 332 building points (number is in `DISPLAYNAME`)
  - `DiningServices`, `CampusServices`, `Transportation`, `CampusReference`, `Tours`,
    `Residence_Community_Labels` — campus places
- **Printed map** (UMD Transportation Services Campus Parking Map PDF; not committed) — the directory,
  grid refs, restriction colours and all rule text
- **api.umd.io/v1/map/buildings** — fallback only; missing ~19 newer buildings
- Google Maps — building 352 only

Earlier exports of `buildings.geojson` / `parking.geojson` also exist outside this repo.

## Engine API

```js
const engine = createEngine({buildings, parking, payParking, rules, lotInfo, places});
// results now carry: spaces, permitsSold, lotType, umdRegulation, conflict,
// classSource ('map' | 'umd_gis'), garage {name, total_spaces, parts, complete}
// searchBuildings() also returns places (features with properties.group)
engine.searchBuildings(query, limit);
engine.findParking(buildingFeature, permit, when, {radius, needsAda});
explainLot(rules, lotId, restrictionClass, when);  // plain-English schedule
```

Extension seams (constructor options): `distance` (haversine → walking router),
`resolveEligibleLots`, `availability` (→ live counts), `enrich`.

`findParking` still accepts a permit argument; the UI always passes `''`.

## Known limits — keep these visible in the UI

Posted signs at the lot always take priority over these published rules.
Distances are straight-line, not walking routes. No live availability.
Semester and event closures are not modelled — UMD has a
`TemporaryParkingClosure` service that could feed this.
