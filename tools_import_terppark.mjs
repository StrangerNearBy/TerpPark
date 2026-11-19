// Imports the parts of TerpPark (github.com/StrangerNearBy/TerpPark, terppark.com)
// that this app does not have from its own sources:
//   - off-campus public parking (City of College Park garage + zones, Cambria garage)
//   - covered bike parking and the DOTS impound lot
// Everything else TerpPark has (lots, buildings, restriction classes) was checked
// against our data on 2026-11-18: all its on-campus lots and buildings were already
// here, and its restriction readings agreed with ours.
//
//   node tools_import_terppark.mjs        -> data/terppark_import.json
//
// Credit stays attached in the output and in the UI.
import { writeFileSync } from 'fs';

const SRC = 'https://raw.githubusercontent.com/StrangerNearBy/TerpPark/main/docs/data.js';
const js = await (await fetch(SRC)).text();
// data.js is a list of `const NAME = <JSON>;` declarations. Parse each value as
// JSON — never execute a remote file. If it ever stops being pure JSON this throws
// instead of running whatever it contains.
const D = {};
const parts = js.replace(/^\s*\/\/.*$/gm, '').split(/^const\s+([A-Za-z_]\w*)\s*=\s*/m);
for (let i = 1; i < parts.length; i += 2) D[parts[i]] = JSON.parse(parts[i + 1].trim().replace(/;\s*$/, ''));
for (const k of ['LOT_DATA', 'AMENITIES']) if (!D[k]) throw new Error(`TerpPark data.js has no ${k}`);

const lots = Array.isArray(D.LOT_DATA.lots) ? D.LOT_DATA.lots : Object.values(D.LOT_DATA.lots);

// Short codes for pills and search ("Zone 4", "City Garage"). TerpPark's own ids
// are slugs; keep them as source_id.
const shortName = (l) => {
  if (/downtown-parking-garage/.test(l.code)) return 'City Garage';
  if (/cambria/.test(l.code)) return 'Cambria';
  const m = l.code.match(/^zone(\d+)-.*?(?:-([abc]))?$/);
  if (m) return `Zone ${m[1]}${m[2] ? m[2].toUpperCase() : ''}`;
  return l.name;
};

// Enforcement windows, only where TerpPark has a primary-source rate and hours.
// City garage: $2/hr Mon-Sat 8am-10pm (collegeparkmd.gov). TerpPark only says it
// "appears" free outside those hours and notes no overnight parking, so those
// hours are left with no window (shown as unconfirmed), never as "Free".
// Cambria: privately operated, paid whenever open. Zones: unconfirmed -> no windows.
const WINDOWS = {
  'downtown-parking-garage': ['mon', 'tue', 'wed', 'thu', 'fri', 'sat']
    .map((days) => ({ days, from: '08:00', to: '22:00', access: 'pay' })),
  'cambria-college-park-garage': [{ days: 'all', from: '00:00', to: '24:00', access: 'pay' }],
};

const offCampus = lots
  .filter((l) => l.category === 'off_campus_parking')
  .map((l) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [l.lng, l.lat] },
    properties: {
      lot: shortName(l),
      type: 'off_campus',
      name: l.name,
      source_id: l.code,
      address: l.address ?? null,
      operator: l.operator ?? null,
      pricing: l.pricing_summary ?? null,
      hours: l.hours_summary ?? null,
      confidence: l.confidence ?? null,
      note: l.note ?? null,
      windows: WINDOWS[l.code] ?? null,
    },
  }));

const AMENITY = {
  covered_bike_parking: { group: 'bike', category: 'Covered bike parking' },
  dots_impound_lot: { group: 'vehicle', category: 'DOTS impound lot' },
};
const amenities = D.AMENITIES.filter((a) => AMENITY[a.type]).map((a) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [a.lng, a.lat] },
  properties: {
    name: AMENITY[a.type].category + (a.note ? ` (${a.note})` : ''),
    ...AMENITY[a.type],
    description: 'Location is approximate: TerpPark anchors these to the nearest lot or building.',
    source: 'TerpPark',
  },
}));

const out = {
  _source: `TerpPark by a friend of this project — ${SRC}`,
  _credit: 'Off-campus parking research and bike/impound locations: TerpPark (terppark.com)',
  _fetched: new Date().toISOString().slice(0, 10),
  off_campus: { type: 'FeatureCollection', features: offCampus },
  amenities: { type: 'FeatureCollection', features: amenities },
};
writeFileSync(new URL('./data/terppark_import.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(`terppark_import: ${offCampus.length} off-campus lots ` +
  `(${offCampus.filter((f) => f.properties.windows).length} with hours), ${amenities.length} amenities`);
console.log('  ', offCampus.map((f) => `${f.properties.lot} [${f.properties.confidence}]`).join(', '));
