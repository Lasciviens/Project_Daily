import { useMemo } from 'react'
import { daysAgoStr } from '../../../shared/utils/dateUtils'
import { useTrainingHistory, useBodyweightHistory } from '../hooks/useTrainingProgress'
import { useAthleteProfile, useAthleteLimitations } from '../hooks/useAthleteProfile'
import {
  computeConsistencyByWeek, computeWeeklyVolumeTrend, computeRepRangeDistribution, computeRelativeStrengthTrend,
  metricKindForExerciseType, computeWeeklySetsPerMuscleTrend, lastCompleteWeek,
} from '../progressAggregate'
import {
  groupFindings, clausesFor, computeConsistencyFindings, computeVolumeFindings, computeMuscleFindings,
  computeRepRangeFindings, computeRelativeStrengthFindings, computeExerciseTrendFindings, FINDING_CLAUSES,
  type Finding, type MuscleFindingInput, type RelativeStrengthFindingInput,
} from '../trainingInsights'
import { buildCanonicalSessions, sessionBestE1rm } from '../progress-engine'
import { buildTemplateMuscleMap, contribution, MAJOR_MUSCLES, MUSCLE_LANDMARKS, scaleLandmarksForExperience, labelForSlug, limitedSlugsFromLimitations } from '../muscleMap'
import { useProgressDataContext } from '../progress/progressDataContext'
import { Skeleton, ToneDot, TonePill, type Tone } from '../../../shared/ui'
import { ChartCard } from './ChartCard'

const TIER_META: Record<Finding['tier'], { label: string; tone: Tone }> = {
  measured: { label: 'Measured', tone: 'info' },
  evidence: { label: 'Evidence-based', tone: 'success' },
  heuristic: { label: 'Heuristic', tone: 'warn' },
}

// ─────────────────────────────────────────────────────────────────────────────
//  Training Analysis — a sports-scientist agent review (2026-09-01), asked
//  explicitly by the user for a READABLE analysis of what's going well, what
//  isn't, and what could improve — not another chart.
//
//  DELIBERATELY A FIXED RULES ENGINE, NOT AN AI CALL — the agent's own call:
//  this is a standing view the user re-opens repeatedly and reads as the
//  app's canonical verdict, unlike PT Coach's dated one-shot opinion. The
//  same log must always produce the same text; the trigger logic and copy
//  live in trainingInsights.ts. Every Finding is tiered (Measured / Evidence-
//  based / Heuristic) so a practitioner convention (MEV/MAV/MRV) never reads
//  as a measurement, and every sentence carries the exact numbers it came
//  from — NEVER_HIDES applies here too: where there isn't enough data for a
//  rule, that's said explicitly rather than the section just being absent.
//
//  Per-exercise findings come straight from the progress engine (the same
//  results the decision table shows, current-program scoped) — ONE
//  per-exercise verdict source, so this panel can't call a lift "flat" that
//  the table calls "Ready to increase". Each shared caveat prints once per
//  group, not inside every sentence.
// ─────────────────────────────────────────────────────────────────────────────

const MIN_COMPLETE_WEEKS = 6
const REP_RANGE_WINDOW_DAYS = 90

export function TrainingInsightsPanel() {
  const { data, isLoading: loadingHistory } = useTrainingHistory()
  const { data: anchors, isLoading: loadingBw } = useBodyweightHistory()
  const { data: profile } = useAthleteProfile()
  const { data: limitations } = useAthleteLimitations(true)
  const progress = useProgressDataContext()

  const isLoading = loadingHistory || loadingBw || progress.isLoading
  const today = progress.today

  const findings = useMemo<Finding[] | null>(() => {
    if (!data || !anchors) return null

    const lastComplete = lastCompleteWeek(today)
    // Dense up to the last COMPLETE week, so a recent break shows as zero
    // weeks instead of the series quietly ending at the last logged week.
    const consistencyWeeks = computeConsistencyByWeek(data.sets, lastComplete)
    const completeWeeks = consistencyWeeks.filter(w => w.weekStart <= lastComplete)
    if (completeWeeks.length < MIN_COMPLETE_WEEKS) return []

    const out: Finding[] = []
    out.push(...computeConsistencyFindings(consistencyWeeks, today, profile?.training_days_per_week))
    out.push(...computeVolumeFindings(computeWeeklyVolumeTrend(data.sets, data.templates, lastComplete), today))

    const templateMuscles = buildTemplateMuscleMap(data.templates)
    const limitedSlugs = limitedSlugsFromLimitations(limitations ?? [])
    const firstWeek = completeWeeks[0].weekStart
    const muscleInputs: MuscleFindingInput[] = [...MAJOR_MUSCLES].map(slug => ({
      slug, label: labelForSlug(slug),
      weekly: computeWeeklySetsPerMuscleTrend(data.sets, templateMuscles, slug, contribution, { fromWeek: firstWeek, untilWeek: lastComplete }),
      landmarks: MUSCLE_LANDMARKS[slug] ? scaleLandmarksForExperience(MUSCLE_LANDMARKS[slug], profile?.experience_level) : undefined,
      restriction: limitedSlugs.get(slug),
    }))
    out.push(...computeMuscleFindings(muscleInputs, today))

    const cutoff = daysAgoStr(REP_RANGE_WINDOW_DAYS)
    out.push(...computeRepRangeFindings(computeRepRangeDistribution(data.sets.filter(s => s.date >= cutoff))))

    // Relative strength uses the engine's own per-session best e1RM.
    const est1rmTemplates = data.templates.filter(t => metricKindForExerciseType(t.type) === 'est1rm')
    const relInputs: RelativeStrengthFindingInput[] = est1rmTemplates.map(t => ({
      title: t.title,
      points: computeRelativeStrengthTrend(
        buildCanonicalSessions(data.sets, t.id).map(s => ({ date: s.date, topValue: sessionBestE1rm(s.comparableWorkingSets) })),
        anchors,
      ),
    }))
    out.push(...computeRelativeStrengthFindings(relInputs, anchors.length))

    out.push(...computeExerciseTrendFindings(
      progress.decisions.map(result => ({ title: progress.titleById.get(result.exerciseTemplateId) ?? 'Unknown exercise', result })),
      !progress.needsCurrentProgram,
    ))

    return out
  }, [data, anchors, profile, limitations, today, progress.decisions, progress.titleById, progress.needsCurrentProgram])

  if (isLoading) return <Skeleton rounded="rounded-card" className="h-40" />

  return (
    <ChartCard title="Training analysis" className="gap-3">
      <p className="text-body text-fg-muted">What your own logged training says about itself — read this before the charts below.</p>

      <div className="flex max-w-3xl flex-col gap-1.5 rounded-row bg-surface-2 p-3 text-meta text-fg-muted">
        <p><strong className="text-fg-2">This is arithmetic on your Hevy log, not medical or coaching advice.</strong> Every statement below names the numbers and sessions it came from — a claim with no numbers attached is a bug.</p>
        <p><strong className="text-fg-2">What it can't see:</strong> effort (reps in reserve), technique, tempo, rest, nutrition, stress or recovery quality — the single biggest thing missing, and it moves real results more than anything counted here. A workout you did but didn&apos;t log doesn&apos;t exist to this page.</p>
        <p><strong className="text-fg-2">Tiers:</strong> <TonePill tone="info">Measured</TonePill> = arithmetic on your log · <TonePill tone="success">Evidence-based</TonePill> = backed by cited meta-analytic work · <TonePill tone="warn">Heuristic</TonePill> = a practitioner convention (e.g. MEV/MAV/MRV) with no trial support for the exact number. No readiness/fitness/injury-risk scores are computed, ever.</p>
      </div>

      {findings === null ? null : findings.length === 0 && (
        <p className="py-2 text-body text-fg-muted">
          Not enough logged history yet — this needs at least {MIN_COMPLETE_WEEKS} complete weeks of logged sessions. Keep logging and the findings appear on their own.
        </p>
      )}

      {/* Grouped by ACTIONABILITY, not evidence tier — a follow-up research
          pass (2026-09-01) found real precedent for this (WHOOP's Weekly
          Performance Assessment buckets a week into "met goals" vs
          "opportunities to improve"); the tier now renders as a per-item
          pill rather than the primary sort key. "Can't assess yet" is its
          own always-visible group — the NEVER_HIDES payoff a flat list
          buried mid-scroll. */}
      {findings && findings.length > 0 && (() => {
        const groups = groupFindings(findings)
        return (
          <div className="flex flex-col gap-3">
            <FindingGroupSection title="What's working" tone="success" findings={groups.working} />
            <FindingGroupSection title="What to look at" tone="warn" findings={groups.attention} />
            <FindingGroupSection title="Can't assess yet" tone="neutral" findings={groups.unassessable} />
          </div>
        )
      })()}

      <p className="text-meta text-fg-faint">Findings are generated by fixed rules, not a language model — the same log always produces the same text. For a conversational read on a specific day, use the Coach tab.</p>
    </ChartCard>
  )
}

function FindingGroupSection({ title, tone, findings }: { title: string; tone: Tone; findings: Finding[] }) {
  if (findings.length === 0) return null
  const clauses = clausesFor(findings)
  return (
    <div className="flex max-w-3xl flex-col gap-2">
      <p className="flex items-center gap-1.5 text-body font-semibold text-fg"><ToneDot tone={tone} />{title}</p>
      <ul className="flex flex-col gap-2">
        {findings.map(f => (
          <li key={f.id} className="text-body text-fg-2">
            <TonePill tone={TIER_META[f.tier].tone} className="mr-1.5 align-middle">{TIER_META[f.tier].label}</TonePill>
            {f.text}
          </li>
        ))}
      </ul>
      {/* Each shared caveat once, under the group — never repeated per finding. */}
      {clauses.length > 0 && (
        <ul className="flex flex-col gap-1 border-l-2 border-line pl-2.5 text-meta text-fg-muted">
          {clauses.map(c => <li key={c}>{FINDING_CLAUSES[c]}</li>)}
        </ul>
      )}
    </div>
  )
}
