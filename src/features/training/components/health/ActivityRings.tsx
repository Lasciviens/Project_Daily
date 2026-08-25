import { useHealthMetricSeries } from '../../hooks/useHealthExport'
import { computeDailySeries } from '../../healthAggregate'

// Inspired by Apple Health's activity rings (Move/Exercise/Stand) — own
// palette, own goal defaults (no per-user goal setting exists yet).
const RINGS = [
  { key: 'active_energy',       label: 'Move',     unit: 'kcal', goal: 500, color: '#f43f5e', icon: '🔥' },
  { key: 'apple_exercise_time', label: 'Exercise',  unit: 'min',  goal: 30,  color: '#22c55e', icon: '⚡' },
  { key: 'apple_stand_hour',    label: 'Stand',     unit: 'hr',   goal: 12,  color: '#38bdf8', icon: '🧍' },
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
    <div className="bg-cream-50 border border-ink-200 rounded-2xl p-3 sm:p-4 flex items-center gap-4 sm:gap-5 flex-wrap">
      {/* Ring shrinks on a phone (viewBox keeps the geometry; only the rendered
          box size changes) so it doesn't dominate the mobile viewport. */}
      <div className="relative shrink-0 w-[132px] h-[132px] sm:w-[176px] sm:h-[176px]">
        {loading && <div className="absolute inset-0 rounded-full bg-cream-100 animate-pulse" />}
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
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: ring.color }} />
            <span className="text-sm">{ring.icon}</span>
            <span className="text-xs text-ink-500 flex-1">{ring.label}</span>
            <span className="text-sm font-bold text-ink-900">
              {Math.round(values[i])}
              <span className="text-[10px] font-normal text-ink-400">/{ring.goal} {ring.unit}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
