# Entur (Ruter data)

Checked: 26.10.2026 against Entur's developer portal (developer.entur.no → Geocoder → "Migration from v2 to v3", and the Journey Planner page) and one live answer per search kind, saved trimmed in `scripts/fixtures/entur/`. Re-checked 23.11.2026 for the Ask AI tool (below): the header and endpoint pages, and one live answer each for departures, a trip and a nearest-stop question (`journey-departures.json`, `journey-trip.json`). Re-checked 24.11.2026 for the stop kinds: `stopPlaceTypes` on live answers for Oslo S, Oslo lufthavn, Aker brygge, Holmenkollen, Bergen busstasjon, Fløibanen, Moss ferjekai and Oslo bussterminal (the table below).

Two Entur services feed Home's transit card, Settings → Places and the assistant's trip planning: the **Journey Planner** (GraphQL: departures, trips, nearest stops) and the **geocoder** (place search: a typed name → stops and places). This page covers the geocoder in full; the Journey Planner's GraphQL fields are verified live by introspection before code reads them (`.claude/rules/home.md`) and described in `docs/features/home.md` (Transit).

## How we authenticate
No key. Every request sends `ET-Client-Name: lasciviens-project-daily` (Entur's `<company>-<application>` form); anonymous clients get much lower rate limits. The browser calls Entur directly; since 23.11.2026 the `claude` function calls the same two services for Ask AI's `get_transit` tool (see "Ask AI" below).

Checked 23.11.2026 on Entur's own pages (developer.entur.org → Authentication, and the Journey Planner page): the header is required ("all consumers identify themselves by using the header `ET-Client-Name`"), its form is `<company>-<application>`, and Entur "will deploy strict rate-limiting policies on API-consumers who do not identify with a header" and "reserves the right to block unidentified consumers". The pages give **no numbers**. A live answer showed the real limit for our name: `rate-limit-allowed: 1000`, `rate-limit-range: "per-minute"` (headers `rate-limit-used` / `rate-limit-available` on every answer). One endpoint: `POST https://api.entur.io/journey-planner/v3/graphql`, a JSON body with `query` and an optional `variables` object.

## Endpoints we call
| Endpoint | Called by | When | Limits |
|---|---|---|---|
| `GET https://api.entur.io/geocoder/v3/autocomplete?q=…&lang=no&limit=N&layers=stopPlace,address,street,poi,place&countries=no` | `ruterApi.searchStops` (limit 15) | each stop search (the transit card, Settings → Places, and the Add sheet's Place — 186, 03.11.2026, the same query) | a 429 says "Rate limited — wait a moment and try again" |
| `POST https://api.entur.io/journey-planner/v3/graphql` | `ruterApi` (`gql`) | departures, trips, nearest stops | — |

The query is built in one place, `geocoderQuery` in `src/features/home/api/enturGeocoder.ts` (`scripts/verify-entur-geocoder.cjs` checks it).

## Ask AI: the `get_transit` tool (23.11.2026)
Called from the `claude` function (`supabase/claude-src/transit-lookup.ts`), only for the owner's own question, on both Ask AI and the phone's question. Two hosts, both constants in code: the journey planner above and `GET https://api.entur.io/geocoder/v3/autocomplete` (`q`, `lang=no`, `limit=5`, `layers=stopPlace,address,street,poi,place`, `countries=no`). Nothing else is ever fetched; a request refuses redirects, stops after 4 s and reads at most 400 000 characters.

**Questions asked (GraphQL variables only; each query text is a constant):**
| Question | Variables | Fields read |
|---|---|---|
| `stopPlace(id)` or `quay(id)` → `estimatedCalls(startTime, timeRange 6 h, numberOfDepartures 30, includeCancelledTrips: true)` | `id`, `n`, `start` (instant), `range` | `name`; per call `realtime`, `cancellation`, `aimedDepartureTime`, `expectedDepartureTime`, `destinationDisplay.frontText`, `quay.publicCode`, `serviceJourney.line.publicCode`, `.transportMode` and `.situations { summary { value language } }` |
| `trip(from, to, numTripPatterns 3, dateTime, arriveBy)` | `from`, `to` as `Location` (`{ place: id }` or `{ coordinates: { latitude, longitude } }`), `n`, `at`, `arriveBy` | per pattern `duration`, `expectedStartTime`, `expectedEndTime`; per leg `mode`, `duration`, `line.publicCode` and `line.situations { summary { value language } }`, `fromPlace.name`, `toPlace.name`, `fromEstimatedCall` (`cancellation`, `realtime`, `aimedDepartureTime`, `expectedDepartureTime`, `quay.publicCode`, `destinationDisplay.frontText`), `toEstimatedCall` (`expectedArrivalTime`) |
| `nearest(latitude, longitude, maximumDistance 600, maximumResults 1, filterByPlaceTypes: [stopPlace])` | `lat`, `lon`, `max` | `edges[0].node.distance`, `.place.id`, `.place.name` (a saved place with only a position asks for the nearest stop) |
| the geocoder (above) | `q` only | the first usable `features[]`: `properties.id`, `names.default`, `address.locality`, `geometry.coordinates` |

**Shapes seen live, 23.11.2026 (Jernbanetorget, `NSR:StopPlace:58366`):** an `estimatedCalls` entry is `{ realtime: true, cancellation: false, aimedDepartureTime: "2026-11-23T20:58:00+01:00", expectedDepartureTime: "…20:58:21+01:00", destinationDisplay: { frontText: "Kolsås" }, quay: { id: "NSR:Quay:7184", publicCode: "2", name: "Jernbanetorget" }, serviceJourney: { line: { publicCode: "3", transportMode: "metro" } } }`. A walking leg has `line: null`, `fromEstimatedCall: null`, and Entur names a coordinate end of the trip `Origin` / `Destination` (we show our own label instead). A trip with `dateTime` and `arriveBy: false` returns trips leaving at or after that time. An unknown stop id answers `{"data":{"stopPlace":null}}` with HTTP 200.

**What the model gets:** a short prepared text, never the answer: line, vehicle kind, destination, platform, times as `HH:MM` Oslo time (a date in front only when it is not the day asked about), delay or early minutes worked out by code as the difference of the two clocks cut to whole minutes (so a bus due 21:00 that leaves 20:59:30 is "1 min early (timetable 21:00)"), `CANCELLED`, "timetable only (no live data)" when `realtime` is false (never "on time": nothing was measured), and for a trip its total duration and changes. The disruption texts of the lines shown (`situations`, the same as Home's transit card) come as a `Notices` block: English text if there is one, else the first, one escaped line of at most 140 characters, repeats once, at most 3 and how many more. At most 8 departures, 3 trips, 8 legs a trip, and the whole result is cut at 6000 characters. Nothing Entur wrote in an error (HTTP body, GraphQL `errors`, a thrown message) is passed on: a failure is one of our own sentences.

**Deliberately unused:** `severity` of a situation (Home shows it as a colour; the tool only needs the text), `presentation` colours, `streetDistance`, `via`, `walkSpeed`, wheelchair and transfer filters, `transportSubmode`, geocoder `categories` / `fareZones` / `transportModes`.

**Traps:** `trip` with `arriveBy: true` needs a time, so the tool refuses `arrive_by` without one. `estimatedCalls` is not sorted by one global time across quays the way a board is, so we sort by expected time ourselves and take the first 8 after the mode filter (we ask for 30 so a "train only" question is not starved by buses). A time at a clock change: an Oslo time that does not exist (the skipped hour) is refused, an ambiguous one takes the earlier instant. `includeCancelledTrips: true` must be asked for, or a cancelled departure silently disappears. The geocoder may answer an address or a place where a stop was meant: the answer names what was matched, and a stop id given as `NSR:StopPlace:<digits>` or `NSR:Quay:<digits>` skips the search.

**Rate:** one tool call is at most 4 requests (two places, then the question) and a chat answer has at most 8 tool calls a round, far under 1000 a minute.

**Saved places:** `user_transit_stops` is read for the verified user only (`stop_id`, `stop_name`, `label`, `lat`, `lon`, `quay_id`, `is_default`; at most 100 rows). "home" / "work" match the label exactly, or a label that holds the word ("Home stop"); any other saved label matches exactly. Departures from a saved place use its saved platform when `quay_id` is exactly `NSR:Quay:<digits>`; a trip uses the stop. An empty `from` for departures is the row with `is_default = true`. A place with only a position asks `nearest` for the stop within 600 m, and the answer does not say how far it is.

**Size and time:** a request is cut at 4 s (2 s on the phone) and when the caller's signal aborts (the chat loop and the phone abort a tool's signal when its time is up, so nothing goes on after the answer has moved on); the answer is read as a stream and cut at 400 000 bytes (`Content-Length` is checked first).

**Privacy:** the owner's saved Home and Work reach Entur only as a stop id or a position (6 decimals); the result names them by label, never by position or distance, and no test or doc uses a real place (made-up: Jernbanetorget and Karl Johans gate 1, which are public).

## Fields we read and write
| Field | Shape seen (26.10.2026) | Where it goes |
|---|---|---|
| `features[].properties.id` | `NSR:StopPlace:58366` for a stop; `KVE:TopographicPlace:…`, `KVE:PostalAddress:…`, `OSM:TopographicPlace:…` otherwise | `GeoPlace.id`; an `NSR:StopPlace:<digits>` id makes it a stop (`layer: 'venue'`) |
| `properties.names.default` (fallback `names.display`) | `"Jernbanetorget"`, `"Karl Johans gate 1"` | `GeoPlace.name` |
| `properties.address.locality` (fallback `address.county`) | `"Oslo"` | `GeoPlace.locality` |
| `properties.layer` | `stopPlace`, `address`, `street`, `poi`, `place`, `groupOfStopPlaces` | `GeoPlace.layer`: a stop → `venue`; `street` → `street`; the others → `address` (the app's names since v1, so the screens didn't change) |
| `properties.stopPlaceTypes` | `["onstreetBus","onstreetTram","metroStation"]` (stops only) | `GeoPlace.category` in plain words (`stopKinds`, the table below): the two most important, joined with ", ": "Metro station, Tram stop" |
| `geometry.coordinates` | `[lon, lat]` (GeoJSON order) | `GeoPlace.lat` / `lon`; a place that isn't a stop is kept only with a point. An item's place keeps them (6 decimals) for Apple's map pin (`items/itemPlace.placeFromGeo`) |

Nothing is written to Entur. Saved stops (`user_transit_stops`) keep their `NSR:StopPlace` ids, which v3 did not change.

## Stop kinds (`stopPlaceTypes` → words)
The search list shows a stop's town and kinds ("Oslo · Train station, Bus stop"), never Entur's codes (owner, 24.11.2026: the list showed "onstreetBus, railStation"). This table is the source of truth: `STOP_KIND` in `enturGeocoder.ts` holds the same rows in the same order (the order the words are shown), and `verify-entur-geocoder` compares the two. A code not on it (and `other`) is dropped, so a stop with only those shows its town alone. At most the first two words are shown (a phone's list has room for two): Oslo lufthavn reads "Airport, Train station". A trimmed live answer for Oslo S and Oslo lufthavn is `scripts/fixtures/entur/geocoder-v3-stop-kinds.json`. The values are NeTEx's stop types; "live" marks the ones seen in an answer on 24.11.2026, the others are from the same list and not yet seen.

| Code | Shown as | Seen |
|---|---|---|
| `airport` | Airport | live (Oslo lufthavn) |
| `railStation` | Train station | live (Oslo S) |
| `metroStation` | Metro station | live (Holmenkollen) |
| `tramStation` | Tram station | — |
| `busStation` | Bus station | live (Oslo bussterminal) |
| `coachStation` | Coach station | — |
| `ferryPort` | Ferry port | — |
| `harbourPort` | Ferry terminal | live (Moss ferjekai) |
| `ferryStop` | Ferry stop | live (Aker brygge) |
| `liftStation` | Cable car | — |
| `vehicleRailInterchange` | Car train | — |
| `onstreetTram` | Tram stop | live (Aker brygge) |
| `onstreetBus` | Bus stop | live (Oslo S) |
| `other` | (dropped) | live (Fløibanen) |

## Fields we deliberately don't use
`names.label`, `source`, `stopPlaceRole`, `transportModes`, `fareZones`, `categories` (OSM tags), the `address.*Id` fields, `metadata` and `bbox`: nothing on screen needs them. `custom-poi` results are skipped (unknown layer).

## Traps
- `countries` takes lowercase alpha-2: `countries=no` works, `countries=NOR` returns **no results and no error** (live, 26.10.2026).
- v3 renamed the parameters: `text` → `q`, `size` → `limit`, `boundary.country` → `countries`; the layer `venue` is now `stopPlace`, and v1's `address` layer is split into `address`, `street`, `poi`, `place` and `groupOfStopPlaces`. A v1 value sent to v3 matches nothing, silently.
- Per Entur's migration page, addresses with a house number appear only when the query has a digit (or `sources` names the address register); stops and named places don't need one.
- v3 ranks by importance a little more than v1 did, so the order of results can differ from before.
- `sources=nsr` was too strict for partial stop names in v1; v3 search uses no `sources` filter.

## Log
### 24.11.2026 — readable stop kinds
The stop search showed the raw `stopPlaceTypes` ("onstreetBus, railStation") and its list was cut off by the card around the field. The parser now maps the codes to words from the table above; the list is anchored (portalled) so it is never clipped.

### 26.10.2026 — geocoder v1 → v3
v1/v2 deprecated on 12.06.2026 (no end date announced). Moved the browser's stop search (and the old `ai-proxy`'s two searches, removed in AI phase 5) to v3 through one pure block (`enturGeocoder.ts`), checked against live answers for a stop and an address. Saved stops are unaffected (same NSR ids).
