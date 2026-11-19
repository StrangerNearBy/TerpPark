/**
 * UMD parking engine — framework-agnostic, zero dependencies.
 *
 * Given a destination building, a permit (or none) and a time, returns nearby
 * parking ranked by whether you may legally park there right then.
 *
 * Everything meant to grow later is a named seam. See EXTENSION POINTS below.
 */

/* ------------------------------------------------------------------ *
 * EXTENSION POINTS — override any of these via createEngine(opts)
 *
 *   distance(a, b)            straight-line now; swap for a walking router
 *   resolveEligibleLots(p)    permit -> lots; swap for a real DOTS account API
 *   availability(lot, when)   returns null now; swap for live space counts
 *   enrich(result, ctx)       decorate results (shuttle, ADA, weather, …)
 *
 * Rules themselves live in data/rules.json, not in this file.
 * Space counts and UMD's own restriction records live in data/lot_info.json
 * (from tools_fetch_umd_gis.py); campus places in data/places.geojson.
 * ------------------------------------------------------------------ */

const DAY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Does `when` fall inside a window? Windows wrap past midnight when to <= from. */
function inWindow(win, when) {
  const day = DAY[when.getDay()];
  const isWeekend = day === 'sat' || day === 'sun';
  const scope = win.days;
  const dayOk =
    scope === 'all' ||
    (scope === 'mon-fri' && !isWeekend) ||
    (scope === 'sat-sun' && isWeekend) ||
    scope === day;

  const now = when.getHours() * 60 + when.getMinutes();
  const from = toMin(win.from);
  const to = win.to === '24:00' ? 1440 : toMin(win.to);

  // A wrapping window (e.g. 16:00 -> 07:00) covers the tail of one day and the
  // head of the next. The day test applies to the day the window *starts*, so a
  // wrap into Saturday morning is still governed by the Friday window.
  if (to <= from) {
    if (now >= from) return dayOk;
    const prev = DAY[(when.getDay() + 6) % 7];
    const prevWeekend = prev === 'sat' || prev === 'sun';
    const prevOk =
      scope === 'all' ||
      (scope === 'mon-fri' && !prevWeekend) ||
      (scope === 'sat-sun' && prevWeekend) ||
      scope === prev;
    return now < to && prevOk;
  }
  return dayOk && now >= from && now < to;
}

// Named EARTH_R, not R: bundle-standalone.mjs inlines this file into the same
// module scope as app/index.html, which declares its own `R` (the rules).
const EARTH_R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

/** Great-circle metres between [lon,lat] pairs. */
function haversine(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(s));
}

/**
 * The "base" of a lot code: its leading run of letters, or leading run of digits.
 *   4a -> 4    16b -> 16    K3 -> K    KK -> KK    XX1 -> XX    PH1 -> PH
 * This is what makes lot *families* work without collapsing genuinely different
 * lots together: K3/K5/K7 share base "K", but KK is its own lot with base "KK",
 * and XX1 (base "XX") is not part of the X family.
 */
export function lotBase(code) {
  const s = String(code ?? '').trim();
  const m = s.match(/^([A-Za-z]+|\d+)/);
  return m ? m[1].toLowerCase() : '';
}

/** Is `code` covered by the reference `ref`? Bare bases expand to the family. */
export function matchesLot(ref, code) {
  const r = String(ref ?? '').trim().toLowerCase();
  const c = String(code ?? '').trim().toLowerCase();
  if (!r || !c) return false;
  if (r === c) return true;
  // A reference that is purely letters or purely digits names a family
  // ("Lot 4" on the map means 4a, 4b, 4h, …). Anything else is a specific lot.
  const isBare = /^([a-z]+|\d+)$/.test(r);
  return isBare && lotBase(c) === r;
}

/**
 * Parse a permit into something the engine can reason about.
 * UMD encodes the permit AS a lot code, so "my permit" == "my lot".
 */
export function parsePermit(raw) {
  if (!raw) return { kind: 'none', lot: null, group: null };
  const lot = String(raw).trim();
  if (!lot) return { kind: 'none', lot: null, group: null };
  // Map convention: leading letter = faculty/staff lot, leading digit = student lot.
  const group = /^[A-Za-z]/.test(lot) ? 'faculty_staff' : 'student';
  return { kind: 'permit', lot, group };
}

export function createEngine({
  buildings,
  parking,
  payParking,
  rules,
  lotInfo = null,
  places = null,
  distance = haversine,
  resolveEligibleLots = null,
  availability = () => null,
  enrich = (r) => r,
} = {}) {
  const buildingFeatures = (buildings?.features ?? []).filter((f) => f.geometry);
  const lotFeatures = (parking?.features ?? []).filter((f) => f.geometry);
  const payFeatures = (payParking?.features ?? []).filter((f) => f.geometry);
  const placeFeatures = (places?.features ?? []).filter((f) => f.geometry);
  // A place that is itself a building (McKeldin Library the library) is already
  // in search as the building; don't list it twice.
  const buildingNames = new Set(buildingFeatures.map((f) => (f.properties.name ?? '').toLowerCase()));
  // Search order: the places people look for first win a shared name ("McKeldin
  // Mall" the area, not the e-scooter spot). Bike racks live in Bike mode only.
  const SEARCH_RANK = { study: 0, food: 1, landmarks: 2, vehicle: 3, transit: 4, services: 5 };
  const searchPlaces = placeFeatures
    .filter((f) => f.properties.group !== 'bike')
    .sort((a, b) => (SEARCH_RANK[a.properties.group] ?? 9) - (SEARCH_RANK[b.properties.group] ?? 9));
  const infoFor = (id) => (id ? lotInfo?.lots?.[id] ?? null : null);
  const garageFor = (num) => (num ? lotInfo?.garages?.[num] ?? null : null);

  /** Which lots does this permit entitle you to? Default = own lot + overflow. */
  const defaultEligible = (permit) => {
    if (permit.kind !== 'permit') return { own: [], overflow: [] };
    const overflow = rules.overflow?.[permit.group] ?? [];
    return {
      own: [permit.lot],
      overflow,
    };
  };
  const eligibleFor = resolveEligibleLots ?? defaultEligible;

  /** The access level in force for a lot at a given moment. */
  function accessAt(lotId, restrictionClass, when) {
    const special = lotId ? rules.special_lots?.[lotId] : null;
    const windows = special?.windows ?? rules.classes?.[restrictionClass]?.windows;
    if (!windows) return { access: 'unknown', window: null };
    const win = windows.find((w) => inWindow(w, when));
    return { access: win ? win.access : 'unknown', window: win ?? null };
  }

  /**
   * Buildings first, then campus places (dining, libraries, stops, …). Places with
   * the same name collapse to one hit, so 'Regents Drive Garage' is not listed
   * once per shuttle direction.
   */
  function searchBuildings(query, limit = 8) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    // One- or two-letter searches ("EV") match word starts only, so "ev" does not
    // hit Centreville or Severn.
    const short = q.length < 3;
    const has = (text) => (short ? new RegExp(`(^|[^a-z0-9])${q.replace(/[^a-z0-9]/g, '')}`).test(text) : text.includes(q));
    const scored = [];
    const seenPlace = new Set();
    for (const f of searchPlaces) {
      const p = f.properties;
      const name = (p.name ?? '').toLowerCase();
      const bldg = (p.building ?? '').toLowerCase();
      const cat = (p.category ?? '').toLowerCase();
      // Rooms in buildings (restrooms, showers…) only when asked for by kind.
      if (p.group === 'services' && !(cat.includes(q) || q.split(/\s+/).some((w) => w.length > 3 && cat.includes(w)))) continue;
      // "Yahentamitsi" the dining hall *is* the building "Yahentamitsi Dining Hall".
      if (bldg && buildingNames.has(bldg) && bldg.startsWith(name)) continue;
      let score = -1;
      if (name === q) score = 10;
      else if (name.startsWith(q)) score = 11;
      else if (has(name) || has(bldg) || cat.startsWith(q)) score = 12;
      // Restaurants inside a food court are findable by their own name.
      if (score < 0) {
        for (const v of p.vendors ?? []) {
          const vn = v.name.toLowerCase();
          const key = `${vn}@${name}`;          // Subway is in two food courts
          if (!(vn === q || vn.startsWith(q) || has(vn)) || seenPlace.has(key)) continue;
          seenPlace.add(key);
          scored.push({ score: vn.startsWith(q) ? 11 : 12, feature: { type: 'Feature', geometry: f.geometry,
            properties: { ...p, name: v.name, category: `in ${p.name}`, vendorOf: p.name, website: v.hours ?? p.website } } });
        }
        continue;
      }
      if (seenPlace.has(name) || buildingNames.has(name)) continue;
      seenPlace.add(name);
      scored.push({ score, feature: f });
    }
    for (const f of buildingFeatures) {
      const p = f.properties;
      const name = (p.name ?? '').toLowerCase();
      const printed = (p.name_as_printed ?? '').toLowerCase();
      const num = String(p.building_number ?? '');
      let score = -1;
      if (name === q || num === q) score = 0;
      else if (name.startsWith(q) || printed.startsWith(q)) score = 1;
      else if (has(name) || has(printed) || num.startsWith(q)) score = 2;
      if (score >= 0) scored.push({ score, feature: f });
    }
    scored.sort((a, b) =>
      a.score - b.score ||
      (a.feature.properties.name ?? '').localeCompare(b.feature.properties.name ?? '')
    );
    return scored.slice(0, limit).map((s) => s.feature);
  }

  /**
   * Core query.
   * @param building GeoJSON building feature (from searchBuildings)
   * @param permitRaw lot code string, or null/'' for no registration
   * @param when Date
   * @param opts { radius, limit, includePay }
   */
  function findParking(building, permitRaw, when = new Date(), opts = {}) {
    const { radius = 1200, limit = 40, includePay = true, needsAda = false } = opts;
    if (!building?.geometry) return { building: null, results: [], pay: [] };

    const origin = building.geometry.coordinates;
    const permit = parsePermit(permitRaw);
    const { own, overflow } = eligibleFor(permit, rules);
    // Match through lot families, so permit "4" covers 4a/4b/4h/… as the map intends.
    const isOwnLot = (code) => own.some((ref) => matchesLot(ref, code));
    const isOverflowLot = (code) => overflow.some((ref) => matchesLot(ref, code));

    // One entry per lot id — collapse the parcel-level points to their closest parcel.
    // Lots you are entitled to are always included, even past the radius: "your lot
    // is a 15 minute walk" is a useful answer, "no results" is not.
    const byLot = new Map();
    for (const f of lotFeatures) {
      const p = f.properties;
      const id = p.lot;
      const entitled = id && (isOwnLot(id) || isOverflowLot(id));
      const d = distance(origin, f.geometry.coordinates);
      if (d > radius && !entitled) continue;
      const mapKey = id ?? `__${p.garage_building_number}`;
      const prev = byLot.get(mapKey);
      if (!prev || d < prev.distance) {
        byLot.set(mapKey, { feature: f, distance: d, beyondRadius: d > radius });
      }
    }

    const results = [];
    for (const { feature, distance: d, beyondRadius } of byLot.values()) {
      const p = feature.properties;
      const id = p.lot;
      const key = id ? id.toLowerCase() : null;
      const info = infoFor(id);
      // The printed map wins; UMD's parking database only fills a lot the map
      // leaves blank (see tools_fetch_umd_gis.py for when that is allowed).
      const cls = p.restriction_class ?? info?.fill_class ?? null;
      const classSource = p.restriction_class ? 'map' : info?.fill_class ? 'umd_gis' : null;
      const garage = garageFor(p.garage_building_number);
      const { access, window } = accessAt(id, cls, when);

      const isOwn = !!(id && isOwnLot(id));
      const isOverflow = !!(id && isOverflowLot(id) && !isOwn);
      const gated = (rules.gated_lots?.lots ?? []).some((l) => l.toLowerCase() === key);
      const adaOnly = !!rules.special_lots?.[id]?.ada_only;

      // Can this user park here right now?
      let allowed = false;
      let reason = '';
      if (access === 'open') {
        allowed = true;
        reason = 'Open to anyone at this time — no permit needed.';
      } else if (access === 'pay') {
        allowed = true;
        reason = 'Permit or payment required at all times.';
      } else if (access === 'permit_lot') {
        allowed = isOwn || isOverflow;
        reason = isOwn
          ? `Your permit is for lot ${id}.`
          : isOverflow
          ? `Overflow lot for ${permit.group === 'student' ? 'students' : 'faculty/staff'}.`
          : `Requires a permit for lot ${id}.`;
      } else if (access === 'faculty_staff') {
        allowed = permit.group === 'faculty_staff';
        reason = allowed
          ? 'Open to any faculty/staff permit at this time.'
          : 'Faculty/staff permits only at this time.';
      } else {
        reason = 'No published rule for this lot.';
      }

      // ADA-only lots are never a general suggestion. Without an ADA permit they
      // are not an option at all, whatever the time-of-day rule says.
      if (adaOnly && !needsAda) {
        allowed = false;
        reason = 'ADA parking only — requires an accessible permit.';
      }

      // Your own lot / overflow entitlement still holds when a lot is open to all,
      // so say both rather than letting the time rule hide it.
      if (allowed && isOwn && access !== 'permit_lot') {
        reason = `Your permit is for lot ${id}. ${reason}`;
      } else if (allowed && isOverflow && access !== 'permit_lot') {
        reason = `Overflow lot for you. ${reason}`;
      }

      // Ranking tier: lower sorts first.
      let tier, tierLabel;
      if (!allowed) [tier, tierLabel] = [5, adaOnly ? 'ADA permit only' : 'Not available to you'];
      else if (adaOnly) [tier, tierLabel] = [0, 'Accessible parking'];
      else if (isOwn) [tier, tierLabel] = [1, 'Your permit'];
      else if (isOverflow) [tier, tierLabel] = [2, 'Your overflow lot'];
      else if (access === 'open') [tier, tierLabel] = [3, 'Free right now'];
      else [tier, tierLabel] = [4, 'Allowed with payment'];

      const cd = rules.classes?.[cls];
      results.push(
        enrich(
          {
            lot: id,
            type: p.type,
            garageName: p.garage_name,
            distance: Math.round(d),
            beyondRadius: !!beyondRadius,
            walkMinutes: Math.max(1, Math.round(d / 80)), // ~4.8 km/h
            allowed,
            tier,
            tierLabel,
            reason,
            access,
            gated,
            adaOnly,
            restrictionClass: cls,
            classSource,
            // A garage with no lot id (Union Lane) only gets a number when UMD's count
            // for it is complete; a partial count would understate it.
            spaces: info?.total_spaces ?? (!id && garage?.complete ? garage.total_spaces : null),
            permitsSold: info?.permits_sold ?? null,
            lotType: info?.lot_type ?? null,
            umdRegulation: info?.umd_regulation ?? null,
            umdAdditional: info?.umd_additional ?? null,
            conflict: info?.conflict ?? null,
            garage,
            garageNumber: p.garage_building_number ?? null,
            restrictionLabel: cd?.label ?? null,
            colour: cd?.colour ?? '#8b8b8b',
            ruleText: rules.special_lots?.[id]?.text ?? cd?.restriction_text ?? null,
            activeWindow: window,
            gridLocation: p.grid_location,
            coordinates: feature.geometry.coordinates,
            availability: availability(id, when),
          },
          { building, permit, when }
        )
      );
    }

    results.sort((a, b) => a.tier - b.tier || a.distance - b.distance);

    // Pay stations / meters — the answer when you have no registration at all.
    let pay = [];
    if (includePay) {
      const payHours = rules.pay_parking?.hours;
      const payActive = payHours
        ? inWindow({ days: 'all', from: payHours.from, to: payHours.to }, when)
        : true;
      pay = payFeatures
        .map((f) => ({
          nearBuilding: f.properties.near_building,
          payType: f.properties.pay_type,
          distance: Math.round(distance(origin, f.geometry.coordinates)),
          coordinates: f.geometry.coordinates,
          paymentRequiredNow: payActive,
          rate: rules.pay_parking?.rate ?? null,
        }))
        .filter((x) => x.distance <= radius)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 10);
    }

    return {
      building,
      permit,
      when,
      results: results.slice(0, limit),
      pay,
      summary: {
        allowedCount: results.filter((r) => r.allowed).length,
        nearestAllowed: results.find((r) => r.allowed) ?? null,
      },
    };
  }

  return { searchBuildings, findParking, accessAt, parsePermit, haversine, rules };
}

export { haversine, inWindow };

/* ------------------------------------------------------------------ *
 * Plain-English rule explanation.
 * The app's job is to state, for any lot: who may park, and when.
 * ------------------------------------------------------------------ */

const WHO = {
  permit_lot: (lot) => `Permit for lot ${lot} only`,
  faculty_staff: () => 'Faculty & staff permits only',
  open: () => 'Anyone — no permit needed',
  pay: () => 'Anyone — payment required',
  unknown: () => 'No published rule',
};

const DAY_LABEL = { 'mon-fri': 'Mon–Fri', 'sat-sun': 'Sat & Sun', all: 'Every day',
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

/** "16:00" -> "4 PM", "07:30" -> "7:30 AM" */
export function prettyTime(hhmm) {
  if (hhmm === '24:00' || hhmm === '00:00') return 'midnight';
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h < 12 ? 'AM' : 'PM';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hr}:${String(m).padStart(2, '0')} ${ampm}` : `${hr} ${ampm}`;
}

/**
 * Full schedule for a lot, in the order it reads best: what applies now first,
 * then every other window. Used to render the "who can park here" breakdown.
 */
export function explainLot(rules, lotId, restrictionClass, when = new Date()) {
  const special = lotId ? rules.special_lots?.[lotId] : null;
  const cls = rules.classes?.[restrictionClass];
  const windows = special?.windows ?? cls?.windows ?? [];

  const schedule = windows.map((w) => ({
    days: DAY_LABEL[w.days] ?? w.days,
    hours:
      w.from === '00:00' && (w.to === '24:00' || w.to === '00:00')
        ? 'All day'
        : `${prettyTime(w.from)} – ${prettyTime(w.to)}`,
    who: (WHO[w.access] ?? WHO.unknown)(lotId),
    access: w.access,
    free: w.access === 'open',
    active: inWindow(w, when),
  }));

  const active = schedule.find((s) => s.active) ?? null;
  const free = schedule.filter((s) => s.free);

  return {
    lot: lotId,
    label: cls?.label ?? null,
    summary: cls?.restriction_text ?? special?.text ?? null,
    requiredText: cls?.required_text ?? null,
    schedule,
    now: active,
    freeWindows: free,
    everFree: free.length > 0,
    adaOnly: !!special?.ada_only,
    gated: (rules.gated_lots?.lots ?? []).some(
      (l) => String(l).toLowerCase() === String(lotId).toLowerCase()
    ),
  };
}
