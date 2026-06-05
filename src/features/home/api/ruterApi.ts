const JOURNEY = 'https://api.entur.io/journey-planner/v3/graphql'
const GEOCODER = 'https://api.entur.io/geocoder/v1/autocomplete'
const CLIENT   = 'lascis-board'

export interface Departure {
  line:        string
  transport:   string
  destination: string
  aimed:       string  // ISO
  expected:    string  // ISO
  realtime:    boolean
  platform?:   string
}

export interface StopResult {
  id:   string
  name: string
}

export async function fetchDepartures(
  stopId: string,
  count = 8
): Promise<{ stopName: string; departures: Departure[] }> {
  const query = `{
    stopPlace(id: "${stopId}") {
      name
      estimatedCalls(timeRange: 72100, numberOfDepartures: ${count}) {
        realtime
        aimedDepartureTime
        expectedDepartureTime
        quay { publicCode }
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
    quay?: { publicCode?: string }
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
  }))

  return { stopName: stop.name, departures }
}

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

export const TRANSPORT_ICON: Record<string, string> = {
  bus: '🚌', tram: '🚊', metro: '🚇', rail: '🚂', ferry: '⛴', water: '⛴',
}

export const DEFAULT_STOP: StopResult = {
  id:   'NSR:StopPlace:58366',
  name: 'Nationaltheatret',
}
