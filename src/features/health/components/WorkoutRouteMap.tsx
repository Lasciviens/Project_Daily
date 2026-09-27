import { Map as MapIcon } from 'lucide-react'
import { useChartColors } from '../../../shared/ui'

// SVG polyline of the GPS route (no map tiles — CSP blocks external hosts, and
// a shape is enough to recognise the route). Projected to local metres with
// ONE scale for both axes: longitude degrees shrink by cos(latitude), so
// stretching each axis to fill the box independently distorted every route at
// Oslo's ~60°N (H-18).
export function WorkoutRouteMap({ route }: { route: unknown[] }) {
  const c = useChartColors()
  const pts = route
    .map(p => ({ lat: Number((p as Record<string, unknown>)?.latitude), lon: Number((p as Record<string, unknown>)?.longitude) }))
    .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon))
  if (pts.length < 2) return null
  const meanLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length
  const k = Math.cos((meanLat * Math.PI) / 180)
  const xy = pts.map(p => ({ x: p.lon * k, y: p.lat }))
  // A loop, not Math.min(...xs): a long ride's per-second route can exceed
  // the engine's argument limit.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of xy) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y
  }
  const W = 320, H = 200, PAD = 12
  const scale = Math.min((W - 2 * PAD) / Math.max(maxX - minX, 1e-9), (H - 2 * PAD) / Math.max(maxY - minY, 1e-9))
  const offX = (W - (maxX - minX) * scale) / 2, offY = (H - (maxY - minY) * scale) / 2
  const sx = (x: number) => offX + (x - minX) * scale
  const sy = (y: number) => H - (offY + (y - minY) * scale) // north up
  const d = xy.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ')
  return (
    <div className="rounded-row border border-line bg-surface p-2">
      <p className="section-label mb-1 flex items-center gap-1 px-1"><MapIcon className="h-3.5 w-3.5" aria-hidden /> Route</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" aria-hidden="true">
        <path d={d} fill="none" stroke={c.series[0]} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={sx(xy[0].x)} cy={sy(xy[0].y)} r={4} fill={c.success} />
        <circle cx={sx(xy[xy.length - 1].x)} cy={sy(xy[xy.length - 1].y)} r={4} fill={c.danger} />
      </svg>
    </div>
  )
}
