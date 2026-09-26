import { useHealthMetricSeries } from '../../hooks/useHealthExport'
import { computeDailySeries } from '../../healthAggregate'

// Inspired by Apple Health's activity rings (Move/Exercise/Stand) — own
// palette, own goal defaults (no per-user goal setting exists yet).
// Apple's Move/Exercise/Stand ring colours are identity data users know by
// colour (THEME.md §2.5), so they stay literal in both themes.
const RINGS = [
  { key: 'active_energy',       label: 'Move',     unit: 'kcal', goal: 500, color: '#f43f5e' },
  { key: 'apple_exercise_time', label: 'Exercise',  unit: 'min',  goal: 30,  color: '#22c55e' },
  { key: 'apple_stand_hour',    label: 'Stand',     unit: 'hr',   goal: 12,  color: '#38bdf8' },
] as const

// Takes the day being viewed rather than hardcoding today: the rings are
// part of the Overview section, and Health now has ONE shared day selector
// at the top, so "go back a day" has to move this too — it used to stay
// pinned to today no matter what the rest of the page was showing.
function useRingValue(metricKey: string, dateStr: string) {
  const { data: points = [], isLoading } = useHealthMetricSeries(metricKey, dateStr, dateStr)
  const series = computeDailySeries(metricKey, points)
  return { value: series[0]?.value ?? 0, isLoading }
}

function RingArc({ cx, cy, r, pct, color, strokeWidth }: {
  cx: number; cy: number; r: number; pct: number; color: string; strokeWidth: number
}) {
  const circumference = 2 * Math.PI * r
  const filled = Math.min(1, Math.max(0, pct)) * circumference
  return (
    <>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeOpacity={0.15} strokeWidth={strokeWidth} />
      <circle
        cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeDasharray={`${filled} ${circumference}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
        className="transition-all duration-700 ease-out"
      />
    </>
  )
}

export function ActivityRings({ dateStr }: { dateStr: string }) {
  const move = useRingValue('active_energy', dateStr)
  const exercise = useRingValue('apple_exercise_time', dateStr)
  const stand = useRingValue('apple_stand_hour', dateStr)
  const values = [move.value, exercise.value, stand.value]
  const loading = move.isLoading || exercise.isLoading || stand.isLoading

  const size = 176
  const center = size / 2
  const strokeWidth = 14
  const gap = 3

  return (
    <div className="card flex w-fit max-w-full flex-wrap items-center gap-4 p-4 sm:gap-5 sm:p-5">
      {/* Ring shrinks on a phone (viewBox keeps the geometry; only the rendered
          box size changes) so it doesn't dominate the mobile viewport. */}
      <div className="relative shrink-0 w-[132px] h-[132px] sm:w-[176px] sm:h-[176px]">
        {loading && <div className="skeleton absolute inset-0 !rounded-full" />}
        <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full">
          {RINGS.map((ring, i) => {
            const r = center - strokeWidth / 2 - i * (strokeWidth + gap)
            return (
              <RingArc
                key={ring.key}
                cx={center} cy={center} r={r}
                pct={values[i] / ring.goal}
                color={ring.color}
                strokeWidth={strokeWidth}
              />
            )
          })}
        </svg>
      </div>

      <div className="flex flex-col gap-2.5 min-w-[140px]">
        {RINGS.map((ring, i) => (
          <div key={ring.key} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: ring.color }} />
            <span className="flex-1 text-meta text-fg-muted">{ring.label}</span>
            <span className="text-body font-bold tabular-nums text-fg">
              {Math.round(values[i])}
              <span className="text-micro font-normal text-fg-muted">/{ring.goal} {ring.unit}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
