import { useState } from 'react'
import { Trophy } from 'lucide-react'
import { useHevyPRs } from '../hooks/useHevyPRs'
import { fmtTrainingDate as formatDate } from '../dateFormat'
import { ExerciseThumb } from '../exerciseMedia'
import { formatSet, formatKg } from '../setFormat'
import { topLoadRecords, type PersonalRecord } from '../personalRecords'
import { Card, EmptyState, Skeleton, SkeletonText } from '../../../shared/ui'

// ─────────────────────────────────────────────────────────────────────────────
//  Personal records (definition: personalRecords.ts — the same "best" the
//  progress engine uses, all-time). Hover-peek ("detail on demand"): one
//  dense line per record; the GIF, muscle, best est. 1RM and date live in a
//  peek card on hover (desktop) or tap (mobile).
// ─────────────────────────────────────────────────────────────────────────────

/** A record is only shown once the exercise has three sessions — a one-off
 *  heavy single (a machine tried once, a spotted rep) is noise, not a record. */
const MIN_TIMES = 3

const METRIC_NOTE: Partial<Record<PersonalRecord['metric_kind'], string>> = {
  assistedWeight: 'Least assistance',
  reps:           'Most reps',
  duration:       'Longest set',
  distance:       'Longest distance',
}

function recordText(pr: PersonalRecord): string {
  return formatSet(pr, pr.exercise_type)
}

function PeekCard({ pr }: { pr: PersonalRecord }) {
  return (
    <div className="absolute left-0 right-0 top-full z-popover mt-1 flex items-start gap-3 rounded-menu border border-line-strong bg-surface p-3 shadow-menu animate-fadeSlideIn">
      <ExerciseThumb title={pr.title} templateId={pr.exercise_template_id} size={72} />
      <div className="flex min-w-0 flex-col gap-1 text-meta">
        <span className="font-semibold text-fg">{pr.title}</span>
        {pr.primary_muscle_group && <span className="chip w-fit capitalize">{pr.primary_muscle_group.replace(/_/g, ' ')}</span>}
        <span className="text-fg-2">
          {METRIC_NOTE[pr.metric_kind] ?? 'Best'}: <strong className="tabular-nums">{recordText(pr)}</strong>
        </span>
        {pr.best_est_1rm != null && (
          <span className="text-fg-muted">Best est. 1RM ≈ <strong className="tabular-nums text-fg-2">{formatKg(pr.best_est_1rm)}</strong></span>
        )}
        <span className="tabular-nums text-fg-muted">First set {formatDate(pr.achieved_at)} · {pr.times_performed} sessions</span>
      </div>
    </div>
  )
}

// ─── Best lifts (top 5 by weight) ─────────────────────────────────────────────

function BestLiftsCard({ muscleFilter }: { muscleFilter: string }) {
  const { data: prs = [], isLoading } = useHevyPRs()
  const [peekId, setPeekId] = useState<string | null>(null)

  if (isLoading) return <Skeleton rounded="rounded-card" className="mb-3 h-24 max-w-md" />

  // Weight × reps exercises only (an assisted pull-up's assistance or a
  // plank's seconds aren't comparable to a squat), recomputed against the
  // muscle filter below.
  const top5 = topLoadRecords(prs, 5, { muscle: muscleFilter === 'All' ? null : muscleFilter, minTimes: MIN_TIMES })
  if (top5.length === 0) return null

  return (
    <Card padded={false} className="mb-3 max-w-md">
      <div className="border-b border-line px-4 py-2.5">
        <p className="section-label">
          Top 5 lifts by weight{muscleFilter !== 'All' ? <span className="capitalize"> · {muscleFilter.replace(/_/g, ' ')}</span> : ''}
        </p>
      </div>
      <div className="divide-y divide-line">
        {top5.map((pr, i) => {
          const open = peekId === pr.exercise_template_id
          return (
            <div
              key={pr.exercise_template_id}
              className="relative"
              onMouseEnter={() => setPeekId(pr.exercise_template_id)}
              onMouseLeave={() => setPeekId(p => (p === pr.exercise_template_id ? null : p))}
            >
              <button
                type="button"
                onClick={() => setPeekId(open ? null : pr.exercise_template_id)}
                aria-expanded={open}
                className={`flex min-h-[44px] w-full items-center gap-3 px-4 py-2 text-left transition-colors ${open ? 'bg-surface-hover' : 'hover:bg-surface-hover'}`}
              >
                <span className="w-5 shrink-0 text-meta font-bold tabular-nums text-fg-faint">#{i + 1}</span>
                <span className="flex-1 truncate text-body font-medium text-fg">{pr.title}</span>
                <span className="shrink-0 text-body font-bold tabular-nums text-fg">{recordText(pr)}</span>
              </button>
              {open && <PeekCard pr={pr} />}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ─── Record list ──────────────────────────────────────────────────────────────

interface HevyPRListProps {
  // Controlled by the parent so the top-5 card recomputes against the same
  // muscle group selected here.
  activeGroup: string
  onActiveGroupChange: (group: string) => void
}

export function HevyPRList({ activeGroup, onActiveGroupChange }: HevyPRListProps) {
  const { data: prs, isLoading } = useHevyPRs()
  const [query, setQuery] = useState('')
  const [peekId, setPeekId] = useState<string | null>(null)

  if (isLoading) return <SkeletonText lines={6} className="max-w-md" />

  if (!prs || prs.length === 0) {
    return <EmptyState icon={<Trophy />} title="No personal records yet" description="Sync your Hevy data first." />
  }

  const eligible = prs.filter(pr => pr.times_performed >= MIN_TIMES)
  if (eligible.length === 0) {
    return <EmptyState icon={<Trophy />} title="No exercise trained 3+ times yet" description="Keep logging — records appear once an exercise has three sessions." />
  }

  const muscleGroups = Array.from(new Set(eligible.map(pr => pr.primary_muscle_group).filter(Boolean) as string[])).sort()
  const groupFiltered = activeGroup === 'All' ? eligible : eligible.filter(pr => pr.primary_muscle_group === activeGroup)

  // Substring match — "zzz" still finds "XXX ZZZ YYY".
  const q = query.trim().toLowerCase()
  const filtered = q ? groupFiltered.filter(pr => pr.title.toLowerCase().includes(q)) : groupFiltered
  const sorted = [...filtered].sort((a, b) => b.achieved_at.localeCompare(a.achieved_at) || a.title.localeCompare(b.title))

  return (
    <div className="flex flex-col gap-3">
      <p className="flex w-fit max-w-full items-center gap-2 rounded-row bg-surface-2 px-3 py-2 text-meta text-fg-2">
        <Trophy className="h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden />
        All-time best working set per exercise trained 3+ times (heaviest, or least assistance, most reps or longest for bodyweight and timed work), newest record first.
      </p>

      <input
        type="text"
        inputMode="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search exercises… (e.g. press, curl)"
        aria-label="Search exercises"
        className="input w-full max-w-md"
      />

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
            {group.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {sorted.length === 0 && <p className="py-6 text-body text-fg-muted">No exercises match “{query}”.</p>}
      {/* Fixed-width columns (15–18rem); leftover width stays on the right. */}
      <ul className="grid grid-cols-1 justify-start gap-x-3 sm:grid-cols-[repeat(auto-fill,minmax(15rem,18rem))]">
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
                aria-expanded={isOpen}
                className={`row w-full justify-between gap-2 px-2 text-left ${isOpen ? 'bg-surface-hover' : 'hover:bg-surface-hover'}`}
              >
                <span className="truncate text-body font-medium text-fg">{pr.title}</span>
                <span className="shrink-0 text-body font-semibold tabular-nums text-fg-2">{recordText(pr)}</span>
              </button>
              {isOpen && <PeekCard pr={pr} />}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** The Personal records sub-tab: best lifts card + the record list, sharing
 *  one muscle filter. */
export function PRsSubTab() {
  const [muscleFilter, setMuscleFilter] = useState<string>('All')
  return (
    <>
      <BestLiftsCard muscleFilter={muscleFilter} />
      <HevyPRList activeGroup={muscleFilter} onActiveGroupChange={setMuscleFilter} />
    </>
  )
}
