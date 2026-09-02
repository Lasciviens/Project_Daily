import { useProgressData, type MuscleDoseCard } from '../hooks/useProgressData'
import { InfoBubble } from '../../../shared/components/InfoBubble'

// ALL muscles actually trained under the current program, not a
// priority-filtered subset. Two real corrections from live user feedback
// (2026-09-02):
//  1. "Expected" is now derived from the CURRENT PROGRAM'S OWN routine
//     structure (one full pass through every routine in it), never a
//     generic population landmark — "below minimum" warnings that don't
//     come from the athlete's own program aren't trustworthy.
//  2. Muscle GROWTH OVER TIME is now visible per muscle (a small trend
//     line across the last 6 weeks), not just a single latest number —
//     the whole point of this section is "is this muscle actually
//     developing", which a bare current count can't answer.
// `exclude_direct` muscles show a plain, literal statement and nothing
// else — never a warning, and their real (indirect) dose stays visible.

function directionArrow(direction: MuscleDoseCard['direction']): { symbol: string; tone: string } {
  if (direction === 'improving') return { symbol: '↑', tone: 'text-green-700' }
  if (direction === 'declining') return { symbol: '↓', tone: 'text-red-600' }
  if (direction === 'flat') return { symbol: '→', tone: 'text-ink-400' }
  return { symbol: '·', tone: 'text-ink-300' }
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="h-8" />
  const max = Math.max(...values, 1)
  return (
    <div className="flex items-end gap-0.5 h-8">
      {values.map((v, i) => (
        <div key={i} className="flex-1 bg-accent-400/60 rounded-sm" style={{ height: `${Math.max(6, (v / max) * 100)}%` }} title={`${v} sets`} />
      ))}
    </div>
  )
}

function MuscleCell({ card }: { card: MuscleDoseCard }) {
  const excluded = card.preference === 'exclude_direct'
  const arrow = directionArrow(card.direction)

  if (excluded) {
    return (
      <div className="rounded-xl border border-ink-200 p-3 opacity-70">
        <p className="text-xs font-semibold text-ink-700 mb-1">{card.label}</p>
        <p className="text-xs text-ink-400">Direct training excluded by preference</p>
      </div>
    )
  }

  return (
    <div className={`rounded-xl border p-3 ${card.preference === 'priority' ? 'border-accent-400 ring-1 ring-accent-200' : 'border-ink-200'}`}>
      <div className="flex items-center justify-between gap-1 mb-1.5">
        <span className="text-xs font-semibold text-ink-800 truncate">
          {card.label}{card.preference === 'priority' && <span className="text-accent-600"> ★</span>}
        </span>
        <span className={`text-sm font-bold ${arrow.tone}`}>{arrow.symbol}</span>
      </div>
      <Sparkline values={card.weeklyTrend} />
      <div className="mt-1.5 text-[11px] text-ink-500 tabular-nums flex flex-col gap-0.5">
        <span>Completed this week: <b className="text-ink-800">{card.weeklySets}</b></span>
        {card.routineExpectation != null ? (
          <>
            <span>Routine expectation: <b className="text-ink-800">{card.routineExpectation}</b></span>
            <span className={card.gap != null && card.gap < 0 ? 'text-amber-700' : 'text-green-700'}>
              Gap: {card.gap != null && card.gap > 0 ? '+' : ''}{card.gap}
            </span>
          </>
        ) : (
          <span className="text-ink-400">Routine expectation: not enough data</span>
        )}
        {card.preference === 'priority' && <span className="text-accent-600">Priority: Yes</span>}
      </div>
      {card.restriction && (
        <p className="text-[10px] text-violet-600 mt-1">Active {card.restriction} limitation reaches this muscle.</p>
      )}
    </div>
  )
}

export function MuscleDoseSummary() {
  const { isLoading, needsCurrentProgram, muscles } = useProgressData()

  if (isLoading || needsCurrentProgram) return null
  if (muscles.length === 0) return null

  return (
    <div className="bg-cream-50 border border-ink-200 rounded-2xl p-4 sm:p-5">
      <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400 mb-1 flex items-center gap-1.5">
        Weekly muscle dose
        <InfoBubble>
          <b>Routine expectation</b>What ONE full pass through every routine in your current program calls for, per muscle per week — not a generic population minimum. Assumes you run your program roughly once a week; a faster or slower cycle will read as over/under its own target even if followed exactly.
        </InfoBubble>
      </p>
      <p className="text-xs text-ink-500 mb-3">
        Every muscle actually trained under your current program, with the last 6 weeks&apos; trend so you can see growth, not just a snapshot.
        Priority muscles (★) stand out; a muscle you&apos;ve excluded from direct work shows that plainly instead of a warning.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {muscles.map(m => <MuscleCell key={m.slug} card={m} />)}
      </div>
    </div>
  )
}
