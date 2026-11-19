// Produces docs/standalone.html — one file, no server, no network. Open it directly.
import { readFileSync, writeFileSync } from 'fs';
const u = (p) => new URL(p, import.meta.url);
const html = readFileSync(u('./docs/index.html'), 'utf8');
const engine = readFileSync(u('./docs/engine.js'), 'utf8').replace(/^export\s+/gm, '');
const data = readFileSync(u('./docs/data.bundle.js'), 'utf8').replace(/^export const /, 'const ');

const lcss = readFileSync(u('./docs/vendor/leaflet.css'), 'utf8');
const ljs  = readFileSync(u('./docs/vendor/leaflet.js'), 'utf8');

let out = html
  .replace('<link rel="stylesheet" href="./vendor/leaflet.css">', `<style>${lcss}</style>`)
  .replace('<script src="./vendor/leaflet.js"></script>', `<script>${ljs}</script>`);

const inlined = out.replace(
  /<script type="module">[\s\S]*?from '\.\/engine\.js';/,
  `<script type="module">\n${data}\n${engine}\n`
);
if (inlined === out) throw new Error('inline failed — import block not matched');
writeFileSync(u('./docs/standalone.html'), inlined);
console.log('wrote docs/standalone.html');
