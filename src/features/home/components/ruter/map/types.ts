/**
 * Transit Map — TypeScript Types
 *
 * All shared types for the map module.  Import from here, not from
 * individual component files, so refactoring stays in one place.
 */

// ─── Vehicle position received from EnTur Vehicles API ───────────────────────
export interface VehiclePosition {
  vehicleId:        string            // unique vehicle identifier
  publicCode:       string            // line number shown to passengers e.g. "23"
  lineRef:          string            // internal line ID e.g. "RUT:Line:23"
  latitude:         number
  longitude:        number
  bearing?:         number            // heading in degrees (0 = north, 90 = east)
  delay?:           number            // seconds behind schedule (negative = early)
  destinationName?: string            // front sign text
  monitored:        boolean           // false when GPS signal is lost
  lastSeenAt:       number            // Date.now() of the last update we received
}

// ─── A transit stop to pin on the map ────────────────────────────────────────
export interface StopPin {
  id:   string   // NSR:StopPlace:... or NSR:Quay:...
  name: string
  lat:  number
  lon:  number
}

// ─── Raw response shape from the EnTur Vehicles GraphQL endpoint ─────────────
// Mirrors the exact JSON structure so we can type the fetch result.
export interface RawVehicle {
  vehicleId: string
  line: {
    lineRef:    string
    publicCode: string
  } | null
  location: {
    latitude:  number
    longitude: number
  } | null
  bearing?:         number
  delay?:           number
  destinationName?: string
  monitored:        boolean
}

export interface VehiclesApiResponse {
  data: {
    vehicles: RawVehicle[]
  }
}

// ─── Props for the public-facing map panel ───────────────────────────────────
export interface TransitMapPanelProps {
  /** The stop that's currently selected in DeparturesTab */
  stop: StopPin | null
  /** Height of the map area in px (default: 220) */
  height?: number
  /** Called when the user clicks a nearby stop pin on the map */
  onStopClick?: (stop: StopPin) => void
}
