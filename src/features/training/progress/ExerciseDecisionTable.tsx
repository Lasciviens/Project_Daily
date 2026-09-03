import { useMemo, useState } from 'react'
import { useProgressData } from '../hooks/useProgressData'
import {
  actionLabel, evidenceLabel, scopeLabel, recentTrendLabel, currentLoadProgressLabel, buildExplanationSentence,
  progressEvidenceExplanation, recommendationEvidenceExplanation,
} from '../progress-engine/copy'
import { RULE_CATALOG } from '../progress-engine/ruleCatalog'
import type { ExerciseProgressResult, CanonicalExerciseSession, CanonicalSet, CurrentAction, EvidenceLevel, ProgressMetricKind } from '../progress-engine/types'
import { buildRepresentativePoints } from '../progress-engine/trend'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import { ExerciseThumb, ExerciseGifPicker } from '../exerciseMedia'
import { fmtTrainingDate as formatDate } from '../dateFormat'

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

const STATUS_TONE: Record<CurrentAction, string> = {
  READY_TO_INCREASE:        'bg-green-100 text-green-700',
  BUILD_AT_CURRENT_LOAD:    'bg-accent-100 text-accent-700',
  CONFIRM_BEFORE_INCREASING:'bg-amber-100 text-amber-700',
  CONFIRM_AT_CURRENT_LOAD:  'bg-amber-100 text-amber-700',
  REVIEW_LOAD_REDUCTION:    'bg-amber-100 text-amber-700',
  HOLD_STEADY:              'bg-ink-100 text-ink-500',
  WATCH_FOR_PLATEAU:        'bg-amber-100 text-amber-700',
  WATCH_FOR_REGRESSION:     'bg-red-100 text-red-700',
  INSUFFICIENT_DATA:        'bg-ink-100 text-ink-500',
}

// ── Metric-aware formatting (§8) — every set renders its OWN load/reps (or
// duration/distance/assistance), never a representative weight glued onto
// every set's rep count. ─────────────────────────────────────────────────
function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.floor(seconds / 60), s = Math.round(seconds % 60)
  return s === 0 ? `${m}m` : `${m}m ${s}s`
}

function formatSetLine(set: CanonicalSet, metricKind: ProgressMetricKind): string {
  const tag = set.kind !== 'normal' ? ` (${set.kind})` : ''
  switch (metricKind) {
    case 'duration':
      if (set.durationSeconds == null) return `—${tag}`
      return set.reps != null ? `${fmtDuration(set.durationSeconds)} × ${set.reps}${tag}` : `${fmtDuration(set.durationSeconds)}${tag}`
    case 'distance':
      if (set.distanceMeters == null) return `—${tag}`
      return set.durationSeconds != null ? `${set.distanceMeters} m in ${fmtDuration(set.durationSeconds)}${tag}` : `${set.distanceMeters} m${tag}`
    case 'assistedWeight':
      return set.weightKg != null ? `${set.weightKg} kg assist × ${set.reps ?? '—'}${tag}` : `${set.reps ?? '—'} reps${tag}`
    default:
      return set.weightKg != null ? `${set.weightKg} kg × ${set.reps ?? '—'}${tag}` : `${set.reps ?? '—'} reps${tag}`
  }
}

function metricChartMeta(metricKind: ProgressMetricKind): { primaryLabel: string; primaryUnit: string; totalLabel: string } {
  switch (metricKind) {
    case 'est1rm':         return { primaryLabel: 'Working weight', primaryUnit: 'kg', totalLabel: 'Total reps' }
    case 'addedWeight':    return { primaryLabel: 'Added weight', primaryUnit: 'kg', totalLabel: 'Total reps' }
    case 'assistedWeight': return { primaryLabel: 'Assistance', primaryUnit: 'kg', totalLabel: 'Total reps' }
    case 'reps':           return { primaryLabel: 'Top-set reps', primaryUnit: 'reps', totalLabel: 'Total reps' }
    case 'duration':       return { primaryLabel: 'Top-set duration', primaryUnit: 's', totalLabel: 'Total duration' }
    case 'distance':       return { primaryLabel: 'Top-set distance', primaryUnit: 'm', totalLabel: 'Total distance' }
  }
}

function sortDecisions(list: ExerciseProgressResult[], sort: SortMode): ExerciseProgressResult[] {
  const arr = [...list]
  switch (sort) {
    case 'action_priority':
      return arr.sort((a, b) => ACTION_PRIORITY_RANK[a.currentAction] - ACTION_PRIORITY_RANK[b.currentAction])
    case 'largest_improvement':
      return arr.sort((a, b) => (b.currentState.loadChangePercent ?? -Infinity) - (a.currentState.loadChangePercent ?? -Infinity))
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

function EvidencePill({ level, label }: { level: EvidenceLevel; label: string }) {
  const tone = level === 'strong' ? 'bg-green-100 text-green-700' : level === 'moderate' ? 'bg-amber-100 text-amber-700' : 'bg-ink-100 text-ink-500'
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${tone}`} title={label}>{evidenceLabel(level).replace(' evidence', '')}</span>
}

function fmtExposure(sets: readonly { reps: number | null }[] | undefined, weightKg: number | null | undefined): string {
  if (!sets || sets.length === 0) return '—'
  const reps = sets.map(s => s.reps ?? '—').join('/')
  return weightKg != null ? `${weightKg} kg × ${reps}` : `${reps} reps`
}

function ExposureLine({ result }: { result: ExerciseProgressResult }) {
  const prevSets = result.currentState.previous?.sets.filter(s => s.kind !== 'dropset')
  const latestSets = result.currentState.latest?.sets.filter(s => s.kind !== 'dropset')
  return (
    <span className="text-xs text-ink-600 tabular-nums">
      {fmtExposure(prevSets, result.currentState.previous?.representativeWeightKg)} <span className="text-ink-300">→</span>{' '}
      <span className="font-semibold text-ink-800">{fmtExposure(latestSets, result.currentState.latest?.representativeWeightKg)}</span>
      {result.currentState.loadChangePercent != null && result.currentState.loadChangePercent !== 0 && (
        <span className={result.currentState.loadChangePercent > 0 ? 'text-green-700' : 'text-amber-700'}> ({result.currentState.loadChangePercent > 0 ? '+' : ''}{result.currentState.loadChangePercent}%)</span>
      )}
    </span>
  )
}

// Every set renders its OWN load+reps (or duration/distance/assistance) —
// never a single representative weight glued onto the whole set list (§8).
function SessionCard({ label, session, metricKind }: { label: string; session: CanonicalExerciseSession | undefined; metricKind: ProgressMetricKind }) {
  if (!session) return null
  return (
    <div className="bg-cream-100 rounded-xl p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-ink-500">{label}</p>
      <p className="text-[11px] text-ink-500">{formatDate(session.date)}{session.workoutTitle ? ` · ${session.workoutTitle}` : ''}</p>
      <ul className="flex flex-col gap-0.5 mt-1.5">
        {session.allSets.map((s, i) => (
          <li key={i} className={`text-xs font-semibold tabular-nums ${s.kind === 'failure' ? 'text-red-600' : s.kind === 'dropset' ? 'italic text-ink-500' : 'text-ink-700'}`}>
            Set {s.order}: {formatSetLine(s, metricKind)}
          </li>
        ))}
      </ul>
    </div>
  )
}

function EventChip({ event }: { event: ExerciseProgressResult['events'][number] }) {
  const info = RULE_CATALOG[event.code]
  if (event.code === 'LOAD_PR') return <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-green-100 text-green-700 inline-flex items-center gap-1">🏆 Load PR — {event.values.value} {event.values.value != null ? 'kg' : ''}</span>
  if (event.code === 'REP_PR_AT_LOAD') return <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-green-100 text-green-700 inline-flex items-center gap-1">🏆 Rep PR — {event.values.reps} @ {event.values.loadKg}kg</span>
  if (event.code === 'TOTAL_REPS_PR_AT_LOAD') return <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-green-100 text-green-700 inline-flex items-center gap-1">🏆 Total-reps PR — {event.values.total} @ {event.values.loadKg}kg</span>
  if (event.code === 'TARGET_COMPLETED') return <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-accent-100 text-accent-700">✓ Target completed</span>
  if (event.code === 'PROGRESSION_STREAK') return <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-accent-100 text-accent-700">🔥 {event.values.streakLength}-session streak</span>
  return <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-ink-100 text-ink-500" title={info?.shortDefinition}>{info?.title ?? event.code} (secondary)</span>
}

// Metric-aware progress chart (§9) — the PRIMARY series is always the
// metric's own natural "how hard" value (working weight for a weight-based
// metric, top-set reps/duration/distance otherwise), never a raw total-reps
// line that would read as regression the moment reps normally drop right
// after a load increase. "Total" is an explicit, separately-labeled toggle
// with its own caveat, never the default.
function ExerciseChart({ result, sessions, metricKind }: { result: ExerciseProgressResult; sessions: CanonicalExerciseSession[]; metricKind: ProgressMetricKind }) {
  const [view, setView] = useState<'primary' | 'total'>('primary')
  const meta = metricChartMeta(metricKind)
  const points = useMemo(() => buildRepresentativePoints(sessions, metricKind), [sessions, metricKind])
  const isWeightBased = metricKind === 'est1rm' || metricKind === 'addedWeight' || metricKind === 'assistedWeight'

  const rows = points.map(p => ({
    date: p.date,
    label: formatDate(p.date),
    primary: isWeightBased ? p.weightKg : p.metricValue,
    total: p.total,
  }))
  const shown = rows.filter(r => (view === 'primary' ? r.primary != null : r.total != null))

  if (shown.length < 2) return <p className="text-xs text-ink-400 py-3">Not enough sessions yet for a chart.</p>

  const values = shown.map(r => (view === 'primary' ? (r.primary as number) : (r.total as number)))
  const max = Math.max(...values), min = Math.min(0, ...values)
  const span = Math.max(1, max - min)

  // Load-change markers (§9 "annotate important load-change events") —
  // computed straight off this same series, not a duplicate algorithm: a
  // point whose primary value moved from the one before it.
  const changeAt = new Set<number>()
  for (let i = 1; i < shown.length; i++) {
    if (shown[i].primary != null && shown[i - 1].primary != null && shown[i].primary !== shown[i - 1].primary) changeAt.add(i)
  }
  const latestEvents = result.events.filter(e => e.code === 'LOAD_PR' || e.code === 'REP_PR_AT_LOAD' || e.code === 'TOTAL_REPS_PR_AT_LOAD' || e.code === 'TARGET_COMPLETED')

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5">
        <button type="button" onClick={() => setView('primary')} className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${view === 'primary' ? 'bg-ink-900 text-white' : 'bg-cream-100 text-ink-600'}`}>{meta.primaryLabel}</button>
        <button type="button" onClick={() => setView('total')} className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${view === 'total' ? 'bg-ink-900 text-white' : 'bg-cream-100 text-ink-600'}`}>{meta.totalLabel} this session</button>
      </div>
      {view === 'total' && (
        <p className="text-[11px] text-ink-500">A drop here right after a load increase is expected, not regression — check {meta.primaryLabel.toLowerCase()} above for the real signal.</p>
      )}
      <div className="flex items-end gap-1 h-32 border-b border-ink-200 pb-1">
        {shown.map((r, i) => {
          const v = view === 'primary' ? (r.primary as number) : (r.total as number)
          const h = Math.max(4, Math.round(((v - min) / span) * 100))
          const isChange = view === 'primary' && changeAt.has(i)
          return (
            <div key={r.date} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0" title={`${r.label}: ${v}${view === 'primary' ? ` ${meta.primaryUnit}` : ''}`}>
              <div className={`w-full rounded-t-sm ${isChange ? 'bg-accent-500' : 'bg-ink-300'}`} style={{ height: `${h}%` }} />
              {i === shown.length - 1 && <span className="text-[9px] text-ink-400 tabular-nums truncate w-full text-center">{r.label}</span>}
            </div>
          )
        })}
      </div>
      {latestEvents.length > 0 && (
        <p className="text-[11px] text-ink-500">★ Most recent session: {latestEvents.map(e => RULE_CATALOG[e.code]?.title ?? e.code).join(', ')}.</p>
      )}
    </div>
  )
}

function DecisionDetail({ result, sessions, metricKind, title }: { result: ExerciseProgressResult; sessions: CanonicalExerciseSession[]; metricKind: ProgressMetricKind; title: string }) {
  const [showAllSessions, setShowAllSessions] = useState(false)
  const [showChart, setShowChart] = useState(false)
  const olderSessions = sessions.slice(0, -2).reverse()

  return (
    <div className="bg-cream-100 rounded-xl p-3 mt-2 flex flex-col gap-3" onClick={e => e.stopPropagation()}>
      <div className="flex items-start gap-3">
        <div className="shrink-0">
          <ExerciseThumb title={title} templateId={result.exerciseTemplateId} size={72} />
          <div className="mt-1"><ExerciseGifPicker templateId={result.exerciseTemplateId} title={title} /></div>
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <p className="text-sm font-bold text-ink-900">{title} — {actionLabel(result.currentAction)}</p>
          <p className="text-xs text-ink-700">{buildExplanationSentence(result)}</p>
          <div className="flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1"><EvidencePill level={result.evidence.progress} label="Progress evidence" /><InfoBubble><b>Progress evidence</b>{progressEvidenceExplanation(result)}</InfoBubble></span>
            {result.evidence.recommendation && (
              <span className="inline-flex items-center gap-1"><EvidencePill level={result.evidence.recommendation} label="Recommendation evidence" /><InfoBubble><b>Recommendation evidence</b>{recommendationEvidenceExplanation(result)}</InfoBubble></span>
            )}
            {result.events.map((e, i) => <EventChip key={i} event={e} />)}
          </div>
        </div>
      </div>

      <div className="text-[11px] text-ink-500 flex flex-wrap gap-2 items-center">
        <span>Evaluated against <b className="text-ink-700">{scopeLabel(result.evaluationScope)}</b></span>
        {result.dataQualityFlags.map(f => <span key={f} className="text-[10.5px] font-bold px-2 py-0.5 rounded-md bg-amber-100 text-amber-700">{f.replace(/_/g, ' ')}</span>)}
      </div>

      {result.nextTargets ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="bg-cream-50 border border-ink-200 rounded-lg p-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-ink-500">Next session</p>
            <p className="text-xs font-semibold text-ink-800 mt-0.5">{result.nextTargets.nextSession.headline}</p>
          </div>
          <div className="bg-cream-50 border border-ink-200 rounded-lg p-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-ink-500">Progression requirement</p>
            <p className="text-xs font-semibold text-ink-800 mt-0.5">{result.nextTargets.progressionRequirement.headline}</p>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-ink-500 bg-cream-50 border border-ink-200 rounded-lg p-2.5">
          No numeric progression recommendation for this session — it didn't share one clean load/backoff shape or a complete set of reps. Log one clean, complete session to get a real target.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <SessionCard label="Previous" session={sessions[sessions.length - 2]} metricKind={metricKind} />
        <SessionCard label="Latest" session={sessions[sessions.length - 1]} metricKind={metricKind} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="bg-cream-50 border border-ink-200 rounded-lg p-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-ink-500">Recent progress trend</p>
          <p className="text-xs font-bold text-ink-800">{recentTrendLabel(result.trend.recentProgressTrend)}</p>
          <p className="text-[11px] text-ink-500 mt-0.5">Based on the last {result.trend.recentWindowSessions} comparable session{result.trend.recentWindowSessions === 1 ? '' : 's'} · {result.trend.recentPositiveSignals} positive · {result.trend.recentNegativeSignals} negative signal{result.trend.recentNegativeSignals === 1 ? '' : 's'}.</p>
        </div>
        <div className="bg-cream-50 border border-ink-200 rounded-lg p-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-ink-500">Current-load progress</p>
          <p className="text-xs font-bold text-ink-800">{currentLoadProgressLabel(result.trend.currentLoadProgress)}</p>
          <p className="text-[11px] text-ink-500 mt-0.5">{result.trend.currentLoadCycleSessions} session{result.trend.currentLoadCycleSessions === 1 ? '' : 's'} at this load.</p>
        </div>
      </div>

      {olderSessions.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowAllSessions(v => !v)} className="text-xs font-semibold text-ink-500 hover:text-ink-800 min-h-[32px]">
            {showAllSessions ? '▲ Hide' : `▼ Show all sessions (${olderSessions.length} more)`}
          </button>
          {showAllSessions && (
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {olderSessions.map(s => (
                <li key={s.workoutId} className="text-xs text-ink-600 py-1 border-b border-ink-200 last:border-0">
                  <p className="text-ink-500">{formatDate(s.date)}{s.workoutTitle ? ` · ${s.workoutTitle}` : ''}</p>
                  <p className="tabular-nums font-medium text-ink-700">
                    {s.allSets.map((set, i) => <span key={i}>{i > 0 ? ', ' : ''}{formatSetLine(set, metricKind)}</span>)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div>
        <button type="button" onClick={() => setShowChart(v => !v)} className="text-xs font-semibold text-ink-500 hover:text-ink-800 min-h-[32px]">
          {showChart ? '▲ Hide progress chart' : '▼ Show progress chart'}
        </button>
        {showChart && <ExerciseChart result={result} sessions={sessions} metricKind={metricKind} />}
      </div>

      {result.currentState.estimatedStrengthChange && (
        <p className="text-[11px] text-ink-500 flex items-center gap-1">
          Estimated strength (secondary): {result.currentState.estimatedStrengthChange.fromKg} kg → {result.currentState.estimatedStrengthChange.toKg} kg
          <InfoBubble><b>Estimated 1RM</b>A rough estimate of your one-rep max, calculated from weight × reps (Epley formula) — not a tested number. Useful for a rough direction only; the real sets above are what actually happened.</InfoBubble>
        </p>
      )}

      <p className="text-[11px] text-ink-400">Expectation: {result.expectation.label}</p>
    </div>
  )
}

function DecisionRow({ result, sessions, metricKind, title }: { result: ExerciseProgressResult; sessions: CanonicalExerciseSession[]; metricKind: ProgressMetricKind; title: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <tr className="border-b border-ink-100 cursor-pointer hover:bg-cream-100" onClick={() => setOpen(v => !v)}>
        <td className="py-2.5 px-3 text-sm font-semibold text-ink-800">{title}</td>
        <td className="py-2.5 px-3"><ExposureLine result={result} /></td>
        <td className="py-2.5 px-3">
          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${STATUS_TONE[result.currentAction]}`}>{actionLabel(result.currentAction)}</span>
        </td>
        <td className="py-2.5 px-3"><EvidencePill level={result.evidence.progress} label="Progress evidence" /></td>
        <td className="py-2.5 px-3">{result.evidence.recommendation ? <EvidencePill level={result.evidence.recommendation} label="Recommendation evidence" /> : <span className="text-ink-300 text-xs">—</span>}</td>
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
    <li className="rounded-xl border border-ink-200 p-3" onClick={() => setOpen(v => !v)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink-800">{title}</span>
        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold shrink-0 ${STATUS_TONE[result.currentAction]}`}>{actionLabel(result.currentAction)}</span>
      </div>
      <div className="mt-1"><ExposureLine result={result} /></div>
      <div className="flex items-center gap-2 mt-1.5">
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
      <div className="bg-cream-50 border border-ink-200 rounded-2xl p-4 text-center">
        <p className="text-sm text-ink-500">No current-program exercises logged in this window yet.</p>
      </div>
    )
  }

  const filtersActive = query || evidenceFilter !== 'any' || dateWindow !== 'all' || muscleFilter !== 'any' || routineFilter !== 'any'

  return (
    <div className="bg-cream-50 border border-ink-200 rounded-2xl p-4 sm:p-5">
      <div className="flex flex-wrap gap-1.5 mb-3">
        {TABS.map(t => (
          <button
            key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`min-h-[36px] px-3 rounded-full text-xs font-semibold transition-colors ${tab === t.id ? 'bg-ink-900 text-white' : 'bg-cream-100 text-ink-600 hover:bg-cream-200'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search exercise…"
          className="min-h-[36px] px-3 rounded-lg border border-ink-200 bg-cream-100 text-xs text-ink-700 max-w-[14rem] w-full sm:w-auto"
        />
        <label className="flex items-center gap-1.5 text-xs text-ink-500">
          Sort:
          <select value={sort} onChange={e => setSort(e.target.value as SortMode)} className="min-h-[36px] px-2 rounded-lg border border-ink-200 bg-cream-100 text-xs text-ink-700">
            {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-ink-500">
          Evidence:
          <select value={evidenceFilter} onChange={e => setEvidenceFilter(e.target.value as 'any' | EvidenceLevel)} className="min-h-[36px] px-2 rounded-lg border border-ink-200 bg-cream-100 text-xs text-ink-700">
            <option value="any">Any</option>
            <option value="limited">Limited</option>
            <option value="moderate">Moderate</option>
            <option value="strong">Strong</option>
          </select>
        </label>
        {muscleOptions.length > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-ink-500">
            Muscle:
            <select value={muscleFilter} onChange={e => setMuscleFilter(e.target.value)} className="min-h-[36px] px-2 rounded-lg border border-ink-200 bg-cream-100 text-xs text-ink-700">
              <option value="any">Any</option>
              {muscleOptions.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        )}
        {routineOptions.length > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-ink-500">
            Routine:
            <select value={routineFilter} onChange={e => setRoutineFilter(e.target.value)} className="min-h-[36px] px-2 rounded-lg border border-ink-200 bg-cream-100 text-xs text-ink-700">
              <option value="any">Any</option>
              {routineOptions.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        )}
        <label className="flex items-center gap-1.5 text-xs text-ink-500">
          Window:
          <select value={dateWindow} onChange={e => setDateWindow(e.target.value as DateWindow)} className="min-h-[36px] px-2 rounded-lg border border-ink-200 bg-cream-100 text-xs text-ink-700">
            {DATE_WINDOWS.map(w => <option key={w.id} value={w.id}>{w.label}</option>)}
          </select>
        </label>
        {filtersActive && (
          <button type="button" onClick={() => { setQuery(''); setEvidenceFilter('any'); setDateWindow('all'); setMuscleFilter('any'); setRoutineFilter('any') }} className="text-xs font-semibold text-accent-600 hover:text-accent-700 min-h-[36px] px-2">
            Clear filters
          </button>
        )}
        <span className="text-[11px] text-ink-400 ml-auto">{shown.length} of {filtered.length}</span>
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
        <div className="mt-3 pt-3 border-t border-ink-100">
          <button type="button" onClick={() => setShowInsufficient(v => !v)} className="text-xs font-semibold text-ink-500 hover:text-ink-800">
            {showInsufficient ? '▲ Hide' : '▼ Show'} {insufficient.length} exercise{insufficient.length === 1 ? '' : 's'} without enough data yet
          </button>
          {showInsufficient && (
            <ul className="mt-2 flex flex-col gap-1">
              {insufficient.map(d => (
                <li key={d.exerciseTemplateId} className="text-xs text-ink-500 flex items-center justify-between py-1.5 border-b border-ink-50 last:border-0">
                  <span>{titleById.get(d.exerciseTemplateId) ?? 'Unknown exercise'}</span>
                  <span className="text-ink-400">{d.comparableSessions} session{d.comparableSessions === 1 ? '' : 's'} logged</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
