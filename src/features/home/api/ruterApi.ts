// EnTur JourneyPlanner v3 GraphQL + Pelias geocoder
// Docs: https://developer.entur.org/pages-journeyplanner-journeyplanner/
// ET-Client-Name is required — anonymous clients get aggressive rate limits.
const JOURNEY  = 'https://api.entur.io/journey-planner/v3/graphql'
const GEOCODER = 'https://api.entur.io/geocoder/v1/autocomplete'
const CLIENT   = 'lasciviens-project-daily'

// ─── Types ────────────────────────────────────────────────────────────────────

export type TransportMode = 'bus' | 'tram' | 'metro' | 'rail' | 'ferry' | 'foot' | 'water' | string

export interface StopResult {
  id:        string   // NSR:StopPlace:...
  name:      string
  locality?: string   // city/municipality e.g. "Oslo"
  category?: string   // onstreetBus, metroStation, railStation, etc.
  lat?:      number
  lon?:      number
}

export interface Departure {
  line:             string
  transport:        string
  destination:      string          // destinationDisplay.frontText — primary direction indicator
  aimed:            string          // ISO datetime
  expected:         string          // ISO datetime
  realtime:         boolean
  quayCode?:        string
  quayName?:        string
  quayDescription?: string          // e.g. "mot Oslo"
}

export interface TripLeg {
  mode:             string          // TransportMode
  duration:         number          // seconds
  distance:         number          // meters
  from:             string          // fromPlace.name
  to:               string          // toPlace.name
  // present only on transit legs (not foot):
  line?:            string          // publicCode
  lineName?:        string          // line.name
  destination?:     string          // destinationDisplay.frontText
  departure?:       string          // expected departure ISO
  aimed?:           string          // aimed departure ISO
  realtime?:        boolean
  quayCode?:        string
  quayName?:        string
  quayDescription?: string
  arrivalTime?:     string          // expected arrival at toPlace ISO
}

export interface TripPattern {
  duration:     number              // seconds, total journey
  walkDistance: number              // meters, total walking
  departure:    string              // ISO, expected start
  arrival:      string              // ISO, expected end
  legs:         TripLeg[]
}

// A route endpoint: either a saved stop or the user's live coordinates.
// Coordinates are never stored — used only as a temporary trip query input.
export type TransitPlace =
  | { kind: 'stop';   id: string; name: string }
  | { kind: 'coords'; lat: number; lon: number; name: string }

// ─── Constants ────────────────────────────────────────────────────────────────

export const TRANSPORT_ICON: Record<string, string> = {
  bus: '🚌', tram: '🚊', metro: '🚇', rail: '🚂',
  ferry: '⛴', water: '⛴', foot: '🚶',
}

export const TRANSPORT_COLOR: Record<string, string> = {
  bus:   'bg-blue-100 text-blue-800',
  tram:  'bg-green-100 text-green-800',
  metro: 'bg-purple-100 text-purple-800',
  rail:  'bg-gray-100 text-gray-800',
  ferry: 'bg-cyan-100 text-cyan-800',
  foot:  'bg-ink-100 text-ink-600',
}

// ─── GraphQL helper ───────────────────────────────────────────────────────────

async function gql(query: string): Promise<unknown> {
  const res = await fetch(JOURNEY, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'ET-Client-Name': CLIENT },
    body:    JSON.stringify({ query }),
  })

  if (res.status === 429) throw new Error('Rate limited — wait a moment and try again')
  if (!res.ok) throw new Error(`EnTur ${res.status}`)

  const json = await res.json() as { data?: unknown; errors?: { message: string }[] }

  // GraphQL returns HTTP 200 even for schema errors; errors coexist with partial data
  if (json.errors?.length) {
    const msg = json.errors.map(e => e.message).join(' | ')
    console.error('[EnTur GraphQL]', msg)
    throw new Error(msg)
  }

  return json.data
}

// ─── Stop search ──────────────────────────────────────────────────────────────

// venue+address layers without sources filter gives broader results.
// sources=nsr was too strict — partial queries like "sinsen" returned nothing.
export async function searchStops(query: string): Promise<StopResult[]> {
  const params = new URLSearchParams({
    text:             query,
    lang:             'no',
    size:             '15',
    layers:           'venue,address',
    'boundary.country': 'NOR',
  })
  const url = `${GEOCODER}?${params.toString()}`
  const res = await fetch(url, { headers: { 'ET-Client-Name': CLIENT } })

  if (res.status === 429) throw new Error('Rate limited — wait a moment and try again')
  if (!res.ok) throw new Error(`Geocoder ${res.status}`)

  const json = await res.json() as {
    features?: {
      properties: {
        id?:       string
        name?:     string
        label?:    string
        locality?: string
        county?:   string
        category?: string
        layer?:    string
      }
      geometry?: { coordinates?: [number, number] }
    }[]
  }

  console.debug('[Entur geocoder]', query, (json.features ?? []).map(f => ({
    id: f.properties.id, name: f.properties.name, layer: f.properties.layer,
  })))

  return (json.features ?? [])
    .filter(f => f.properties.id?.startsWith('NSR:StopPlace:'))
    .map(f => ({
      id:       f.properties.id!,
      name:     f.properties.name ?? f.properties.label ?? '',
      locality: f.properties.locality ?? f.properties.county,
      category: f.properties.category ?? f.properties.layer,
      lat:      f.geometry?.coordinates?.[1],
      lon:      f.geometry?.coordinates?.[0],
    }))
}

// ─── Departures ───────────────────────────────────────────────────────────────

export async function fetchDepartures(
  stopId: string,
  count?: number,
): Promise<{ stopName: string; departures: Departure[] }> {
  const n = count ?? 12
  const data = await gql(`{
    stopPlace(id: "${stopId}") {
      name
      estimatedCalls(timeRange: 72100, numberOfDepartures: ${n}) {
        realtime
        aimedDepartureTime
        expectedDepartureTime
        destinationDisplay { frontText }
        quay { publicCode name description }
        serviceJourney {
          line { publicCode transportMode }
        }
      }
    }
  }`) as {
    stopPlace: {
      name: string
      estimatedCalls: {
        realtime:              boolean
        aimedDepartureTime:    string
        expectedDepartureTime: string
        destinationDisplay:    { frontText: string }
        quay?: { publicCode?: string; name?: string; description?: string }
        serviceJourney:        { line: { publicCode: string; transportMode: string } }
      }[]
    } | null
  }

  if (!data.stopPlace) throw new Error(`Stop not found: ${stopId}`)

  const departures: Departure[] = (data.stopPlace.estimatedCalls ?? []).map(c => ({
    line:             c.serviceJourney.line.publicCode,
    transport:        c.serviceJourney.line.transportMode,
    destination:      c.destinationDisplay.frontText,
    aimed:            c.aimedDepartureTime,
    expected:         c.expectedDepartureTime,
    realtime:         c.realtime,
    quayCode:         c.quay?.publicCode,
    quayName:         c.quay?.name,
    quayDescription:  c.quay?.description,
  }))

  return { stopName: data.stopPlace.name, departures }
}

// ─── Trip planner ─────────────────────────────────────────────────────────────

// Builds the GraphQL `from`/`to` input depending on whether it's a stop or coords.
function gqlPlace(p: TransitPlace): string {
  if (p.kind === 'stop') return `{ place: "${p.id}" }`
  return `{ coordinates: { latitude: ${p.lat}, longitude: ${p.lon} } }`
}

export async function fetchTrips(
  from:   TransitPlace,
  to:     TransitPlace,
  count?: number,
): Promise<TripPattern[]> {
  const n = count ?? 5
  const data = await gql(`{
    trip(
      from: ${gqlPlace(from)}
      to:   ${gqlPlace(to)}
      numTripPatterns: ${n}
    ) {
      tripPatterns {
        duration
        walkDistance
        expectedStartTime
        expectedEndTime
        legs {
          mode
          duration
          distance
          fromPlace { name }
          toPlace   { name }
          line {
            publicCode
            name
            transportMode
          }
          fromEstimatedCall {
            quay { publicCode name description }
            aimedDepartureTime
            expectedDepartureTime
            realtime
            destinationDisplay { frontText }
          }
          toEstimatedCall {
            quay { publicCode name }
            expectedArrivalTime
          }
        }
      }
    }
  }`) as {
    trip: {
      tripPatterns: {
        duration:          number | null
        walkDistance:      number | null
        expectedStartTime: string
        expectedEndTime:   string
        legs: {
          mode:     string
          duration: number | null
          distance: number | null
          fromPlace: { name: string }
          toPlace:   { name: string }
          line?: { publicCode: string; name: string; transportMode: string } | null
          fromEstimatedCall?: {
            quay?: { publicCode?: string; name?: string; description?: string } | null
            aimedDepartureTime:    string
            expectedDepartureTime: string
            realtime:              boolean
            destinationDisplay:    { frontText: string }
          } | null
          toEstimatedCall?: {
            quay?: { publicCode?: string; name?: string } | null
            expectedArrivalTime: string
          } | null
        }[]
      }[]
    }
  }

  return (data.trip?.tripPatterns ?? []).map(p => ({
    duration:     p.duration     ?? 0,
    walkDistance: p.walkDistance ?? 0,
    departure:    p.expectedStartTime,
    arrival:      p.expectedEndTime,
    legs: p.legs.map(l => {
      const leg: TripLeg = {
        mode:     l.mode,
        duration: l.duration ?? 0,
        distance: l.distance ?? 0,
        from:     l.fromPlace.name,
        to:       l.toPlace.name,
      }
      if (l.line) {
        leg.line        = l.line.publicCode
        leg.lineName    = l.line.name
      }
      if (l.fromEstimatedCall) {
        leg.destination      = l.fromEstimatedCall.destinationDisplay.frontText
        leg.departure        = l.fromEstimatedCall.expectedDepartureTime
        leg.aimed            = l.fromEstimatedCall.aimedDepartureTime
        leg.realtime         = l.fromEstimatedCall.realtime
        leg.quayCode         = l.fromEstimatedCall.quay?.publicCode
        leg.quayName         = l.fromEstimatedCall.quay?.name
        leg.quayDescription  = l.fromEstimatedCall.quay?.description
      }
      if (l.toEstimatedCall) {
        leg.arrivalTime = l.toEstimatedCall.expectedArrivalTime
      }
      return leg
    }),
  }))
}
