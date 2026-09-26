import { useState } from 'react'
import { useHevyPRs } from '../hooks/useHevyPRs'
import { fmtTrainingDate as formatDate } from '../dateFormat'
import { ExerciseThumb } from '../exerciseMedia'
import { Trophy } from 'lucide-react'
import { EmptyState, SkeletonText } from '../../../shared/ui'

// ─────────────────────────────────────────────────────────────────────────────
//  Hover-peek ("detail on demand"): one dense line per PR; the demo GIF,
//  muscle, estimated 1RM and date live in a peek card on hover (desktop) or
//  tap (mobile).
// ─────────────────────────────────────────────────────────────────────────────

// Epley estimate — the standard "what's my 1-rep max" formula from a
// weight×reps set. Rough by nature; labelled "est" in the UI.
function est1RM(weightKg: number, reps: number | null): number | null {
  if (reps == null || reps <= 0) return null
  if (reps === 1) return weightKg
  return Math.round(weightKg * (1 + reps / 30) * 10) / 10
}

interface HevyPRListProps {
  // Controlled by the parent (PRsSubTab) so the "Top 5 Lifts by Weight" card
  // recomputes against the same muscle group selected here.
  activeGroup: string
  onActiveGroupChange: (group: string) => void
}

export function HevyPRList({ activeGroup, onActiveGroupChange }: HevyPRListProps) {
  const { data: prs, isLoading } = useHevyPRs()
  const [query, setQuery] = useState('')
  // Which PR's peek card is open — hover on desktop, tap on mobile.
  const [peekId, setPeekId] = useState<string | null>(null)

  if (isLoading) {
    return <SkeletonText lines={6} className="max-w-md" />
  }

  if (!prs || prs.length === 0) {
    return (
      <EmptyState icon={<Trophy />} title="No personal records yet" description="Sync your Hevy data first." />
    )
  }

  // Only exercises trained at least 3 times — a one-off heavy single isn't a
  // real "personal record" worth tracking here, it's noise (a machine tried
  // once, a form check, a spotter-assisted rep).
  const eligible = prs.filter(pr => pr.times_performed >= 3)

  if (eligible.length === 0) {
    return (
      <EmptyState icon={<Trophy />} title="No exercise trained 3+ times yet" description="Keep logging — records appear once an exercise has three sessions." />
    )
  }

  const muscleGroups = Array.from(
    new Set(eligible.map(pr => pr.primary_muscle_group).filter(Boolean) as string[])
  ).sort()

  const groupFiltered = activeGroup === 'All'
    ? eligible
    : eligible.filter(pr => pr.primary_muscle_group === activeGroup)

  // Live substring match, not prefix-only — searching "zzz" must still find
  // "XXX ZZZ YYY" since the matching word can be anywhere in the title.
  const q = query.trim().toLowerCase()
  const filtered = q ? groupFiltered.filter(pr => pr.title.toLowerCase().includes(q)) : groupFiltered

  const sorted = [...filtered].sort(
    (a, b) => new Date(b.achieved_at).getTime() - new Date(a.achieved_at).getTime()
  )

  return (
    <div className="flex flex-col gap-3">
      {/* Info banner — content-sized, not a full-monitor-width band */}
      <p className="flex w-fit max-w-full items-center gap-2 rounded-row bg-surface-2 px-3 py-2 text-meta text-fg-2">
        <Trophy className="h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden />
        All-time heaviest lift per exercise trained 3+ times, most recent first. Weights in kg.
      </p>

      {/* Search — a text box never needs 1900px */}
      <input
        type="text"
        inputMode="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search exercises… (e.g. press, curl)"
        aria-label="Search exercises"
        className="input w-full max-w-md"
      />

      {/* Filter bar */}
      <div role="tablist" aria-label="Muscle group" className="scroll-x -mx-1 flex gap-1 px-1 sm:flex-wrap">
        {['All', ...muscleGroups].map(group => (
          <button
            key={group}
            type="button"
            role="tab"
            aria-selected={activeGroup === group}
            onClick={() => onActiveGroupChange(group)}
            className="pill-tab shrink-0 capitalize"
          >
            {group}
          </button>
        ))}
      </div>

      {/* PR list — dense single-line rows in an auto-packing grid; details
          peek on hover/tap instead of occupying permanent rows. */}
      {sorted.length === 0 && (
        <p className="py-6 text-body text-fg-muted">No exercises match “{query}”.</p>
      )}
      {/* Fixed-width columns (15–18rem); leftover width stays on the right. */}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,18rem))] gap-x-3 justify-start">
        {sorted.map(pr => {
          const isOpen = peekId === pr.exercise_template_id
          return (
            <li
              key={pr.exercise_template_id}
              className="relative"
              onMouseEnter={() => setPeekId(pr.exercise_template_id)}
              onMouseLeave={() => setPeekId(p => (p === pr.exercise_template_id ? null : p))}
            >
              <button
                type="button"
                onClick={() => setPeekId(isOpen ? null : pr.exercise_template_id)}
                className={`row w-full justify-between gap-2 px-2 text-left ${isOpen ? 'bg-surface-hover' : 'hover:bg-surface-hover'}`}
              >
                <span className="truncate text-body font-medium text-fg">{pr.title}</span>
                <span className="shrink-0 text-body font-semibold tabular-nums text-fg-2">
                  {pr.max_weight_kg}<span className="font-normal text-fg-muted"> kg</span>
                  {pr.reps_at_max != null && <span className="font-normal text-fg-muted"> ×{pr.reps_at_max}</span>}
                </span>
              </button>

              {/* Peek card — GIF + everything secondary, zero permanent cost */}
              {isOpen && (
                <div className="absolute left-0 right-0 top-full z-popover mt-1 flex items-start gap-3 rounded-menu border border-line-strong bg-surface p-3 shadow-menu animate-fadeSlideIn">
                  <ExerciseThumb title={pr.title} templateId={pr.exercise_template_id} size={72} />
                  <div className="flex min-w-0 flex-col gap-1 text-meta">
                    <span className="font-semibold text-fg">{pr.title}</span>
                    {pr.primary_muscle_group && <span className="chip w-fit capitalize">{pr.primary_muscle_group}</span>}
                    <span className="text-fg-2">
                      Best: <strong className="tabular-nums">{pr.max_weight_kg} kg{pr.reps_at_max != null ? ` × ${pr.reps_at_max}` : ''}</strong>
                    </span>
                    {est1RM(pr.max_weight_kg, pr.reps_at_max) != null && (
                      <span className="text-fg-muted">est. 1RM ≈ <strong className="tabular-nums text-fg-2">{est1RM(pr.max_weight_kg, pr.reps_at_max)} kg</strong></span>
                    )}
                    <span className="tabular-nums text-fg-muted">{formatDate(pr.achieved_at)}</span>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
