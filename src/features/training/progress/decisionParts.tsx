import { useState, type ReactNode } from 'react'
import { Check, ChevronDown, Flame, Trophy } from 'lucide-react'
import { TonePill, type Tone } from '../../../shared/ui'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import {
  actionLabel, evidenceLabel, scopeLabel, recentTrendLabel, recentTrendMeaning, currentLoadProgressLabel,
  currentLoadProgressMeaning, buildExplanationSentence, progressEvidenceExplanation, recommendationEvidenceExplanation,
  nextTargetUnavailableText, dataQualityFlagCopy,
} from '../progress-engine/copy'
import { RULE_CATALOG } from '../progress-engine/ruleCatalog'
import { formatSessionSets, fmtDuration } from '../progress-engine/format'
import type { ExerciseProgressResult, CanonicalExerciseSession, CanonicalSet, EvidenceLevel, ProgressMetricKind } from '../progress-engine/types'
import { isWeightBasedMetric } from '../progress-engine/metricStrategy'
import { ExerciseThumb, ExerciseGifPicker } from '../exerciseMedia'
import { fmtTrainingDate as formatDate } from '../dateFormat'
import { ExerciseTrendChart } from './ExerciseTrendChart'

// Presentation pieces of one exercise decision: exposure line, evidence
// pills, session cards, event chips and the expandable detail. They only
// render the engine's output — no decision is made here.

const EVIDENCE_TONE: Record<EvidenceLevel, Tone> = { strong: 'success', moderate: 'warn', limited: 'neutral' }

// Every set renders its OWN load and quantity, never a representative weight
// glued onto every set's reps.
function formatSetLine(set: CanonicalSet, metricKind: ProgressMetricKind): string {
  const tag = set.kind !== 'normal' ? ` (${set.kind})` : ''
  switch (metricKind) {
    case 'duration':
      if (set.durationSeconds == null) return `—${tag}`
      return `${set.weightKg != null ? `${set.weightKg} kg × ` : ''}${fmtDuration(set.durationSeconds)}${tag}`
    case 'distance':
      if (set.distanceMeters == null) return `—${tag}`
      return set.durationSeconds != null ? `${set.distanceMeters} m in ${fmtDuration(set.durationSeconds)}${tag}` : `${set.distanceMeters} m${tag}`
    case 'assistedWeight':
      return set.weightKg != null ? `${set.weightKg} kg assist × ${set.reps ?? '—'}${tag}` : `${set.reps ?? '—'} reps${tag}`
    default:
      return set.weightKg != null ? `${set.weightKg} kg × ${set.reps ?? '—'}${tag}` : `${set.reps ?? '—'} reps${tag}`
  }
}

/** A metric-generic VALUE (a load, or top-set reps/seconds/metres) in its own unit. */
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

function DetailTile({ label, info, note, children }: { label: string; info?: ReactNode; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-row border border-line bg-surface p-3">
      <p className="section-label flex items-center gap-1.5">{label}{info != null && <InfoBubble>{info}</InfoBubble>}</p>
      <div className="mt-0.5 text-body font-semibold text-fg">{children}</div>
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

/** "100 kg × 5 · 80 kg × 10/10 → 102.5 kg × 5 · 80 kg × 9/8 (+2.5%)" — each
 *  set group with its own load. */
export function ExposureLine({ result }: { result: ExerciseProgressResult }) {
  const prevSets = result.currentState.previous?.sets.filter(s => s.kind !== 'dropset')
  const latestSets = result.currentState.latest?.sets.filter(s => s.kind !== 'dropset')
  // A percentage change is only honest on a real load axis.
  const pct = result.currentState.loadChangePercent
  const showPercent = isWeightBasedMetric(result.metricKind) && pct != null && pct !== 0
  const better = showPercent && (result.metricKind === 'assistedWeight' ? (pct as number) < 0 : (pct as number) > 0)
  return (
    <span className="text-meta tabular-nums text-fg-2">
      {prevSets && prevSets.length > 0 && <>{formatSessionSets(prevSets, result.metricKind)} <span className="text-fg-faint">→</span>{' '}</>}
      <span className="font-semibold text-fg">{formatSessionSets(latestSets, result.metricKind)}</span>
      {showPercent && (
        <span data-tone={better ? 'success' : 'warn'} className="tone-text"> ({(pct as number) > 0 ? '+' : ''}{pct}%)</span>
      )}
    </span>
  )
}

function SessionCard({ label, session, metricKind }: { label: string; session: CanonicalExerciseSession | undefined; metricKind: ProgressMetricKind }) {
  if (!session) return null
  return (
    <div className="rounded-row border border-line bg-surface p-3">
      <p className="section-label">{label}</p>
      <p className="text-meta tabular-nums text-fg-muted">{formatDate(session.date)}{session.workoutTitle ? ` · ${session.workoutTitle}` : ''}</p>
      <ul className="mt-1.5 flex flex-col gap-0.5">
        {session.allSets.map((s, i) => (
          <li key={`${session.workoutId}-${i}`} data-tone={s.kind === 'failure' ? 'danger' : undefined} className={`text-meta font-semibold tabular-nums ${s.kind === 'failure' ? 'tone-text' : s.kind === 'dropset' ? 'italic text-fg-muted' : 'text-fg-2'}`}>
            Set {i + 1}: {formatSetLine(s, metricKind)}
          </li>
        ))}
      </ul>
    </div>
  )
}

function EventChip({ event, metricKind }: { event: ExerciseProgressResult['events'][number]; metricKind: ProgressMetricKind }) {
  const info = RULE_CATALOG[event.code]
  const weightBased = isWeightBasedMetric(metricKind)
  let chip: ReactNode
  if (event.code === 'LOAD_PR') {
    const value = event.values.value
    chip = <TonePill tone="success"><Trophy className="h-3 w-3" aria-hidden /> {weightBased ? '6-month best load' : '6-month best'} — {value != null ? formatPrimaryValue(value as number, metricKind) : '—'}</TonePill>
  } else if (event.code === 'REP_PR_AT_LOAD') {
    const at = weightBased && event.values.loadKg != null ? ` @ ${formatPrimaryValue(event.values.loadKg as number, metricKind)}` : ''
    chip = <TonePill tone="success"><Trophy className="h-3 w-3" aria-hidden /> Rep best — {event.values.reps}{at}</TonePill>
  } else if (event.code === 'TOTAL_REPS_PR_AT_LOAD') {
    const at = weightBased && event.values.loadKg != null ? ` @ ${formatPrimaryValue(event.values.loadKg as number, metricKind)}` : ''
    chip = <TonePill tone="success"><Trophy className="h-3 w-3" aria-hidden /> Total-reps best — {event.values.total}{at}</TonePill>
  } else if (event.code === 'TARGET_COMPLETED') {
    chip = <TonePill tone="info"><Check className="h-3 w-3" aria-hidden /> Target completed</TonePill>
  } else if (event.code === 'PROGRESSION_STREAK') {
    chip = <TonePill tone="star"><Flame className="h-3 w-3" aria-hidden /> {event.values.streakLength}-session streak</TonePill>
  } else {
    chip = <TonePill tone="neutral">{info?.title ?? event.code}</TonePill>
  }
  return (
    <span className="inline-flex items-center gap-1">
      {chip}
      {info && <InfoBubble label={`About ${info.title}`}><b>{info.title}</b> {info.shortDefinition}</InfoBubble>}
    </span>
  )
}

function NextTargetTiles({ result }: { result: ExerciseProgressResult }) {
  const t = result.nextTargets
  if (!t) {
    return <p className="rounded-row border border-line bg-surface p-3 text-meta text-fg-muted">{nextTargetUnavailableText(result)}</p>
  }
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <DetailTile
        label="Next session"
        info={<><b>Next session</b> A concrete plan for the next time you do this exercise: each set keeps its own load, and the floor is simply &quot;don&apos;t let any set drop below last time&quot;. Double progression — add reps at the same load until every set reaches the top of your range, then add load.</>}
      >
        {t.nextSession.headline}
      </DetailTile>
      <DetailTile label="When to add load">{t.progressionRequirement.headline}</DetailTile>
    </div>
  )
}

export function DecisionDetail({ result, sessions, metricKind, title }: { result: ExerciseProgressResult; sessions: CanonicalExerciseSession[]; metricKind: ProgressMetricKind; title: string }) {
  const [showAllSessions, setShowAllSessions] = useState(false)
  const [showChart, setShowChart] = useState(false)
  const olderSessions = sessions.slice(0, -2).reverse()
  const actionInfo = RULE_CATALOG[result.currentAction]

  return (
    <div className="mt-2 flex cursor-default flex-col gap-3 rounded-row bg-surface-2 p-3" onClick={e => e.stopPropagation()}>
      <div className="flex items-start gap-3">
        <div className="shrink-0">
          <ExerciseThumb title={title} templateId={result.exerciseTemplateId} size={72} />
          <div className="mt-1"><ExerciseGifPicker templateId={result.exerciseTemplateId} title={title} /></div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="flex flex-wrap items-center gap-1.5 text-body font-semibold text-fg">
            {title} — {actionLabel(result.currentAction)}
            {actionInfo && <InfoBubble label={`About ${actionInfo.title}`}><b>{actionInfo.title}</b> {actionInfo.shortDefinition}</InfoBubble>}
          </p>
          <p className="text-body text-fg-2">{buildExplanationSentence(result)}</p>
          <div className="flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1"><EvidencePill level={result.evidence.progress} label="Trend evidence" /><InfoBubble><b>Trend evidence</b> {progressEvidenceExplanation(result)}</InfoBubble></span>
            {result.evidence.recommendation && (
              <span className="inline-flex items-center gap-1"><EvidencePill level={result.evidence.recommendation} label="Decision evidence" /><InfoBubble><b>Decision evidence</b> {recommendationEvidenceExplanation(result)}</InfoBubble></span>
            )}
            {result.events.map(e => <EventChip key={e.code} event={e} metricKind={metricKind} />)}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-meta text-fg-muted">
        <span>Checked against <b className="text-fg-2">{scopeLabel(result.evaluationScope)}</b></span>
        {result.dataQualityFlags.map(f => {
          const copy = dataQualityFlagCopy(f)
          return (
            <span key={f} className="inline-flex items-center gap-1">
              <TonePill tone="warn">{copy.title}</TonePill>
              <InfoBubble label={`About ${copy.title}`}><b>{copy.title}</b> {copy.definition}</InfoBubble>
            </span>
          )
        })}
      </div>

      <NextTargetTiles result={result} />

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <SessionCard label="Previous" session={sessions[sessions.length - 2]} metricKind={metricKind} />
        <SessionCard label="Latest" session={sessions[sessions.length - 1]} metricKind={metricKind} />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <DetailTile
          label="Recent trend"
          info={<><b>{recentTrendLabel(result.trend.recentProgressTrend)}</b> {recentTrendMeaning(result.trend.recentProgressTrend)}</>}
          note={<>Based on the last {result.trend.recentWindowSessions} comparable session{result.trend.recentWindowSessions === 1 ? '' : 's'} · {result.trend.recentPositiveSignals} step{result.trend.recentPositiveSignals === 1 ? '' : 's'} forward · {result.trend.recentNegativeSignals} back.</>}
        >
          {recentTrendLabel(result.trend.recentProgressTrend)}
        </DetailTile>
        <DetailTile
          label="At this load"
          info={<><b>{currentLoadProgressLabel(result.trend.currentLoadProgress)}</b> {currentLoadProgressMeaning(result.trend.currentLoadProgress)}</>}
          note={<>{result.trend.currentLoadCycleSessions} session{result.trend.currentLoadCycleSessions === 1 ? '' : 's'} at the current load.</>}
        >
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
                  <p className="font-medium tabular-nums text-fg-2">{formatSessionSets(s.allSets, metricKind)}</p>
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
        {showChart && <div className="mt-2"><ExerciseTrendChart sessions={sessions} metricKind={metricKind} /></div>}
      </div>

      {result.currentState.estimatedStrengthChange && (
        <p className="flex items-center gap-1 text-meta text-fg-muted">
          Estimated 1RM: {result.currentState.estimatedStrengthChange.fromKg} kg → {result.currentState.estimatedStrengthChange.toKg} kg
          <InfoBubble><b>Estimated 1RM</b> A rough estimate of your one-rep max from weight × reps (Epley formula, sets of 12 reps or fewer) — not a tested number. Useful for direction only; the real sets above are what actually happened.</InfoBubble>
        </p>
      )}

      <p className="text-meta text-fg-faint">Target: {result.expectation.label}</p>
    </div>
  )
}
