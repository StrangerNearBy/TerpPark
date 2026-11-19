// Bundles the datasets into a single JS file so docs/index.html runs straight from
// file:// with no server and no network. Re-run after changing anything in data/.
import { readFileSync, writeFileSync } from 'fs';
const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));

const slim = (fc, keep) => ({
  ...fc,
  features: fc.features.map((f) => ({
    type: 'Feature',
    geometry: f.geometry,
    properties: Object.fromEntries(keep.map((k) => [k, f.properties[k]]).filter(([, v]) => v != null)),
  })),
});

// TerpPark import (tools_import_terppark.mjs): off-campus lots join the lot list,
// their enforcement windows become per-lot rules, amenities join the places.
const tp = load('./data/terppark_import.json');
const rules = load('./data/rules.json');
rules.special_lots = { ...rules.special_lots };
const offCampus = {};
for (const f of tp.off_campus.features) {
  const p = f.properties;
  if (p.windows) rules.special_lots[p.lot] = { text: p.hours, windows: p.windows, off_campus: true };
  offCampus[p.lot] = { name: p.name, address: p.address, operator: p.operator, pricing: p.pricing,
    hours: p.hours, confidence: p.confidence, note: p.note };
}
const parking = load('./data/parking.geojson');
parking.features = [...parking.features, ...tp.off_campus.features];
const places = load('./data/places.geojson');
// UMD's own rack layer marks covered racks exactly, so TerpPark's approximate
// covered-bike points are dropped; its impound lot is kept.
places.features = [...places.features,
  ...tp.amenities.features.filter((f) => f.properties.category !== 'Covered bike parking')];

const bundle = {
  buildings: slim(load('./data/buildings.geojson'),
    ['name', 'name_as_printed', 'building_number', 'map_category', 'grid_location']),
  parking: slim(parking,
    ['lot', 'type', 'restriction_class', 'grid_location', 'garage_name',
     'garage_building_number', 'parcel', 'parcels_for_lot']),
  payParking: load('./data/pay_parking.geojson'),
  lotPolygons: load('./data/lot_polygons.geojson'),
  rules,
  offCampus,
  payZones: load('./data/parkmobile_zones.json'),
  lotInfo: load('./data/lot_info.json'),
  places: slim(places,
    ['name', 'group', 'category', 'building', 'room', 'website', 'description',
     'spaces', 'chargers', 'vehicles', 'phone', 'loops', 'covered', 'access', 'lock', 'status', 'hours']),
};

writeFileSync(new URL('./docs/data.bundle.js', import.meta.url),
  'export const DATA = ' + JSON.stringify(bundle) + ';\n');
console.log('wrote docs/data.bundle.js');
