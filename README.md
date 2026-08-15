# TerpPark

A client-side webapp for UMD (College Park) parking. Three things it does:

1. **Check a lot** — type a lot code (e.g. `LL4`, `P2`, `1a`) and see its restriction category, the exact rule text, and whether it's currently open to you (computed live from the real clock in America/New_York).
2. **Park near a building** — type a building name (e.g. "McKeldin Library") and get the closest parking lots ranked by distance, each with distance, estimated walk time, and live status.
3. **Map** — every lot and building plotted on a real OpenStreetMap map, color-coded by restriction category.

## Running it

No build step, no backend.

```
cd docs
python3 -m http.server 8791
```

Then open `http://localhost:8791`. (A plain double-click on `index.html` also mostly works, except some browsers block `fetch`/CORS for `file://` — this app avoids that by inlining all data into `data.js`, so double-clicking should work too.)

## Where the data comes from

- **`Campus-parking-map.pdf`** — the official UMD Transportation Services Campus Parking Map (2025-26 edition) you provided. This is the source for: the list of 117 lot codes, each lot's restriction category (color-coded on the map: green/cyan/orange/red/purple), the rule text for each category, and the special per-lot rules (KK, TV, YC, BB, D, E, GG2, HP), gated lots, and overflow-lot lists. Read via `pdftotext` + rendering pages to PNG and reading the legend/directory tables directly.
- **4 visitor parking garages** (Mowatt Lane, Regents Drive, Stadium Drive, Union Lane) are included as their own `visitor_garage` category — pay-to-park, no permit needed, $4/hr/$20-day-max — using their real GIS building coordinates directly rather than the grid-derived estimate.
- **Maryland iMAP GIS** (`geodata.md.gov` / `mdgeodata.md.gov`, service `Structure/MD_CampusFacilities`) — the *real, surveyed* coordinates. This is a Maryland state government open-data service maintained with UMD Facilities Management / UMD DOTS. Two layers were used:
  - `UMD Buildings` (layer 2): polygon footprints with a `BUILDINGID` field that matches the numeric IDs printed on the parking map's Building Directory. 234 of 245 PDF building entries matched directly by ID → real lat/lng (centroid of the actual building footprint).
  - `UMD Parking Lots` (layer 1): 305 real paved-area polygons tagged `SURFUSE=Parking Lot`, but **not** labeled with lot codes — so they can't be joined by name.

### How lot coordinates were derived (since the GIS lots aren't labeled)

1. The parking map prints a letter/number grid (columns A–H, rows ~2–13) over the campus, and both the Building Directory and Parking Lot Directory give each entry's grid cell (e.g. `D10`).
2. Using the 234 buildings matched by ID (real lat/lng + known grid cell), I fit a linear regression (grid cell → lat/lng). This is necessarily coarse — a grid cell is roughly 150-200m across, so the fit alone has ~115m median error.
3. For each of the ~112 parking lots, I looked up its grid cell → got an approximate point from that regression → then **snapped it to the nearest real GIS parking-lot polygon(s)** within 140m (averaging their centroids). 111 of 112 lots successfully snapped to real pavement — meaning their final coordinates are the actual location of a real paved lot, not just an interpolated guess.
4. 15 lots aren't on the main map page at all (the PDF says "found on back of the map" — they're in inset maps for Greenmead/Courtyards, Graduate Gardens, Tech Ventures & Patapsco, and Anacostia/Severn). For those, coordinates are the centroid of GIS buildings in that named area — a neighborhood-level estimate, not a lot-level one.
5. One lot (`8`) has no identifiable location in the source map at all and is left uncoordinated (still shown in the "Check a Lot" tool, just excluded from distance ranking).

Every lot/building record's `coord_source` field (in `lots_final.json` / `buildings_final.json`) states exactly how its coordinate was derived, so you can see which are GIS-exact vs. estimated.

### Accuracy verification pass

Every lot's restriction category was originally transcribed by eye from a rendered PDF page. Because getting this wrong is a real ticket risk, it was re-verified **objectively**, not just re-read:

1. Built a Pillow-based pixel classifier: sampled reference RGB values directly from the 5 solid-color legend swatches, then frequency-voted the dominant color in a small pixel window over each lot code's text in the directory table (avoiding the anti-aliasing and red divider-line contamination that broke a naive single-pixel sample).
2. First pass found 49 "mismatches" — almost all turned out to be a sampling bug (divider-line bleed), fixed by re-measuring the actual divider x-positions and switching to frequency-based color voting.
3. Second pass found 15 genuine mismatches between my original transcription and the objectively-measured color, plus one lot (`RR`) missing from the transcription entirely. Every one of the 15 was individually re-confirmed with a fresh zoomed crop before the fix was applied — including two lots (`R4`, `TT`) that had been mistakenly recorded as *less* restrictive than they actually are (both are real 24-hour-restricted lots), which would have been actively misleading.
4. Re-ran the classifier after fixing the data: **0 mismatches across all 113 directory-table lot codes.**
5. Separately re-read every lot's grid-reference cell (the black text) column-by-column against the JSON, independent of the color check — also 0 mismatches.
6. Cross-checked all rule text (the 5-category legend, special restrictions, overflow lots, gated lots, pay-area rates) word-for-word against a fresh high-res crop. Found and fixed one real gap: the "Unrestricted after 4PM" category's exception for commuter registrants (no overnight parking 3am-5am Mon-Fri) was missing from both the rule text and the live-status logic.
7. Ran an exhaustive boundary-time sweep (every 15-30 min mark, every category, weekday and weekend, including exact 7am/4pm/8pm/3am/5am transitions) confirming the live-status logic matches the written policy with no off-by-one errors.
8. Sanity-checked every one of the 244 buildings' and 116 lots' coordinates falls within the real UMD campus bounding box (0 outliers).

As of this pass, zero lots remain in the `unspecified` (low-confidence) category — every one that was previously uncertain (`9b`, `10a`, `11b`, `K3`, `K5`, `K7`, `4t`, `12a`) was resolved with high confidence.

### Second pass: page 2 (the inset detail maps) and remaining gaps

The 16 "found on back of the map" lots had been given a crude whole-neighborhood coordinate estimate. Page 2 actually contains detailed inset maps of those areas (Greenmead/Courtyards, Graduate Hills, Graduate Gardens, Tech Ventures & Patapsco, Severn, Anacostia) showing each lot's real position next to specific numbered buildings. Re-examining those insets directly:

- **Found and fixed 4 lots wrongly attributed to the wrong neighborhood**: `4h`, `4k`, `4m`, `12a`, `14a`, `14b`, `14c` had all been tagged "Tech Ventures & Patapsco" from an unreliable text-extraction guess; the insets show `4h`/`4m` are actually in Greenmead, `4k` is in Severn, and `12a`/`14a`/`14b`/`14c` are actually in Graduate Hills Apartments, nowhere near Tech Ventures.
- **Located lot `8`**, which previously had no coordinate at all anywhere in the dataset (the one lot the first pass couldn't place) — it's on the Greenmead/Courtyards inset, right next to buildings 990/987.
- **Every one of the 16 satellite lots now has a coordinate pinned to specific real (GIS) buildings** visible next to it on the inset, rather than a pooled average of an entire neighborhood — e.g. `14a`'s coordinate is now the real position of building 288, not an average of ~6 unrelated buildings across the whole area. Only `V3` still uses a neighborhood-level estimate (not visible/labeled on any inset).
- **Found a real conflict inside the source PDF itself**: lot `TV`'s color is rendered green ("Unrestricted after 4PM") in the main-page summary directory table, but purple ("Special Restrictions") on the Tech Ventures detail inset - and the special-restrictions rule text for TV ("only valid CLPR/permit required all other times") describes behavior that is never actually free-for-everyone, which only matches the purple category. Two independent signals (inset color + rule text) outweighed the one (table color), so TV is now categorized as `special_restrictions`. This is flagged in its `note` field.
- Added the **Letter vs. Number lot-type rule** from the "How to Read a Parking Lot Sign" panel (letter-prefixed = Faculty/Staff lot, number-prefixed = Student lot) as a `lot_type` field, shown as a chip on each lot's detail page and explained on the Rules screen. This existed on page 2 of the PDF but had never been captured anywhere in the app.
- Added the **Overflow Lots for Registered Parkers** list to the Rules screen (it was in the dataset already but was never actually rendered anywhere in the UI).
- **Not modeled, by scope decision**: the Map Key amenity icons (bike repair stations, EV charging, motorcycle/scooter parking, covered bike parking, Zipcar, DOTS impound lot, areas under construction) are point icons on the source map but aren't parking-restriction data, so they're not part of this dataset. Also not modeled: Special Events/Athletic Event game-day parking restrictions (no fixed schedule to encode) and the Sustainable Transportation / DOTS program info (not related to lot-by-lot parking rules).
- One open item: the Tech Ventures inset shows an unlabeled-in-the-directory lot marked just `V` next to the Patapsco building - it doesn't appear as its own row in the main Parking Lot Directory table, so it was not added as a separate entry (it may simply be an inset-only sub-label for `V2`/`V3`, similar to how lot `22` is labeled `22c` on its inset).

### Known limitations

- **Distance is straight-line**, not actual walking-path distance (no routing API used, per the simple-static-app choice). It's a reasonable proxy on a compact campus but will understate distance across buildings/barriers.
- Newer buildings not yet in the 2013-vintage GIS building layer (e.g. Yahentamitsi Dining Hall, Thurgood Marshall Hall, Pyon-Chen Hall) fall back to the coarser grid-regression estimate.
- 15 lots aren't on the main map page at all (the PDF says "found on back of the map" — inset maps for Greenmead/Courtyards, Graduate Gardens, Tech Ventures & Patapsco, and Anacostia/Severn); their coordinates are a neighborhood-level GIS-area estimate, not lot-level.
- One lot (`8`) has no identifiable location anywhere in the source map and is left uncoordinated (shown in "Check a Lot", excluded from distance ranking).
- **Posted signage at the lot always overrides this app.** Restrictions change; this is a convenience tool, not an authoritative source.

## Files

```
Campus-parking-map.pdf     source PDF
scripts/                   the data-extraction pipeline (PDF text → parsed → joined with GIS → geocoded)
lots_directory.json        hand-transcribed lot table from the PDF (code, grid cell, category)
buildings_final.json       final building dataset (244 records)
lots_final.json            final parking lot dataset (117 records: 112 lettered/numbered lots + 4 visitor garages + RR)
docs/                    the app itself (index.html, style.css, app.js, data.js)
```

To regenerate the data (e.g. if you get an updated PDF), rerun in order:
`parse_buildings.py` → `join_buildings.py` → `fit_transform.py` → `build_dataset.py` → `backfill_satellite_lots.py`, then regenerate `docs/data.js` from the two `*_final.json` files.
