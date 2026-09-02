import { useMemo, useState } from 'react'
import { useProgressData } from '../hooks/useProgressData'
import { decisionHeadline, statusVerb, confidenceLabel, composeConfidenceSentence } from '../progressCopy'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import type { ExerciseDecision } from '../progressDecisions'

// Desktop: a dense decision table. Mobile (<640px): the same rows stack as
// cards. A tap on any row expands its own drill-down detail in place.
//
// Real fixes from live user testing (2026-09-02, round 3):
//  - The old "Immediate actions" strip duplicated the table below it with
//    no new information — removed. A single set of tabs now IS the primary
//    navigation: Recent Changes (default, sorted by most recently trained)
//    / Ready to Increase / Building at New Weight / Needs Attention / All.
//  - Every row now shows the actual last-comparable-workout -> latest-
//    workout numbers directly (never just a bare unlabeled derived number)
//    — this is the PRIMARY evidence a user recognizes on sight.
//  - The specific reason ("Successful load increase" vs "Rep progression"
//    vs "Build at this weight") comes from decisionHeadline(), which reads
//    the decision's reasonCodes — not a generic status label that hid a
//    real, already-successful load increase behind "Keep this weight".
//  - A name search box + a sort dropdown (recent / action priority / largest
//    improvement / closest to progression / lowest confidence) sit above
//    the tabs, independent of which tab is active. NOT yet built: filtering
//    by muscle group, specific routine/workout, or a date range — the user
//    asked for these too, but they need muscle/routine data this component
//    doesn't have yet (see docs/progress-redesign/PLAN.md's Round 3 section
//    for the stated fast-follow).

type Tab = 'recent' | 'increase' | 'building' | 'attention' | 'all'
const TABS: { id: Tab; label: string }[] = [
  { id: 'recent', label: 'Recent Changes' },
  { id: 'increase', label: 'Ready to Increase' },
  { id: 'building', label: 'Building at New Weight' },
  { id: 'attention', label: 'Needs Attention' },
  { id: 'all', label: 'All Exercises' },
]

type SortMode = 'recent' | 'action_priority' | 'largest_improvement' | 'closest_to_progression' | 'lowest_confidence'
const SORTS: { id: SortMode; label: string }[] = [
  { id: 'recent', label: 'Most recently trained' },
  { id: 'action_priority', label: 'Action priority' },
  { id: 'largest_improvement', label: 'Largest improvement' },
  { id: 'closest_to_progression', label: 'Closest to progression' },
  { id: 'lowest_confidence', label: 'Lowest confidence' },
]

const ACTION_PRIORITY_RANK: Record<ExerciseDecision['status'], number> = {
  increase: 0, watch: 1, plateau: 1, keep: 2, insufficient_data: 3,
}
const CONFIDENCE_RANK: Record<'low' | 'medium' | 'high', number> = { low: 0, medium: 1, high: 2 }

function sortDecisions(list: ExerciseDecision[], sort: SortMode): ExerciseDecision[] {
  const arr = [...list]
  switch (sort) {
    case 'action_priority':
      return arr.sort((a, b) => ACTION_PRIORITY_RANK[a.status] - ACTION_PRIORITY_RANK[b.status])
    case 'largest_improvement':
      return arr.sort((a, b) => (b.currentState?.loadChangePercent ?? -Infinity) - (a.currentState?.loadChangePercent ?? -Infinity))
    case 'closest_to_progression': {
      // Smaller gap to the target's top rep = closer to a real increase.
      const gapToTop = (d: ExerciseDecision) => {
        const reps = d.currentState?.latest?.reps
        if (reps == null || d.expectation.repMax == null) return Infinity
        return Math.max(0, d.expectation.repMax - reps)
      }
      return arr.sort((a, b) => gapToTop(a) - gapToTop(b))
    }
    case 'lowest_confidence':
      return arr.sort((a, b) => CONFIDENCE_RANK[a.trendConfidence] - CONFIDENCE_RANK[b.trendConfidence])
    case 'recent':
    default:
      return arr.sort((a, b) => (b.currentState?.latest?.date ?? '').localeCompare(a.currentState?.latest?.date ?? ''))
  }
}

const STATUS_TONE: Record<ExerciseDecision['status'], string> = {
  increase:          'bg-green-100 text-green-700',
  keep:              'bg-accent-100 text-accent-700',
  watch:             'bg-amber-100 text-amber-700',
  plateau:           'bg-amber-100 text-amber-700',
  insufficient_data: 'bg-ink-100 text-ink-500',
}

function ConfidencePill({ level, label }: { level: 'low' | 'medium' | 'high'; label: string }) {
  const tone = level === 'high' ? 'bg-green-100 text-green-700' : level === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-ink-100 text-ink-500'
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${tone}`} title={label}>{confidenceLabel(level).replace(' confidence', '')}</span>
}

function fmtExposure(e: { weightKg: number | null; reps: number | null } | null | undefined): string {
  if (!e) return '—'
  if (e.weightKg != null && e.reps != null) return `${e.weightKg} kg × ${e.reps}`
  if (e.reps != null) return `${e.reps} reps`
  if (e.weightKg != null) return `${e.weightKg} kg`
  return '—'
}

function ExposureLine({ decision }: { decision: ExerciseDecision }) {
  if (!decision.currentState) return null
  return (
    <span className="text-xs text-ink-600 tabular-nums">
      {fmtExposure(decision.currentState.previous)} <span className="text-ink-300">→</span> <span className="font-semibold text-ink-800">{fmtExposure(decision.currentState.latest)}</span>
      {decision.currentState.loadChangePercent != null && decision.currentState.loadChangePercent !== 0 && (
        <span className={decision.currentState.loadChangePercent > 0 ? 'text-green-700' : 'text-amber-700'}> ({decision.currentState.loadChangePercent > 0 ? '+' : ''}{decision.currentState.loadChangePercent}%)</span>
      )}
    </span>
  )
}

function DecisionDetail({ decision }: { decision: ExerciseDecision }) {
  return (
    <div className="bg-cream-100 rounded-xl p-3 mt-2 flex flex-col gap-2">
      <p className="text-xs font-semibold text-ink-700">
        {composeConfidenceSentence(decision.trendConfidence, decision.actionConfidence, decision.rpeEvidence != null)}
      </p>
      <ul className="flex flex-col gap-1">
        {decision.evidence.map((e, i) => (
          <li key={i} className="text-xs text-ink-600 flex items-start gap-1.5">
            <span className="text-ink-300 shrink-0">—</span><span>{e}</span>
          </li>
        ))}
      </ul>
      {decision.currentState?.estimatedStrengthChange && (
        <p className="text-[11px] text-ink-500 flex items-center gap-1">
          Estimated strength (secondary): {decision.currentState.estimatedStrengthChange.fromKg} kg → {decision.currentState.estimatedStrengthChange.toKg} kg
          <InfoBubble><b>Estimated 1RM</b>A rough estimate of your one-rep max, calculated from weight × reps (Epley formula) — not a tested number. Example: 10 kg for 8 reps estimates to about 12.7 kg. Useful for a rough direction only; the real sets above are what actually happened.</InfoBubble>
        </p>
      )}
      {decision.caveat && (
        <p className="text-xs italic text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">{decision.caveat}</p>
      )}
      <p className="text-[11px] text-ink-400">Expectation: {decision.expectation.label} · Next: {decision.nextCheck}</p>
    </div>
  )
}

function DecisionRow({ decision, title }: { decision: ExerciseDecision; title: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <tr className="border-b border-ink-100 cursor-pointer hover:bg-cream-100" onClick={() => setOpen(v => !v)}>
        <td className="py-2.5 px-3 text-sm font-semibold text-ink-800">{title}</td>
        <td className="py-2.5 px-3"><ExposureLine decision={decision} /></td>
        <td className="py-2.5 px-3">
          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${STATUS_TONE[decision.status]}`}>
            {statusVerb(decision.status)} {decisionHeadline(decision)}
          </span>
        </td>
        <td className="py-2.5 px-3"><ConfidencePill level={decision.trendConfidence} label="Trend confidence — is this exercise really progressing?" /></td>
        <td className="py-2.5 px-3">{decision.actionConfidence ? <ConfidencePill level={decision.actionConfidence} label="Action confidence — how sure we are about THIS recommendation specifically" /> : <span className="text-ink-300 text-xs">—</span>}</td>
        <td className="py-2.5 px-3 text-xs text-ink-500">{decision.nextCheck}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} className="px-3 pb-2"><DecisionDetail decision={decision} /></td>
        </tr>
      )}
    </>
  )
}

function DecisionCard({ decision, title }: { decision: ExerciseDecision; title: string }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="rounded-xl border border-ink-200 p-3" onClick={() => setOpen(v => !v)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink-800">{title}</span>
        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold shrink-0 ${STATUS_TONE[decision.status]}`}>
          {statusVerb(decision.status)} {decisionHeadline(decision)}
        </span>
      </div>
      <div className="mt-1"><ExposureLine decision={decision} /></div>
      <div className="flex items-center gap-2 mt-1.5">
        <ConfidencePill level={decision.trendConfidence} label="Trend confidence" />
        {decision.actionConfidence && <ConfidencePill level={decision.actionConfidence} label="Action confidence" />}
        <span className="text-[11px] text-ink-400 ml-auto">{decision.nextCheck}</span>
      </div>
      {open && <DecisionDetail decision={decision} />}
    </li>
  )
}

function filterByTab(decisions: ExerciseDecision[], tab: Tab): ExerciseDecision[] {
  const withDecision = decisions.filter(d => d.status !== 'insufficient_data')
  switch (tab) {
    case 'increase':  return withDecision.filter(d => d.status === 'increase')
    case 'building':  return withDecision.filter(d => d.status === 'keep')
    case 'attention': return withDecision.filter(d => d.status === 'watch' || d.status === 'plateau')
    case 'all':       return withDecision
    case 'recent':
    default:          return withDecision
  }
}

export function ExerciseDecisionTable() {
  const { isLoading, needsCurrentProgram, decisions, titleById } = useProgressData()
  const [tab, setTab] = useState<Tab>('recent')
  const [sort, setSort] = useState<SortMode>('recent')
  const [query, setQuery] = useState('')
  const [showInsufficient, setShowInsufficient] = useState(false)

  const filtered = useMemo(() => filterByTab(decisions, tab), [decisions, tab])
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return filtered
    return filtered.filter(d => (titleById.get(d.templateId) ?? '').toLowerCase().includes(q))
  }, [filtered, query, titleById])
  const shown = useMemo(() => sortDecisions(searched, sort), [searched, sort])
  const insufficient = useMemo(() => decisions.filter(d => d.status === 'insufficient_data'), [decisions])

  if (isLoading || needsCurrentProgram) return null
  if (decisions.length === 0) {
    return (
      <div className="bg-cream-50 border border-ink-200 rounded-2xl p-4 text-center">
        <p className="text-sm text-ink-500">No current-program exercises logged in this window yet.</p>
      </div>
    )
  }

  return (
    <div className="bg-cream-50 border border-ink-200 rounded-2xl p-4 sm:p-5">
      <div className="flex flex-wrap gap-1.5 mb-3">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`min-h-[36px] px-3 rounded-full text-xs font-semibold transition-colors ${
              tab === t.id ? 'bg-ink-900 text-white' : 'bg-cream-100 text-ink-600 hover:bg-cream-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search exercise…"
          className="min-h-[36px] px-3 rounded-lg border border-ink-200 bg-cream-100 text-xs text-ink-700 max-w-[14rem] w-full sm:w-auto"
        />
        <label className="flex items-center gap-1.5 text-xs text-ink-500">
          Sort:
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortMode)}
            className="min-h-[36px] px-2 rounded-lg border border-ink-200 bg-cream-100 text-xs text-ink-700"
          >
            {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-ink-500 py-4 text-center">No exercises in this view yet.</p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-ink-400 border-b-2 border-ink-200">
                  <th className="py-2 px-3">Exercise</th>
                  <th className="py-2 px-3">Previous → Latest</th>
                  <th className="py-2 px-3">Decision</th>
                  <th className="py-2 px-3">
                    <span className="inline-flex items-center gap-1">Trend <InfoBubble><b>Trend confidence</b>Is this exercise really progressing? Based only on sample size, time span and consistency — never touched by effort/RPE data.</InfoBubble></span>
                  </th>
                  <th className="py-2 px-3">
                    <span className="inline-flex items-center gap-1">Action <InfoBubble><b>Action confidence</b>How sure we are about THIS specific recommendation. Capped lower than trend confidence when effort (RPE) wasn&apos;t logged.</InfoBubble></span>
                  </th>
                  <th className="py-2 px-3">Next check</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(d => <DecisionRow key={d.templateId} decision={d} title={titleById.get(d.templateId) ?? 'Unknown exercise'} />)}
              </tbody>
            </table>
          </div>

          {/* Mobile stacked cards */}
          <ul className="sm:hidden flex flex-col gap-2">
            {shown.map(d => <DecisionCard key={d.templateId} decision={d} title={titleById.get(d.templateId) ?? 'Unknown exercise'} />)}
          </ul>
        </>
      )}

      {insufficient.length > 0 && (
        <div className="mt-3 pt-3 border-t border-ink-100">
          <button
            type="button"
            onClick={() => setShowInsufficient(v => !v)}
            className="text-xs font-semibold text-ink-500 hover:text-ink-800"
          >
            {showInsufficient ? '▲ Hide' : '▼ Show'} {insufficient.length} exercise{insufficient.length === 1 ? '' : 's'} without enough data yet
          </button>
          {showInsufficient && (
            <ul className="mt-2 flex flex-col gap-1">
              {insufficient.map(d => (
                <li key={d.templateId} className="text-xs text-ink-500 flex items-center justify-between py-1.5 border-b border-ink-50 last:border-0">
                  <span>{titleById.get(d.templateId) ?? 'Unknown exercise'}</span>
                  <span className="text-ink-400">{d.comparableSessions} session{d.comparableSessions === 1 ? '' : 's'} · needs {d.nextCheck.toLowerCase()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
