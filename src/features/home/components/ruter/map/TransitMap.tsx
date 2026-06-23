/**
 * TransitMap
 *
 * Leaflet-based map showing:
 *   • The selected stop as a red circle pin
 *   • The user's current GPS location (blue circle) — optional
 *   • Live Ruter vehicle positions (colored by delay) — polled every 15 s
 *
 * Self-contained: import <TransitMap> anywhere, pass a StopPin, done.
 * To completely remove: delete the /map/ folder + the import in DeparturesTab.
 *
 * Leaflet requires its CSS to be imported once in the app.
 * We do that here so this module is fully self-contained.
 */

import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useVehiclePositions } from './useVehiclePositions'
import {
  TILE_URL,
  TILE_ATTRIBUTION,
  STOP_ZOOM,
  VEHICLE_COLORS,
  DELAY_THRESHOLDS,
  STOP_MARKER_COLOR,
  STOP_MARKER_RADIUS,
  USER_LOCATION_COLOR,
} from './config'
import type { VehiclePosition, StopPin } from './types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Pick a hex color for a vehicle based on its delay in seconds */
function vehicleColor(v: VehiclePosition): string {
  if (!v.monitored)                          return VEHICLE_COLORS.noGPS
  if ((v.delay ?? 0) <= DELAY_THRESHOLDS.onTime) return VEHICLE_COLORS.onTime
  if ((v.delay ?? 0) <= DELAY_THRESHOLDS.slight)  return VEHICLE_COLORS.slight
  return VEHICLE_COLORS.late
}

/** Build an SVG bus icon that also shows the line number + direction arrow */
function makeVehicleIcon(v: VehiclePosition): L.DivIcon {
  const color    = vehicleColor(v)
  const bearing  = v.bearing ?? 0

  return L.divIcon({
    className: '',   // suppress Leaflet's default white box
    iconSize:  [36, 36],
    iconAnchor:[18, 18],
    html: `
      <div style="
        width:36px; height:36px; position:relative;
        display:flex; align-items:center; justify-content:center;
      ">
        <!-- Direction arrow — rotates to show heading -->
        <div style="
          position:absolute; top:-6px; left:50%; transform:translateX(-50%) rotate(${bearing}deg);
          width:0; height:0;
          border-left:5px solid transparent;
          border-right:5px solid transparent;
          border-bottom:8px solid ${color};
          opacity:0.85;
        "></div>

        <!-- Circle badge with line number -->
        <div style="
          width:28px; height:28px;
          background:${color};
          border-radius:50%;
          border:2px solid white;
          display:flex; align-items:center; justify-content:center;
          font-family:Inter,Arial,sans-serif;
          font-size:${v.publicCode.length > 2 ? '9' : '11'}px;
          font-weight:800;
          color:#fff;
          box-shadow:0 2px 6px rgba(0,0,0,0.3);
          line-height:1;
        ">${v.publicCode}</div>
      </div>
    `,
  })
}

/** Build a popup HTML string for a vehicle */
function vehiclePopup(v: VehiclePosition): string {
  const delayText = v.delay === undefined ? '' :
    v.delay <= 0 ? ' · on time' :
    ` · ${Math.round(v.delay / 60)} min late`
  return `
    <div style="font-family:Inter,Arial,sans-serif; font-size:13px; line-height:1.5;">
      <strong>Line ${v.publicCode}</strong>${v.destinationName ? ' → ' + v.destinationName : ''}
      <br/><span style="color:#64748b;">${delayText}${!v.monitored ? ' · no GPS' : ''}</span>
    </div>
  `
}

// ─── Component ────────────────────────────────────────────────────────────────

interface TransitMapProps {
  stop:          StopPin | null
  userLocation?: [number, number] | null   // [lat, lon]
  height?:       number                    // px, default 220
}

export function TransitMap({ stop, userLocation, height = 220 }: TransitMapProps) {
  // We manage the Leaflet map instance ourselves (imperative API)
  // rather than via react-leaflet, to avoid SSR/hydration issues and
  // keep full control over marker lifecycle.
  const containerRef  = useRef<HTMLDivElement>(null)
  const mapRef        = useRef<L.Map | null>(null)
  const stopLayerRef  = useRef<L.Layer | null>(null)
  const userLayerRef  = useRef<L.Layer | null>(null)
  const vehicleLayerRef = useRef<L.LayerGroup | null>(null)
  // Track markers by vehicleId so we update-in-place instead of recreating
  const vehicleMarkersRef = useRef<Map<string, L.Marker>>(new Map())

  const { vehicles, error: vehicleError } = useVehiclePositions(stop)

  // ── Initialize Leaflet map once on mount ──────────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el || mapRef.current) return   // already initialized

    const map = L.map(el, {
      zoomControl:       true,
      attributionControl: true,
      // Disable scroll-zoom in the widget to prevent accidental zoom
      // while scrolling the page.  User can still use +/- buttons.
      scrollWheelZoom:   false,
    })

    // Kartverket tile layer
    L.tileLayer(TILE_URL, {
      attribution: TILE_ATTRIBUTION,
      maxZoom:     19,
    }).addTo(map)

    // Vehicle layer group — all vehicle markers live here
    const vehicleLayer = L.layerGroup().addTo(map)
    vehicleLayerRef.current = vehicleLayer

    mapRef.current = map

    return () => {
      // Full cleanup on unmount — prevents "map already initialized" errors
      map.remove()
      mapRef.current        = null
      vehicleLayerRef.current = null
      vehicleMarkersRef.current.clear()
    }
  }, [])  // intentionally empty — run once

  // ── Fly to selected stop & update stop pin ────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Remove previous stop marker
    if (stopLayerRef.current) {
      map.removeLayer(stopLayerRef.current)
      stopLayerRef.current = null
    }

    if (!stop) return

    // Red circle for the selected stop
    const marker = L.circleMarker([stop.lat, stop.lon], {
      radius:      STOP_MARKER_RADIUS,
      fillColor:   STOP_MARKER_COLOR,
      color:       '#fff',
      weight:      2,
      opacity:     1,
      fillOpacity: 0.95,
    }).addTo(map)

    marker.bindPopup(`<strong>${stop.name}</strong>`, { closeButton: false })
    stopLayerRef.current = marker

    // Fly to stop
    map.flyTo([stop.lat, stop.lon], STOP_ZOOM, { duration: 0.8 })
  }, [stop?.id, stop?.lat, stop?.lon])

  // ── Update user location pin ──────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (userLayerRef.current) {
      map.removeLayer(userLayerRef.current)
      userLayerRef.current = null
    }

    if (!userLocation) return

    const marker = L.circleMarker(userLocation, {
      radius:      8,
      fillColor:   USER_LOCATION_COLOR,
      color:       '#fff',
      weight:      2,
      opacity:     1,
      fillOpacity: 0.9,
    }).addTo(map)

    marker.bindPopup('<strong>Your location</strong>', { closeButton: false })
    userLayerRef.current = marker
  }, [userLocation?.[0], userLocation?.[1]])

  // ── Update vehicle markers ────────────────────────────────────────────────
  useEffect(() => {
    const layer   = vehicleLayerRef.current
    const markers = vehicleMarkersRef.current
    if (!layer) return

    const incomingIds = new Set(vehicles.map(v => v.vehicleId))

    // Remove markers for vehicles no longer in the feed
    for (const [id, marker] of markers) {
      if (!incomingIds.has(id)) {
        layer.removeLayer(marker)
        markers.delete(id)
      }
    }

    // Add or update markers for current vehicles
    for (const v of vehicles) {
      const latlng = new L.LatLng(v.latitude, v.longitude)
      const icon   = makeVehicleIcon(v)
      const popup  = vehiclePopup(v)

      if (markers.has(v.vehicleId)) {
        // Update existing marker in place (smooth movement, no flicker)
        const m = markers.get(v.vehicleId)!
        m.setLatLng(latlng)
        m.setIcon(icon)
        m.setPopupContent(popup)
      } else {
        // Create new marker
        const m = L.marker(latlng, { icon })
        m.bindPopup(popup, { closeButton: false })
        m.addTo(layer)
        markers.set(v.vehicleId, m)
      }
    }
  }, [vehicles])

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="relative w-full rounded-xl overflow-hidden border border-ink-100" style={{ height }}>
      {/* The div Leaflet attaches to — must have explicit dimensions */}
      <div ref={containerRef} className="w-full h-full" />

      {/* Live indicator (top-left corner) */}
      {vehicles.length > 0 && (
        <div
          className="absolute top-2 left-2 z-[1000] flex items-center gap-1.5
                     bg-white/90 backdrop-blur-sm rounded-lg px-2 py-1 shadow-sm
                     pointer-events-none"
        >
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block" />
          <span className="text-[10px] font-semibold text-ink-700">
            {vehicles.length} vehicle{vehicles.length !== 1 ? 's' : ''} live
          </span>
        </div>
      )}

      {/* Error badge */}
      {vehicleError && (
        <div
          className="absolute top-2 left-2 z-[1000]
                     bg-red-50 border border-red-200 rounded-lg px-2 py-1 shadow-sm
                     pointer-events-none"
        >
          <span className="text-[10px] text-red-600">⚠ {vehicleError}</span>
        </div>
      )}
    </div>
  )
}
