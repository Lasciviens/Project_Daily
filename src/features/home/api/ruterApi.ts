// EnTur JourneyPlanner v3 GraphQL + Pelias geocoder
// Docs: https://developer.entur.org/pages-journeyplanner-journeyplanner/
// Rate-limit policy: https://developer.entur.org/pages-customers-docs-ratelimiting/
// ET-Client-Name must be "company-application" — anonymous clients are rate-limited aggressively.
const JOURNEY  = 'https://api.entur.io/journey-planner/v3/graphql'
const GEOCODER = 'https://api.entur.io/geocoder/v1/autocomplete'
const CLIENT   = 'personal-lascisboard'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Departure {
  line:        string
  transport:   string
  destination: string
  aimed:       string   // ISO datetime
  expected:    string   // ISO datetime
  realtime:    boolean
  platform?:   string
  direction?:  string
}

export interface StopResult {
  id:   string
  name: string
}

export interface TripLeg {
  mode:      string
  line:      string
  departure: string   // ISO datetime (expected)
  aimed:     string   // ISO datetime (aimed)
  from:      string
  to:        string
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

// Visperud: NSR:StopPlace:5492 (confirmed via reise.frammr.no)
// Sinsenveien 47D area: NSR:StopPlace:58221 (lines 23/31 — east side of Sinsenveien)
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

// ─── GraphQL helpers ──────────────────────────────────────────────────────────

async function gql(query: string): Promise<unknown> {
  const res = await fetch(JOURNEY, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'ET-Client-Name': CLIENT },
    body:    JSON.stringify({ query }),
  })

  if (res.status === 429) throw new Error('Rate limited — wait a moment and try again')
  if (!res.ok) throw new Error(`EnTur ${res.status}`)

  const json = await res.json()

  // GraphQL always returns 200; errors are in json.errors even when data is partially present
  if (json.errors?.length) {
    const msg = json.errors.map((e: { message: string }) => e.message).join(' | ')
    console.error('[EnTur GraphQL]', msg)
    throw new Error(msg)
  }

  return json.data
}

// ─── Departures ───────────────────────────────────────────────────────────────

export async function fetchDepartures(
  stopId: string,
  count = 12
): Promise<{ stopName: string; departures: Departure[] }> {
  const data = await gql(`{
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
  }`) as { stopPlace: {
    name: string
    estimatedCalls: {
      realtime: boolean
      aimedDepartureTime: string
      expectedDepartureTime: string
      quay?: { publicCode?: string; description?: string; name?: string }
      serviceJourney: { line: { publicCode: string; transportMode: string } }
      destinationDisplay: { frontText: string }
    }[]
  } | null }

  if (!data.stopPlace) throw new Error(`Stop not found: ${stopId}`)

  const departures: Departure[] = (data.stopPlace.estimatedCalls ?? []).map(c => ({
    line:        c.serviceJourney.line.publicCode,
    transport:   c.serviceJourney.line.transportMode,
    destination: c.destinationDisplay.frontText,
    aimed:       c.aimedDepartureTime,
    expected:    c.expectedDepartureTime,
    realtime:    c.realtime,
    platform:    c.quay?.publicCode,
    // Show quay description as direction only when it contains direction text
    direction:   (() => {
      const raw = c.quay?.description ?? c.quay?.name ?? ''
      const lower = raw.toLowerCase()
      if (lower.includes('mot ') || lower.includes('retning') || lower.includes('sentrum')) return raw
      return undefined
    })(),
  }))

  return { stopName: data.stopPlace.name, departures }
}

// ─── Stop search ─────────────────────────────────────────────────────────────

// sources=nsr restricts results to the National Stop Registry so IDs are
// always in NSR:StopPlace:XXXXX format — usable directly in stopPlace(id:...) queries.
export async function searchStops(query: string): Promise<StopResult[]> {
  const url = `${GEOCODER}?text=${encodeURIComponent(query)}&lang=no&size=8&layers=venue&sources=nsr`
  const res = await fetch(url, { headers: { 'ET-Client-Name': CLIENT } })

  if (res.status === 429) throw new Error('Rate limited')
  if (!res.ok) throw new Error(`Geocoder ${res.status}`)

  const json = await res.json()
  return (json.features ?? [])
    .filter((f: { properties: { id?: string } }) => f.properties.id?.startsWith('NSR:StopPlace:'))
    .map((f: { properties: { id: string; name: string } }) => ({
      id:   f.properties.id,
      name: f.properties.name,
    }))
}

// ─── Trip planner ─────────────────────────────────────────────────────────────

// mode is already on Leg; transportMode is not queried from line to avoid
// schema version differences between OTP2 builds.
export async function fetchTrips(
  fromId: string,
  toId:   string,
  count = 5
): Promise<TripPattern[]> {
  const data = await gql(`{
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
          toPlace   { name }
          fromEstimatedCall {
            aimedDepartureTime
            expectedDepartureTime
          }
          line { publicCode }
        }
      }
    }
  }`) as { trip: { tripPatterns: {
    duration: number
    expectedStartTime: string
    expectedEndTime: string
    legs: {
      mode: string
      fromPlace: { name: string }
      toPlace:   { name: string }
      fromEstimatedCall?: { aimedDepartureTime: string; expectedDepartureTime: string }
      line?: { publicCode: string }
    }[]
  }[] } }

  return (data.trip?.tripPatterns ?? []).map(p => ({
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
