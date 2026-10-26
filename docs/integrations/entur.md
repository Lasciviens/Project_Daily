# EnTur (Ruter data)

Checked: 26.10.2026 against EnTur's developer portal (developer.entur.no → Geocoder → "Migration from v2 to v3", and the Journey Planner page) and one live answer per search kind, saved trimmed in `scripts/fixtures/entur/`.

Two EnTur services feed Home's transit card, Settings → Places and the assistant's trip planning: the **Journey Planner** (GraphQL: departures, trips, nearest stops) and the **geocoder** (place search: a typed name → stops and places). This page covers the geocoder in full; the Journey Planner's GraphQL fields are verified live by introspection before code reads them (`.claude/rules/home.md`) and described in `docs/features/home.md` (Transit).

## How we authenticate
No key. Every request sends `ET-Client-Name: lasciviens-project-daily` (EnTur's `<company>-<application>` form); anonymous clients get much lower rate limits. The browser calls EnTur directly; `ai-proxy` calls the same endpoints for the assistant.

## Endpoints we call
| Endpoint | Called by | When | Limits |
|---|---|---|---|
| `GET https://api.entur.io/geocoder/v3/autocomplete?q=…&lang=no&limit=N&layers=stopPlace,address,street,poi,place&countries=no` | `ruterApi.searchStops` (limit 15), `ai-proxy` `geocodeCandidates` (the asked size) and `searchTransitStops` (8) | each stop search; the assistant's plan_trip and search_transit_stops | a 429 says "Rate limited — wait a moment and try again" |
| `POST https://api.entur.io/journey-planner/v3/graphql` | `ruterApi` (`gql`), `ai-proxy` | departures, trips, nearest stops | — |

The query is built in one place, `geocoderQuery` in `src/features/home/api/enturGeocoder.ts`; its `<entur-geocoder>` block is copied verbatim into `ai-proxy` (`scripts/verify-entur-geocoder.cjs` compares them).

## Fields we read and write
| Field | Shape seen (26.10.2026) | Where it goes |
|---|---|---|
| `features[].properties.id` | `NSR:StopPlace:58366` for a stop; `KVE:TopographicPlace:…`, `KVE:PostalAddress:…`, `OSM:TopographicPlace:…` otherwise | `GeoPlace.id`; an `NSR:StopPlace:<digits>` id makes it a stop (`layer: 'venue'`) |
| `properties.names.default` (fallback `names.display`) | `"Jernbanetorget"`, `"Karl Johans gate 1"` | `GeoPlace.name` |
| `properties.address.locality` (fallback `address.county`) | `"Oslo"` | `GeoPlace.locality` |
| `properties.layer` | `stopPlace`, `address`, `street`, `poi`, `place`, `groupOfStopPlaces` | `GeoPlace.layer`: a stop → `venue`; `street` → `street`; the others → `address` (the app's names since v1, so the screens didn't change) |
| `properties.stopPlaceTypes` | `["onstreetBus","onstreetTram","metroStation"]` (stops only) | `GeoPlace.category`, joined with ", " |
| `geometry.coordinates` | `[lon, lat]` (GeoJSON order) | `GeoPlace.lat` / `lon`; a place that isn't a stop is kept only with a point |

Nothing is written to EnTur. Saved stops (`user_transit_stops`) keep their `NSR:StopPlace` ids, which v3 did not change.

## Fields we deliberately don't use
`names.label`, `source`, `stopPlaceRole`, `transportModes`, `fareZones`, `categories` (OSM tags), the `address.*Id` fields, `metadata` and `bbox`: nothing on screen needs them. `custom-poi` results are skipped (unknown layer).

## Traps
- `countries` takes lowercase alpha-2: `countries=no` works, `countries=NOR` returns **no results and no error** (live, 26.10.2026).
- v3 renamed the parameters: `text` → `q`, `size` → `limit`, `boundary.country` → `countries`; the layer `venue` is now `stopPlace`, and v1's `address` layer is split into `address`, `street`, `poi`, `place` and `groupOfStopPlaces`. A v1 value sent to v3 matches nothing, silently.
- Per EnTur's migration page, addresses with a house number appear only when the query has a digit (or `sources` names the address register); stops and named places don't need one.
- v3 ranks by importance a little more than v1 did, so the order of results can differ from before.
- `sources=nsr` was too strict for partial stop names in v1; v3 search uses no `sources` filter.

## Log
### 26.10.2026 — geocoder v1 → v3
v1/v2 deprecated on 12.06.2026 (no end date announced). Moved the browser's stop search and `ai-proxy`'s two searches to v3 through one pure block (`enturGeocoder.ts`, mirrored in `ai-proxy`), checked against live answers for a stop and an address. Saved stops are unaffected (same NSR ids).
