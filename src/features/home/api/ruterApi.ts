// EnTur JourneyPlanner v3 GraphQL + Pelias geocoder
// Docs: https://developer.entur.org/pages-journeyplanner-journeyplanner/
// ET-Client-Name is required — anonymous clients get aggressive rate limits.
const JOURNEY  = 'https://api.entur.io/journey-planner/v3/graphql'
const GEOCODER = 'https://api.entur.io/geocoder/v1/autocomplete'
const CLIENT   = 'lasciviens-project-daily'

// ─── Types ────────────────────────────────────────────────────────────────────

export type TransportMode = 'bus' | 'tram' | 'metro' | 'rail' | 'ferry' | 'foot' | 'water' | string

export interface StopResult {
  id:        string   // NSR:StopPlace:... for transit stops, or address provider id
  name:      string
  locality?: string   // city/municipality e.g. "Oslo"
  category?: string   // onstreetBus, metroStation, railStation, etc.
  layer?:    string   // 'venue' = transit stop, 'address' / 'street' = address
  lat?:      number
  lon?:      number
}

export interface Departure {
  line:              string
  transport:         string
  destination:       string          // destinationDisplay.frontText — primary direction indicator
  aimed:             string          // ISO datetime
  expected:          string          // ISO datetime
  realtime:          boolean
  quayCode?:         string
  quayName?:         string
  quayDescription?:  string          // e.g. "mot Oslo"
  lineColour?:       string          // hex without #, from line.presentation.colour
  lineTextColour?:   string          // hex without #, from line.presentation.textColour
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
  lineColour?:      string          // hex without #, from line.presentation.colour
  lineTextColour?:  string          // hex without #, from line.presentation.textColour
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

  if (import.meta.env.DEV) {
    console.debug('[Entur geocoder]', query, (json.features ?? []).map(f => ({
      id: f.properties.id, name: f.properties.name, layer: f.properties.layer,
    })))
  }

  return (json.features ?? [])
    .filter(f => {
      // Keep transit stops (NSR:StopPlace) and address/street results that have coordinates
      const isStop    = f.properties.id?.startsWith('NSR:StopPlace:')
      const isAddress = f.properties.layer === 'address' || f.properties.layer === 'street'
      const hasCoords = f.geometry?.coordinates?.length === 2
      return isStop || (isAddress && hasCoords)
    })
    .map(f => ({
      id:       f.properties.id ?? '',
      name:     f.properties.name ?? f.properties.label ?? '',
      locality: f.properties.locality ?? f.properties.county,
      category: f.properties.category,
      layer:    f.properties.layer,
      lat:      f.geometry?.coordinates?.[1],
      lon:      f.geometry?.coordinates?.[0],
    }))
}

// ─── Stop quay directions ─────────────────────────────────────────────────────

export interface QuayDirectionHint {
  quayId:      string
  publicCode?: string | null
  description?: string | null   // e.g. "mot Oslo S" — from quay.description
  fallback?:   string | null    // "mot " + frontText when description is null
  lines:       string[]         // line codes serving this quay e.g. ["31", "32"]
}

// Fetches direction hints for a stop without loading full departure times.
// Uses numberOfDeparturesPerLineAndDestinationDisplay:1 to get one call per
// unique line+direction combo — much lighter than fetching all departures.
export async function fetchStopDirections(stopId: string): Promise<QuayDirectionHint[]> {
  const data = await gql(`{
    stopPlace(id: "${stopId}") {
      estimatedCalls(
        timeRange: 86400
        numberOfDepartures: 20
      ) {
        quay { id publicCode description }
        destinationDisplay { frontText }
        serviceJourney { line { publicCode } }
      }
    }
  }`) as {
    stopPlace: {
      estimatedCalls: {
        quay?: { id?: string; publicCode?: string; description?: string } | null
        destinationDisplay?: { frontText?: string } | null
        serviceJourney?:     { line?: { publicCode?: string } | null } | null
      }[]
    } | null
  }

  const calls   = data.stopPlace?.estimatedCalls ?? []
  const byQuay  = new Map<string, QuayDirectionHint>()

  for (const call of calls) {
    const quay      = call.quay
    const lineCode  = call.serviceJourney?.line?.publicCode
    const frontText = call.destinationDisplay?.frontText
    if (!quay?.id) continue

    if (!byQuay.has(quay.id)) {
      byQuay.set(quay.id, {
        quayId:      quay.id,
        publicCode:  quay.publicCode ?? null,
        description: quay.description ?? null,
        // When description is null use frontText as a readable fallback
        fallback:    !quay.description && frontText ? `mot ${frontText}` : null,
        lines:       lineCode ? [lineCode] : [],
      })
    } else {
      const existing = byQuay.get(quay.id)!
      if (lineCode && !existing.lines.includes(lineCode)) existing.lines.push(lineCode)
    }
  }

  return [...byQuay.values()]
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
          line {
            publicCode
            transportMode
            presentation { colour textColour }
          }
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
        serviceJourney:        {
          line: {
            publicCode: string
            transportMode: string
            presentation?: { colour?: string; textColour?: string } | null
          }
        }
      }[]
    } | null
  }

  if (!data.stopPlace) throw new Error(`Stop not found: ${stopId}`)

  // Filter out any malformed calls so one bad item doesn't crash the whole widget
  const departures: Departure[] = (data.stopPlace.estimatedCalls ?? [])
    .filter(c => c.serviceJourney?.line?.publicCode && c.expectedDepartureTime)
    .map(c => ({
      line:              c.serviceJourney.line.publicCode,
      transport:         c.serviceJourney.line.transportMode,
      destination:       c.destinationDisplay.frontText,
      aimed:             c.aimedDepartureTime,
      expected:          c.expectedDepartureTime,
      realtime:          c.realtime,
      quayCode:          c.quay?.publicCode,
      quayName:          c.quay?.name,
      quayDescription:   c.quay?.description,
      lineColour:        c.serviceJourney.line.presentation?.colour,
      lineTextColour:    c.serviceJourney.line.presentation?.textColour,
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
  from:       TransitPlace,
  to:         TransitPlace,
  count?:     number,
  dateTime?:  string,   // ISO 8601 — omit for "depart now"
  arriveBy?:  boolean,  // EnTur v3: arriveBy — treat dateTime as arrival target
): Promise<TripPattern[]> {
  const n    = count ?? 5
  const dtArg = dateTime ? `\n      dateTime: "${dateTime}"` : ''
  const abArg = arriveBy  ? `\n      arriveBy: true`         : ''
  const data = await gql(`{
    trip(
      from: ${gqlPlace(from)}
      to:   ${gqlPlace(to)}
      numTripPatterns: ${n}${dtArg}${abArg}
    ) {
      tripPatterns {
        duration
        streetDistance
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
            presentation { colour textColour }
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
        streetDistance:    number | null
        expectedStartTime: string
        expectedEndTime:   string
        legs: {
          mode:     string
          duration: number | null
          distance: number | null
          fromPlace: { name: string }
          toPlace:   { name: string }
          line?: { publicCode: string; name: string; transportMode: string; presentation?: { colour?: string; textColour?: string } | null } | null
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

  return (data.trip?.tripPatterns ?? [])
    .filter(p => p.expectedStartTime && p.legs?.length)
    .map(p => ({
    duration:     p.duration     ?? 0,
    walkDistance: p.streetDistance ?? 0,
    departure:    p.expectedStartTime,
    arrival:      p.expectedEndTime,
    // Skip any leg missing required fields so one bad leg doesn't crash the card
    legs: p.legs.filter(l => l.mode && l.fromPlace && l.toPlace).map(l => {
      const leg: TripLeg = {
        mode:     l.mode,
        duration: l.duration ?? 0,
        distance: l.distance ?? 0,
        from:     l.fromPlace.name,
        to:       l.toPlace.name,
      }
      if (l.line) {
        leg.line          = l.line.publicCode
        leg.lineName      = l.line.name
        leg.lineColour    = l.line.presentation?.colour
        leg.lineTextColour = l.line.presentation?.textColour
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

