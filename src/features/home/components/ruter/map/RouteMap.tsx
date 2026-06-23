import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import L from 'leaflet'
import type { TripLeg } from '../../../api/ruterApi'
import { TILE_URL, TILE_ATTRIBUTION } from './config'

// ─── Polyline decoder (Google Encoded Polyline Algorithm, precision 5) ─────────

function decodePolyline(encoded: string): [number, number][] {
  const result: [number, number][] = []
  let index = 0, lat = 0, lng = 0
  while (index < encoded.length) {
    let b: number, shift = 0, result_ = 0
    do { b = encoded.charCodeAt(index++) - 63; result_ |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    const dlat = (result_ & 1) ? ~(result_ >> 1) : (result_ >> 1); lat += dlat
    shift = 0; result_ = 0
    do { b = encoded.charCodeAt(index++) - 63; result_ |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    const dlng = (result_ & 1) ? ~(result_ >> 1) : (result_ >> 1); lng += dlng
    result.push([lat / 1e5, lng / 1e5])
  }
  return result
}

// ─── Leg colors by transport mode ─────────────────────────────────────────────

const LEG_COLORS: Record<string, string> = {
  foot:   '#94A3B8',
  bus:    '#E8112D',
  tram:   '#E8112D',
  metro:  '#E8112D',
  rail:   '#4A4A4A',
  ferry:  '#0066CC',
}

function legColor(mode: string): string {
  return LEG_COLORS[mode] ?? '#94A3B8'
}

// ─── Component ────────────────────────────────────────────────────────────────

interface RouteMapProps {
  legs:    TripLeg[]
  height?: number
}

export function RouteMap({ legs, height = 260 }: RouteMapProps) {
  const containerRef  = useRef<HTMLDivElement>(null)
  const mapRef        = useRef<L.Map | null>(null)
  const layersRef     = useRef<L.Layer[]>([])

  // Init map once on mount
  useEffect(() => {
    const el = containerRef.current
    if (!el || mapRef.current) return

    const map = L.map(el, { scrollWheelZoom: false, zoomControl: true })
    map.setView([59.9127, 10.7461], 12)
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map)
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
      layersRef.current = []
    }
  }, [])

  // Redraw route whenever legs change
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Clear previous route layers
    for (const layer of layersRef.current) map.removeLayer(layer)
    layersRef.current = []

    const allCoords: [number, number][] = []

    for (const leg of legs) {
      if (!leg.legGeometry?.points) continue
      const coords = decodePolyline(leg.legGeometry.points)
      if (coords.length === 0) continue
      allCoords.push(...coords)

      const line = L.polyline(coords, {
        color:   legColor(leg.mode),
        weight:  4,
        opacity: 0.85,
      }).addTo(map)
      layersRef.current.push(line)

      // Circle marker at boarding point for transit legs
      if (leg.mode !== 'foot' && coords[0]) {
        const label = [leg.line, leg.destination].filter(Boolean).join(' → ')
        const marker = L.circleMarker(coords[0], {
          radius: 5, fillColor: legColor(leg.mode),
          color: '#fff', weight: 2, opacity: 1, fillOpacity: 0.95,
        }).addTo(map)
        if (label) marker.bindPopup(label, { closeButton: false })
        layersRef.current.push(marker)
      }
    }

    if (allCoords.length === 0) return

    // Start marker (red) and end marker (green)
    const start = allCoords[0]
    const end   = allCoords[allCoords.length - 1]

    const startMarker = L.circleMarker(start, {
      radius: 7, fillColor: '#E8112D',
      color: '#fff', weight: 2, opacity: 1, fillOpacity: 1,
    }).addTo(map)
    startMarker.bindPopup('Start', { closeButton: false })
    layersRef.current.push(startMarker)

    const endMarker = L.circleMarker(end, {
      radius: 7, fillColor: '#16A34A',
      color: '#fff', weight: 2, opacity: 1, fillOpacity: 1,
    }).addTo(map)
    endMarker.bindPopup('End', { closeButton: false })
    layersRef.current.push(endMarker)

    map.fitBounds(L.latLngBounds(allCoords), { padding: [20, 20] })
  }, [legs])

  const totalMins = Math.round(legs.reduce((s, l) => s + l.duration, 0) / 60)
  const hasGeometry = legs.some(l => !!l.legGeometry?.points)

  return (
    <div className="relative w-full rounded-xl overflow-hidden border border-ink-100" style={{ height }}>
      <div ref={containerRef} className="w-full h-full" />

      {/* Duration badge */}
      {hasGeometry && (
        <div className="absolute top-2 left-2 z-[1000] bg-white/90 backdrop-blur-sm rounded-lg px-2 py-1 shadow-sm pointer-events-none">
          <span className="text-[10px] font-semibold text-ink-700">{totalMins} min</span>
        </div>
      )}

      {/* No geometry fallback */}
      {!hasGeometry && (
        <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-ink-50/80">
          <span className="text-xs text-ink-400">Route preview not available</span>
        </div>
      )}
    </div>
  )
}
