import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'
import { BarLineChart } from './BarLineChart'
import type { HealthWorkout } from '../../api/healthApi'

// ─────────────────────────────────────────────────────────────────────────────
//  HealthWorkoutDetail — surfaces the RICH per-workout data Health Auto Export
//  sends inside `raw` that the summary row never showed: a per-interval heart-
//  rate curve (avg + min/max band), GPS route map (outdoor), pace/speed,
//  cadence, distance, elevation, weather, HR recovery, step count. Everything
//  is read from the stored `raw` jsonb client-side (no schema change) — before
//  this, all of it was ingested and then ignored.
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- HAE workout `raw` is a free-form jsonb blob; we read a handful of fields defensively.
type Raw = Record<string, any>

// HAE numeric fields are either a plain number or a { qty, units } object.
function qty(v: unknown): number | null {
  if (typeof v === 'number') return v
  if (v && typeof v === 'object' && typeof (v as Raw).qty === 'number') return (v as Raw).qty
  return null
}

function hhmm(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function fmtDuration(seconds: number | null): string {
  if (!seconds) return '—'
  const mins = Math.round(seconds / 60)
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-cream-100/60 px-3 py-2 flex flex-col gap-0.5 min-w-[5rem]">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">{label}</span>
      <span className="text-base font-bold text-ink-900 leading-none tabular-nums">{value}</span>
      {sub && <span className="text-[10px] text-ink-400">{sub}</span>}
    </div>
  )
}

// Normalised SVG polyline of the GPS route (no map tiles — CSP blocks external
// hosts anyway, and a shape is enough to recognise the run). lat north-up.
function RouteMap({ route }: { route: Raw[] }) {
  const pts = route
    .map(p => ({ lat: Number(p.latitude), lon: Number(p.longitude) }))
    .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon))
  if (pts.length < 2) return null
  const lats = pts.map(p => p.lat), lons = pts.map(p => p.lon)
  const minLat = Math.min(...lats), maxLat = Math.max(...lats)
  const minLon = Math.min(...lons), maxLon = Math.max(...lons)
  const W = 320, H = 200, PAD = 12
  // Keep aspect roughly correct: lon degrees shrink by cos(lat).
  const latRange = Math.max(maxLat - minLat, 1e-6)
  const lonRange = Math.max(maxLon - minLon, 1e-6)
  const sx = (lon: number) => PAD + ((lon - minLon) / lonRange) * (W - 2 * PAD)
  const sy = (lat: number) => PAD + (1 - (lat - minLat) / latRange) * (H - 2 * PAD)
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.lon).toFixed(1)},${sy(p.lat).toFixed(1)}`).join(' ')
  return (
    <div className="rounded-xl border border-ink-100 bg-cream-50 p-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-ink-400 mb-1 px-1">🗺️ Route</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" aria-hidden="true">
        <path d={d} fill="none" stroke="rgb(var(--accent-500))" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={sx(pts[0].lon)} cy={sy(pts[0].lat)} r={4} fill="#22c55e" />
        <circle cx={sx(pts[pts.length - 1].lon)} cy={sy(pts[pts.length - 1].lat)} r={4} fill="#ef4444" />
      </svg>
    </div>
  )
}

export function HealthWorkoutDetail({ workout, onClose }: { workout: HealthWorkout; onClose: () => void }) {
  const raw: Raw = workout.raw ?? {}

  // kcal (HAE sends energy in kcal despite our column being named *_kj).
  const active = workout.active_energy_kj ?? qty(raw.activeEnergyBurned)
  const total = workout.total_energy_kj ?? qty(raw.totalEnergy)
  const distance = qty(raw.distance)
  const avgSpeed = qty(raw.avgSpeed) ?? qty(raw.speed)
  const maxSpeed = qty(raw.maxSpeed)
  const cadence = qty(raw.stepCadence)
  const elevation = qty(raw.elevationUp)
  const temp = qty(raw.temperature)
  const humidity = qty(raw.humidity)
  const intensity = qty(raw.intensity)
  const steps = Array.isArray(raw.stepCount) ? Math.round(raw.stepCount.reduce((s: number, p: Raw) => s + (qty(p) ?? 0), 0)) : null
  const pace = avgSpeed && avgSpeed > 0 ? 60 / avgSpeed : null // min/km

  // HR curve — per-interval Avg with a faint [Min,Max] band.
  const hrSeries = Array.isArray(raw.heartRateData)
    ? raw.heartRateData
        .map((p: Raw) => ({ label: hhmm(p.date), avg: Math.round(Number(p.Avg)), range: [Math.round(Number(p.Min)), Math.round(Number(p.Max))] }))
        .filter((p: { avg: number }) => Number.isFinite(p.avg))
    : []

  const recovery = Array.isArray(raw.heartRateRecovery) && raw.heartRateRecovery.length > 1
    ? (() => {
        const vals = raw.heartRateRecovery.map((p: Raw) => Number(p.Avg)).filter(Number.isFinite)
        return vals.length > 1 ? Math.round(vals[0] - vals[vals.length - 1]) : null
      })()
    : null

  return (
    <Dialog open onClose={onClose} className="relative z-[60]">
      <DialogBackdrop transition className="fixed inset-0 bg-ink-900/30 transition duration-200 data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel transition className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-lg max-h-[90vh] overflow-y-auto bg-cream-50 border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95">
          <div className="h-1 bg-accent-500" />
          <div className="p-4 sm:p-5 flex flex-col gap-4">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-ink-900 truncate">{workout.name}</h2>
                <p className="text-xs text-ink-400">
                  {workout.start_time && new Date(workout.start_time).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                  {' · '}{hhmm(workout.start_time)}–{hhmm(workout.end_time)}
                  {raw.location && ` · ${raw.location}`}
                </p>
              </div>
              <button onClick={onClose} aria-label="Close" className="min-w-[36px] min-h-[36px] flex items-center justify-center text-ink-400 hover:text-ink-700 text-lg leading-none shrink-0">×</button>
            </div>

            {/* Stat chips (only render what exists) */}
            <div className="flex flex-wrap gap-2">
              <Stat label="Duration" value={fmtDuration(workout.duration_seconds)} />
              {total != null && <Stat label="Energy" value={`${Math.round(total)}`} sub="kcal total" />}
              {active != null && <Stat label="Active" value={`${Math.round(active)}`} sub="kcal" />}
              {workout.avg_heart_rate != null && <Stat label="Avg HR" value={`${Math.round(workout.avg_heart_rate)}`} sub={workout.max_heart_rate != null ? `max ${Math.round(workout.max_heart_rate)}` : 'bpm'} />}
              {distance != null && <Stat label="Distance" value={distance.toFixed(2)} sub="km" />}
              {pace != null && <Stat label="Pace" value={`${Math.floor(pace)}:${String(Math.round((pace % 1) * 60)).padStart(2, '0')}`} sub="min/km" />}
              {avgSpeed != null && <Stat label="Avg Speed" value={avgSpeed.toFixed(1)} sub={maxSpeed != null ? `max ${maxSpeed.toFixed(1)} km/h` : 'km/h'} />}
              {cadence != null && <Stat label="Cadence" value={`${Math.round(cadence)}`} sub="spm" />}
              {steps != null && steps > 0 && <Stat label="Steps" value={steps.toLocaleString('en-GB')} />}
              {elevation != null && elevation > 0 && <Stat label="Elevation" value={`${Math.round(elevation)}`} sub="m up" />}
              {recovery != null && <Stat label="HR Recovery" value={`${recovery}`} sub="bpm drop" />}
              {intensity != null && <Stat label="Intensity" value={intensity.toFixed(1)} sub="kcal/hr·kg" />}
              {temp != null && <Stat label="Weather" value={`${Math.round(temp)}°`} sub={humidity != null ? `${Math.round(humidity)}% hum` : undefined} />}
            </div>

            {/* HR curve */}
            {hrSeries.length > 1 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-ink-400 mb-1">❤️ Heart rate</p>
                <BarLineChart data={hrSeries} dataKey="avg" rangeKey="range" color="#e11d48" unit="bpm" tooltipLabel="Avg HR" height={160} />
              </div>
            )}

            {/* GPS route */}
            {Array.isArray(raw.route) && <RouteMap route={raw.route} />}
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
