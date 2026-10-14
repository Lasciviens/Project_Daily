import { InfoBubble } from '../../../shared/components/InfoBubble'
import type { HealthWindow } from '../healthWindowStats'
import { useMetricWindow } from '../hooks/useHealthWindow'
import { DEFAULT_RING_GOALS, type RingGoals } from './ringGoals'

// Move / Exercise / Stand for one day, or the average day of the picked
// period (against the daily goal). Apple's ring colours are identity data
// users know by colour (THEME.md §2.5), so they stay literal in both themes.
//
// Ring GOALS: Health Auto Export doesn't send Apple's activity summary, so
// your real goals aren't in the data (checked against the full metric
// inventory). Until a health profile stores them, these are placeholders and
// the card says so, rather than presenting 500 kcal as if it were your goal
// (T41). Pass `goals` to use real ones.

const RINGS = [
  { key: 'active_energy',       goal: 'move' as const,     label: 'Move',     unit: 'kcal', color: '#f43f5e' },
  { key: 'apple_exercise_time', goal: 'exercise' as const, label: 'Exercise', unit: 'min',  color: '#22c55e' },
  { key: 'apple_stand_hour',    goal: 'stand' as const,    label: 'Stand',    unit: 'hr',   color: '#38bdf8' },
]

// That day's value, or the average day of the period picked in the range bar
// (finished days only — today's rings are still filling). Reads the page
// window's range, so it shares the download the sections already made.
function useRingValue(metricKey: string, win: HealthWindow) {
  const { summary, isLoading } = useMetricWindow(metricKey, win)
  return { value: summary.value, isLoading }
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

export function ActivityRings({ win, goals }: { win: HealthWindow; goals?: Partial<RingGoals> }) {
  const g: RingGoals = { ...DEFAULT_RING_GOALS, ...goals }
  const usingDefaults = !goals || RINGS.some(r => goals[r.goal] == null)
  const move = useRingValue('active_energy', win)
  const exercise = useRingValue('apple_exercise_time', win)
  const stand = useRingValue('apple_stand_hour', win)
  const values = [move.value, exercise.value, stand.value]
  const loading = move.isLoading || exercise.isLoading || stand.isLoading
  const partial = win.isDay && win.to === win.today
  const note = partial ? 'So far today' : win.isDay ? null : 'Average per day'

  const size = 176
  const center = size / 2
  const strokeWidth = 14
  const gap = 3

  return (
    // Sized by the column it sits in (a 24rem side track on a wide page), not
    // the viewport: the wrapper is the container, since a w-fit card can't be one.
    <div className="@container">
    <div className="card flex w-fit max-w-full flex-wrap items-center gap-4 p-4 @[27rem]:gap-5 @[27rem]:p-5">
      <div className="relative h-[132px] w-[132px] shrink-0 @[27rem]:h-[176px] @[27rem]:w-[176px]">
        {loading && <div className="skeleton absolute inset-0 !rounded-full" />}
        <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full" role="img"
          aria-label={RINGS.map((r, i) => `${r.label} ${values[i] == null ? 'no data' : Math.round(values[i] as number)} of ${g[r.goal]} ${r.unit}`).join(', ')}>
          {RINGS.map((ring, i) => (
            <RingArc key={ring.key} cx={center} cy={center} r={center - strokeWidth / 2 - i * (strokeWidth + gap)}
              pct={(values[i] ?? 0) / g[ring.goal]} color={ring.color} strokeWidth={strokeWidth} />
          ))}
        </svg>
      </div>

      <div className="flex min-w-[150px] flex-col gap-2.5">
        {RINGS.map((ring, i) => (
          <div key={ring.key} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: ring.color }} />
            <span className="flex-1 text-meta text-fg-muted">{ring.label}</span>
            <span className="text-body font-bold tabular-nums text-fg">
              {values[i] == null ? '—' : Math.round(values[i] as number)}
              <span className="text-micro font-normal text-fg-muted">/{g[ring.goal]} {ring.unit}</span>
            </span>
          </div>
        ))}
        <div className="flex items-center gap-1 text-micro text-fg-muted">
          {note}{note && usingDefaults ? ' · ' : null}
          {usingDefaults && (
            <>
              Placeholder goals
              <InfoBubble label="About the ring goals">
                Apple Health doesn't export your own Move, Exercise and Stand goals, so these rings use placeholder
                goals (500 kcal, 30 min, 12 hours). The values themselves are yours.
              </InfoBubble>
            </>
          )}
        </div>
      </div>
    </div>
    </div>
  )
}
