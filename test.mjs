import { createEngine } from './src/engine.js';
import { readFileSync } from 'fs';
const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));

const engine = createEngine({
  buildings: load('./data/buildings.geojson'),
  parking: load('./data/parking.geojson'),
  payParking: load('./data/pay_parking.geojson'),
  rules: load('./data/rules.json'),
});

const [b] = engine.searchBuildings('Iribe');
console.log('building:', b.properties.name, '\n');

const show = (label, permit, when, opts = {}) => {
  const r = engine.findParking(b, permit, when, { radius: 800, ...opts });
  console.log('==', label, '| allowed:', r.summary.allowedCount);
  for (const x of r.results.slice(0, 4))
    console.log(`   ${x.allowed ? 'OK ' : '-- '} ${String(x.lot).padEnd(5)} ${String(x.distance+'m').padEnd(6)} ${x.tierLabel.padEnd(20)} ${x.reason}`);
  if (!permit) console.log('   nearest pay:', r.pay[0] ? `${r.pay[0].payType} ${r.pay[0].distance}m` : 'none');
  console.log();
};

show('Student permit 4,  Tue 10:00', '4', new Date('2026-08-11T10:00:00'));
show('No registration,   Tue 10:00', '',  new Date('2026-08-11T10:00:00'));
show('No registration,   Tue 18:00', '',  new Date('2026-08-11T18:00:00'));
show('Faculty Z,         Tue 18:00', 'Z', new Date('2026-08-11T18:00:00'));
show('ADA needed,        Tue 10:00', '',  new Date('2026-08-11T10:00:00'), { needsAda: true });

// boundary checks on the window logic
import { inWindow } from './src/engine.js';
const w = { days: 'mon-fri', from: '16:00', to: '07:00' };
const t = (s) => inWindow(w, new Date(s));
console.log('window wrap checks (mon-fri 16:00->07:00):');
console.log('  Tue 15:59 ->', t('2026-08-11T15:59:00'), '(expect false)');
console.log('  Tue 16:00 ->', t('2026-08-11T16:00:00'), '(expect true)');
console.log('  Wed 06:59 ->', t('2026-08-12T06:59:00'), '(expect true)');
console.log('  Wed 07:00 ->', t('2026-08-12T07:00:00'), '(expect false)');
console.log('  Sat 06:00 ->', t('2026-08-15T06:00:00'), '(expect true, wraps from Fri)');
console.log('  Sun 06:00 ->', t('2026-08-16T06:00:00'), '(expect false, Sat is not mon-fri)');

import { matchesLot } from './src/engine.js';
console.log('\nlot family matching:');
const cases = [['4','4a',true],['4','4J',true],['4','40',false],['16','16b',true],
  ['K','K3',true],['K','KK',false],['X','X1',true],['X','XX1',false],
  ['P','P1',true],['P','PH1',false],['U','U2',true],['U','UU',false],
  ['XX1','XX1',true],['SDG','SDG',true],['1','1b (S)',true]];
let bad=0;
for (const [ref,code,want] of cases) {
  const got = matchesLot(ref,code);
  if (got!==want) { bad++; console.log(`  FAIL ${ref} vs ${code}: got ${got} want ${want}`); }
}
console.log(bad ? `  ${bad} FAILURES` : `  all ${cases.length} family cases pass`);
