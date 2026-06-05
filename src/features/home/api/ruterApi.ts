const JOURNEY  = 'https://api.entur.io/journey-planner/v3/graphql'
const GEOCODER = 'https://api.entur.io/geocoder/v1/autocomplete'
const CLIENT   = 'lascis-board'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Departure {
  line:        string
  transport:   string
  destination: string
  aimed:       string   // ISO datetime
  expected:    string   // ISO datetime
  realtime:    boolean
  platform?:   string
  // quay description from Entur often contains direction, e.g. "Retning sentrum"
  direction?:  string
}

export interface StopResult {
  id:   string
  name: string
}

export interface TripLeg {
  mode:       string
  line:       string
  departure:  string   // ISO datetime (expected)
  aimed:      string   // ISO datetime (aimed)
  from:       string
  to:         string
}

export interface TripPattern {
  duration:  number   // seconds
  departure: string   // ISO datetime
  arrival:   string   // ISO datetime
  legs:      TripLeg[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const TRANSPORT_ICON: Record<string, string> = {
  bus: '🚌', tram: '🚊', metro: '🚇', rail: '🚂', ferry: '⛴', water: '⛴', foot: '🚶',
}

// Visperud: confirmed via https://reise.frammr.no/departures/NSR:StopPlace:5492
// Sinsenveien: NSR:StopPlace:58221 — bus stop on lines 23/31, nearest to Sinsenveien 47D (0585 Oslo)
//   (not to be confused with Sinsenkrysset NSR:StopPlace:6039, which is a different stop)
// User can override route stops via the Routes tab search
export const DEFAULT_STOP: StopResult = {
  id:   'NSR:StopPlace:5492',
  name: 'Visperud',
}

export const PRESET_ROUTES: { label: string; from: StopResult; to: StopResult }[] = [
  {
    label: '🏠 Home',
    from:  { id: 'NSR:StopPlace:58221', name: 'Sinsenveien' },
    to:    { id: 'NSR:StopPlace:5492',  name: 'Visperud' },
  },
  {
    label: '💼 Work',
    from:  { id: 'NSR:StopPlace:5492',  name: 'Visperud' },
    to:    { id: 'NSR:StopPlace:58221', name: 'Sinsenveien' },
  },
]

// ─── Departures ───────────────────────────────────────────────────────────────

// quay.description from Entur often holds direction text, e.g. "Mot sentrum"
// We surface it as a direction label next to the departure line.
export async function fetchDepartures(
  stopId: string,
  count = 10
): Promise<{ stopName: string; departures: Departure[] }> {
  const query = `{
    stopPlace(id: "${stopId}") {
      name
      estimatedCalls(timeRange: 72100, numberOfDepartures: ${count}) {
        realtime
        aimedDepartureTime
        expectedDepartureTime
        quay { publicCode description name }
        serviceJourney { line { publicCode transportMode } }
        destinationDisplay { frontText }
      }
    }
  }`
  const res = await fetch(JOURNEY, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'ET-Client-Name': CLIENT },
    body:    JSON.stringify({ query }),
  })
  if (!res.ok) throw new Error(`Entur ${res.status}`)
  const json = await res.json()
  const stop = json.data?.stopPlace
  if (!stop) throw new Error('Stop not found')

  const departures: Departure[] = (stop.estimatedCalls ?? []).map((c: {
    realtime: boolean
    aimedDepartureTime: string
    expectedDepartureTime: string
    quay?: { publicCode?: string; description?: string; name?: string }
    serviceJourney: { line: { publicCode: string; transportMode: string } }
    destinationDisplay: { frontText: string }
  }) => ({
    line:        c.serviceJourney.line.publicCode,
    transport:   c.serviceJourney.line.transportMode,
    destination: c.destinationDisplay.frontText,
    aimed:       c.aimedDepartureTime,
    expected:    c.expectedDepartureTime,
    realtime:    c.realtime,
    platform:    c.quay?.publicCode,
    // Prefer quay description (direction) over quay name; both may be undefined
    direction:   c.quay?.description ?? c.quay?.name,
  }))

  return { stopName: stop.name, departures }
}

// ─── Stop search ─────────────────────────────────────────────────────────────

export async function searchStops(query: string): Promise<StopResult[]> {
  const res = await fetch(
    `${GEOCODER}?text=${encodeURIComponent(query)}&lang=no&size=6&layers=venue`,
    { headers: { 'ET-Client-Name': CLIENT } }
  )
  if (!res.ok) throw new Error(`Geocoder ${res.status}`)
  const json = await res.json()
  return (json.features ?? []).map((f: { properties: { id: string; name: string } }) => ({
    id:   f.properties.id,
    name: f.properties.name,
  }))
}

// ─── Trip planner ─────────────────────────────────────────────────────────────

// Returns next N trip patterns between two stops using Entur journey planner.
// Each pattern may include multiple legs (transfers).
export async function fetchTrips(
  fromId: string,
  toId:   string,
  count = 5
): Promise<TripPattern[]> {
  const query = `{
    trip(
      from: { place: "${fromId}" }
      to:   { place: "${toId}" }
      numTripPatterns: ${count}
    ) {
      tripPatterns {
        duration
        expectedStartTime
        expectedEndTime
        legs {
          mode
          fromPlace { name }
          toPlace { name }
          fromEstimatedCall {
            aimedDepartureTime
            expectedDepartureTime
          }
          line { publicCode transportMode }
        }
      }
    }
  }`
  const res = await fetch(JOURNEY, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'ET-Client-Name': CLIENT },
    body:    JSON.stringify({ query }),
  })
  if (!res.ok) throw new Error(`Entur trip ${res.status}`)
  const json = await res.json()
  const patterns = json.data?.trip?.tripPatterns ?? []

  return patterns.map((p: {
    duration: number
    expectedStartTime: string
    expectedEndTime: string
    legs: {
      mode: string
      fromPlace: { name: string }
      toPlace:   { name: string }
      fromEstimatedCall?: { aimedDepartureTime: string; expectedDepartureTime: string }
      line?: { publicCode: string; transportMode: string }
    }[]
  }) => ({
    duration:  p.duration,
    departure: p.expectedStartTime,
    arrival:   p.expectedEndTime,
    legs: p.legs.map(l => ({
      mode:      l.mode,
      line:      l.line?.publicCode ?? '',
      departure: l.fromEstimatedCall?.expectedDepartureTime ?? p.expectedStartTime,
      aimed:     l.fromEstimatedCall?.aimedDepartureTime    ?? p.expectedStartTime,
      from:      l.fromPlace.name,
      to:        l.toPlace.name,
    })),
  }))
}
