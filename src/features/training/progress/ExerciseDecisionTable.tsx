import { useMemo, useState } from 'react'
import { useProgressData } from '../hooks/useProgressData'
import { actionLabel, improvementScore } from '../progress-engine/copy'
import type { ExerciseProgressResult, CanonicalExerciseSession, CurrentAction, EvidenceLevel, ProgressMetricKind } from '../progress-engine/types'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import { Card, EmptyState, TonePill, type Tone } from '../../../shared/ui'
import { DecisionDetail, DisclosureButton, EvidencePill, ExposureLine } from './decisionParts'

// Desktop: a dense decision table. Mobile (<640px): the same rows stack as
// cards. A tap on any row expands its own drill-down detail in place —
// the SAME inline-expansion mechanism this repo has used here since before
// the Phase 2/3 engine rewrite, kept unchanged per the approved contract.
//
// This is the corrected production wiring of the progress engine
// (src/features/training/progress-engine/) approved across several rounds
// of algorithm review — see docs/training/progress-engine/ for the settled
// rules. Every row now reads observedTransition/repDelta/rangeCompliance/
// evaluationScope/dataQualityFlags/currentAction/trend/evidence as
// independent facets (never one collapsed status), shows the real GIF via
// the SAME shared resolver ExerciseTemplatesTab already uses, a per-set-
// position Next Target floor, full per-set session history (never a
// representative weight glued onto every set's reps), and a metric-aware
// progress chart — nothing here re-derives the algorithm; it only renders it.

type Tab = 'recent' | 'increase' | 'building' | 'attention' | 'all'
const TABS: { id: Tab; label: string }[] = [
  { id: 'recent', label: 'Recent changes' },
  { id: 'increase', label: 'Ready to increase' },
  { id: 'building', label: 'Building at new weight' },
  { id: 'attention', label: 'Needs attention' },
  { id: 'all', label: 'All exercises' },
]

type SortMode = 'recent' | 'action_priority' | 'largest_improvement' | 'closest_to_progression' | 'lowest_confidence'
const SORTS: { id: SortMode; label: string }[] = [
  { id: 'recent', label: 'Most recently trained' },
  { id: 'action_priority', label: 'Action priority' },
  { id: 'largest_improvement', label: 'Largest improvement' },
  { id: 'closest_to_progression', label: 'Closest to progression' },
  { id: 'lowest_confidence', label: 'Lowest confidence' },
]

type DateWindow = 'all' | '4w' | '8w' | '12w'
const DATE_WINDOWS: { id: DateWindow; label: string }[] = [
  { id: 'all', label: 'All time' },
  { id: '4w', label: 'Last 4 weeks' },
  { id: '8w', label: 'Last 8 weeks' },
  { id: '12w', label: 'Last 12 weeks' },
]

const ACTION_PRIORITY_RANK: Record<CurrentAction, number> = {
  READY_TO_INCREASE: 0, CONFIRM_BEFORE_INCREASING: 1, WATCH_FOR_REGRESSION: 1, WATCH_FOR_PLATEAU: 1,
  CONFIRM_AT_CURRENT_LOAD: 2, REVIEW_LOAD_REDUCTION: 2, HOLD_STEADY: 2,
  BUILD_AT_CURRENT_LOAD: 3, INSUFFICIENT_DATA: 4,
}
const EVIDENCE_RANK: Record<EvidenceLevel, number> = { limited: 0, moderate: 1, strong: 2 }

const ACTION_TONE: Record<CurrentAction, Tone> = {
  READY_TO_INCREASE:         'success',
  BUILD_AT_CURRENT_LOAD:     'info',
  CONFIRM_BEFORE_INCREASING: 'warn',
  CONFIRM_AT_CURRENT_LOAD:   'warn',
  REVIEW_LOAD_REDUCTION:     'warn',
  HOLD_STEADY:               'neutral',
  WATCH_FOR_PLATEAU:         'warn',
  WATCH_FOR_REGRESSION:      'danger',
  INSUFFICIENT_DATA:         'neutral',
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

function withinDateWindow(result: ExerciseProgressResult, window: DateWindow): boolean {
  if (window === 'all') return true
  const latestDate = result.currentState.latest?.date
  if (!latestDate) return true
  const weeks = window === '4w' ? 4 : window === '8w' ? 8 : 12
  const cutoff = Date.now() - weeks * 7 * 86_400_000
  return new Date(latestDate + 'T00:00:00').getTime() >= cutoff
}

function DecisionRow({ result, sessions, metricKind, title }: { result: ExerciseProgressResult; sessions: CanonicalExerciseSession[]; metricKind: ProgressMetricKind; title: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <tr className="cursor-pointer border-b border-line hover:bg-surface-hover" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <td className="px-3 py-2.5 text-body font-semibold text-fg">{title}</td>
        <td className="px-3 py-2.5"><ExposureLine result={result} /></td>
        <td className="px-3 py-2.5"><TonePill tone={ACTION_TONE[result.currentAction]}>{actionLabel(result.currentAction)}</TonePill></td>
        <td className="px-3 py-2.5"><EvidencePill level={result.evidence.progress} label="Progress evidence" /></td>
        <td className="px-3 py-2.5">{result.evidence.recommendation ? <EvidencePill level={result.evidence.recommendation} label="Recommendation evidence" /> : <span className="text-meta text-fg-faint">—</span>}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className="px-3 pb-2"><DecisionDetail result={result} sessions={sessions} metricKind={metricKind} title={title} /></td>
        </tr>
      )}
    </>
  )
}

function DecisionCard({ result, sessions, metricKind, title }: { result: ExerciseProgressResult; sessions: CanonicalExerciseSession[]; metricKind: ProgressMetricKind; title: string }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="cursor-pointer rounded-row border border-line p-3" aria-expanded={open} onClick={() => setOpen(v => !v)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-body font-semibold text-fg">{title}</span>
        <TonePill tone={ACTION_TONE[result.currentAction]} className="shrink-0">{actionLabel(result.currentAction)}</TonePill>
      </div>
      <div className="mt-1"><ExposureLine result={result} /></div>
      <div className="mt-1.5 flex items-center gap-2">
        <EvidencePill level={result.evidence.progress} label="Progress evidence" />
        {result.evidence.recommendation && <EvidencePill level={result.evidence.recommendation} label="Recommendation evidence" />}
      </div>
      {open && <DecisionDetail result={result} sessions={sessions} metricKind={metricKind} title={title} />}
    </li>
  )
}

function filterByTab(decisions: ExerciseProgressResult[], tab: Tab): ExerciseProgressResult[] {
  const withDecision = decisions.filter(d => d.currentAction !== 'INSUFFICIENT_DATA')
  switch (tab) {
    case 'increase':  return withDecision.filter(d => d.currentAction === 'READY_TO_INCREASE')
    case 'building':  return withDecision.filter(d => d.currentAction === 'BUILD_AT_CURRENT_LOAD' || d.currentAction === 'CONFIRM_AT_CURRENT_LOAD' || d.currentAction === 'CONFIRM_BEFORE_INCREASING')
    case 'attention': return withDecision.filter(d => d.currentAction === 'WATCH_FOR_PLATEAU' || d.currentAction === 'WATCH_FOR_REGRESSION' || d.currentAction === 'REVIEW_LOAD_REDUCTION' || d.currentAction === 'HOLD_STEADY')
    case 'all':       return withDecision
    case 'recent':
    default:          return withDecision
  }
}

export function ExerciseDecisionTable() {
  const {
    isLoading, needsCurrentProgram, decisions, titleById, sessionsByTemplateId, metricKindByTemplateId,
    muscleGroupByTemplateId, routineTitlesByTemplateId,
  } = useProgressData()
  const [tab, setTab] = useState<Tab>('recent')
  const [sort, setSort] = useState<SortMode>('recent')
  const [query, setQuery] = useState('')
  const [evidenceFilter, setEvidenceFilter] = useState<'any' | EvidenceLevel>('any')
  const [dateWindow, setDateWindow] = useState<DateWindow>('all')
  const [muscleFilter, setMuscleFilter] = useState<string>('any')
  const [routineFilter, setRoutineFilter] = useState<string>('any')
  const [showInsufficient, setShowInsufficient] = useState(false)

  const muscleOptions = useMemo(() => {
    const set = new Set<string>()
    for (const d of decisions) { const m = muscleGroupByTemplateId.get(d.exerciseTemplateId); if (m) set.add(m) }
    return [...set].sort()
  }, [decisions, muscleGroupByTemplateId])
  const routineOptions = useMemo(() => {
    const set = new Set<string>()
    for (const d of decisions) { for (const r of routineTitlesByTemplateId.get(d.exerciseTemplateId) ?? []) set.add(r) }
    return [...set].sort()
  }, [decisions, routineTitlesByTemplateId])

  const filtered = useMemo(() => filterByTab(decisions, tab), [decisions, tab])
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = filtered
    if (q) list = list.filter(d => (titleById.get(d.exerciseTemplateId) ?? '').toLowerCase().includes(q))
    if (evidenceFilter !== 'any') list = list.filter(d => d.evidence.progress === evidenceFilter)
    if (muscleFilter !== 'any') list = list.filter(d => muscleGroupByTemplateId.get(d.exerciseTemplateId) === muscleFilter)
    if (routineFilter !== 'any') list = list.filter(d => (routineTitlesByTemplateId.get(d.exerciseTemplateId) ?? []).includes(routineFilter))
    list = list.filter(d => withinDateWindow(d, dateWindow))
    return list
  }, [filtered, query, titleById, evidenceFilter, dateWindow, muscleFilter, routineFilter, muscleGroupByTemplateId, routineTitlesByTemplateId])
  const shown = useMemo(() => sortDecisions(searched, sort), [searched, sort])
  const insufficient = useMemo(() => decisions.filter(d => d.currentAction === 'INSUFFICIENT_DATA'), [decisions])

  if (isLoading || needsCurrentProgram) return null
  if (decisions.length === 0) {
    return (
      <Card><EmptyState title="No current-program exercises logged in this window yet" className="py-6" /></Card>
    )
  }

  const filtersActive = query || evidenceFilter !== 'any' || dateWindow !== 'all' || muscleFilter !== 'any' || routineFilter !== 'any'

  return (
    <Card>
      <div role="tablist" aria-label="Decision view" className="scroll-x -mx-1 mb-3 flex gap-1 px-1 sm:flex-wrap">
        {TABS.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className="pill-tab shrink-0 px-3">
            {t.label}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search exercise…" aria-label="Search exercise"
          className="input w-full sm:w-56"
        />
        <label className="flex items-center gap-1.5 text-meta text-fg-muted">
          Sort:
          <select value={sort} onChange={e => setSort(e.target.value as SortMode)} className="select py-0 text-meta">
            {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-meta text-fg-muted">
          Evidence:
          <select value={evidenceFilter} onChange={e => setEvidenceFilter(e.target.value as 'any' | EvidenceLevel)} className="select py-0 text-meta">
            <option value="any">Any</option>
            <option value="limited">Limited</option>
            <option value="moderate">Moderate</option>
            <option value="strong">Strong</option>
          </select>
        </label>
        {muscleOptions.length > 0 && (
          <label className="flex items-center gap-1.5 text-meta text-fg-muted">
            Muscle:
            <select value={muscleFilter} onChange={e => setMuscleFilter(e.target.value)} className="select py-0 text-meta">
              <option value="any">Any</option>
              {muscleOptions.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        )}
        {routineOptions.length > 0 && (
          <label className="flex items-center gap-1.5 text-meta text-fg-muted">
            Routine:
            <select value={routineFilter} onChange={e => setRoutineFilter(e.target.value)} className="select py-0 text-meta">
              <option value="any">Any</option>
              {routineOptions.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        )}
        <label className="flex items-center gap-1.5 text-meta text-fg-muted">
          Window:
          <select value={dateWindow} onChange={e => setDateWindow(e.target.value as DateWindow)} className="select py-0 text-meta">
            {DATE_WINDOWS.map(w => <option key={w.id} value={w.id}>{w.label}</option>)}
          </select>
        </label>
        {filtersActive && (
          <button type="button" onClick={() => { setQuery(''); setEvidenceFilter('any'); setDateWindow('all'); setMuscleFilter('any'); setRoutineFilter('any') }} className="btn-ghost btn-sm text-meta !text-accent-600">
            Clear filters
          </button>
        )}
        <span className="ml-auto text-meta tabular-nums text-fg-muted">{shown.length} of {filtered.length}</span>
      </div>

      {shown.length === 0 ? (
        <p className="py-4 text-center text-body text-fg-muted">No exercises in this view yet.</p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="section-label border-b border-line-strong text-left">
                  <th className="py-2 px-3">Exercise</th>
                  <th className="py-2 px-3">Previous → Latest</th>
                  <th className="py-2 px-3">Decision</th>
                  <th className="py-2 px-3">
                    <span className="inline-flex items-center gap-1">Progress <InfoBubble><b>Progress evidence</b>How much history supports the recent trend read. Never touched by effort/RPE data.</InfoBubble></span>
                  </th>
                  <th className="py-2 px-3">
                    <span className="inline-flex items-center gap-1">Recommendation <InfoBubble><b>Recommendation evidence</b>How much the current action&apos;s own inputs hold up — data completeness and target quality. Never affected by missing effort/RPE data.</InfoBubble></span>
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
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile stacked cards */}
          <ul className="sm:hidden flex flex-col gap-2">
            {shown.map(d => (
              <DecisionCard
                key={d.exerciseTemplateId} result={d}
                sessions={sessionsByTemplateId.get(d.exerciseTemplateId) ?? []}
                metricKind={metricKindByTemplateId.get(d.exerciseTemplateId) ?? 'est1rm'}
                title={titleById.get(d.exerciseTemplateId) ?? 'Unknown exercise'}
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
