// ============================================================
// Core data helpers (distance, time, restriction logic)
// ============================================================

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(m) {
  const ft = m * 3.28084;
  if (ft < 1000) return `${Math.round(ft)} ft`;
  return `${(m / 1609.34).toFixed(2)} mi`;
}

function walkMinutes(m) {
  return Math.max(1, Math.round(m / 1.35 / 60)); // ~1.35 m/s average walk
}

const WEEKDAY_FULL = { Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' };
const WEEKEND = new Set(['Sat', 'Sun']);

// Real current time in America/New_York (the campus's timezone), independent
// of whatever timezone the visitor's device is set to.
function campusNow() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false
  }).formatToParts(new Date());
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const hour = parseInt(map.hour, 10) % 24;
  const minute = parseInt(map.minute, 10);
  return { weekday: map.weekday, hour, minute, minutesOfDay: hour * 60 + minute };
}

// Same shape as campusNow() but for an arbitrary time-of-day on today's weekday
// (used by the "Plan Ahead" slider).
function timeAt(minutesOfDay, weekday) {
  return {
    weekday,
    hour: Math.floor(minutesOfDay / 60),
    minute: minutesOfDay % 60,
    minutesOfDay
  };
}

function formatClock(minutesOfDay) {
  let h = Math.floor(minutesOfDay / 60);
  let m = minutesOfDay % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; h = h || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

// Returns { level: 'ok'|'warn'|'bad', label, detail }
function computeLotStatus(lot, now) {
  const isWeekend = WEEKEND.has(now.weekday);
  const t = now.minutesOfDay;
  const at = (h, m = 0) => h * 60 + m;
  const inWindow = (start, end) => t >= start && t < end;
  const cat = lot.category;

  // parkableNow: can a generic visitor/student with no special permit park
  // here right now? paid: is it free or pay-to-park? Both used to guarantee
  // "at least one currently-parkable lot, free and/or paid" everywhere the
  // app surfaces nearby lots - level alone isn't enough, since 'warn' means
  // "Faculty/Staff only" in some categories but "pay to park" in others.

  if (cat === 'unrestricted_after_4pm') {
    if (isWeekend || !inWindow(at(7), at(16))) {
      if (!isWeekend && inWindow(at(3), at(5))) {
        return { level: 'ok', label: 'Open to anyone', detail: 'No permit needed - except Commuter registrants, who may not park here overnight Mon-Fri 3am-5am.', parkableNow: true, paid: false };
      }
      return { level: 'ok', label: 'Open to anyone', detail: 'No permit needed at this time.', parkableNow: true, paid: false };
    }
    return { level: 'bad', label: 'Restricted (7am-4pm Mon-Fri)', detail: 'Valid lot-specific permit/CLPR required until 4pm. Free for everyone after 4pm.', parkableNow: false, paid: false };
  }

  if (cat === 'restricted_after_4pm') {
    if (isWeekend || !inWindow(at(7), at(16))) {
      return { level: 'warn', label: 'Faculty/Staff permit only', detail: 'Students and visitors may not park here even though it is after hours.', parkableNow: false, paid: false };
    }
    return { level: 'bad', label: 'Restricted (7am-4pm Mon-Fri)', detail: 'Valid lot-specific permit/CLPR required. Faculty/Staff-only outside these hours too.', parkableNow: false, paid: false };
  }

  if (cat === 'modified_restricted') {
    if (!isWeekend && inWindow(at(7), at(16))) {
      return { level: 'bad', label: 'Restricted (7am-4pm Mon-Fri)', detail: 'Valid lot-specific permit/CLPR required.', parkableNow: false, paid: false };
    }
    if (!isWeekend && inWindow(at(16), at(20))) {
      return { level: 'warn', label: 'Faculty/Staff permit only', detail: '4pm-8pm weekdays is Faculty/Staff permit only.', parkableNow: false, paid: false };
    }
    if (isWeekend) {
      return { level: 'warn', label: 'Faculty/Staff permit only', detail: 'All day on weekends is Faculty/Staff permit only.', parkableNow: false, paid: false };
    }
    return { level: 'ok', label: 'Open to anyone', detail: '8pm-7am weekdays, no permit needed.', parkableNow: true, paid: false };
  }

  if (cat === 'twentyfour_hour') {
    return { level: 'bad', label: 'Permit required, 24/7', detail: '24-hour restricted lot - only vehicles with a valid lot-specific permit/CLPR may park here, any time, any day.', parkableNow: false, paid: false };
  }

  if (cat === 'visitor_garage') {
    return { level: 'warn', label: 'Pay to park, no permit needed', detail: '$4/hr, $20/day max. Daily, 7AM-Midnight.', parkableNow: true, paid: true };
  }

  if (cat === 'special_restrictions') {
    const payable = ['BB', 'D', 'E', 'GG2', 'HP'].includes(lot.code);
    if (payable) {
      return { level: 'warn', label: 'Permit or payment required', detail: lot.special_rule || '', parkableNow: true, paid: true };
    }
    return { level: 'bad', label: 'Custom permit required', detail: lot.special_rule || '', parkableNow: false, paid: false };
  }

  return { level: 'warn', label: 'Check posted sign', detail: lot.rule || 'Restriction category could not be confidently read from the source map.', parkableNow: false, paid: false };
}

const STATUS_META = {
  ok:   { bg: '#1b5e20', border: '#2e7d32', icon: 'check_circle' },
  warn: { bg: '#8a5a00', border: '#b8860b', icon: 'warning' },
  bad:  { bg: '#b71c1c', border: '#d32f2f', icon: 'block' }
};
const STATUS_PILL_CLASS = {
  ok: 'bg-[#e6f4ea] text-[#1b5e20]',
  warn: 'bg-[#fdf0d5] text-[#8a5a00]',
  bad: 'bg-[#fbe4e2] text-[#b71c1c]'
};

// ============================================================
// Data indices
// ============================================================

const lotsByCode = {};
for (const l of LOT_DATA.lots) lotsByCode[l.code.toUpperCase()] = l;

function nearestLots(lat, lng, opts = {}) {
  const { limit = 8, excludeCode = null } = opts;
  return LOT_DATA.lots
    .filter(l => l.lat != null && l.lng != null && l.code !== excludeCode)
    .map(l => ({ lot: l, dist: haversineMeters(lat, lng, l.lat, l.lng) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, limit);
}

// Guarantees the "at least one parkable lot, free and/or paid" rule: scans
// ALL lots by distance (not just a top-N slice) and returns the nearest one
// that's actually parkable right now by a generic visitor, split into three
// options: nearest free/unrestricted lot, nearest paid option of any kind
// (a payable special-restriction lot or a garage, whichever is closer), and
// nearest visitor parking garage specifically (Mowatt Lane, Regents Drive,
// Stadium Drive, Union Lane) - garages are always open and pay-to-park, so
// this one never needs a parkableNow/paid filter. Any of the three may come
// back null if no such lot has coordinates, which should be rare.
function nearestGuaranteedOptions(lat, lng, now, excludeCode = null) {
  const ranked = LOT_DATA.lots
    .filter(l => l.lat != null && l.lng != null && l.code !== excludeCode)
    .map(l => ({ lot: l, dist: haversineMeters(lat, lng, l.lat, l.lng), status: computeLotStatus(l, now) }))
    .sort((a, b) => a.dist - b.dist);
  const free = ranked.find(r => r.status.parkableNow && !r.status.paid) || null;
  const paid = ranked.find(r => r.status.parkableNow && r.status.paid) || null;
  const garage = ranked.find(r => r.lot.category === 'visitor_garage') || null;
  return { free, paid, garage };
}

const GUARANTEED_CARD_META = {
  free:   { color: '#1b5e20', icon: 'check_circle', label: 'free, unrestricted' },
  paid:   { color: '#8a5a00', icon: 'payments', label: 'pay to park' },
  garage: { color: '#3b6fb0', icon: 'local_parking', label: 'visitor parking garage' },
};

function guaranteedOptionCardHTML(entry, kind) {
  const { lot, dist } = entry;
  const cat = LOT_DATA.categories[lot.category];
  const meta = GUARANTEED_CARD_META[kind];
  return `<div class="flex items-center gap-stack-sm bg-surface-container-lowest border border-outline-variant rounded-lg p-stack-sm cursor-pointer active:bg-surface-container transition-colors" data-lot="${lot.code}">
    <span class="material-symbols-outlined text-[20px]" style="color:${meta.color}">${meta.icon}</span>
    <div class="flex-1 min-w-0">
      <p class="font-body-md text-body-md font-bold">${lot.code}${lot.name ? ' - ' + lot.name : ''} <span class="font-label-md text-label-md font-normal text-on-surface-variant">&middot; ${meta.label}</span></p>
      <p class="font-label-md text-label-md text-on-surface-variant">${cat.label} &middot; ${formatDistance(dist)} &middot; ${walkMinutes(dist)} min walk</p>
    </div>
  </div>`;
}

// Renders the "you can always park here right now" guarantee panel for a
// given anchor point: up to three cards (free / paid / nearest visitor
// garage). Always shows something as long as the campus has any parkable
// lot at all (in practice, always true).
function guaranteedParkingHTML(lat, lng, now, excludeCode = null) {
  const { free, paid, garage } = nearestGuaranteedOptions(lat, lng, now, excludeCode);
  if (!free && !paid && !garage) {
    return `<p class="font-body-md text-body-md text-on-surface-variant">No currently-parkable lot found in the dataset - check posted signage.</p>`;
  }
  // Don't show the garage card twice if it's already the "paid" pick.
  const showGarage = garage && (!paid || garage.lot.code !== paid.lot.code);
  return `<div class="space-y-2">
    ${free ? guaranteedOptionCardHTML(free, 'free') : ''}
    ${paid ? guaranteedOptionCardHTML(paid, 'paid') : ''}
    ${showGarage ? guaranteedOptionCardHTML(garage, 'garage') : ''}
    ${!free ? `<p class="font-label-md text-label-md text-on-surface-variant italic">No free unrestricted lot currently open nearby - closest option is pay-to-park.</p>` : ''}
    ${!paid && !showGarage ? `<p class="font-label-md text-label-md text-on-surface-variant italic">No pay-to-park option found nearby.</p>` : ''}
  </div>`;
}

function nearestBuilding(lat, lng) {
  let best = null, bestDist = Infinity;
  for (const b of BUILDINGS) {
    if (b.lat == null) continue;
    const d = haversineMeters(lat, lng, b.lat, b.lng);
    if (d < bestDist) { bestDist = d; best = b; }
  }
  return best ? { building: best, dist: bestDist } : null;
}

function openLotCount(now) {
  return LOT_DATA.lots.filter(l => computeLotStatus(l, now).level === 'ok').length;
}

// ============================================================
// Tiny autocomplete helper
// ============================================================

function attachAutocomplete(inputEl, panelEl, items, onSelect) {
  // items: [{label, sub, value}]
  function render(query) {
    const q = query.trim().toLowerCase();
    if (!q) { panelEl.classList.add('hidden'); panelEl.innerHTML = ''; return; }
    const matches = items.filter(it => it.label.toLowerCase().includes(q)).slice(0, 8);
    if (!matches.length) { panelEl.classList.add('hidden'); panelEl.innerHTML = ''; return; }
    panelEl.innerHTML = matches.map(it => `
      <div class="autocomplete-item px-4 py-3 border-b border-outline-variant last:border-0" data-value="${it.value}">
        <p class="font-body-md text-body-md font-bold text-on-surface">${it.label}</p>
        ${it.sub ? `<p class="font-label-md text-label-md text-on-surface-variant">${it.sub}</p>` : ''}
      </div>`).join('');
    panelEl.classList.remove('hidden');
    panelEl.querySelectorAll('.autocomplete-item').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        onSelect(el.dataset.value);
        panelEl.classList.add('hidden');
      });
    });
  }
  inputEl.addEventListener('input', () => render(inputEl.value));
  inputEl.addEventListener('focus', () => render(inputEl.value));
  inputEl.addEventListener('blur', () => setTimeout(() => panelEl.classList.add('hidden'), 100));
}

// ============================================================
// Shared UI fragments
// ============================================================

function statusBannerHTML(status, timeLabel) {
  const meta = STATUS_META[status.level];
  return `
  <div class="text-white p-stack-md rounded-lg flex items-center justify-between border-l-[8px]"
       style="background-color:${meta.bg}; border-color:${meta.border};" id="status-banner">
    <div>
      <p class="font-label-lg text-label-lg opacity-90 uppercase">${timeLabel}</p>
      <h2 class="font-headline-lg text-headline-lg leading-tight">${status.label.toUpperCase()}</h2>
      ${status.detail ? `<p class="font-body-md text-body-md opacity-90 mt-1">${status.detail}</p>` : ''}
    </div>
    <span class="material-symbols-outlined text-[44px] flex-shrink-0 ml-2" style="font-variation-settings:'FILL' 1;">${meta.icon}</span>
  </div>`;
}

function lotListItemHTML(lot, dist, rank) {
  const now = campusNow();
  const status = computeLotStatus(lot, now);
  const cat = LOT_DATA.categories[lot.category];
  return `
  <div class="lot-row flex items-center gap-stack-sm py-stack-sm border-b border-outline-variant last:border-0 cursor-pointer active:bg-surface-container transition-colors" data-lot="${lot.code}">
    ${rank ? `<div class="font-label-lg text-label-lg text-on-surface-variant w-5 text-center flex-shrink-0">${rank}</div>` : ''}
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="font-headline-md text-headline-md px-2 rounded text-white" style="background:${cat.color};">${lot.code}</span>
        <span class="px-2 py-0.5 rounded-full font-label-md text-label-md ${STATUS_PILL_CLASS[status.level]}">${status.label}</span>
      </div>
      <p class="font-label-md text-label-md text-on-surface-variant mt-0.5">${lot.name ? lot.name + ' &middot; ' : ''}${cat.label}${lot.special_rule ? ' &middot; special rule' : ''}</p>
    </div>
    ${dist != null ? `<div class="text-right flex-shrink-0 font-label-md text-label-md text-on-surface-variant">
      <div class="flex items-center gap-1 justify-end"><span class="material-symbols-outlined text-[16px]">directions_walk</span>${formatDistance(dist)}</div>
      <div>${walkMinutes(dist)} min</div>
    </div>` : `<span class="material-symbols-outlined text-outline">chevron_right</span>`}
  </div>`;
}

function bindLotRowClicks(root) {
  root.querySelectorAll('[data-lot]').forEach(el => {
    el.addEventListener('click', () => { location.hash = `#/lot/${encodeURIComponent(el.dataset.lot)}`; });
  });
}

// ============================================================
// Screens
// ============================================================

const appRoot = document.getElementById('app-root');

function renderHome() {
  const now = campusNow();
  const openCount = openLotCount(now);
  appRoot.innerHTML = `
  <section class="screen-enter space-y-stack-lg">
    <div class="flex justify-between items-center bg-inverse-surface text-inverse-on-surface px-4 py-3 rounded-lg shadow-sm">
      <div class="flex flex-col">
        <span id="home-clock" class="font-headline-md text-headline-md leading-none">${formatClock(now.minutesOfDay)}</span>
        <span id="home-day" class="font-label-md text-label-md text-white/60 mt-1">${WEEKDAY_FULL[now.weekday]} &middot; College Park, MD</span>
      </div>
      <div class="flex flex-col items-end">
        <span id="home-open-count" class="font-stat-display text-stat-display text-primary-fixed-dim leading-none">${openCount}</span>
        <span class="font-label-md text-label-md text-white/60 mt-1">of ${LOT_DATA.lots.length} lots open now</span>
      </div>
    </div>

    <div class="space-y-stack-sm relative">
      <label class="font-label-lg text-label-lg text-secondary uppercase px-1">Quick Lot Lookup</label>
      <div class="relative flex items-center">
        <span class="material-symbols-outlined absolute left-4 text-outline">search</span>
        <input id="lot-search" class="w-full h-12 pl-12 pr-4 bg-surface-container-lowest border border-outline rounded-lg font-body-lg text-body-lg focus:outline-none focus:ring-2 focus:ring-primary" placeholder="Enter a lot code, e.g. LL4, P2, 1a" type="text" autocomplete="off">
        <div id="lot-panel" class="autocomplete-panel hidden"></div>
      </div>
    </div>

    <div class="space-y-stack-sm relative">
      <label class="font-label-lg text-label-lg text-secondary uppercase px-1">Destination Search</label>
      <div class="relative flex items-center">
        <span class="material-symbols-outlined absolute left-4 text-outline">location_on</span>
        <input id="dest-search" class="w-full h-12 pl-12 pr-4 bg-surface-container-lowest border border-outline rounded-lg font-body-lg text-body-lg focus:outline-none focus:ring-2 focus:ring-primary" placeholder="Enter a building, e.g. McKeldin Library" type="text" autocomplete="off">
        <div id="dest-panel" class="autocomplete-panel hidden"></div>
      </div>
      <div id="dest-results"></div>
    </div>

    <section class="relative">
      <div class="bg-surface-container-lowest border-l-4 border-primary rounded-lg p-stack-lg shadow-sm">
        <h2 class="font-label-lg text-label-lg text-secondary uppercase mb-2">Nearest Lot to You</h2>
        <div id="geo-card"><button id="geo-btn" class="w-full h-touch-target-min bg-primary text-white font-headline-md text-headline-md rounded-lg active:scale-95 transition-transform flex items-center justify-center gap-2">
          <span class="material-symbols-outlined">near_me</span> Use My Location
        </button></div>
      </div>
    </section>

    <button data-route="lots" class="bento-tile w-full h-touch-target-min bg-primary text-white font-headline-md rounded-lg flex items-center justify-center gap-stack-sm active:opacity-90 transition-opacity">
      <span class="material-symbols-outlined">local_parking</span> All Lots
    </button>

    <section class="grid grid-cols-2 gap-stack-md">
      <div data-route="map" class="bento-tile bg-surface-container-low border border-outline-variant p-4 rounded-lg cursor-pointer active:bg-surface-container-high transition-colors">
        <span class="material-symbols-outlined text-secondary mb-2">map</span>
        <p class="font-headline-md text-headline-md-mobile">Map View</p>
        <p class="font-body-md text-body-md text-on-surface-variant">Explore all lots &amp; buildings</p>
      </div>
      <div data-route="rules" class="bento-tile bg-surface-container-low border border-outline-variant p-4 rounded-lg cursor-pointer active:bg-surface-container-high transition-colors">
        <span class="material-symbols-outlined text-secondary mb-2">gavel</span>
        <p class="font-headline-md text-headline-md-mobile">Rules Legend</p>
        <p class="font-body-md text-body-md text-on-surface-variant">Every restriction, explained</p>
      </div>
    </section>
  </section>`;
  bindLotRowClicks(appRoot);

  // Quick lot lookup
  const lotItems = LOT_DATA.lots.map(l => ({
    label: l.name ? `${l.code} - ${l.name}` : l.code,
    sub: LOT_DATA.categories[l.category].label, value: l.code
  }));
  attachAutocomplete(document.getElementById('lot-search'), document.getElementById('lot-panel'), lotItems,
    (code) => { location.hash = `#/lot/${encodeURIComponent(code)}`; });

  // Destination search
  const buildingItems = BUILDINGS.filter(b => b.lat != null).map(b => ({
    label: b.name, sub: b.category, value: b.id
  }));
  attachAutocomplete(document.getElementById('dest-search'), document.getElementById('dest-panel'), buildingItems,
    (id) => {
      const building = BUILDINGS.find(b => b.id === id);
      document.getElementById('dest-search').value = building.name;
      renderDestResults(building);
    });

  function renderDestResults(building) {
    const now = campusNow();
    const nearest = nearestLots(building.lat, building.lng, { limit: 6 });
    const box = document.getElementById('dest-results');
    box.innerHTML = `
      <h3 class="font-label-lg text-label-lg text-secondary uppercase px-1 mt-stack-sm mb-1">Guaranteed to be available now near ${building.name}</h3>
      ${guaranteedParkingHTML(building.lat, building.lng, now)}
      <div class="mt-stack-md">
        <h3 class="font-label-lg text-label-lg text-secondary uppercase px-1 mb-1">Nearest lots to ${building.name}</h3>
        <div class="flex gap-stack-sm overflow-x-auto hide-scrollbar pb-2">
          ${nearest.map(n => {
            const status = computeLotStatus(n.lot, now);
            const cat = LOT_DATA.categories[n.lot.category];
            return `<div class="flex-shrink-0 w-32 bg-surface-container border border-outline-variant p-3 rounded-xl active:bg-surface-container-high transition-colors cursor-pointer" data-lot="${n.lot.code}">
              <div class="flex justify-between items-start mb-1">
                <span class="font-headline-md text-headline-md px-1.5 rounded text-white text-[16px]" style="background:${cat.color}">${n.lot.code}</span>
                <span class="material-symbols-outlined text-secondary text-sm">directions_walk</span>
              </div>
              <p class="font-label-md text-label-md text-on-surface-variant">${walkMinutes(n.dist)} min walk</p>
              <p class="font-label-lg text-label-lg mt-1 ${status.level === 'ok' ? 'text-[#1b5e20]' : status.level === 'warn' ? 'text-[#8a5a00]' : 'text-[#b71c1c]'}">${status.label}</p>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    bindLotRowClicks(box);
  }

  document.querySelectorAll('.bento-tile').forEach(el => {
    el.addEventListener('click', () => { location.hash = `#/${el.dataset.route}`; });
  });

  // Geolocation "nearest to me"
  document.getElementById('geo-btn').addEventListener('click', () => {
    const card = document.getElementById('geo-card');
    card.innerHTML = `<p class="font-body-md text-body-md text-on-surface-variant flex items-center gap-2"><span class="material-symbols-outlined animate-spin text-[18px]">progress_activity</span> Getting your location…</p>`;
    if (!navigator.geolocation) {
      card.innerHTML = `<p class="font-body-md text-body-md text-on-surface-variant">Geolocation isn't supported by this browser.</p>`;
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const near = nearestLots(latitude, longitude, { limit: 1 })[0];
        if (!near) { card.innerHTML = `<p class="font-body-md text-body-md">No lot data available.</p>`; return; }
        const status = computeLotStatus(near.lot, campusNow());
        const meta = STATUS_META[status.level];
        const cat = LOT_DATA.categories[near.lot.category];
        card.innerHTML = `
          <div class="flex justify-between items-start mb-stack-md">
            <div>
              <h3 class="font-headline-lg text-headline-lg-mobile text-on-surface">Lot ${near.lot.code}</h3>
              <div class="flex items-center text-secondary">
                <span class="material-symbols-outlined text-sm mr-1">near_me</span>
                <span class="font-body-md text-body-md">${formatDistance(near.dist)} away &middot; ${cat.label}</span>
              </div>
            </div>
          </div>
          <div class="p-4 rounded-lg flex items-center gap-4 text-white" style="background:${meta.bg};">
            <span class="material-symbols-outlined" style="font-variation-settings:'FILL' 1;">${meta.icon}</span>
            <div>
              <p class="font-headline-md text-headline-md leading-tight">${status.label}</p>
              <p class="font-body-md text-body-md opacity-90">${status.detail}</p>
            </div>
          </div>
          <button data-lot="${near.lot.code}" class="mt-stack-md w-full h-touch-target-min bg-primary text-white font-headline-md text-headline-md rounded-lg active:scale-95 transition-transform">View Lot Details</button>
          <div class="mt-stack-md">
            <h3 class="font-label-lg text-label-lg text-secondary uppercase mb-1">Guaranteed to be available now near you</h3>
            ${guaranteedParkingHTML(latitude, longitude, campusNow())}
          </div>`;
        bindLotRowClicks(card);
      },
      (err) => {
        card.innerHTML = `<p class="font-body-md text-body-md text-on-surface-variant">Couldn't get your location (${err.message}). <button id="geo-retry" class="text-primary underline">Try again</button></p>`;
        document.getElementById('geo-retry').addEventListener('click', () => document.getElementById('geo-btn').click());
      },
      { timeout: 8000 }
    );
  });
}

function renderLotDetail(code) {
  const lot = lotsByCode[(code || '').toUpperCase()];
  if (!lot) {
    appRoot.innerHTML = `<div class="screen-enter text-center py-stack-lg">
      <p class="font-headline-md text-headline-md">Lot "${code}" not found.</p>
      <a href="#/home" class="text-primary underline">Back to search</a>
    </div>`;
    return;
  }
  const cat = LOT_DATA.categories[lot.category];
  const now = campusNow();
  const status = computeLotStatus(lot, now);
  const near = lot.lat != null ? nearestBuilding(lot.lat, lot.lng) : null;
  const alts = lot.lat != null ? nearestLots(lot.lat, lot.lng, { limit: 6, excludeCode: lot.code }) : [];

  const chips = [];
  if (lot.lot_type === 'faculty_staff') chips.push('Faculty/Staff lot (letter-prefixed)');
  if (lot.lot_type === 'student') chips.push('Student lot (number-prefixed)');
  if (lot.gated) chips.push('Gated lot');
  if (lot.overflow_faculty_staff) chips.push('Faculty/Staff overflow lot');
  if (lot.overflow_student) chips.push('Student overflow lot');
  if (lot.note) chips.push(lot.note);
  if (lot.approx_pavement_area_sqft) chips.push(`~${lot.approx_pavement_area_sqft.toLocaleString()} sq ft`);

  appRoot.innerHTML = `
  <section class="screen-enter space-y-stack-lg pb-16">
    <div>
      <div class="flex items-center gap-2 mb-1">
        <span class="font-headline-lg text-headline-lg px-2 rounded text-white" style="background:${cat.color}">${lot.code}</span>
        <h1 class="font-headline-lg text-headline-lg text-on-surface">${lot.name || cat.label}</h1>
      </div>
      ${lot.name ? `<p class="font-body-md text-body-md text-on-surface-variant -mt-1 mb-1">${cat.label}</p>` : ''}
      ${near ? `<div class="flex items-center text-on-surface-variant">
        <span class="material-symbols-outlined text-body-md mr-1">location_on</span>
        <p class="font-body-md text-body-md">Nearest building: ${near.building.name} (${formatDistance(near.dist)})</p>
      </div>` : ''}
    </div>

    <div id="status-wrap">${statusBannerHTML(status, `Status now &middot; ${now.weekday} ${formatClock(now.minutesOfDay)}`)}</div>

    <section class="bg-surface-container-lowest border border-outline-variant rounded-xl p-stack-md">
      <h3 class="font-label-lg text-label-lg text-primary uppercase mb-stack-sm">Rules</h3>
      <ul class="space-y-stack-sm">
        <li class="flex items-start gap-stack-sm">
          <span class="material-symbols-outlined text-primary mt-0.5">verified</span>
          <p class="font-body-md text-body-md text-on-surface-variant">${lot.rule}</p>
        </li>
        ${lot.special_rule ? `<li class="flex items-start gap-stack-sm">
          <span class="material-symbols-outlined text-secondary mt-0.5">priority_high</span>
          <div><p class="font-body-md text-body-md font-bold">Special rule</p>
          <p class="font-body-md text-body-md text-on-surface-variant">${lot.special_rule}</p></div>
        </li>` : ''}
        <li class="flex items-start gap-stack-sm">
          <span class="material-symbols-outlined text-secondary mt-0.5">payments</span>
          <p class="font-body-md text-body-md text-on-surface-variant">${LOT_DATA.pay_area_rule}</p>
        </li>
      </ul>
      ${chips.length ? `<div class="flex flex-wrap gap-2 mt-stack-md">${chips.map(c => `<span class="px-3 py-1 bg-surface-container rounded-full font-label-md text-label-md text-on-surface-variant">${c}</span>`).join('')}</div>` : ''}
    </section>

    <section>
      <div class="flex justify-between items-end mb-stack-sm">
        <h3 class="font-label-lg text-label-lg text-on-surface uppercase">Plan Ahead</h3>
        <span class="font-stat-display text-stat-display text-primary" id="time-display">${formatClock(now.minutesOfDay)}</span>
      </div>
      <div class="bg-surface-container border border-outline-variant p-stack-md rounded-xl">
        <div class="flex gap-2 mb-stack-md">
          <button data-daytype="weekday" class="daytype-btn flex-1 h-9 rounded-full font-label-lg text-label-lg border transition-colors">Weekday</button>
          <button data-daytype="weekend" class="daytype-btn flex-1 h-9 rounded-full font-label-lg text-label-lg border transition-colors">Weekend</button>
        </div>
        <input id="time-slider" class="w-full h-2 bg-outline-variant rounded-lg appearance-none cursor-pointer accent-primary" max="1440" min="0" step="15" type="range" value="${now.minutesOfDay}">
        <div class="flex justify-between mt-stack-sm text-on-surface-variant font-label-md text-label-md">
          <span>12 AM</span><span>Noon</span><span>11:59 PM</span>
        </div>
      </div>
      <p class="mt-stack-sm font-body-md text-body-md text-on-surface-variant italic text-center">Drag the slider and toggle weekday/weekend to preview this lot's status at any time.</p>
    </section>

    ${alts.length ? `<section>
      <h3 class="font-label-lg text-label-lg text-on-surface uppercase mb-stack-sm">Nearest Alternative Lots</h3>
      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl px-stack-md">
        ${alts.map((a, i) => lotListItemHTML(a.lot, a.dist, i + 1)).join('')}
      </div>
    </section>` : ''}

    ${lot.lat != null ? `<section>
      <h3 class="font-label-lg text-label-lg text-on-surface uppercase mb-stack-sm">Guaranteed to be available now</h3>
      ${guaranteedParkingHTML(lot.lat, lot.lng, now, lot.code)}
    </section>` : ''}
  </section>
  ${lot.lat != null ? `<div class="fixed bottom-6 left-0 w-full px-margin-mobile max-w-md mx-auto">
    <button id="navigate-btn" class="w-full h-touch-target-min bg-primary text-on-primary font-headline-md rounded-lg flex items-center justify-center gap-stack-sm shadow-md active:opacity-90 transition-opacity">
      <span class="material-symbols-outlined">directions</span> Navigate to Lot ${lot.code}
    </button>
  </div>` : ''}`;

  bindLotRowClicks(appRoot);

  if (lot.lat != null) {
    document.getElementById('navigate-btn').addEventListener('click', () => {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${lot.lat},${lot.lng}`, '_blank', 'noopener');
    });
  }

  let previewDayType = WEEKEND.has(now.weekday) ? 'weekend' : 'weekday';
  const REP_WEEKDAY = { weekday: 'Wed', weekend: 'Sat' };

  function updateDaytypeButtons() {
    document.querySelectorAll('.daytype-btn').forEach(btn => {
      const active = btn.dataset.daytype === previewDayType;
      btn.className = 'daytype-btn flex-1 h-9 rounded-full font-label-lg text-label-lg border transition-colors ' +
        (active ? 'bg-primary text-white border-primary' : 'bg-surface-container-lowest text-on-surface-variant border-outline-variant');
    });
  }
  function updatePreview() {
    const mins = parseInt(slider.value, 10);
    document.getElementById('time-display').textContent = formatClock(mins);
    const previewNow = timeAt(mins, REP_WEEKDAY[previewDayType]);
    const previewStatus = computeLotStatus(lot, previewNow);
    const dayLabel = previewDayType === 'weekend' ? 'a weekend day' : 'a weekday';
    document.getElementById('status-wrap').innerHTML = statusBannerHTML(previewStatus, `Status at ${formatClock(mins)} on ${dayLabel}`);
  }

  const slider = document.getElementById('time-slider');
  updateDaytypeButtons();
  slider.addEventListener('input', updatePreview);
  document.querySelectorAll('.daytype-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      previewDayType = btn.dataset.daytype;
      updateDaytypeButtons();
      updatePreview();
    });
  });
}

function renderLotsList() {
  appRoot.innerHTML = `
  <section class="screen-enter space-y-stack-md">
    <h1 class="font-headline-lg text-headline-lg text-on-surface">All Parking Lots</h1>
    <div class="relative flex items-center">
      <span class="material-symbols-outlined absolute left-4 text-outline">filter_list</span>
      <input id="lots-filter" class="w-full h-12 pl-12 pr-4 bg-surface-container-lowest border border-outline rounded-lg font-body-lg text-body-lg focus:outline-none focus:ring-2 focus:ring-primary" placeholder="Filter by lot code…" type="text" autocomplete="off">
    </div>
    <div id="lots-list" class="bg-surface-container-lowest border border-outline-variant rounded-xl px-stack-md"></div>
  </section>`;

  const sorted = LOT_DATA.lots.slice().sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  function draw(filter) {
    const f = filter.trim().toLowerCase();
    const rows = sorted.filter(l => !f || l.code.toLowerCase().includes(f));
    const box = document.getElementById('lots-list');
    box.innerHTML = rows.map(l => lotListItemHTML(l, null, null)).join('') ||
      `<p class="py-stack-md text-center text-on-surface-variant font-body-md text-body-md">No lots match "${filter}".</p>`;
    bindLotRowClicks(box);
  }
  draw('');
  document.getElementById('lots-filter').addEventListener('input', (e) => draw(e.target.value));
}

function renderRules() {
  const c = LOT_DATA.categories;
  appRoot.innerHTML = `
  <section class="screen-enter space-y-stack-lg pb-8">
    <h1 class="font-headline-lg text-headline-lg text-on-surface">Rules Legend</h1>
    <p class="font-body-md text-body-md text-on-surface-variant">${LOT_DATA.general_rule}</p>

    <div class="space-y-stack-md">
      ${Object.values(c).map(cat => `
        <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-stack-md border-l-[6px]" style="border-left-color:${cat.color}">
          <h3 class="font-headline-md text-headline-md mb-1" style="color:${cat.color}">${cat.label}</h3>
          <p class="font-body-md text-body-md text-on-surface-variant">${cat.rule}</p>
        </div>`).join('')}
    </div>

    <section class="bg-surface-container-lowest border border-outline-variant rounded-xl p-stack-md">
      <h3 class="font-label-lg text-label-lg text-primary uppercase mb-stack-sm">Pay Areas</h3>
      <p class="font-body-md text-body-md text-on-surface-variant">${LOT_DATA.pay_area_rule}</p>
    </section>

    <section class="bg-surface-container-lowest border border-outline-variant rounded-xl p-stack-md">
      <h3 class="font-label-lg text-label-lg text-primary uppercase mb-stack-sm">Letter vs. Number Lots</h3>
      <p class="font-body-md text-body-md text-on-surface-variant">Lot signs starting with a <strong>letter</strong> (e.g. LL4, GG1) are Faculty/Staff lots, regardless of any number that follows. Lot signs starting with a <strong>number</strong> (e.g. 1a, 16b) are Student lots. This is separate from - and doesn't override - the restriction category above.</p>
    </section>

    <section class="bg-surface-container-lowest border border-outline-variant rounded-xl p-stack-md">
      <h3 class="font-label-lg text-label-lg text-primary uppercase mb-stack-sm">Overflow Lots for Registered Parkers</h3>
      <p class="font-body-md text-body-md text-on-surface-variant"><strong>Students:</strong> Lot 4 family (4a, 4b, 4h, 4J, 4k, 4m, 4n).</p>
      <p class="font-body-md text-body-md text-on-surface-variant mt-1"><strong>Faculty/Staff:</strong> K, P, U, V, X, XX1, Z, SDG, 1, 3, 4, 6, 9, 11, 15, 16, 17, 19 (and all their sub-numbered lots).</p>
    </section>

    <section class="bg-surface-container-lowest border border-outline-variant rounded-xl p-stack-md">
      <h3 class="font-label-lg text-label-lg text-primary uppercase mb-stack-sm">Gated Lots</h3>
      <p class="font-body-md text-body-md text-on-surface-variant">Physically gated - require a valid credential to enter: ${
        LOT_DATA.lots.filter(l => l.gated).map(l => l.code).join(', ') || 'none listed'
      }</p>
    </section>
  </section>`;
}

let leafletMap = null;
function renderMap() {
  appRoot.innerHTML = `
  <section class="screen-enter space-y-stack-md">
    <h1 class="font-headline-lg text-headline-lg text-on-surface">Campus Map</h1>
    <div class="rounded-xl overflow-hidden border border-outline-variant">
      <div id="map"></div>
    </div>
    <div id="map-legend" class="flex flex-wrap gap-3 font-label-md text-label-md"></div>
    <a href="https://transportation.umd.edu/sites/default/files/2026-02/Campus-parking-map.pdf"
       target="_blank" rel="noopener"
       class="w-full h-touch-target-min flex items-center justify-center gap-stack-sm rounded-lg border border-primary text-primary font-headline-md active:bg-surface-container transition-colors">
      <span class="material-symbols-outlined">download</span> Download Official PDF Map
    </a>
  </section>`;

  const legend = document.getElementById('map-legend');
  legend.innerHTML = Object.values(LOT_DATA.categories).map(c =>
    `<span class="flex items-center gap-1"><span class="w-3 h-3 rounded inline-block" style="background:${c.color}"></span>${c.label}</span>`
  ).join('') + `<span class="flex items-center gap-1"><span class="w-3 h-3 rounded-full inline-block bg-white border border-outline"></span>Building</span>`;

  setTimeout(() => {
    leafletMap = L.map('map').setView([38.9869, -76.9426], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
    }).addTo(leafletMap);

    for (const lot of LOT_DATA.lots) {
      if (lot.lat == null) continue;
      const cat = LOT_DATA.categories[lot.category];
      const marker = L.circleMarker([lot.lat, lot.lng], { radius: 7, color: '#222', weight: 1, fillColor: cat.color, fillOpacity: 0.85 }).addTo(leafletMap);
      marker.bindPopup(`<strong>${lot.code}${lot.name ? ' - ' + lot.name : ''}</strong> - ${cat.label}<br>${lot.rule}${lot.special_rule ? '<br><em>' + lot.special_rule + '</em>' : ''}<br><a href="#/lot/${encodeURIComponent(lot.code)}">View details &rarr;</a>`);
    }
    for (const b of BUILDINGS) {
      if (b.lat == null) continue;
      const marker = L.circleMarker([b.lat, b.lng], { radius: 3, color: '#444', weight: 1, fillColor: '#ffffff', fillOpacity: 0.9 }).addTo(leafletMap);
      marker.bindPopup(`<strong>${b.name}</strong><br>${b.category}`);
    }
  }, 0);
}

// ============================================================
// Router
// ============================================================

const ROUTES = {
  home:  { render: renderHome, showBack: false },
  lots:  { render: renderLotsList, showBack: true },
  map:   { render: renderMap, showBack: true },
  rules: { render: renderRules, showBack: true },
  lot:   { render: (arg) => renderLotDetail(arg), showBack: true }
};

function route() {
  if (leafletMap) { leafletMap.remove(); leafletMap = null; }
  const hash = location.hash.replace(/^#\//, '') || 'home';
  const [seg, arg] = hash.split('/');
  const r = ROUTES[seg] || ROUTES.home;
  r.render(decodeURIComponent(arg || ''));

  document.getElementById('back-btn').style.display = r.showBack ? 'flex' : 'none';
  window.scrollTo(0, 0);
}

document.getElementById('back-btn').addEventListener('click', () => history.back());
window.addEventListener('hashchange', route);

// ============================================================
// Live clock - keeps the Home screen's time (and open-lot count) ticking
// in real time without a page refresh or navigation.
// ============================================================

function liveTick() {
  const clockEl = document.getElementById('home-clock');
  if (!clockEl) return; // not currently on the Home screen
  const now = campusNow();
  clockEl.textContent = formatClock(now.minutesOfDay);
  document.getElementById('home-day').textContent =
    `${WEEKDAY_FULL[now.weekday]} · College Park, MD`;
  document.getElementById('home-open-count').textContent = openLotCount(now);
}
setInterval(liveTick, 1000);

// ============================================================
// Boot
// ============================================================

route();
