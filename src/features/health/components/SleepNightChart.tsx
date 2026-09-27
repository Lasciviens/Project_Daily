import { AlarmClock, BedDouble } from 'lucide-react'
import { useChartColors } from '../../../shared/ui'
import { formatSleepHours as fmtHrs } from '../healthAggregate'
import { AWAKE_COLOR, SLEEP_COLOR } from './sleepStages'


const fmtClock = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// The Day-mode "WHEN YOU SLEPT" clock — a bedtime → wake header plus a real
// hour-axis band showing the asleep window(s) and any awake interruption
// between them. Deliberately NOT a per-stage hypnogram — the export carries
// whole-night stage TOTALS only (no per-stage timestamps), so stage timing on
// an axis would be invented precision; the stage split is its own bar.
export function SleepNightChart({ sessions }: { sessions: { startMs: number; endMs: number }[] }) {
  const c = useChartColors()
  const bedtime = sessions[0].startMs
  const wake    = sessions[sessions.length - 1].endMs
  const inBedH  = (wake - bedtime) / 3_600_000

  const PAD_MS = 20 * 60_000
  const min = bedtime - PAD_MS
  const max = wake + PAD_MS
  const span = Math.max(max - min, 60_000)
  const W = 640, H = 70, TOP = 8, BAND_H = 34, AXIS_Y = TOP + BAND_H + 15
  const x = (ms: number) => ((ms - min) / span) * W

  // Hour ticks — every 2h for long windows so labels don't crowd/overlap.
  const stepH = span > 11 * 3_600_000 ? 2 : 1
  const ticks: number[] = []
  const first = new Date(min); first.setMinutes(0, 0, 0)
  for (let t = first.getTime(); t <= max; t += stepH * 3_600_000) if (t >= min) ticks.push(t)

  return (
    <div className="max-w-2xl rounded-row border border-line bg-surface px-3 py-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="section-label">When you slept</p>
        <p className="flex items-center gap-1 text-meta tabular-nums text-fg-2">
          <BedDouble className="h-3.5 w-3.5 text-fg-muted" aria-label="Bedtime" /><span className="font-semibold">{fmtClock(bedtime)}</span>
          <span className="text-fg-faint"> → </span>
          <AlarmClock className="h-3.5 w-3.5 text-fg-muted" aria-label="Wake" /><span className="font-semibold">{fmtClock(wake)}</span>
          <span className="text-fg-muted"> · {fmtHrs(inBedH)} in bed</span>
        </p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" aria-hidden="true">
        {sessions.slice(1).map((s, i) => {
          const gapStart = sessions[i].endMs
          const gapEnd = s.startMs
          if (gapEnd <= gapStart) return null
          const w = x(gapEnd) - x(gapStart)
          return (
            <g key={`gap-${i}`}>
              <rect x={x(gapStart)} y={TOP} width={w} height={BAND_H} rx={4} fill={AWAKE_COLOR} fillOpacity={0.3} />
              {w > 26 && <text x={(x(gapStart) + x(gapEnd)) / 2} y={TOP + BAND_H / 2 + 3} textAnchor="middle" fontSize={8} fill={c.danger}>awake</text>}
            </g>
          )
        })}
        {sessions.map((s, i) => (
          <rect key={i} x={x(s.startMs)} y={TOP} width={Math.max(x(s.endMs) - x(s.startMs), 2)} height={BAND_H} rx={6} fill={SLEEP_COLOR} fillOpacity={0.9} />
        ))}
        <line x1={0} y1={AXIS_Y - 8} x2={W} y2={AXIS_Y - 8} stroke={c.grid} strokeWidth={1} />
        {ticks.map(t => (
          <g key={t}>
            <line x1={x(t)} y1={AXIS_Y - 11} x2={x(t)} y2={AXIS_Y - 5} stroke={c.grid} strokeWidth={1} />
            <text x={x(t)} y={AXIS_Y + 4} textAnchor="middle" fontSize={8.5} fill={c.axis}>
              {new Date(t).getHours().toString().padStart(2, '0')}
            </text>
          </g>
        ))}
      </svg>
      {sessions.length > 1 && (
        <p data-tone="warn" className="tone-text mt-1 text-micro font-medium">{sessions.length - 1} interruption{sessions.length > 2 ? 's' : ''} overnight (woke up, then back to sleep)</p>
      )}
    </div>
  )
}
