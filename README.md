# TerpPark

Client-side webapp for UMD (College Park) parking. Live at [terppark.com](https://terppark.com).

1. **Check a lot** — type a lot code (e.g. `LL4`, `P2`, `1a`) and see its restriction category, exact rule text, and whether it's currently open to you (computed live from the real clock in America/New_York).
2. **Park near a building** — type a building name and get the closest lots ranked by distance, filterable by parker type (visitor / student / faculty-staff).
3. **Bike, Moto & EV Parking** — motorcycle spots, covered bike parking, bike repair stations, EV charging, filterable and sortable by distance.
4. **Map** — every lot, building, and amenity plotted on a real OpenStreetMap map, color-coded by category.

No backend, no build step, no dependencies — plain HTML/CSS/JS with Tailwind and Leaflet loaded from CDN.

## Data pipeline

Everything under `v2/extraction/` is the current, live pipeline. `generate_data_js.py` combines the source-of-truth JSON files into `docs/data.js`:

- **`buildings_v2_stage1.json`** / **`lots_v2_stage1.json`** — 244 buildings, 119 UMD lots. Sourced from the official Campus Parking Map PDF, cross-verified against Maryland iMAP GIS (`mdgeodata.md.gov`) real surveyed coordinates, with a pixel-color classifier used to independently re-verify every lot's restriction category against the source map (catches transcription errors a human re-read would miss).
- **`amenities_v2.json`** — 50 verified bike/moto/EV sightings, anchored to nearest known lot/building.
- **`offcampus_parking_v1.json`** — independently verified non-UMD public parking near campus (2 facilities, e.g. City of College Park Downtown Garage), each requiring two independent verification signals before inclusion.

Re-run `python3 v2/extraction/generate_data_js.py` from that directory any time a source file changes — don't hand-edit `docs/data.js`.

## Known limitations

- Distance is straight-line, not routing-based.
- A handful of lots not on the main map page use a neighborhood-level coordinate estimate rather than a lot-level one (flagged in their `note` field).
- **Posted signage at the lot always overrides this app.** Restrictions change; this is a convenience tool, not an authoritative source.
