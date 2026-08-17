# Off-campus parking research notes (offcampus_parking_v1.json)

## Verification method

For every included facility I required at least two independent signals before
writing it down, matching the rigor already used for this project's on-campus
data (see `unmatched_resolved.json` / `build_dataset.py`):

1. An official or primary operator source (wmata.com, collegeparkmd.gov,
   thehotelumd.com, or a hotel's Choice Hotels page) fetched directly via
   WebFetch - not just a search-engine AI summary.
2. An independent geocode/cross-check: OpenStreetMap Nominatim
   (`https://nominatim.openstreetmap.org/search`, custom User-Agent, 1
   req/sec) returning a **named POI match** at the same address (e.g. the
   Nominatim result literally named "City of College Park Downtown Parking
   Garage" or "The Hotel at The University of Maryland"), which is the same
   "osm_named_match" bar used elsewhere in this project.
3. For the two private hotel garages, a third signal from an independent
   third-party parking-booking aggregator (ParkWhiz) that separately lists
   the same address/facility, since a single operator page plus OSM alone
   felt thinner for those.

Where sources disagreed (see below) I always preferred the directly-fetched
official/primary source over search-engine paraphrases or older aggregator
listings, and called out the discrepancy in the `note` field rather than
silently picking one number.

## What I verified and included (4 facilities)

1. **College Park-U of Md Metro Station Parking Garage** (WMATA) - 4931
   Calvert Road. High confidence. Address/capacity/history cross-checked
   between wmata.com, Wikipedia, and an OSM named `amenity=parking` node at
   the identical address.
2. **City of College Park Downtown Parking Garage** - Knox Rd & Yale Ave
   (OSM address: 4509 Knox Road). High confidence. Pulled directly from the
   City's own official parking page (fetched twice, consistent both times)
   and matched to an OSM POI whose *name* is literally "City of College Park
   Downtown Parking Garage."
3. **The Hotel at the University of Maryland Parking Garage** - 7777
   Baltimore Ave. Medium confidence. Real, well-documented private garage
   immediately on campus's edge that explicitly sells monthly public/student
   parking, but I could not pin down the actual current monthly dollar rate
   from a primary source, only the daily hotel-guest rate.
4. **Cambria College Park Garage** - 8321 Baltimore Ave. Medium confidence.
   Verified via a third-party booking listing (ParkWhiz), the hotel's own
   site, and an OSM named match, but pricing is only approximate ($10 vs
   $12/night across two sources) and no official public hours were found.

## Deliberately excluded (and why)

- **St. Andrew's Episcopal Church Lot** and **Hartwick Rd/Knox Rd lots**
  (City of College Park) - real, verifiable facilities, but the City's own
  page explicitly restricts them to "employees of Downtown area businesses"
  and "verified residents" of two specific named apartment buildings
  respectively, with a signed-lease requirement. They fail the task's
  "public, non-restricted" bar, so I left them out even though I could
  verify their existence.
- **"College Park Shopping Center Lot" / "City Hall Lot"** - a couple of
  AI-generated web-search summaries asserted these as distinct named,
  metered public lots, but I could not confirm this by directly fetching
  collegeparkmd.gov's own parking page (fetched it twice; it only documents
  the Downtown Parking Garage, St. Andrew's, Hartwick/Knox, and a small
  City Hall area with EV chargers, not a metered "Shopping Center Lot").
  Rather than trust an unverified search-summary paraphrase, I left it out.
  A human should double check this one directly with the City if it matters
  - it's plausible the shopping center's own lot has some informal
  city-enforced spaces that just aren't documented online.
- **"Discovery Lot" at 7775 Baltimore Ave** (Discovery District / COPT,
  right next to The Hotel at UMD) - shows up on SpotHero/Parkopedia with a
  daily rate (~$10.50/day) and even monthly/semester rates, and is plausibly
  a legitimate privately-operated public-facing lot. But I could not get an
  independent geocode/building match for the exact address (Nominatim only
  returned nearby road segments, not a building POI), and couldn't find an
  official operator page (only aggregator listings) to cross-check the
  name/price against. Excluded for insufficient independent verification -
  worth someone re-checking with a precise address lookup or by visiting.
- **Union on Knox garage** (4350 Knox Rd) - real underground garage next to
  campus with ground-floor retail, but I found no evidence it rents parking
  to the general public (no aggregator listing, no public rate found) -
  appears to be resident/retail-customer only. Excluded.
- **"Domain College Park" garage** - a search for public/SpotHero parking
  there returned an unrelated property in Cleveland, OH, indicating either
  no such public offering exists or my search terms collided with a
  same-named property elsewhere. Excluded rather than guess.
- **College Park Aviation Museum lot** - real, free, on-site lot, but it's
  a Prince George's County park facility roughly 1.5-2 miles from the main
  campus core (near Corporal Frank Scott Dr / Paint Branch Pkwy), likely
  outside a reasonable walking distance and not really documented anywhere
  as a "commuter alternative" to campus parking. Excluded as out of scope.
- On-street metered parking generally - excluded entirely per the task's
  instructions; I did not include any "parking is available on X street"
  generalities, only the named Downtown Parking Garage and Metro garage
  which are specific, addressable facilities.

## Flags for a human to double-check before shipping

- **Downtown Parking Garage address**: OSM's named POI gives 4509 Knox
  Road, but a couple of secondary listings (Yelp, an older Parkopedia page)
  give 7306 Yale Ave for what appears to be the same building at the
  Knox/Yale corner. I believe this is a dual-frontage address quirk rather
  than two different facilities, but it's worth a human confirming the
  exact posted street number if the app will display/link a precise
  address.
- **Downtown Parking Garage rate**: official city site says $2.00/hour
  (checked directly, Aug 2026); at least one Yelp-sourced snippet claims
  $0.75/hour "free on Sundays." I trusted the official site as current and
  authoritative, but rates can change - worth a spot check.
- **WMATA garage construction status**: as of the research date there was
  a recent (~June 15-Aug 10, 2026) Kiss & Ride closure for
  standpipe/fire-connection work, and separately I found older references
  to a longer garage rehabilitation project affecting up to ~325 spaces at a
  time. WMATA stated the main garage itself stayed open throughout the Kiss
  & Ride work, but a human should check wmata.com/service/status for any
  currently active advisory before telling users this garage is fully
  available.
- **Hotel at UMD and Cambria monthly/nightly pricing**: both are
  best-effort estimates pieced together from the operator's own site plus
  third-party booking aggregators (ParkWhiz), not a single authoritative
  rate card. Treat the dollar figures in `pricing_summary` as approximate
  and re-verify before showing a specific number to end users.

## Bottom line

4 facilities verified and included, all at medium-or-higher confidence, none
guessed. I stopped short of forcing the 5-15 target because every additional
candidate I found (Discovery Lot, Union on Knox, Domain, College Park
Shopping Center Lot, City Hall Lot) failed at least one leg of the two-signal
verification bar - per the task's own instruction, a missing entry beats a
wrong one here.
