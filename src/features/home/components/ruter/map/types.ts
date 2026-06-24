// ─── Vehicle position ────────────────────────────────────────────────────────
export interface VehiclePosition {
  vehicleId:        string
  publicCode:       string
  lineRef:          string
  latitude:         number
  longitude:        number
  bearing?:         number
  delay?:           number            // seconds, negative = early
  destinationName?: string
  monitored:        boolean
  lastSeenAt:       number            // Date.now() stamp
}

// ─── Stop pin ────────────────────────────────────────────────────────────────
export interface StopPin {
  id:   string   // NSR:StopPlace:... or NSR:Quay:...
  name: string
  lat:  number
  lon:  number
}

// ─── Route stop (from serviceJourney.passingTimes) ───────────────────────────
export interface RouteStop {
  name: string
  lat:  number
  lon:  number
}

// ─── What vehicles to fetch — three modes ────────────────────────────────────
// stop    → bbox around the stop (area overview)
// journey → all vehicles on a line (lineRef); serviceJourneyId is for route polyline only
// bbox    → explicit bounding box (route overview in Routes tab)
export type VehicleTarget =
  | { kind: 'stop';    stop: StopPin }
  | { kind: 'journey'; serviceJourneyId: string; lineRef: string }
  | { kind: 'bbox';    minLat: number; minLon: number; maxLat: number; maxLon: number }
  | null

// ─── Raw EnTur Vehicles API response ────────────────────────────────────────
export interface RawVehicle {
  vehicleId: string
  line: { lineRef: string; publicCode: string } | null
  location: { latitude: number; longitude: number } | null
  bearing?:         number
  delay?:           number
  destinationName?: string
  monitored:        boolean
}

export interface VehiclesApiResponse {
  data?: { vehicles: RawVehicle[] | null }
}
