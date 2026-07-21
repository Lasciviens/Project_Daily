import { useSleepSegments } from '../../hooks/useHealthExport'
import type { SleepSegment } from '../../api/healthApi'

// Classic hypnogram from Fitbit's timestamped stage segments — lanes top to
// bottom Awake/REM/Light/Deep, one colored block per segment. Renders nothing
// until fitbit-family segments exist for the viewed night (google-health-sync
// writes them; Apple never delivers per-segment stages, so this is the first
// true stage timeline in the app). Width-capped per the Width Standard (W4).
const LANES: { stage: SleepSegment['stage'] | 'asleep'; label: string; color: string }[] = [
  { stage: 'wake',  label: 'Awake', color: '#f59e0b' },
  { stage: 'rem',   label: 'REM',   color: '#a78bfa' },
  { stage: 'light', label: 'Light', color: '#60a5fa' },
  { stage: 'deep',  label: 'Deep',  color: '#4f46e5' },
]
const laneIndex = (stage: string) => {
  const i = LANES.findIndex(l => l.stage === stage)
  return i === -1 ? 2 : i // unknown/'asleep' renders in the Light lane
}

function fmtHm(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

export function FitbitHypnogram({ nightDate }: { nightDate: string }) {
  // The night attributed to `nightDate` = segments of sessions ENDING that
  // day (wake-day attribution, same rule as sleepNightKey). Fetch a generous
  // window around it and filter locally.
  const from = new Date(new Date(nightDate + 'T00:00:00').getTime() - 12 * 3600_000).toISOString()
  const to   = new Date(nightDate + 'T23:59:59').toISOString()
  const { data: segments = [] } = useSleepSegments(from, to)

  const night = segments.filter(s =>
    s.source_family === 'fitbit' &&
    new Date(s.end_at).toLocaleDateString('sv-SE') === nightDate)
  if (night.length === 0) return null

  const t0 = Math.min(...night.map(s => new Date(s.start_at).getTime()))
  const t1 = Math.max(...night.map(s => new Date(s.end_at).getTime()))
  const span = Math.max(1, t1 - t0)
  const W = 640, H = 96, LANE_H = H / LANES.length

  const totals = new Map<string, number>()
  for (const s of night) {
    const lane = LANES[laneIndex(s.stage)].stage
    totals.set(lane, (totals.get(lane) ?? 0) + (new Date(s.end_at).getTime() - new Date(s.start_at).getTime()))
  }
  const fmtDur = (ms: number) => {
    const m = Math.round(ms / 60000)
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
  }

  return (
    <div className="bg-cream-50 border border-ink-200 rounded-2xl p-4 max-w-2xl">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500">🛌 Sleep stages (Fitbit)</p>
        <p className="text-[11px] text-ink-400">{fmtHm(t0)} – {fmtHm(t1)}</p>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxWidth: 640 }} role="img" aria-label="Sleep stage timeline">
          {LANES.map((l, i) => (
            <g key={l.stage}>
              <line x1={0} x2={W} y1={i * LANE_H + LANE_H} y2={i * LANE_H + LANE_H} stroke="rgb(var(--ink-100))" strokeWidth={1} />
              <text x={2} y={i * LANE_H + 11} fontSize={9} fill="rgb(var(--ink-400))">{l.label}</text>
            </g>
          ))}
          {night.map(s => {
            const x = ((new Date(s.start_at).getTime() - t0) / span) * W
            const w = Math.max(1.5, ((new Date(s.end_at).getTime() - new Date(s.start_at).getTime()) / span) * W)
            const li = laneIndex(s.stage)
            return <rect key={s.id} x={x} y={li * LANE_H + 14} width={w} height={LANE_H - 18} rx={2} fill={LANES[li].color} />
          })}
        </svg>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {LANES.map(l => (
          <span key={l.stage} className="text-[11px] text-ink-500 flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: l.color }} />
            {l.label} {fmtDur(totals.get(l.stage) ?? 0)}
          </span>
        ))}
      </div>
    </div>
  )
}
