import { useProgressData, type MuscleDoseCard } from '../hooks/useProgressData'

// ALL muscles actually trained under the current program, not a
// priority-filtered subset — a real gap the second review round on this
// feature caught: filtering the default view down to priority + limited
// muscles can hide a genuine deficiency in a non-priority muscle (e.g.
// quads or back) simply because it isn't a personal focus right now.
// Priority muscles get a visual highlight; `exclude_direct` muscles are
// shown with their real dose but relabeled "Excluded by preference"
// instead of a warning — never removed from the grid.

function bandFor(card: MuscleDoseCard): { label: string; tone: string } {
  if (card.preference === 'exclude_direct') return { label: 'Excluded by preference', tone: 'bg-ink-100 text-ink-500' }
  if (card.expectedMev == null) return { label: '—', tone: 'bg-ink-100 text-ink-400' }
  if (card.weeklySets <= 0) return { label: 'Not trained', tone: 'bg-ink-200 text-ink-600' }
  if (card.weeklySets < card.expectedMev) return { label: 'Below minimum', tone: 'bg-red-100 text-red-700' }
  if (card.expectedMav != null && card.weeklySets <= card.expectedMav) return { label: 'On track', tone: 'bg-green-100 text-green-700' }
  return { label: 'High', tone: 'bg-amber-100 text-amber-700' }
}

function MuscleCell({ card }: { card: MuscleDoseCard }) {
  const band = bandFor(card)
  const excluded = card.preference === 'exclude_direct'
  return (
    <div className={`rounded-xl border p-2.5 ${card.preference === 'priority' ? 'border-accent-400 ring-1 ring-accent-200' : 'border-ink-200'} ${excluded ? 'opacity-70' : ''}`}>
      <div className="flex items-center justify-between gap-1 mb-1">
        <span className="text-xs font-semibold text-ink-800 truncate">
          {card.label}{card.preference === 'priority' && <span className="text-accent-600"> ★</span>}
        </span>
      </div>
      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${band.tone}`}>{band.label}</span>
      {!excluded && (
        <p className="text-[10px] text-ink-400 mt-1 tabular-nums">
          {card.weeklySets} sets/wk{card.expectedMev != null ? ` · expected ${card.expectedMev}-${card.expectedMav}` : ''}
        </p>
      )}
      {card.restriction && (
        <p className="text-[10px] text-violet-600 mt-0.5">Active {card.restriction} limitation reaches this muscle.</p>
      )}
    </div>
  )
}

export function MuscleDoseSummary() {
  const { isLoading, muscles } = useProgressData()

  if (isLoading) return <div className="h-40 rounded-2xl bg-cream-200 animate-pulse" />
  if (muscles.length === 0) return null

  return (
    <div className="bg-cream-50 border border-ink-200 rounded-2xl p-4 sm:p-5">
      <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400 mb-1">Weekly muscle dose</p>
      <p className="text-xs text-ink-500 mb-3">
        Every muscle actually trained under your current program — priority muscles (★) get more urgent messaging
        below MEV; a muscle you&apos;ve excluded from direct work still shows its real dose, just without a
        &quot;you have no direct work for this&quot; warning.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {muscles.map(m => <MuscleCell key={m.slug} card={m} />)}
      </div>
    </div>
  )
}
