/**
 * Transit Map — Central Configuration
 *
 * ALL tunable values live here. When something breaks or needs adjusting,
 * this is the only file you need to touch for config-level changes.
 *
 * To remove the map feature entirely:
 *   1. Delete src/features/home/components/ruter/map/
 *   2. Remove <TransitMapPanel> from DeparturesTab.tsx
 *   3. Run `npm uninstall leaflet react-leaflet @types/leaflet`
 */

// ─── Tile Provider ────────────────────────────────────────────────────────────
// Kartverket = Norwegian Mapping Authority.
// Official Norwegian maps, completely free, no API key, no rate limit.
// Alternatives (swap the URL if Kartverket ever goes down):
//   OpenStreetMap:  'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
//   OpenTopoMap:    'https://tile.opentopomap.org/{z}/{x}/{y}.png'
export const TILE_URL =
  'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

export const TILE_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

// ─── Map Defaults ─────────────────────────────────────────────────────────────
// Oslo S as fallback when no stop is selected / GPS unavailable
export const DEFAULT_CENTER: [number, number] = [59.9127, 10.7461]
export const DEFAULT_ZOOM   = 15
export const STOP_ZOOM      = 16   // zoom when flying to a selected stop
export const WIDGET_ZOOM    = 15   // zoom for the small in-widget map

// ─── EnTur Vehicles API ───────────────────────────────────────────────────────
// Real-time vehicle positions (bus/tram/metro) from EnTur.
// REST endpoint — no WebSocket needed for polling.
// Docs: https://developer.entur.org/pages-real-time-vehicle/
export const VEHICLES_REST_URL = 'https://api.entur.io/realtime/v2/vehicles/graphql'

// ET-Client-Name must match the value used in ruterApi.ts
export const ET_CLIENT_NAME = 'lasciviens-project-daily'

// ─── Ruter (Oslo) ─────────────────────────────────────────────────────────────
// Ruter's operator codespace in the EnTur system.
// Change to 'SKY' for Skyss (Bergen), 'BRA' for Brakar, etc.
export const RUTER_CODESPACE = 'RUT'

// ─── Polling ──────────────────────────────────────────────────────────────────
// How often to re-fetch vehicle positions (milliseconds).
// EnTur updates every ~15 s; polling faster than that wastes bandwidth.
export const POLL_INTERVAL_MS = 15_000

// How many seconds a vehicle entry stays in state after the last update
// before being removed (vehicles that disappear from the feed).
export const VEHICLE_STALE_AFTER_MS = 60_000

// ─── Bounding Box Padding ─────────────────────────────────────────────────────
// How far around the selected stop to fetch vehicles (decimal degrees).
// 0.015° ≈ 1.1 km.  Increase if you want more vehicles visible.
export const BBOX_PADDING_DEG = 0.015

// ─── Vehicle Marker Colors ────────────────────────────────────────────────────
// Delay thresholds (seconds) that decide marker color.
export const DELAY_THRESHOLDS = {
  onTime: 60,    // ≤60 s late → green
  slight: 180,   // ≤180 s late → amber
                 // >180 s late → red
}

export const VEHICLE_COLORS = {
  onTime:  '#16A34A',  // green-600
  slight:  '#D97706',  // amber-600
  late:    '#DC2626',  // red-600
  noGPS:   '#94A3B8',  // slate-400  (monitored = false)
}

// ─── Stop Marker ──────────────────────────────────────────────────────────────
export const STOP_MARKER_COLOR   = '#E8112D'  // Ruter red
export const STOP_MARKER_RADIUS  = 8           // px

// ─── User Location Marker ────────────────────────────────────────────────────
export const USER_LOCATION_COLOR = '#2563EB'  // blue-600
