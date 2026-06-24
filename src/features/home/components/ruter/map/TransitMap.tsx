import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useVehiclePositions } from './useVehiclePositions'
import {
  TILE_URL,
  TILE_ATTRIBUTION,
  TILE_SUBDOMAINS,
  STOP_ZOOM,
  DEFAULT_CENTER,
  WIDGET_ZOOM,
  VEHICLE_COLORS,
  DELAY_THRESHOLDS,
  STOP_MARKER_COLOR,
  STOP_MARKER_RADIUS,
  USER_LOCATION_COLOR,
} from './config'
import type { VehiclePosition, StopPin, VehicleTarget } from './types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function vehicleColor(v: VehiclePosition): string {
  if (!v.monitored)                               return VEHICLE_COLORS.noGPS
  if ((v.delay ?? 0) <= DELAY_THRESHOLDS.onTime)  return VEHICLE_COLORS.onTime
  if ((v.delay ?? 0) <= DELAY_THRESHOLDS.slight)  return VEHICLE_COLORS.slight
  return VEHICLE_COLORS.late
}

function makeVehicleIcon(v: VehiclePosition, tracked = false): L.DivIcon {
  const color   = vehicleColor(v)
  const bearing = v.bearing ?? 0
  const size    = tracked ? 44 : 36
  const badge   = tracked ? 36 : 28
  const fs      = tracked ? (v.publicCode.length > 2 ? '11' : '14') : (v.publicCode.length > 2 ? '9' : '11')

  return L.divIcon({
    className: '',
    iconSize:  [size, size],
    iconAnchor:[size / 2, size / 2],
    html: `
      <div style="width:${size}px;height:${size}px;position:relative;display:flex;align-items:center;justify-content:center;">
        <div style="position:absolute;top:-6px;left:50%;transform:translateX(-50%) rotate(${bearing}deg);
          width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;
          border-bottom:8px solid ${color};opacity:0.85;"></div>
        <div style="width:${badge}px;height:${badge}px;background:${color};border-radius:50%;
          border:${tracked ? '3px solid white' : '2px solid white'};
          ${tracked ? 'box-shadow:0 0 0 3px rgba(255,255,255,0.4),0 3px 10px rgba(0,0,0,0.5);' : 'box-shadow:0 2px 6px rgba(0,0,0,0.3);'}
          display:flex;align-items:center;justify-content:center;
          font-family:Inter,Arial,sans-serif;font-size:${fs}px;font-weight:800;color:#fff;line-height:1;">
          ${v.publicCode}
        </div>
      </div>
    `,
  })
}

function vehiclePopup(v: VehiclePosition): string {
  const delayText = v.delay === undefined ? '' :
    v.delay <= 0 ? ' · on time' : ` · ${Math.round(v.delay / 60)} min late`
  return `<div style="font-family:Inter,Arial,sans-serif;font-size:13px;line-height:1.5;">
    <strong>Line ${v.publicCode}</strong>${v.destinationName ? ' → ' + v.destinationName : ''}
    <br/><span style="color:#94a3b8;">${delayText}${!v.monitored ? ' · no GPS' : ''}</span>
  </div>`
}

// ─── Component ────────────────────────────────────────────────────────────────

interface TransitMapProps {
  stop:                     StopPin | null
  userLocation?:            [number, number] | null
  height?:                  number
  trackedServiceJourneyId?: string | null
  trackedLineRef?:          string | null
}

export function TransitMap({ stop, userLocation, height = 220, trackedServiceJourneyId, trackedLineRef }: TransitMapProps) {
  const containerRef    = useRef<HTMLDivElement>(null)
  const mapRef          = useRef<L.Map | null>(null)
  const stopLayerRef    = useRef<L.Layer | null>(null)
  const userLayerRef    = useRef<L.Layer | null>(null)
  const vehicleLayerRef = useRef<L.LayerGroup | null>(null)
  const routeLayerRef   = useRef<L.Layer | null>(null)
  const vehicleMarkersRef = useRef<Map<string, L.Marker>>(new Map())

  // Build the vehicle fetch target.
  // lineRef queries all active vehicles on the line — reliable.
  // serviceJourneyId is kept for fetchRouteStops (route polyline) only.
  const vehicleTarget: VehicleTarget = trackedServiceJourneyId && trackedLineRef
    ? { kind: 'journey', serviceJourneyId: trackedServiceJourneyId, lineRef: trackedLineRef }
    : stop
      ? { kind: 'stop', stop }
      : null

  const { vehicles, routeStops, error: vehicleError } = useVehiclePositions(vehicleTarget)

  // ── Initialize map ────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el || mapRef.current) return

    const map = L.map(el, { zoomControl: true, attributionControl: true, scrollWheelZoom: false })
    map.setView(DEFAULT_CENTER, WIDGET_ZOOM)

    L.tileLayer(TILE_URL, {
      attribution: TILE_ATTRIBUTION,
      subdomains:  TILE_SUBDOMAINS,
      maxZoom:     19,
    }).addTo(map)

    vehicleLayerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
      vehicleLayerRef.current = null
      vehicleMarkersRef.current.clear()
    }
  }, [])

  // ── Stop pin & fly ────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (stopLayerRef.current) { map.removeLayer(stopLayerRef.current); stopLayerRef.current = null }
    if (!stop) return

    const marker = L.circleMarker([stop.lat, stop.lon], {
      radius: STOP_MARKER_RADIUS, fillColor: STOP_MARKER_COLOR,
      color: '#fff', weight: 2, opacity: 1, fillOpacity: 0.95,
    }).addTo(map)
    marker.bindPopup(`<strong>${stop.name}</strong>`, { closeButton: false })
    stopLayerRef.current = marker
    map.flyTo([stop.lat, stop.lon], STOP_ZOOM, { duration: 0.8 })
  }, [stop?.id, stop?.lat, stop?.lon])

  // ── User location pin ─────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (userLayerRef.current) { map.removeLayer(userLayerRef.current); userLayerRef.current = null }
    if (!userLocation) return

    const marker = L.circleMarker(userLocation, {
      radius: 8, fillColor: USER_LOCATION_COLOR,
      color: '#fff', weight: 2, opacity: 1, fillOpacity: 0.9,
    }).addTo(map)
    marker.bindPopup('<strong>Your location</strong>', { closeButton: false })
    userLayerRef.current = marker
  }, [userLocation?.[0], userLocation?.[1]])

  // ── Route stop polyline ───────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (routeLayerRef.current) { map.removeLayer(routeLayerRef.current); routeLayerRef.current = null }
    if (routeStops.length < 2) return

    const coords = routeStops.map(s => [s.lat, s.lon] as [number, number])
    const line = L.polyline(coords, {
      color:   '#e2e8f0',   // light line on dark background
      weight:  3,
      opacity: 0.6,
      dashArray: '6 4',
    }).addTo(map)
    routeLayerRef.current = line

    // Fit map to the route when tracking starts
    if (trackedServiceJourneyId && coords.length > 0) {
      map.fitBounds(L.latLngBounds(coords), { padding: [30, 30], maxZoom: 14 })
    }
  }, [routeStops, trackedServiceJourneyId])

  // ── Vehicle markers ───────────────────────────────────────────────────────
  useEffect(() => {
    const layer   = vehicleLayerRef.current
    const markers = vehicleMarkersRef.current
    if (!layer) return

    const incomingIds = new Set(vehicles.map(v => v.vehicleId))
    for (const [id, marker] of markers) {
      if (!incomingIds.has(id)) { layer.removeLayer(marker); markers.delete(id) }
    }

    for (const v of vehicles) {
      const latlng  = new L.LatLng(v.latitude, v.longitude)
      const tracked = !!trackedServiceJourneyId   // in journey mode every vehicle returned IS the tracked one
      const icon    = makeVehicleIcon(v, tracked)
      const popup   = vehiclePopup(v)

      if (markers.has(v.vehicleId)) {
        const m = markers.get(v.vehicleId)!
        m.setLatLng(latlng); m.setIcon(icon); m.setPopupContent(popup)
      } else {
        const m = L.marker(latlng, { icon })
        m.bindPopup(popup, { closeButton: false })
        m.addTo(layer)
        markers.set(v.vehicleId, m)
      }
    }

    // In tracking mode, pan to the tracked vehicle so it stays visible
    if (trackedServiceJourneyId && vehicles.length > 0 && mapRef.current) {
      const v = vehicles[0]
      mapRef.current.panTo([v.latitude, v.longitude], { animate: true, duration: 0.5 })
    }
  }, [vehicles, trackedServiceJourneyId])

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="relative w-full rounded-xl overflow-hidden border border-ink-100" style={{ height }}>
      <div ref={containerRef} className="w-full h-full" />

      {vehicles.length > 0 && (
        <div className="absolute top-2 left-2 z-[1000] flex items-center gap-1.5
                        bg-black/60 backdrop-blur-sm rounded-lg px-2 py-1 shadow-sm pointer-events-none">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse inline-block" />
          <span className="text-[10px] font-semibold text-white">
            {trackedServiceJourneyId
              ? `Tracking line ${vehicles[0]?.publicCode ?? '…'}`
              : `${vehicles.length} vehicle${vehicles.length !== 1 ? 's' : ''} live`
            }
          </span>
        </div>
      )}

      {vehicleError && (
        <div className="absolute top-2 left-2 z-[1000] bg-red-900/80 border border-red-700 rounded-lg px-2 py-1 shadow-sm pointer-events-none">
          <span className="text-[10px] text-red-200">⚠ {vehicleError}</span>
        </div>
      )}
    </div>
  )
}
