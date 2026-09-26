import { useMemo, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Flame, Trophy } from 'lucide-react'
import { TonePill, useChartColors, type Tone } from '../../../shared/ui'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import {
  actionLabel, evidenceLabel, scopeLabel, recentTrendLabel, currentLoadProgressLabel, buildExplanationSentence,
  progressEvidenceExplanation, recommendationEvidenceExplanation,
} from '../progress-engine/copy'
import { RULE_CATALOG } from '../progress-engine/ruleCatalog'
import type { ExerciseProgressResult, CanonicalExerciseSession, CanonicalSet, EvidenceLevel, ProgressMetricKind } from '../progress-engine/types'
import { buildRepresentativePoints } from '../progress-engine/trend'
import { isWeightBasedMetric } from '../progress-engine/metricStrategy'
import { ExerciseThumb, ExerciseGifPicker } from '../exerciseMedia'
import { fmtTrainingDate as formatDate } from '../dateFormat'

// Presentation pieces of one exercise decision: exposure line, evidence
// pills, session cards, event chips, the metric-aware chart and the
// expandable detail. They only render the engine's output.

const EVIDENCE_TONE: Record<EvidenceLevel, Tone> = { strong: 'success', moderate: 'warn', limited: 'neutral' }

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

/** Formats a single metric-generic VALUE (the representative weight for a
 *  weight-based metric, or the metric's own derived value otherwise) with
 *  its own honest unit — never a hardcoded "kg" (§5). Used for event chips
 *  (LOAD_PR etc.), which read `event.values.value`/`loadKg` generically off
 *  the engine's structured output regardless of which metric produced it. */
function formatPrimaryValue(value: number, metricKind: ProgressMetricKind): string {
  switch (metricKind) {
    case 'est1rm':
    case 'addedWeight':
    case 'assistedWeight':
      return `${value} kg`
    case 'reps':
      return `${value} reps`
    case 'duration':
      return fmtDuration(value)
    case 'distance':
      return `${value} m`
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

function DetailTile({ label, note, children }: { label: string; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-row border border-line bg-surface p-3">
      <p className="section-label">{label}</p>
      <p className="mt-0.5 text-body font-semibold text-fg">{children}</p>
      {note != null && <p className="mt-0.5 text-meta text-fg-muted">{note}</p>}
    </div>
  )
}

export function DisclosureButton({ open, onClick, children }: { open: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-expanded={open} onClick={onClick} className="btn-ghost btn-sm gap-1 px-2 text-meta">
      <ChevronDown aria-hidden className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      {children}
    </button>
  )
}

export function EvidencePill({ level, label }: { level: EvidenceLevel; label: string }) {
  return (
    <span title={label} className="inline-flex">
      <TonePill tone={EVIDENCE_TONE[level]}>{evidenceLabel(level).replace(' evidence', '')}</TonePill>
    </span>
  )
}

// Metric-aware (§4) — reps/duration/distance/assistance each read their OWN
// natural quantity. A duration/distance session never logs `reps` at all,
// so the old reps-only version rendered a valid session as a bare "—/—".
function fmtExposure(sets: readonly CanonicalSet[] | undefined, metricKind: ProgressMetricKind, weightKg: number | null | undefined): string {
  if (!sets || sets.length === 0) return '—'
  switch (metricKind) {
    case 'duration':
      return sets.map(s => s.durationSeconds != null ? fmtDuration(s.durationSeconds) : '—').join('/')
    case 'distance':
      return sets.map(s => s.distanceMeters != null ? `${s.distanceMeters}m` : '—').join('/')
    case 'assistedWeight': {
      const reps = sets.map(s => s.reps ?? '—').join('/')
      return weightKg != null ? `${weightKg} kg assist × ${reps}` : `${reps} reps`
    }
    default: {
      const reps = sets.map(s => s.reps ?? '—').join('/')
      return weightKg != null ? `${weightKg} kg × ${reps}` : `${reps} reps`
    }
  }
}

export function ExposureLine({ result }: { result: ExerciseProgressResult }) {
  const prevSets = result.currentState.previous?.sets.filter(s => s.kind !== 'dropset')
  const latestSets = result.currentState.latest?.sets.filter(s => s.kind !== 'dropset')
  // A percentage change is only honest on a real load axis (§5) — reps/
  // duration/distance have no weight to compute a load % from, even though
  // loadChangePercent is technically populated (it tracks the metric's own
  // representative value generically, whatever that value is).
  const showPercent = isWeightBasedMetric(result.metricKind)
    && result.currentState.loadChangePercent != null && result.currentState.loadChangePercent !== 0
  return (
    <span className="text-meta tabular-nums text-fg-2">
      {fmtExposure(prevSets, result.metricKind, result.currentState.previous?.representativeWeightKg)} <span className="text-fg-faint">→</span>{' '}
      <span className="font-semibold text-fg">{fmtExposure(latestSets, result.metricKind, result.currentState.latest?.representativeWeightKg)}</span>
      {showPercent && (
        <span data-tone={(result.currentState.loadChangePercent as number) > 0 ? 'success' : 'warn'} className="tone-text"> ({(result.currentState.loadChangePercent as number) > 0 ? '+' : ''}{result.currentState.loadChangePercent}%)</span>
      )}
    </span>
  )
}

// Every set renders its OWN load+reps (or duration/distance/assistance) —
// never a single representative weight glued onto the whole set list (§8).
function SessionCard({ label, session, metricKind }: { label: string; session: CanonicalExerciseSession | undefined; metricKind: ProgressMetricKind }) {
  if (!session) return null
  return (
    <div className="rounded-row border border-line bg-surface p-3">
      <p className="section-label">{label}</p>
      <p className="text-meta tabular-nums text-fg-muted">{formatDate(session.date)}{session.workoutTitle ? ` · ${session.workoutTitle}` : ''}</p>
      <ul className="flex flex-col gap-0.5 mt-1.5">
        {session.allSets.map((s, i) => (
          <li key={i} data-tone={s.kind === 'failure' ? 'danger' : undefined} className={`text-meta font-semibold tabular-nums ${s.kind === 'failure' ? 'tone-text' : s.kind === 'dropset' ? 'italic text-fg-muted' : 'text-fg-2'}`}>
            Set {s.order}: {formatSetLine(s, metricKind)}
          </li>
        ))}
      </ul>
    </div>
  )
}

function EventChip({ event, metricKind }: { event: ExerciseProgressResult['events'][number]; metricKind: ProgressMetricKind }) {
  const info = RULE_CATALOG[event.code]
  const weightBased = isWeightBasedMetric(metricKind)
  if (event.code === 'LOAD_PR') {
    const label = weightBased ? 'Load PR' : 'Personal best'
    const value = event.values.value
    return <TonePill tone="success"><Trophy className="h-3 w-3" aria-hidden /> {label} — {value != null ? formatPrimaryValue(value as number, metricKind) : '—'}</TonePill>
  }
  if (event.code === 'REP_PR_AT_LOAD') {
    const at = weightBased && event.values.loadKg != null ? ` @ ${formatPrimaryValue(event.values.loadKg as number, metricKind)}` : ''
    return <TonePill tone="success"><Trophy className="h-3 w-3" aria-hidden /> Rep PR — {event.values.reps}{at}</TonePill>
  }
  if (event.code === 'TOTAL_REPS_PR_AT_LOAD') {
    const at = weightBased && event.values.loadKg != null ? ` @ ${formatPrimaryValue(event.values.loadKg as number, metricKind)}` : ''
    return <TonePill tone="success"><Trophy className="h-3 w-3" aria-hidden /> Total-reps PR — {event.values.total}{at}</TonePill>
  }
  if (event.code === 'TARGET_COMPLETED') return <TonePill tone="info"><Check className="h-3 w-3" aria-hidden /> Target completed</TonePill>
  if (event.code === 'PROGRESSION_STREAK') return <TonePill tone="star"><Flame className="h-3 w-3" aria-hidden /> {event.values.streakLength}-session streak</TonePill>
  return <span title={info?.shortDefinition} className="inline-flex"><TonePill tone="neutral">{info?.title ?? event.code} (secondary)</TonePill></span>
}

// Metric-aware progress chart (§9) — the PRIMARY series is always the
// metric's own natural "how hard" value (working weight for a weight-based
// metric, top-set reps/duration/distance otherwise), never a raw total-reps
// line that would read as regression the moment reps normally drop right
// after a load increase. "Total" is an explicit, separately-labeled toggle
// with its own caveat, never the default.
function ExerciseChart({ result, sessions, metricKind }: { result: ExerciseProgressResult; sessions: CanonicalExerciseSession[]; metricKind: ProgressMetricKind }) {
  const [view, setView] = useState<'primary' | 'total'>('primary')
  const c = useChartColors()
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

  if (shown.length < 2) return <p className="py-3 text-meta text-fg-muted">Not enough sessions yet for a chart.</p>

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
      <div className="flex gap-1">
        <button type="button" aria-pressed={view === 'primary'} onClick={() => setView('primary')} className="pill-tab px-3 text-meta">{meta.primaryLabel}</button>
        <button type="button" aria-pressed={view === 'total'} onClick={() => setView('total')} className="pill-tab px-3 text-meta">{meta.totalLabel} this session</button>
      </div>
      {view === 'total' && (
        <p className="text-meta text-fg-muted">A drop here right after a load increase is expected, not regression — check {meta.primaryLabel.toLowerCase()} above for the real signal.</p>
      )}
      <div className="flex h-32 max-w-2xl items-end gap-1 border-b border-line pb-1">
        {shown.map((r, i) => {
          const v = view === 'primary' ? (r.primary as number) : (r.total as number)
          const h = Math.max(4, Math.round(((v - min) / span) * 100))
          const isChange = view === 'primary' && changeAt.has(i)
          return (
            <div key={r.date} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0" title={`${r.label}: ${v}${view === 'primary' ? ` ${meta.primaryUnit}` : ''}`}>
              <div className="w-full rounded-t-sm" style={{ height: `${h}%`, backgroundColor: isChange ? c.series[0] : c.neutral }} />
              {i === shown.length - 1 && <span className="w-full truncate text-center text-micro font-normal tabular-nums text-fg-muted">{r.label}</span>}
            </div>
          )
        })}
      </div>
      {latestEvents.length > 0 && (
        <p className="text-meta text-fg-muted">Most recent session: {latestEvents.map(e => RULE_CATALOG[e.code]?.title ?? e.code).join(', ')}.</p>
      )}
    </div>
  )
}

export function DecisionDetail({ result, sessions, metricKind, title }: { result: ExerciseProgressResult; sessions: CanonicalExerciseSession[]; metricKind: ProgressMetricKind; title: string }) {
  const [showAllSessions, setShowAllSessions] = useState(false)
  const [showChart, setShowChart] = useState(false)
  const olderSessions = sessions.slice(0, -2).reverse()

  return (
    <div className="mt-2 flex cursor-default flex-col gap-3 rounded-row bg-surface-2 p-3" onClick={e => e.stopPropagation()}>
      <div className="flex items-start gap-3">
        <div className="shrink-0">
          <ExerciseThumb title={title} templateId={result.exerciseTemplateId} size={72} />
          <div className="mt-1"><ExerciseGifPicker templateId={result.exerciseTemplateId} title={title} /></div>
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <p className="text-body font-semibold text-fg">{title} — {actionLabel(result.currentAction)}</p>
          <p className="text-body text-fg-2">{buildExplanationSentence(result)}</p>
          <div className="flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1"><EvidencePill level={result.evidence.progress} label="Progress evidence" /><InfoBubble><b>Progress evidence</b>{progressEvidenceExplanation(result)}</InfoBubble></span>
            {result.evidence.recommendation && (
              <span className="inline-flex items-center gap-1"><EvidencePill level={result.evidence.recommendation} label="Recommendation evidence" /><InfoBubble><b>Recommendation evidence</b>{recommendationEvidenceExplanation(result)}</InfoBubble></span>
            )}
            {result.events.map((e, i) => <EventChip key={i} event={e} metricKind={metricKind} />)}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-meta text-fg-muted">
        <span>Evaluated against <b className="text-fg-2">{scopeLabel(result.evaluationScope)}</b></span>
        {result.dataQualityFlags.map(f => <TonePill key={f} tone="warn" className="lowercase">{f.replace(/_/g, ' ')}</TonePill>)}
      </div>

      {result.nextTargets ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <DetailTile label="Next session">{result.nextTargets.nextSession.headline}</DetailTile>
          <DetailTile label="Progression requirement">{result.nextTargets.progressionRequirement.headline}</DetailTile>
        </div>
      ) : (
        <p className="rounded-row border border-line bg-surface p-3 text-meta text-fg-muted">
          No numeric progression recommendation for this session — it didn't share one clean load/backoff shape or a complete set of reps. Log one clean, complete session to get a real target.
        </p>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <SessionCard label="Previous" session={sessions[sessions.length - 2]} metricKind={metricKind} />
        <SessionCard label="Latest" session={sessions[sessions.length - 1]} metricKind={metricKind} />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <DetailTile label="Recent progress trend" note={<>Based on the last {result.trend.recentWindowSessions} comparable session{result.trend.recentWindowSessions === 1 ? '' : 's'} · {result.trend.recentPositiveSignals} positive · {result.trend.recentNegativeSignals} negative signal{result.trend.recentNegativeSignals === 1 ? '' : 's'}.</>}>
          {recentTrendLabel(result.trend.recentProgressTrend)}
        </DetailTile>
        <DetailTile label="Current-load progress" note={<>{result.trend.currentLoadCycleSessions} session{result.trend.currentLoadCycleSessions === 1 ? '' : 's'} at this load.</>}>
          {currentLoadProgressLabel(result.trend.currentLoadProgress)}
        </DetailTile>
      </div>

      {olderSessions.length > 0 && (
        <div>
          <DisclosureButton open={showAllSessions} onClick={() => setShowAllSessions(v => !v)}>
            {showAllSessions ? 'Hide older sessions' : `Show all sessions (${olderSessions.length} more)`}
          </DisclosureButton>
          {showAllSessions && (
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {olderSessions.map(s => (
                <li key={s.workoutId} className="border-b border-line py-1 text-meta last:border-0">
                  <p className="tabular-nums text-fg-muted">{formatDate(s.date)}{s.workoutTitle ? ` · ${s.workoutTitle}` : ''}</p>
                  <p className="font-medium tabular-nums text-fg-2">
                    {s.allSets.map((set, i) => <span key={i}>{i > 0 ? ', ' : ''}{formatSetLine(set, metricKind)}</span>)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div>
        <DisclosureButton open={showChart} onClick={() => setShowChart(v => !v)}>
          {showChart ? 'Hide progress chart' : 'Show progress chart'}
        </DisclosureButton>
        {showChart && <ExerciseChart result={result} sessions={sessions} metricKind={metricKind} />}
      </div>

      {result.currentState.estimatedStrengthChange && (
        <p className="flex items-center gap-1 text-meta text-fg-muted">
          Estimated strength (secondary): {result.currentState.estimatedStrengthChange.fromKg} kg → {result.currentState.estimatedStrengthChange.toKg} kg
          <InfoBubble><b>Estimated 1RM</b>A rough estimate of your one-rep max, calculated from weight × reps (Epley formula) — not a tested number. Useful for a rough direction only; the real sets above are what actually happened.</InfoBubble>
        </p>
      )}

      <p className="text-meta text-fg-faint">Expectation: {result.expectation.label}</p>
    </div>
  )
}

