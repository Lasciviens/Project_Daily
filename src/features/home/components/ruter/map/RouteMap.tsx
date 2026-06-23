import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useMemo } from 'react'
import L from 'leaflet'
import type { TripLeg } from '../../../api/ruterApi'
import { TILE_URL, TILE_ATTRIBUTION, TILE_SUBDOMAINS, VEHICLE_COLORS, DELAY_THRESHOLDS } from './config'
import { useVehiclePositions } from './useVehiclePositions'
import type { VehiclePosition, VehicleTarget } from './types'

// ─── Polyline decoder (Google Encoded Polyline Algorithm, precision 5) ─────────

export function decodePolyline(encoded: string): [number, number][] {
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

// ─── Colors ──────────────────────────────────────────────────────────────────

const LEG_COLORS: Record<string, string> = {
  foot: '#64748b', bus: '#E8112D', tram: '#E8112D',
  metro: '#E8112D', rail: '#4A4A4A', ferry: '#0066CC',
}
function legColor(mode: string): string { return LEG_COLORS[mode] ?? '#94A3B8' }

function vehicleColor(v: VehiclePosition): string {
  if (!v.monitored)                               return VEHICLE_COLORS.noGPS
  if ((v.delay ?? 0) <= DELAY_THRESHOLDS.onTime)  return VEHICLE_COLORS.onTime
  if ((v.delay ?? 0) <= DELAY_THRESHOLDS.slight)  return VEHICLE_COLORS.slight
  return VEHICLE_COLORS.late
}

function makeVehicleIcon(v: VehiclePosition): L.DivIcon {
  const color = vehicleColor(v)
  return L.divIcon({
    className: '',
    iconSize:  [32, 32],
    iconAnchor:[16, 16],
    html: `<div style="width:32px;height:32px;position:relative;display:flex;align-items:center;justify-content:center;">
      <div style="position:absolute;top:-5px;left:50%;transform:translateX(-50%) rotate(${v.bearing ?? 0}deg);
        width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;
        border-bottom:7px solid ${color};opacity:0.85;"></div>
      <div style="width:24px;height:24px;background:${color};border-radius:50%;border:2px solid white;
        display:flex;align-items:center;justify-content:center;
        font-family:Inter,Arial,sans-serif;font-size:9px;font-weight:800;color:#fff;
        box-shadow:0 2px 6px rgba(0,0,0,0.4);">${v.publicCode}</div>
    </div>`,
  })
}

// ─── Component ────────────────────────────────────────────────────────────────

interface RouteMapProps {
  legs:    TripLeg[]
  height?: number
}

export function RouteMap({ legs, height = 280 }: RouteMapProps) {
  const containerRef     = useRef<HTMLDivElement>(null)
  const mapRef           = useRef<L.Map | null>(null)
  const routeLayersRef   = useRef<L.Layer[]>([])
  const vehicleLayerRef  = useRef<L.LayerGroup | null>(null)
  const vehicleMarkersRef = useRef<Map<string, L.Marker>>(new Map())

  // Compute bounding box from all decoded points for vehicle fetching
  const vehicleTarget = useMemo((): VehicleTarget => {
    const allCoords: [number, number][] = []
    for (const leg of legs) {
      if (leg.legGeometry?.points) allCoords.push(...decodePolyline(leg.legGeometry.points))
    }
    if (allCoords.length === 0) return null
    const lats = allCoords.map(c => c[0])
    const lons = allCoords.map(c => c[1])
    return {
      kind: 'bbox',
      minLat: Math.min(...lats) - 0.005,
      minLon: Math.min(...lons) - 0.005,
      maxLat: Math.max(...lats) + 0.005,
      maxLon: Math.max(...lons) + 0.005,
    }
  }, [legs])

  const { vehicles, error: vehicleError } = useVehiclePositions(vehicleTarget)

  // ── Init map once ─────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el || mapRef.current) return

    const map = L.map(el, { scrollWheelZoom: false, zoomControl: true })
    map.setView([59.9127, 10.7461], 12)
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, subdomains: TILE_SUBDOMAINS, maxZoom: 19 }).addTo(map)
    vehicleLayerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
      vehicleLayerRef.current = null
      vehicleMarkersRef.current.clear()
      routeLayersRef.current = []
    }
  }, [])

  // ── Redraw route polylines ────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    for (const layer of routeLayersRef.current) map.removeLayer(layer)
    routeLayersRef.current = []

    const allCoords: [number, number][] = []

    for (const leg of legs) {
      if (!leg.legGeometry?.points) continue
      const coords = decodePolyline(leg.legGeometry.points)
      if (!coords.length) continue
      allCoords.push(...coords)

      const line = L.polyline(coords, {
        color:   legColor(leg.mode),
        weight:  leg.mode === 'foot' ? 2 : 4,
        opacity: leg.mode === 'foot' ? 0.5 : 0.9,
        dashArray: leg.mode === 'foot' ? '4 4' : undefined,
      }).addTo(map)
      routeLayersRef.current.push(line)

      if (leg.mode !== 'foot' && coords[0]) {
        const label = [leg.line, leg.destination].filter(Boolean).join(' → ')
        const m = L.circleMarker(coords[0], {
          radius: 5, fillColor: legColor(leg.mode),
          color: '#fff', weight: 2, opacity: 1, fillOpacity: 1,
        }).addTo(map)
        if (label) m.bindPopup(label, { closeButton: false })
        routeLayersRef.current.push(m)
      }
    }

    if (!allCoords.length) return

    const start = allCoords[0]
    const end   = allCoords[allCoords.length - 1]

    const sm = L.circleMarker(start, { radius: 7, fillColor: '#E8112D', color: '#fff', weight: 2, opacity: 1, fillOpacity: 1 }).addTo(map)
    sm.bindPopup('Start', { closeButton: false })
    routeLayersRef.current.push(sm)

    const em = L.circleMarker(end, { radius: 7, fillColor: '#16A34A', color: '#fff', weight: 2, opacity: 1, fillOpacity: 1 }).addTo(map)
    em.bindPopup('End', { closeButton: false })
    routeLayersRef.current.push(em)

    map.fitBounds(L.latLngBounds(allCoords), { padding: [24, 24] })
  }, [legs])

  // ── Update vehicle markers ────────────────────────────────────────────────
  useEffect(() => {
    const layer   = vehicleLayerRef.current
    const markers = vehicleMarkersRef.current
    if (!layer) return

    const incoming = new Set(vehicles.map(v => v.vehicleId))
    for (const [id, m] of markers) {
      if (!incoming.has(id)) { layer.removeLayer(m); markers.delete(id) }
    }
    for (const v of vehicles) {
      const latlng = new L.LatLng(v.latitude, v.longitude)
      const icon   = makeVehicleIcon(v)
      const popup  = `<strong>Line ${v.publicCode}</strong>${v.destinationName ? ' → ' + v.destinationName : ''}`
      if (markers.has(v.vehicleId)) {
        const m = markers.get(v.vehicleId)!
        m.setLatLng(latlng); m.setIcon(icon); m.setPopupContent(popup)
      } else {
        const m = L.marker(latlng, { icon })
        m.bindPopup(popup, { closeButton: false }); m.addTo(layer)
        markers.set(v.vehicleId, m)
      }
    }
  }, [vehicles])

  const totalMins  = Math.round(legs.reduce((s, l) => s + l.duration, 0) / 60)
  const hasGeom    = legs.some(l => !!l.legGeometry?.points)

  return (
    <div className="relative w-full rounded-xl overflow-hidden border border-ink-100" style={{ height }}>
      <div ref={containerRef} className="w-full h-full" />

      <div className="absolute top-2 left-2 z-[1000] flex items-center gap-2 pointer-events-none">
        {hasGeom && (
          <div className="bg-black/60 backdrop-blur-sm rounded-lg px-2 py-1">
            <span className="text-[10px] font-semibold text-white">{totalMins} min</span>
          </div>
        )}
        {vehicles.length > 0 && (
          <div className="bg-black/60 backdrop-blur-sm rounded-lg px-2 py-1 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
            <span className="text-[10px] font-semibold text-white">{vehicles.length} live</span>
          </div>
        )}
      </div>

      {vehicleError && (
        <div className="absolute top-2 right-2 z-[1000] bg-red-900/80 rounded-lg px-2 py-1 pointer-events-none">
          <span className="text-[10px] text-red-200">⚠ {vehicleError}</span>
        </div>
      )}

      {!hasGeom && (
        <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-ink-900/60">
          <span className="text-xs text-white/70">Route preview not available</span>
        </div>
      )}
    </div>
  )
}
