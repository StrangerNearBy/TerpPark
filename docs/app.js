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

  if (cat === 'visitor_pay_parking') {
    return { level: 'warn', label: 'Pay to park, no permit needed', detail: '$4/hr, $20/day max. Daily, 7AM-Midnight.', parkableNow: true, paid: true };
  }

  if (cat === 'special_restrictions') {
    const payable = ['BB', 'D', 'E', 'GG2', 'HP'].includes(lot.code);
    if (payable) {
      return { level: 'warn', label: 'Permit or payment required', detail: lot.special_rule || '', parkableNow: true, paid: true };
    }
    return { level: 'bad', label: 'Custom permit required', detail: lot.special_rule || '', parkableNow: false, paid: false };
  }

  if (cat === 'off_campus_parking') {
    // Not a UMD lot, so there's no CLPR/permit restriction to model - any
    // parker type may use it (see parkerEligible's explicit off-campus
    // check). But we have no structured hours data, only free-text summaries
    // that sometimes describe hours when the facility is CLOSED (e.g. the
    // WMATA garage overnight) - so parkableNow stays false rather than
    // claiming a guarantee we can't verify in real time. It still surfaces
    // in every nearest-lot list by plain distance; it just never gets
    // treated as "the guaranteed open option" the way an actually-verified
    // open UMD lot does.
    const bits = [lot.operator ? `Operated by ${lot.operator}.` : '', lot.pricing_summary, lot.hours_summary ? `Hours: ${lot.hours_summary}` : ''].filter(Boolean);
    return { level: 'warn', label: 'Public parking (non-UMD)', detail: (bits.join(' ') || 'Not a UMD lot - check posted rates/hours.') + ' Confirm it is currently open before you go.', parkableNow: false, paid: true };
  }

  return { level: 'warn', label: 'Check posted sign', detail: LOT_DATA.categories[cat].rule || 'Restriction category could not be confidently read from the source map.', parkableNow: false, paid: false };
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
// Parking type ("who's parking") - lets a search be narrowed to lots a
// given kind of parker can actually use, instead of just nearest-by-distance.
// ============================================================

const PARKER_TYPES = {
  any:           { label: 'Any/Just Checking' },
  visitor:       { label: 'Visitor (no permit)' },
  student:       { label: 'Student permit' },
  faculty_staff: { label: 'Faculty/Staff permit' }
};

// Is this lot usable right now by a parker of this type? Built entirely from
// fields already on the lot record (lot_type, overflow flags) plus the live
// status computed above - not a new source of parking policy. 'any' never
// filters, so existing flows are unaffected when no type is chosen.
function parkerEligible(lot, parkerType, status) {
  if (!parkerType || parkerType === 'any') return true;
  if (lot.category === 'off_campus_parking') return true; // no UMD permit ever required here, for anyone
  if (status.parkableNow) return true; // open to anyone (or pay-to-park) right now
  if (parkerType === 'student') return lot.lot_type === 'student' || lot.overflow_student === true;
  if (parkerType === 'faculty_staff') {
    return lot.lot_type === 'faculty_staff' || lot.overflow_faculty_staff === true ||
      status.label === 'Faculty/Staff permit only';
  }
  return false; // visitor: only ever eligible via parkableNow above (visitors hold no permit)
}

function parkerTypeOptionsHTML() {
  return Object.entries(PARKER_TYPES).map(([val, meta]) => `<option value="${val}">${meta.label}</option>`).join('');
}

// HTML attribute carrying the chosen parking type through hash-routed
// navigation (see bindLotRowClicks) - empty for 'any' since that's the
// no-filter default and needs no context to propagate.
function parkerDataAttr(parkerType) {
  return parkerType && parkerType !== 'any' ? ` data-parker="${parkerType}"` : '';
}

function noLotsMessage(parkerType) {
  return (parkerType && parkerType !== 'any')
    ? `No ${PARKER_TYPES[parkerType].label.toLowerCase()} lots found nearby right now.`
    : `No lots found nearby right now.`;
}

// ============================================================
// Data indices
// ============================================================

const lotsByCode = {};
for (const l of LOT_DATA.lots) lotsByCode[l.code.toUpperCase()] = l;

function nearestLots(lat, lng, opts = {}) {
  const { limit = 8, excludeCode = null, parkerType = 'any', now = null } = opts;
  const filterByType = parkerType && parkerType !== 'any';
  const scored = LOT_DATA.lots
    .filter(l => l.lat != null && l.lng != null && l.code !== excludeCode)
    .map(l => {
      const status = filterByType ? computeLotStatus(l, now || campusNow()) : null;
      return { lot: l, dist: haversineMeters(lat, lng, l.lat, l.lng), status };
    });
  if (!filterByType) return scored.sort((a, b) => a.dist - b.dist).slice(0, limit);

  const top = scored
    .filter(e => parkerEligible(e.lot, parkerType, e.status))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, limit);
  // "Eligible for my permit type" isn't the same as "usable right now" - a
  // lot-specific permit doesn't help outside its own hours. Guarantee this
  // list always includes at least one lot open to anyone right now, the same
  // promise the unfiltered ("any") results make, so a type filter can never
  // leave someone with zero currently-parkable options.
  if (!top.some(e => e.status.parkableNow)) {
    const nearestParkable = scored
      .filter(e => e.status.parkableNow)
      .sort((a, b) => a.dist - b.dist)[0];
    if (nearestParkable && !top.some(e => e.lot.code === nearestParkable.lot.code)) top.push(nearestParkable);
  }
  return top;
}

// "Best Available Lots": scans ALL lots by distance (not just a top-N slice)
// and returns the single nearest lot of EACH restriction category that
// exists in the dataset, each carrying its own live status (open/restricted
// right now) so the list stays honest even when a category's nearest lot
// happens to be closed at that moment. Guarantees category coverage near
// any point on campus; any one entry may come back null only if that
// category truly has no lot with coordinates anywhere in the dataset.
function nearestBestAvailableByCategory(lat, lng, now, excludeCode = null) {
  const byCategory = {};
  const remaining = new Set(Object.keys(LOT_DATA.categories));
  const ranked = LOT_DATA.lots
    .filter(l => l.lat != null && l.lng != null && l.code !== excludeCode)
    .map(l => ({ lot: l, dist: haversineMeters(lat, lng, l.lat, l.lng) }))
    .sort((a, b) => a.dist - b.dist);
  // Single pass over the distance-sorted list: fill each category the first
  // time it's seen (computing status lazily, only for lots actually used),
  // and stop as soon as every category has a pick.
  for (const entry of ranked) {
    if (remaining.size === 0) break;
    if (!remaining.has(entry.lot.category)) continue;
    entry.status = computeLotStatus(entry.lot, now);
    byCategory[entry.lot.category] = entry;
    remaining.delete(entry.lot.category);
  }
  for (const catKey of remaining) byCategory[catKey] = null;
  return byCategory;
}

function bestAvailableCardHTML(entry) {
  const { lot, dist, status } = entry;
  const cat = LOT_DATA.categories[lot.category];
  const meta = STATUS_META[status.level];
  return `<div class="stagger-in flex items-center gap-stack-sm bg-surface-container-lowest border border-outline-variant rounded-lg p-stack-sm cursor-pointer active:bg-surface-container transition-colors" data-lot="${lot.code}">
    <span class="material-symbols-outlined text-[20px]" style="color:${meta.bg}">${meta.icon}</span>
    <div class="flex-1 min-w-0">
      <p class="font-body-md text-body-md font-bold">${lot.code}${lot.name ? ' - ' + lot.name : ''} <span class="font-label-md text-label-md font-normal" style="color:${meta.bg}">&middot; ${status.label}</span></p>
      <p class="font-label-md text-label-md text-on-surface-variant">${cat.label} &middot; ${formatDistance(dist)} &middot; ${walkMinutes(dist)} min walk</p>
    </div>
  </div>`;
}

// Renders the "Best Available Lots" panel for a given anchor point: the
// single nearest lot of every restriction category present in the dataset,
// each labeled with its live status right now.
function bestAvailableLotsHTML(lat, lng, now, excludeCode = null, parkerType = 'any') {
  if (parkerType && parkerType !== 'any') {
    const nearest = nearestLots(lat, lng, { limit: 6, excludeCode, parkerType, now });
    if (!nearest.length) {
      return `<p class="font-body-md text-body-md text-on-surface-variant">${noLotsMessage(parkerType)}</p>`;
    }
    return `<div class="space-y-2">${nearest.map(bestAvailableCardHTML).join('')}</div>`;
  }
  const byCategory = nearestBestAvailableByCategory(lat, lng, now, excludeCode);
  const entries = Object.entries(byCategory);
  if (entries.every(([, v]) => !v)) {
    return `<p class="font-body-md text-body-md text-on-surface-variant">No lots found in the dataset near here.</p>`;
  }
  return `<div class="space-y-2">
    ${entries.map(([catKey, entry]) => entry ? bestAvailableCardHTML(entry) :
      `<p class="font-label-md text-label-md text-on-surface-variant italic">No ${LOT_DATA.categories[catKey].label} lot found nearby.</p>`
    ).join('')}
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

// "Open" is ambiguous on its own - free-and-open (no permit, no cost) and
// pay-to-park (no permit, but costs money) are both "parkable right now" but
// mean very different things to a user deciding where to go. Report them
// separately rather than collapsing them into one number.
function lotAvailabilityCounts(now) {
  let free = 0, paid = 0;
  for (const l of LOT_DATA.lots) {
    const status = computeLotStatus(l, now);
    if (status.level === 'ok') free++;
    else if (status.parkableNow && status.paid) paid++;
  }
  return { free, paid };
}

// Bike/moto/EV/repair amenities, each already anchored to real coordinates
// near a known lot or building (see v2/extraction/amenities_v2.json).
function nearestAmenities(lat, lng, opts = {}) {
  const { type = 'all', limit = 200 } = opts;
  return AMENITIES
    .filter(a => type === 'all' || a.type === type)
    .map(a => ({ amenity: a, dist: haversineMeters(lat, lng, a.lat, a.lng) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, limit);
}

// ============================================================
// Tiny autocomplete helper
// ============================================================

function attachAutocomplete(inputEl, panelEl, items, onSelect) {
  // items: [{label, sub, value}]. Visibility is driven by the .open class
  // (opacity/scale/pointer-events in style.css) instead of display:none, so
  // opening and closing can actually transition instead of snapping.
  function render(query) {
    const q = query.trim().toLowerCase();
    if (!q) { panelEl.classList.remove('open'); panelEl.innerHTML = ''; return; }
    const matches = items.filter(it => it.label.toLowerCase().includes(q)).slice(0, 8);
    if (!matches.length) { panelEl.classList.remove('open'); panelEl.innerHTML = ''; return; }
    panelEl.innerHTML = matches.map(it => `
      <div class="autocomplete-item px-4 py-3 border-b border-outline-variant last:border-0" data-value="${it.value}">
        <p class="font-body-md text-body-md font-bold text-on-surface">${it.label}</p>
        ${it.sub ? `<p class="font-label-md text-label-md text-on-surface-variant">${it.sub}</p>` : ''}
      </div>`).join('');
    panelEl.classList.add('open');
    panelEl.querySelectorAll('.autocomplete-item').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        onSelect(el.dataset.value);
        panelEl.classList.remove('open');
      });
    });
  }
  inputEl.addEventListener('input', () => render(inputEl.value));
  inputEl.addEventListener('focus', () => render(inputEl.value));
  inputEl.addEventListener('blur', () => setTimeout(() => panelEl.classList.remove('open'), 100));
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
  // Stagger only applies to the short, rank-numbered "nearest lots" lists,
  // never the full All Lots list - that one re-renders on every filter
  // keystroke, and animating every row on every keystroke would fight
  // against the "never animate keyboard-repeated actions" rule.
  return `
  <div class="${rank ? 'stagger-in ' : ''}lot-row flex items-center gap-stack-sm py-stack-sm border-b border-outline-variant last:border-0 cursor-pointer active:bg-surface-container transition-colors" data-lot="${lot.code}">
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

// data-near (a building id), when present on an element or an ancestor,
// carries the "I got here via a destination search for building X" context
// through to the lot detail page, so that page's nearest/best-available
// lists stay relative to the destination the user actually cares about,
// not the lot they happened to click on.
function bindLotRowClicks(root) {
  root.querySelectorAll('[data-lot]').forEach(el => {
    el.addEventListener('click', () => {
      const nearEl = el.closest('[data-near]');
      const near = nearEl ? nearEl.dataset.near : null;
      const parkEl = el.closest('[data-parker]');
      const parkerType = parkEl ? parkEl.dataset.parker : null;
      let hash = `#/lot/${encodeURIComponent(el.dataset.lot)}`;
      if (near) hash += `/near/${encodeURIComponent(near)}`;
      if (parkerType && parkerType !== 'any') hash += `/park/${encodeURIComponent(parkerType)}`;
      location.hash = hash;
    });
  });
}

// ============================================================
// Screens
// ============================================================

const appRoot = document.getElementById('app-root');

function renderHome() {
  const now = campusNow();
  const counts = lotAvailabilityCounts(now);
  appRoot.innerHTML = `
  <section class="screen-enter space-y-stack-lg">
    <div class="flex justify-between items-center bg-inverse-surface text-inverse-on-surface px-4 py-3 rounded-lg shadow-sm">
      <div class="flex flex-col">
        <span id="home-clock" class="font-headline-md text-headline-md leading-none">${formatClock(now.minutesOfDay)}</span>
        <span id="home-day" class="font-label-md text-label-md text-white/60 mt-1">${WEEKDAY_FULL[now.weekday]} &middot; College Park, MD</span>
      </div>
      <div class="flex flex-col items-end">
        <span id="home-open-count" class="font-stat-display text-stat-display text-primary-fixed-dim leading-none">${counts.free}</span>
        <span class="font-label-md text-label-md text-white/60 mt-1">free &amp; open now</span>
        <span id="home-paid-count" class="font-label-md text-label-md text-white/80 mt-0.5">+${counts.paid} pay-to-park</span>
      </div>
    </div>

    <div class="space-y-stack-sm relative">
      <label class="font-label-lg text-label-lg text-secondary uppercase px-1">Quick Lot Lookup</label>
      <div class="relative flex items-center">
        <span class="material-symbols-outlined absolute left-4 text-outline">search</span>
        <input id="lot-search" class="w-full h-12 pl-12 pr-4 bg-surface-container-lowest border border-outline rounded-lg font-body-lg text-body-lg focus:outline-none focus:ring-2 focus:ring-primary" placeholder="Enter a lot code, e.g. LL4, P2, 1a" type="text" autocomplete="off">
        <div id="lot-panel" class="autocomplete-panel"></div>
      </div>
    </div>

    <div class="space-y-stack-sm relative">
      <label class="font-label-lg text-label-lg text-secondary uppercase px-1">Destination Search</label>
      <div class="relative flex items-center">
        <span class="material-symbols-outlined absolute left-4 text-outline">location_on</span>
        <input id="dest-search" class="w-full h-12 pl-12 pr-4 bg-surface-container-lowest border border-outline rounded-lg font-body-lg text-body-lg focus:outline-none focus:ring-2 focus:ring-primary" placeholder="Enter a building, e.g. McKeldin Library" type="text" autocomplete="off">
        <div id="dest-panel" class="autocomplete-panel"></div>
      </div>
      <div class="relative">
        <label class="font-label-md text-label-md text-on-surface-variant px-1" for="dest-parker-type">What kind of parking do you need?</label>
        <select id="dest-parker-type" class="w-full h-11 px-3 bg-surface-container-lowest border border-outline rounded-lg font-body-md text-body-md focus:outline-none focus:ring-2 focus:ring-primary">
          ${parkerTypeOptionsHTML()}
        </select>
      </div>
      <div id="dest-results"></div>
    </div>

    <section class="relative">
      <div class="bg-surface-container-lowest border-l-4 border-primary rounded-lg p-stack-lg shadow-sm">
        <h2 class="font-label-lg text-label-lg text-secondary uppercase mb-2">Nearest Lot to You</h2>
        <div class="mb-stack-sm">
          <label class="font-label-md text-label-md text-on-surface-variant px-1" for="geo-parker-type">What kind of parking do you need?</label>
          <select id="geo-parker-type" class="w-full h-11 px-3 bg-surface-container-lowest border border-outline rounded-lg font-body-md text-body-md focus:outline-none focus:ring-2 focus:ring-primary">
            ${parkerTypeOptionsHTML()}
          </select>
        </div>
        <div id="geo-card"><button id="geo-btn" class="press w-full h-touch-target-min bg-primary text-white font-headline-md text-headline-md rounded-lg flex items-center justify-center gap-2">
          <span class="material-symbols-outlined">near_me</span> Use My Location
        </button></div>
      </div>
    </section>

    <button data-route="lots" class="press bento-tile w-full h-touch-target-min bg-primary text-white font-headline-md rounded-lg flex items-center justify-center gap-stack-sm active:opacity-90 transition-opacity">
      <span class="material-symbols-outlined">local_parking</span> All Lots
    </button>

    <section class="grid grid-cols-2 gap-stack-md">
      <div data-route="map" class="press bento-tile bg-surface-container-low border border-outline-variant p-4 rounded-lg cursor-pointer active:bg-surface-container-high transition-colors">
        <span class="material-symbols-outlined text-secondary mb-2">map</span>
        <p class="font-headline-md text-headline-md-mobile">Map View</p>
        <p class="font-body-md text-body-md text-on-surface-variant">Explore all lots &amp; buildings</p>
      </div>
      <div data-route="rules" class="press bento-tile bg-surface-container-low border border-outline-variant p-4 rounded-lg cursor-pointer active:bg-surface-container-high transition-colors">
        <span class="material-symbols-outlined text-secondary mb-2">gavel</span>
        <p class="font-headline-md text-headline-md-mobile">Rules Legend</p>
        <p class="font-body-md text-body-md text-on-surface-variant">Every restriction, explained</p>
      </div>
    </section>

    <button data-route="amenities" class="press bento-tile w-full h-touch-target-min bg-surface-container-low border border-outline-variant text-on-surface font-headline-md rounded-lg flex items-center justify-center gap-stack-sm active:bg-surface-container-high transition-colors">
      <span class="material-symbols-outlined text-secondary">ev_station</span> Bike, Moto &amp; EV Parking
    </button>
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
  let selectedDestBuilding = null;
  attachAutocomplete(document.getElementById('dest-search'), document.getElementById('dest-panel'), buildingItems,
    (id) => {
      const building = BUILDINGS.find(b => b.id === id);
      document.getElementById('dest-search').value = building.name;
      selectedDestBuilding = building;
      renderDestResults(building);
    });
  document.getElementById('dest-parker-type').addEventListener('change', () => {
    if (selectedDestBuilding) renderDestResults(selectedDestBuilding);
  });

  function renderDestResults(building) {
    const now = campusNow();
    const parkerType = document.getElementById('dest-parker-type').value;
    const nearest = nearestLots(building.lat, building.lng, { limit: 6, parkerType, now });
    const box = document.getElementById('dest-results');
    const bestHeading = parkerType === 'any'
      ? `Best Available Lots near ${building.name}`
      : `Nearest ${PARKER_TYPES[parkerType].label} Lots near ${building.name}`;
    // When a parker type is chosen, the "Best Available" panel and the
    // "Nearest lots" strip below want the exact same nearest-eligible-lots
    // computation, so reuse `nearest` instead of asking bestAvailableLotsHTML
    // to recompute it. The 'any' (unfiltered) case still needs its own
    // one-lot-per-category logic, which stays inside bestAvailableLotsHTML.
    const bestHTML = parkerType === 'any'
      ? bestAvailableLotsHTML(building.lat, building.lng, now, null, 'any')
      : (nearest.length ? `<div class="space-y-2">${nearest.map(bestAvailableCardHTML).join('')}</div>` : `<p class="font-body-md text-body-md text-on-surface-variant">${noLotsMessage(parkerType)}</p>`);
    // data-near/data-parker carry the destination building's id and chosen
    // parking type to every lot clicked from within this box, so the lot
    // detail page's "nearest lots" stays relative to this building and this
    // parker type, not just to the lot itself.
    box.innerHTML = `
      <div class="screen-enter" data-near="${building.id}"${parkerDataAttr(parkerType)}>
        <h3 class="font-label-lg text-label-lg text-secondary uppercase px-1 mt-stack-sm mb-1">${bestHeading}</h3>
        ${bestHTML}
        <div class="mt-stack-md">
          <h3 class="font-label-lg text-label-lg text-secondary uppercase px-1 mb-1">Nearest lots to ${building.name}</h3>
          ${nearest.length ? `<div class="flex gap-stack-sm overflow-x-auto hide-scrollbar pb-2">
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
          </div>` : `<p class="font-body-md text-body-md text-on-surface-variant px-1">${noLotsMessage(parkerType)}</p>`}
        </div>
      </div>`;
    bindLotRowClicks(box);
  }

  document.querySelectorAll('.bento-tile').forEach(el => {
    el.addEventListener('click', () => { location.hash = `#/${el.dataset.route}`; });
  });

  // Geolocation "nearest to me"
  let geoCoords = null; // cached after first successful lookup, so changing
                         // the parking-type dropdown afterward re-filters
                         // instantly without asking the browser for location again.

  function renderGeoResults(latitude, longitude) {
    const card = document.getElementById('geo-card');
    const parkerType = document.getElementById('geo-parker-type').value;
    const now = campusNow();
    const near = nearestLots(latitude, longitude, { limit: 1, parkerType, now })[0];
    if (!near) {
      card.innerHTML = `<p class="font-body-md text-body-md text-on-surface-variant">${noLotsMessage(parkerType)}</p>`;
      return;
    }
    const status = computeLotStatus(near.lot, now);
    const meta = STATUS_META[status.level];
    const cat = LOT_DATA.categories[near.lot.category];
    const parkerAttr = parkerDataAttr(parkerType);
    card.innerHTML = `
      <div class="screen-enter"${parkerAttr}>
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
      <button data-lot="${near.lot.code}" class="press mt-stack-md w-full h-touch-target-min bg-primary text-white font-headline-md text-headline-md rounded-lg">View Lot Details</button>
      <div class="mt-stack-md">
        <h3 class="font-label-lg text-label-lg text-secondary uppercase mb-1">${parkerType === 'any' ? 'Best Available Lots near you' : `Nearest ${PARKER_TYPES[parkerType].label} Lots near you`}</h3>
        ${bestAvailableLotsHTML(latitude, longitude, now, null, parkerType)}
      </div>
      </div>`;
    bindLotRowClicks(card);
  }

  document.getElementById('geo-parker-type').addEventListener('change', () => {
    if (geoCoords) renderGeoResults(geoCoords.lat, geoCoords.lng);
  });

  document.getElementById('geo-btn').addEventListener('click', () => {
    const card = document.getElementById('geo-card');
    card.innerHTML = `<p class="font-body-md text-body-md text-on-surface-variant flex items-center gap-2"><span class="material-symbols-outlined animate-spin text-[18px]">progress_activity</span> Getting your location…</p>`;
    if (!navigator.geolocation) {
      card.innerHTML = `<p class="font-body-md text-body-md text-on-surface-variant">Geolocation isn't supported by this browser.</p>`;
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        geoCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        renderGeoResults(geoCoords.lat, geoCoords.lng);
      },
      (err) => {
        card.innerHTML = `<p class="font-body-md text-body-md text-on-surface-variant">Couldn't get your location (${err.message}). <button id="geo-retry" class="text-primary underline">Try again</button></p>`;
        document.getElementById('geo-retry').addEventListener('click', () => document.getElementById('geo-btn').click());
      },
      { timeout: 8000 }
    );
  });
}

// `code` in renderLotDetail below comes straight from location.hash (an
// attacker-controlled URL, e.g. a shared link) with no validation - escape
// before it ever reaches innerHTML. Every other value rendered in this file
// comes from the trusted static dataset, so this is the one real sink.
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Some UMD buildings only have a generic numbered name ("House 173",
// "Building 006") rather than a proper name - the category alone
// ("Fraternity/Sorority") is clearer there than pairing it with the number.
function nearestBuildingLabel(building) {
  if (/^(House|Building)\s+\d+$/.test(building.name)) return building.category || building.name;
  return building.category ? `${building.name} &middot; ${building.category}` : building.name;
}

// Hand-authored, not derived: every fact below is quoted/paraphrased
// directly from the verified off-campus lot records in data.js
// (pricing_summary / hours_summary / operator / note). Only 2 off-campus
// lots exist, so this is safer than a generic text parser - each entry
// was written after reading that lot's exact verified source text, not
// guessed or pattern-matched. Add an entry here only after doing the same.
const OFF_CAMPUS_DETAILS = {
  OC1: {
    price: '$2.00', unit: '/hr',
    schedule: ['Mon-Sat, 8:00am - 10:00pm', 'Free outside these hours & Sundays'],
    payNote: null, // no city-garage-specific pay-station note exists in the verified data - do NOT
    // substitute UMD's own pay_area_rule here, that's a different operator's rate, not OC1's.
    pills: [
      { icon: 'credit_card', label: 'Credit/App Only' },
      { icon: 'accessible', label: 'Handicap Tag Free All Day' },
      { icon: 'bedtime', label: 'No Overnight Parking' },
      { icon: 'domain', label: 'Non-UMD Operated' }
    ],
    amenities: [
      { icon: 'ev_station', label: '2 EV Charging Stations' },
      { icon: 'directions_walk', label: '0.5 miles to Campus' },
      { icon: 'smartphone', label: 'Pay via App/Card' }
    ]
  },
  OC2: {
    price: '$10-12', unit: '/night',
    schedule: ['Hours not publicly confirmed', 'Ask the hotel directly'],
    payNote: 'Book via ParkWhiz/SpotHero-style apps, or ask the hotel directly.',
    pills: [
      { icon: 'apartment', label: 'Privately Operated' },
      { icon: 'domain', label: 'Non-UMD Operated' },
      { icon: 'smartphone', label: 'Reserve via App' }
    ],
    amenities: [
      { icon: 'directions_walk', label: '1.1 miles to Campus' },
      { icon: 'smartphone', label: 'Book via App' }
    ]
  }
};

function renderLotDetail(code, nearBuildingId, parkerType = null) {
  if (!PARKER_TYPES[parkerType]) parkerType = 'any';
  const lot = lotsByCode[(code || '').toUpperCase()];
  if (!lot) {
    appRoot.innerHTML = `<div class="screen-enter text-center py-stack-lg">
      <p class="font-headline-md text-headline-md">Lot "${escapeHtml(code)}" not found.</p>
      <a href="#/home" class="text-primary underline">Back to search</a>
    </div>`;
    return;
  }
  const cat = LOT_DATA.categories[lot.category];
  const now = campusNow();
  const status = computeLotStatus(lot, now);
  const near = lot.lat != null ? nearestBuilding(lot.lat, lot.lng) : null;

  // Arrived here via a destination search? Anchor "nearest lots" and "best
  // available" to that destination instead of to this lot itself, and keep
  // carrying the same context if the user clicks through to another lot.
  const nearBuilding = nearBuildingId ? BUILDINGS.find(b => b.id === nearBuildingId) : null;
  const anchor = nearBuilding ? { lat: nearBuilding.lat, lng: nearBuilding.lng } : { lat: lot.lat, lng: lot.lng };
  const anchorLabel = nearBuilding ? nearBuilding.name : null;
  const nearAttr = nearBuilding ? ` data-near="${nearBuilding.id}"` : '';
  const parkerAttr = parkerDataAttr(parkerType);
  const contextAttr = nearAttr + parkerAttr;

  const alts = anchor.lat != null ? nearestLots(anchor.lat, anchor.lng, { limit: 6, excludeCode: lot.code, parkerType, now }) : [];

  // Short, tag-length facts become pill chips (Airbnb-amenities style).
  // Anything that's actually a sentence stays as plain prose in `notes` -
  // squeezing a whole paragraph into a pill shape is what caused the clutter.
  const chips = [];
  if (lot.lot_type === 'faculty_staff') chips.push('Faculty/Staff lot');
  if (lot.lot_type === 'student') chips.push('Student lot');
  if (lot.gated) chips.push('Gated');
  if (lot.overflow_faculty_staff) chips.push('Faculty/Staff overflow');
  if (lot.overflow_student) chips.push('Student overflow');
  if (lot.approx_pavement_area_sqft) chips.push(`~${lot.approx_pavement_area_sqft.toLocaleString()} sq ft`);
  if (lot.address) chips.push(lot.address);

  const notes = [];
  if (lot.note) notes.push(lot.note);
  if (lot.category === 'off_campus_parking' && lot.confidence !== 'high') notes.push('Pricing/hours not fully confirmed from an official source - verify with the operator before relying on it.');

  // Off-campus lots get a distinct blue "Garage Details" layout (only the 2
  // lots with hand-verified OFF_CAMPUS_DETAILS entries - anything else in
  // this category falls back to the normal red UMD layout below).
  const ocd = lot.category === 'off_campus_parking' ? OFF_CAMPUS_DETAILS[lot.code] : null;
  const useOC = !!ocd;

  appRoot.innerHTML = `
  <section class="screen-enter space-y-stack-lg pb-16">
    <div>
      ${useOC ? `<div class="flex items-center gap-2 mb-2">
        <span class="font-label-md text-label-md font-bold px-3 py-1 rounded-full text-white bg-blue-600 uppercase">Public Parking</span>
        <span class="font-body-md text-body-md text-on-surface-variant">Off-campus</span>
      </div>
      <h1 class="font-headline-lg text-headline-lg text-on-surface">${lot.name || cat.label}</h1>
      ${lot.address ? `<div class="flex items-start gap-1 mt-stack-sm text-on-surface-variant">
        <span class="material-symbols-outlined text-body-md mt-0.5">location_on</span>
        <p class="font-body-md text-body-md">${lot.address}</p>
      </div>` : ''}
      ${near ? `<div class="flex items-center text-on-surface-variant mt-1">
        <span class="material-symbols-outlined text-body-md mr-1">near_me</span>
        <p class="font-body-md text-body-md">Nearest building: ${nearestBuildingLabel(near.building)} (${formatDistance(near.dist)})</p>
      </div>` : ''}` : `<div class="flex items-center gap-2 mb-1">
        <span class="font-headline-lg text-headline-lg px-2 rounded text-white" style="background:${cat.color}">${lot.code}</span>
        <h1 class="font-headline-lg text-headline-lg text-on-surface">${lot.name || cat.label}</h1>
      </div>
      ${lot.name ? `<p class="font-body-md text-body-md text-on-surface-variant -mt-1 mb-1">${cat.label}</p>` : ''}
      ${near ? `<div class="flex items-center text-on-surface-variant">
        <span class="material-symbols-outlined text-body-md mr-1">location_on</span>
        <p class="font-body-md text-body-md">Nearest building: ${nearestBuildingLabel(near.building)} (${formatDistance(near.dist)})</p>
      </div>` : ''}`}
    </div>

    ${useOC ? `
    <section class="bg-surface-container-lowest border border-outline-variant rounded-2xl p-stack-md">
      <div class="flex items-baseline gap-1">
        <span class="font-headline-lg text-headline-lg text-blue-600 font-bold">${ocd.price}</span>
        <span class="font-body-md text-body-md text-on-surface-variant">${ocd.unit}</span>
      </div>
      <div class="flex items-start gap-stack-sm mt-stack-sm">
        <span class="material-symbols-outlined text-on-surface-variant mt-0.5">schedule</span>
        <div>${ocd.schedule.map(line => `<p class="font-body-md text-body-md text-on-surface">${line}</p>`).join('')}</div>
      </div>
      ${ocd.payNote ? `<div class="flex items-start gap-stack-sm mt-stack-md bg-blue-50 rounded-lg p-stack-sm">
        <span class="material-symbols-outlined text-blue-600 text-[20px] mt-0.5">info</span>
        <p class="font-label-md text-label-md text-on-surface-variant">${ocd.payNote}</p>
      </div>` : ''}
    </section>

    <section>
      <h3 class="font-headline-md text-headline-md text-on-surface mb-stack-sm">Rules &amp; Info</h3>
      <div class="flex flex-wrap gap-stack-sm">
        ${ocd.pills.map(p => `<span class="flex items-center gap-1.5 px-3 py-1.5 bg-surface-container-lowest border border-outline-variant rounded-full font-label-lg text-label-lg text-on-surface">
          <span class="material-symbols-outlined text-blue-600 text-[18px]">${p.icon}</span>${p.label}
        </span>`).join('')}
      </div>
    </section>

    <section>
      <h3 class="font-headline-md text-headline-md text-on-surface mb-stack-sm">Amenities</h3>
      <div class="grid grid-cols-2 gap-stack-md">
        ${ocd.amenities.map(a => `<div class="flex items-center gap-stack-sm">
          <span class="material-symbols-outlined flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-blue-50 text-blue-600 text-[20px]">${a.icon}</span>
          <p class="font-body-md text-body-md text-on-surface">${a.label}</p>
        </div>`).join('')}
      </div>
    </section>
    ${notes.length ? `<div class="space-y-1">
      ${notes.map(n => `<p class="font-label-md text-label-md text-on-surface-variant italic">${n}</p>`).join('')}
    </div>` : ''}
    ` : `
    <div id="status-wrap">${statusBannerHTML(status, `Status now &middot; ${now.weekday} ${formatClock(now.minutesOfDay)}`)}</div>

    <section>
      <h3 class="font-headline-md text-headline-md text-on-surface mb-stack-sm">What you need to know</h3>
      <div class="space-y-stack-sm">
        <p class="font-body-md text-body-md text-on-surface">${cat.rule}</p>
        ${lot.special_rule ? `<p class="font-body-md text-body-md text-on-surface">${lot.special_rule}</p>` : ''}
        <p class="font-body-md text-body-md text-on-surface">${LOT_DATA.pay_area_rule}</p>
      </div>
      ${chips.length ? `<div class="flex flex-wrap gap-2 mt-stack-md">
        ${chips.map(c => `<span class="px-3 py-1.5 bg-surface-container rounded-full font-label-md text-label-md text-on-surface-variant">${c}</span>`).join('')}
      </div>` : ''}
      ${notes.length ? `<div class="space-y-1 mt-stack-md">
        ${notes.map(n => `<p class="font-label-md text-label-md text-on-surface-variant italic">${n}</p>`).join('')}
      </div>` : ''}
    </section>
    `}

    <section>
      <div class="flex justify-between items-end mb-stack-sm">
        <h3 class="font-label-lg text-label-lg text-on-surface uppercase">Plan Ahead</h3>
        <span class="font-stat-display text-stat-display ${useOC ? 'text-blue-600' : 'text-primary'}" id="time-display">${formatClock(now.minutesOfDay)}</span>
      </div>
      <div class="bg-surface-container border border-outline-variant p-stack-md rounded-xl">
        <div class="flex gap-2 mb-stack-md">
          <button data-daytype="weekday" class="press daytype-btn flex-1 h-9 rounded-full font-label-lg text-label-lg border transition-colors">Weekday</button>
          <button data-daytype="weekend" class="press daytype-btn flex-1 h-9 rounded-full font-label-lg text-label-lg border transition-colors">Weekend</button>
        </div>
        <input id="time-slider" class="w-full h-2 bg-outline-variant rounded-lg appearance-none cursor-pointer ${useOC ? 'accent-blue-600' : 'accent-primary'}" max="1440" min="0" step="15" type="range" value="${now.minutesOfDay}">
        <div class="flex justify-between mt-stack-sm text-on-surface-variant font-label-md text-label-md">
          <span>12 AM</span><span>Noon</span><span>11:59 PM</span>
        </div>
      </div>
      <p class="mt-stack-sm font-body-md text-body-md text-on-surface-variant italic text-center">Drag the slider and toggle weekday/weekend to preview this lot's status at any time.</p>
    </section>

    ${anchorLabel || parkerType !== 'any' ? `<p class="font-label-md text-label-md text-on-surface-variant italic -mb-2">
      ${anchorLabel ? `Showing lots nearest to ${anchorLabel}, not to ${lot.code}.` : ''}
      ${parkerType !== 'any' ? ` Filtered for: ${PARKER_TYPES[parkerType].label}.` : ''}
    </p>` : ''}

    ${alts.length ? `<section${contextAttr}>
      <h3 class="font-label-lg text-label-lg text-on-surface uppercase mb-stack-sm">${anchorLabel ? `Nearest Lots to ${anchorLabel}` : 'Nearest Alternative Lots'}</h3>
      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl px-stack-md">
        ${alts.map((a, i) => lotListItemHTML(a.lot, a.dist, i + 1)).join('')}
      </div>
    </section>` : ''}

    ${anchor.lat != null ? `<section${contextAttr}>
      <h3 class="font-label-lg text-label-lg text-on-surface uppercase mb-stack-sm">${anchorLabel ? `Best Available Lots near ${anchorLabel}` : 'Best Available Lots'}</h3>
      ${bestAvailableLotsHTML(anchor.lat, anchor.lng, now, lot.code, parkerType)}
    </section>` : ''}
  </section>
  ${lot.lat != null ? `<div class="fixed bottom-6 left-0 right-0 w-full px-margin-mobile max-w-md mx-auto">
    <button id="navigate-btn" class="press w-full h-touch-target-min ${useOC ? 'bg-blue-600' : 'bg-primary'} text-on-primary font-headline-md rounded-lg flex items-center justify-center gap-stack-sm shadow-md active:opacity-90 transition-opacity">
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
      btn.className = 'press daytype-btn flex-1 h-9 rounded-full font-label-lg text-label-lg border transition-colors ' +
        (active ? (useOC ? 'bg-blue-600 text-white border-blue-600' : 'bg-primary text-white border-primary') : 'bg-surface-container-lowest text-on-surface-variant border-outline-variant');
    });
  }
  function updatePreview() {
    const mins = parseInt(slider.value, 10);
    document.getElementById('time-display').textContent = formatClock(mins);
    // Off-campus lots have no live permit-window status to preview (computeLotStatus
    // returns the same static message regardless of time), so there's no #status-wrap.
    if (useOC) return;
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

function renderAmenities() {
  const parkingTypes = ['ev_charging', 'motorcycle', 'covered_bike_parking', 'bike_repair_station'];
  const impoundLot = AMENITIES.find(a => a.type === 'dots_impound_lot');
  let activeType = 'all';
  let userLoc = null; // once set (via "Sort by distance from me"), cards show real walking distance

  appRoot.innerHTML = `
  <section class="screen-enter space-y-stack-lg pb-8">
    <div>
      <h1 class="font-headline-lg text-headline-lg text-on-surface">Bike, Moto &amp; EV Parking</h1>
      <p class="font-body-md text-body-md text-on-surface-variant mt-1">EV charging stations, motorcycle parking, and covered bicycle parking (with repair stations), each anchored to the nearest known lot or building on the official campus parking map.</p>
    </div>

    <button id="amenity-geo-btn" class="press w-full h-11 bg-surface-container-lowest border border-outline text-on-surface font-headline-md text-body-lg rounded-lg flex items-center justify-center gap-2">
      <span class="material-symbols-outlined text-[18px]">near_me</span> Sort by distance from me
    </button>

    <div class="flex gap-2 overflow-x-auto hide-scrollbar pb-1" id="amenity-filters">
      <button data-type="all" class="press amenity-filter-btn flex-shrink-0 h-9 px-4 rounded-full font-label-lg text-label-lg border transition-colors">All</button>
      ${parkingTypes.map(t => `<button data-type="${t}" class="press amenity-filter-btn flex-shrink-0 h-9 px-4 rounded-full font-label-lg text-label-lg border transition-colors">${AMENITY_TYPES[t].label}</button>`).join('')}
    </div>

    <div id="amenity-list" class="space-y-2"></div>

    ${impoundLot ? `
    <section class="bg-surface-container border border-outline-variant rounded-xl p-stack-md">
      <h3 class="font-label-lg text-label-lg text-secondary uppercase mb-1">Good to know</h3>
      <div class="flex items-center gap-stack-sm">
        <span class="material-symbols-outlined" style="color:${AMENITY_TYPES.dots_impound_lot.color}">${AMENITY_TYPES.dots_impound_lot.icon}</span>
        <p class="font-body-md text-body-md text-on-surface-variant">${AMENITY_TYPES.dots_impound_lot.label}${impoundLot.note ? ' - ' + impoundLot.note : ''}. If your vehicle is towed, this is where DOTS holds it.</p>
      </div>
    </section>` : ''}
  </section>`;

  function updateFilterButtons() {
    document.querySelectorAll('.amenity-filter-btn').forEach(btn => {
      const active = btn.dataset.type === activeType;
      btn.className = 'press amenity-filter-btn flex-shrink-0 h-9 px-4 rounded-full font-label-lg text-label-lg border transition-colors ' +
        (active ? 'bg-primary text-white border-primary' : 'bg-surface-container-lowest text-on-surface-variant border-outline-variant');
    });
  }

  function amenityCardHTML(entry) {
    const a = entry.amenity;
    const meta = AMENITY_TYPES[a.type];
    return `<div class="stagger-in flex items-center gap-stack-sm bg-surface-container-lowest border border-outline-variant rounded-lg p-stack-sm">
      <span class="material-symbols-outlined text-[22px] flex-shrink-0" style="color:${meta.color}">${meta.icon}</span>
      <div class="flex-1 min-w-0">
        <p class="font-body-md text-body-md font-bold">${meta.label}</p>
        <p class="font-label-md text-label-md text-on-surface-variant">${a.note || ''}${entry.dist != null ? ` &middot; ${formatDistance(entry.dist)} &middot; ${walkMinutes(entry.dist)} min walk` : ''}</p>
      </div>
      <button data-lat="${a.lat}" data-lng="${a.lng}" class="press amenity-directions-btn flex-shrink-0 p-2 text-primary" aria-label="Directions">
        <span class="material-symbols-outlined">directions</span>
      </button>
    </div>`;
  }

  function draw() {
    // Before the user shares their location, sort by proximity to a fixed
    // campus-center point for a stable default order - but don't show that
    // as a "distance from you" figure, since it isn't one.
    const anchor = userLoc || { lat: 38.9869, lng: -76.9426 };
    const results = nearestAmenities(anchor.lat, anchor.lng, { type: activeType })
      .filter(e => e.amenity.type !== 'dots_impound_lot');
    const box = document.getElementById('amenity-list');
    box.innerHTML = results.length
      ? results.map(e => amenityCardHTML(userLoc ? e : { amenity: e.amenity, dist: null })).join('')
      : `<p class="font-body-md text-body-md text-on-surface-variant text-center py-stack-md">No amenities found for this filter.</p>`;
    box.querySelectorAll('.amenity-directions-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        window.open(`https://www.google.com/maps/dir/?api=1&destination=${btn.dataset.lat},${btn.dataset.lng}`, '_blank', 'noopener');
      });
    });
  }

  document.querySelectorAll('.amenity-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => { activeType = btn.dataset.type; updateFilterButtons(); draw(); });
  });

  document.getElementById('amenity-geo-btn').addEventListener('click', () => {
    const btn = document.getElementById('amenity-geo-btn');
    if (!navigator.geolocation) {
      btn.textContent = "Geolocation isn't supported by this browser.";
      return;
    }
    btn.innerHTML = `<span class="material-symbols-outlined animate-spin text-[18px]">progress_activity</span> Getting your location…`;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        btn.innerHTML = `<span class="material-symbols-outlined text-[18px]">near_me</span> Sorted by distance from you`;
        draw();
      },
      () => {
        btn.innerHTML = `<span class="material-symbols-outlined text-[18px]">near_me</span> Couldn't get your location - try again`;
      },
      { timeout: 8000 }
    );
  });

  updateFilterButtons();
  draw();
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
       class="press w-full h-touch-target-min flex items-center justify-center gap-stack-sm rounded-lg border border-primary text-primary font-headline-md active:bg-surface-container transition-colors">
      <span class="material-symbols-outlined">download</span> Download Official PDF Map
    </a>
  </section>`;

  const legend = document.getElementById('map-legend');
  legend.innerHTML = Object.values(LOT_DATA.categories).map(c =>
    `<span class="flex items-center gap-1"><span class="w-3 h-3 rounded inline-block" style="background:${c.color}"></span>${c.label}</span>`
  ).join('') + `<span class="flex items-center gap-1"><span class="w-3 h-3 rounded-full inline-block bg-white border border-outline"></span>Building</span>`
    + Object.entries(AMENITY_TYPES).filter(([type]) => type !== 'dots_impound_lot').map(([, meta]) =>
      `<span class="flex items-center gap-1"><span class="material-symbols-outlined text-[14px]" style="color:${meta.color}">${meta.icon}</span>${meta.label}</span>`
    ).join('');

  setTimeout(() => {
    leafletMap = L.map('map').setView([38.9869, -76.9426], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
    }).addTo(leafletMap);

    for (const lot of LOT_DATA.lots) {
      if (lot.lat == null) continue;
      const cat = LOT_DATA.categories[lot.category];
      const marker = L.circleMarker([lot.lat, lot.lng], { radius: 7, color: '#222', weight: 1, fillColor: cat.color, fillOpacity: 0.85 }).addTo(leafletMap);
      marker.bindPopup(`<strong>${lot.code}${lot.name ? ' - ' + lot.name : ''}</strong> - ${cat.label}<br>${cat.rule}${lot.special_rule ? '<br><em>' + lot.special_rule + '</em>' : ''}<br><a href="#/lot/${encodeURIComponent(lot.code)}">View details &rarr;</a>`);
    }
    for (const b of BUILDINGS) {
      if (b.lat == null) continue;
      const marker = L.circleMarker([b.lat, b.lng], { radius: 3, color: '#444', weight: 1, fillColor: '#ffffff', fillOpacity: 0.9 }).addTo(leafletMap);
      marker.bindPopup(`<strong>${b.name}</strong><br>${b.category}`);
    }
    for (const a of AMENITIES) {
      if (a.type === 'dots_impound_lot') continue;
      const meta = AMENITY_TYPES[a.type];
      const marker = L.circleMarker([a.lat, a.lng], { radius: 5, color: '#fff', weight: 1, fillColor: meta.color, fillOpacity: 0.95 }).addTo(leafletMap);
      marker.bindPopup(`<strong>${meta.label}</strong>${a.note ? '<br>' + a.note : ''}`);
    }
    // The .screen-enter entrance animation is still running on the ancestor
    // <section> when the map initializes (its transform can make Leaflet
    // mis-measure the container). Re-validate once the animation has
    // definitely settled so the map's internal size/position is correct.
    setTimeout(() => { if (leafletMap) leafletMap.invalidateSize(); }, 260);
  }, 0);
}

// ============================================================
// Router
// ============================================================

const ROUTES = {
  home:      { render: renderHome, showBack: false },
  lots:      { render: renderLotsList, showBack: true },
  map:       { render: renderMap, showBack: true },
  rules:     { render: renderRules, showBack: true },
  amenities: { render: renderAmenities, showBack: true },
  lot:       { render: (arg, nearId, parkerType) => renderLotDetail(arg, nearId, parkerType), showBack: true }
};

function route() {
  if (leafletMap) { leafletMap.remove(); leafletMap = null; }
  const hash = location.hash.replace(/^#\//, '') || 'home';
  // #/lot/CODE, optionally followed by /near/BUILDINGID and/or /park/TYPE
  // (either order) - both arrive via search results carrying context, so the
  // lot detail page can stay anchored to the right point and parker type.
  const [seg, arg, ...rest] = hash.split('/').map(decodeURIComponent);
  let nearId = null, parkerType = null;
  for (let i = 0; i < rest.length; i += 2) {
    if (rest[i] === 'near') nearId = rest[i + 1];
    if (rest[i] === 'park') parkerType = rest[i + 1];
  }
  if (!PARKER_TYPES[parkerType]) parkerType = null;
  const r = ROUTES[seg] || ROUTES.home;
  r.render(arg || '', nearId, parkerType);

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
  const counts = lotAvailabilityCounts(now);
  document.getElementById('home-open-count').textContent = counts.free;
  document.getElementById('home-paid-count').textContent = `+${counts.paid} pay-to-park`;
}
setInterval(liveTick, 1000);

// ============================================================
// Boot
// ============================================================

route();
