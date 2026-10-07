import { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useProgressDataContext } from './progressDataContext'
import { actionLabel, improvementScore } from '../progress-engine/copy'
import type { ExerciseProgressResult, CanonicalExerciseSession, CurrentAction, EvidenceLevel, ProgressMetricKind } from '../progress-engine/types'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import { Card, EmptyState, TonePill, cx, type Tone } from '../../../shared/ui'
import { DecisionDetail, DisclosureButton, EvidencePill, ExposureLine } from './decisionParts'
import { RECENT_DAYS, filterByTab, isUnchanged, type DecisionTab } from './decisionTabs'
import {
  NO_FILTERS, applyDecisionFilters, effectiveFilters, filtersActive, muscleOptions, muscleRoleFor, routineOptions,
  type DecisionFilters, type MuscleRoleInExercise,
} from './decisionFilters'
import { DecisionFilterBar } from './DecisionFilterBar'

// Below 44rem of the card's own width the rows stack as cards; wider, a dense
// decision table. Each row expands its own drill-down in place, by mouse,
// touch or keyboard (the exercise name is a real button). Nothing here
// re-derives the algorithm (progress-engine/, settled rules in
// docs/training/progress-engine/); it only renders, filters
// (decisionFilters.ts) and sorts it.

type Tab = DecisionTab
const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'recent', label: 'Recent changes', hint: 'Every exercise you trained in the last 14 days, most recent first. “No change” means the load and reps matched last time.' },
  { id: 'increase', label: 'Ready to increase', hint: 'Every prescribed set reached the top of the range — try the next load.' },
  { id: 'building', label: 'Building', hint: 'Keep the load and add reps toward the top of the range.' },
  { id: 'attention', label: 'Needs attention', hint: 'Below the minimum, a load reduction to check, or a plateau/decline at this load.' },
  { id: 'all', label: 'All exercises', hint: 'Every current-program exercise you have logged, including ones with only one session so far.' },
]

type SortMode = 'recent' | 'action_priority' | 'largest_improvement' | 'closest_to_progression' | 'lowest_confidence'
const SORTS: { id: SortMode; label: string }[] = [
  { id: 'recent', label: 'Most recently trained' },
  { id: 'action_priority', label: 'Action priority' },
  { id: 'largest_improvement', label: 'Largest improvement' },
  { id: 'closest_to_progression', label: 'Closest to progression' },
  { id: 'lowest_confidence', label: 'Lowest confidence' },
]

const ACTION_PRIORITY_RANK: Record<CurrentAction, number> = {
  READY_TO_INCREASE: 0, CONFIRM_BEFORE_INCREASING: 1, WATCH_FOR_REGRESSION: 1, WATCH_FOR_PLATEAU: 1,
  CONFIRM_AT_CURRENT_LOAD: 2, REVIEW_LOAD_REDUCTION: 2, LOG_COMPARABLE_SESSION: 2,
  HOLD_STEADY: 3, BUILD_AT_CURRENT_LOAD: 3, INSUFFICIENT_DATA: 4,
}

const EVIDENCE_RANK: Record<EvidenceLevel, number> = { limited: 0, moderate: 1, strong: 2 }

const ACTION_TONE: Record<CurrentAction, Tone> = {
  READY_TO_INCREASE:         'success',
  BUILD_AT_CURRENT_LOAD:     'info',
  CONFIRM_BEFORE_INCREASING: 'warn',
  CONFIRM_AT_CURRENT_LOAD:   'warn',
  REVIEW_LOAD_REDUCTION:     'warn',
  HOLD_STEADY:               'info',
  WATCH_FOR_PLATEAU:         'warn',
  WATCH_FOR_REGRESSION:      'danger',
  INSUFFICIENT_DATA:         'neutral',
  LOG_COMPARABLE_SESSION:    'neutral',
}

function sortDecisions(list: ExerciseProgressResult[], sort: SortMode): ExerciseProgressResult[] {
  const arr = [...list]
  switch (sort) {
    case 'action_priority':
      return arr.sort((a, b) => ACTION_PRIORITY_RANK[a.currentAction] - ACTION_PRIORITY_RANK[b.currentAction])
    case 'largest_improvement':
      return arr.sort((a, b) => improvementScore(b) - improvementScore(a))
    case 'closest_to_progression': {
      const gapToTop = (d: ExerciseProgressResult) => {
        const latestSets = d.currentState.latest?.sets.filter(s => s.kind !== 'dropset') ?? []
        const worst = latestSets.length ? Math.min(...latestSets.map(s => s.reps ?? 0)) : null
        if (worst == null || d.expectation.repMax == null) return Infinity
        return Math.max(0, d.expectation.repMax - worst)
      }
      return arr.sort((a, b) => gapToTop(a) - gapToTop(b))
    }
    case 'lowest_confidence':
      return arr.sort((a, b) => EVIDENCE_RANK[a.evidence.progress] - EVIDENCE_RANK[b.evidence.progress])
    case 'recent':
    default:
      return arr.sort((a, b) => (b.currentState.latest?.date ?? '').localeCompare(a.currentState.latest?.date ?? ''))
  }
}

/** Under a Muscle filter: how this exercise trains the picked muscle. */
type MuscleRoleTag = { role: MuscleRoleInExercise; muscle: string }

type RowProps = {
  result: ExerciseProgressResult; sessions: CanonicalExerciseSession[]; metricKind: ProgressMetricKind; title: string
  noChange?: boolean; muscleRole?: MuscleRoleTag | null
}

function NoChangePill() {
  return <TonePill tone="neutral">No change</TonePill>
}

// "Secondary muscle" on its own reads next to the evidence pills; the muscle
// itself is the one picked in the filter (named for screen readers).
function MuscleRoleChip({ role, muscle }: MuscleRoleTag) {
  const meaning = role === 'primary' ? `${muscle} is this exercise's primary muscle` : `${muscle} is a secondary (helper) muscle in this exercise`
  return (
    <span title={meaning} className={cx('chip shrink-0', role === 'secondary' && 'text-fg-muted')}>
      <span className="sr-only">{muscle}: </span>{role === 'primary' ? 'Primary muscle' : 'Secondary muscle'}
    </span>
  )
}

function ToggleName({ open, onToggle, title }: { open: boolean; onToggle: () => void; title: string }) {
  return (
    <button
      type="button" aria-expanded={open} onClick={e => { e.stopPropagation(); onToggle() }}
      className="flex min-h-[44px] items-center gap-1.5 text-left text-body font-semibold text-fg"
    >
      <ChevronDown aria-hidden className={`h-4 w-4 shrink-0 text-fg-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      <span>{title}</span>
    </button>
  )
}

function DecisionRow({ result, sessions, metricKind, title, noChange, muscleRole }: RowProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      {/* The name button is the keyboard/AT control; a click anywhere on the row is a mouse convenience. */}
      <tr className="cursor-pointer border-b border-line hover:bg-surface-hover" onClick={() => setOpen(v => !v)}>
        <td className="px-3 py-1">
          <div className="flex flex-wrap items-center gap-x-2">
            <ToggleName open={open} onToggle={() => setOpen(v => !v)} title={title} />
            {muscleRole && <MuscleRoleChip {...muscleRole} />}
          </div>
        </td>
        <td className="px-3 py-2.5"><ExposureLine result={result} />{noChange && <> <NoChangePill /></>}</td>
        <td className="px-3 py-2.5"><TonePill tone={ACTION_TONE[result.currentAction]}>{actionLabel(result.currentAction)}</TonePill></td>
        <td className="px-3 py-2.5"><EvidencePill level={result.evidence.progress} label="Trend evidence" /></td>
        <td className="px-3 py-2.5">{result.evidence.recommendation ? <EvidencePill level={result.evidence.recommendation} label="Decision evidence" /> : <span className="text-meta text-fg-faint">—</span>}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className="px-3 pb-2"><DecisionDetail result={result} sessions={sessions} metricKind={metricKind} title={title} /></td>
        </tr>
      )}
    </>
  )
}

function DecisionCard({ result, sessions, metricKind, title, noChange, muscleRole }: RowProps) {
  const [open, setOpen] = useState(false)
  return (
    <li className="rounded-row border border-line px-3 pb-3 pt-1">
      <div className="flex items-center justify-between gap-2">
        <ToggleName open={open} onToggle={() => setOpen(v => !v)} title={title} />
        <TonePill tone={ACTION_TONE[result.currentAction]} className="shrink-0">{actionLabel(result.currentAction)}</TonePill>
      </div>
      <div className="mt-0.5"><ExposureLine result={result} />{noChange && <> <NoChangePill /></>}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <EvidencePill level={result.evidence.progress} label="Trend evidence" />
        {result.evidence.recommendation && <EvidencePill level={result.evidence.recommendation} label="Decision evidence" />}
        {muscleRole && <MuscleRoleChip {...muscleRole} />}
      </div>
      {open && <DecisionDetail result={result} sessions={sessions} metricKind={metricKind} title={title} />}
    </li>
  )
}

export function ExerciseDecisionTable() {
  const {
    isLoading, needsCurrentProgram, decisions, titleById, sessionsByTemplateId, metricKindByTemplateId,
    musclesByTemplateId, routineIdsByTemplateId, activeRoutines, today,
  } = useProgressDataContext()
  const [tab, setTab] = useState<Tab>('recent')
  const [sort, setSort] = useState<SortMode>('recent')
  const [picked, setPicked] = useState<DecisionFilters>(NO_FILTERS)
  const [showInsufficient, setShowInsufficient] = useState(false)

  // Options come from every decision, not the open tab's, so a pick survives a tab change.
  const muscles = useMemo(() => muscleOptions(decisions, musclesByTemplateId), [decisions, musclesByTemplateId])
  const routines = useMemo(() => routineOptions(decisions, activeRoutines, routineIdsByTemplateId), [decisions, activeRoutines, routineIdsByTemplateId])
  const filters = useMemo(() => effectiveFilters(picked, muscles, routines), [picked, muscles, routines])
  const filterData = useMemo(() => ({ titleById, musclesByTemplateId, routineIdsByTemplateId, today }), [titleById, musclesByTemplateId, routineIdsByTemplateId, today])

  const filtered = useMemo(() => filterByTab(decisions, tab, today), [decisions, tab, today])
  const searched = useMemo(() => applyDecisionFilters(filtered, filters, filterData), [filtered, filters, filterData])
  const shown = useMemo(() => sortDecisions(searched, sort), [searched, sort])
  // Recent and All list single-session exercises themselves; the fold only
  // collects the ones the open view doesn't show — narrowed by the same filters.
  const insufficient = useMemo(() => {
    const listed = new Set(filtered.map(d => d.exerciseTemplateId))
    const rest = decisions.filter(d => d.currentAction === 'INSUFFICIENT_DATA' && !listed.has(d.exerciseTemplateId))
    return applyDecisionFilters(rest, filters, filterData)
  }, [decisions, filtered, filters, filterData])

  if (isLoading || needsCurrentProgram) return null
  if (decisions.length === 0) {
    return (
      <Card><EmptyState title="No current-program exercises logged in this window yet" className="py-6" /></Card>
    )
  }

  const anyFilter = filtersActive(filters)
  const muscleLabel = muscles.find(m => m.slug === filters.muscle)?.label ?? null
  const roleOf = (templateId: string): MuscleRoleTag | null => {
    if (!muscleLabel) return null
    const role = muscleRoleFor(musclesByTemplateId.get(templateId), filters.muscle)
    return role ? { role, muscle: muscleLabel } : null
  }

  // Table or stacked cards by the card's OWN width (a side-by-side layout
  // can make it narrow on a laptop), not the viewport's.
  return (
    <Card className="@container">
      <div role="tablist" aria-label="Decision view" className="scroll-x -mx-1 mb-1 flex gap-1 px-1 sm:flex-wrap">
        {TABS.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className="pill-tab shrink-0 px-3">
            {t.label}
          </button>
        ))}
      </div>
      <p className="mb-3 text-meta text-fg-muted">{TABS.find(t => t.id === tab)?.hint}</p>

      <DecisionFilterBar
        filters={filters} onChange={p => setPicked(f => ({ ...f, ...p }))} onClear={() => setPicked(NO_FILTERS)} active={anyFilter}
        sort={sort} sortOptions={SORTS} onSortChange={id => setSort(id as SortMode)}
        muscles={muscles} routines={routines} shown={shown.length} total={filtered.length}
      />

      {shown.length === 0 ? (
        <p className="py-4 text-center text-body text-fg-muted">
          {anyFilter
            ? 'No exercises in this view match these filters.'
            : tab === 'recent' ? `Nothing trained in the last ${RECENT_DAYS} days — see All exercises for every lift.` : 'No exercises in this view.'}
        </p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto @[44rem]:block">
            <table className="w-full">
              <thead>
                <tr className="section-label border-b border-line-strong text-left">
                  <th className="py-2 px-3">Exercise</th>
                  <th className="py-2 px-3">Last time → latest</th>
                  <th className="py-2 px-3">Decision</th>
                  <th className="py-2 px-3">
                    <span className="inline-flex items-center gap-1">Trend evidence <InfoBubble><b>Trend evidence</b> How much history backs the trend read: Strong = 6+ comparable sessions over 3+ weeks in the recent window, Moderate = 4+ over 2+ weeks, Limited = less.</InfoBubble></span>
                  </th>
                  <th className="py-2 px-3">
                    <span className="inline-flex items-center gap-1">Decision evidence <InfoBubble><b>Decision evidence</b> How complete the latest session was for this decision: Strong = every prescribed set logged and checked, Moderate = only the top set (or a set count off the prescription), Limited = a data-quality flag such as a missing set.</InfoBubble></span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map(d => (
                  <DecisionRow
                    key={d.exerciseTemplateId} result={d}
                    sessions={sessionsByTemplateId.get(d.exerciseTemplateId) ?? []}
                    metricKind={metricKindByTemplateId.get(d.exerciseTemplateId) ?? 'est1rm'}
                    title={titleById.get(d.exerciseTemplateId) ?? 'Unknown exercise'}
                    noChange={tab === 'recent' && isUnchanged(d)}
                    muscleRole={roleOf(d.exerciseTemplateId)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile stacked cards */}
          <ul className="flex flex-col gap-2 @[44rem]:hidden">
            {shown.map(d => (
              <DecisionCard
                key={d.exerciseTemplateId} result={d}
                sessions={sessionsByTemplateId.get(d.exerciseTemplateId) ?? []}
                metricKind={metricKindByTemplateId.get(d.exerciseTemplateId) ?? 'est1rm'}
                title={titleById.get(d.exerciseTemplateId) ?? 'Unknown exercise'}
                noChange={tab === 'recent' && isUnchanged(d)}
                muscleRole={roleOf(d.exerciseTemplateId)}
              />
            ))}
          </ul>
        </>
      )}

      {insufficient.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <DisclosureButton open={showInsufficient} onClick={() => setShowInsufficient(v => !v)}>
            {showInsufficient ? 'Hide' : 'Show'} {insufficient.length} exercise{insufficient.length === 1 ? '' : 's'} without enough data yet
          </DisclosureButton>
          {showInsufficient && (
            <ul className="mt-2 flex flex-col gap-1">
              {insufficient.map(d => (
                <li key={d.exerciseTemplateId} className="flex items-center justify-between border-b border-line py-1.5 text-meta text-fg-2 last:border-0">
                  <span>{titleById.get(d.exerciseTemplateId) ?? 'Unknown exercise'}</span>
                  <span className="tabular-nums text-fg-muted">{d.comparableSessions} session{d.comparableSessions === 1 ? '' : 's'} logged</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  )
}
