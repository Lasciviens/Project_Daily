import type { ReactNode } from 'react'
import { useProgressData } from '../hooks/useProgressData'
import { useSetCurrentProgramRoutines } from '../hooks/useAthleteProfile'
import { progressVerdictHeadline, workloadLabel } from '../progressCopy'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import type { ProgramDecision } from '../progressDecisions'
import { Button, Card, CardHeader, Skeleton, type Tone } from '../../../shared/ui'

// The page's headline — answers "what's happening / why / how reliable" in
// the first viewport, per the redesign's own acceptance criteria. Two
// DISTINCT facets are shown side by side, deliberately never collapsed into
// one score: progressVerdict (is this exercise-level progress real?) and
// workload (should the program as a whole change?).
//
// GATING (real bug, fixed 2026-09-02): this used to silently treat every
// logged exercise as "current" whenever no program was explicitly selected
// — an unreliable verdict built from a mix of the current program and
// exercises abandoned months ago. It now refuses to produce a verdict at
// all in that state and asks for an explicit selection instead, offering a
// recency-based suggestion the athlete must still confirm.

const VERDICT_TONE: Record<ProgramDecision['progressVerdict'], Tone> = {
  progressing: 'success',
  mixed: 'warn',
  insufficient_data: 'neutral',
}

const WORKLOAD_TONE: Record<ProgramDecision['workload'], Tone> = {
  continue: 'success',
  review_workload: 'warn',
  ease_off: 'danger',
}

function GatingCard() {
  const { suggestedRoutines } = useProgressData()
  const setProgram = useSetCurrentProgramRoutines()

  return (
    <div className="flex flex-col items-start gap-3 rounded-card border-2 border-dashed border-accent-200 bg-surface p-5">
      <p className="section-label text-accent-600">Setup needed</p>
      <p className="text-title font-semibold text-fg">Select your current training program to generate progress decisions.</p>
      <p className="max-w-2xl text-body text-fg-muted">
        Every decision below (increase/keep/watch, the overall verdict) is scoped to the routines you
        confirm here — never guessed from recent activity alone, so an old program never quietly mixes in with what
        you&apos;re training today.
      </p>
      {suggestedRoutines.length > 0 && (
        <div className="flex w-full flex-col gap-2">
          <p className="text-meta text-fg-muted">Recently trained — looks like your current program?</p>
          <div className="flex flex-wrap gap-2">
            {suggestedRoutines.map(r => <span key={r.id} className="chip text-body">{r.title}</span>)}
          </div>
          <Button variant="primary" className="mt-1 self-start" loading={setProgram.isPending} onClick={() => setProgram.mutate(suggestedRoutines.map(r => r.id))}>
            Use these as my current program
          </Button>
        </div>
      )}
      <p className="text-meta text-fg-muted">Or pick exactly which routines count in Training → Coach → Profile → Current program.</p>
    </div>
  )
}

function SummaryCard({ label, value, tone, note, info }: { label: string; value: string; tone?: Tone; note: string; info: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="section-label flex items-center gap-1.5">{label} <InfoBubble>{info}</InfoBubble></p>
      <p data-tone={tone} className={`mt-1 text-kpi font-bold tabular-nums tracking-tight ${tone ? 'tone-text' : 'text-fg'}`}>{value}</p>
      <p className="mt-0.5 text-meta text-fg-muted">{note}</p>
    </div>
  )
}

export function ProgressOverview() {
  const { isLoading, needsCurrentProgram, program, summary } = useProgressData()

  if (isLoading) return <Skeleton rounded="rounded-card" className="h-32" />
  if (needsCurrentProgram) return <GatingCard />
  if (!program || !summary) return null

  const adherenceText = summary.adherence?.target
    ? `${summary.adherence.completedThisWeek} of ${summary.adherence.target} planned`
    : `${summary.adherence?.completedThisWeek ?? 0} logged`
  const bwText = summary.bodyweightDirection
    ? `${summary.bodyweightDirection.deltaKg > 0 ? '+' : ''}${summary.bodyweightDirection.deltaKg} kg`
    : '—'

  return (
    <Card className="flex flex-col gap-4">
      <CardHeader variant="label" title="Progress" className="!mb-0" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <p className="section-label flex items-center gap-1.5">
            Progress result
            <InfoBubble><b>Progress result</b>Compares each analyzable exercise&apos;s recent direction. &quot;Progressing&quot; needs most of them trending up; &quot;Mixed&quot; means it&apos;s genuinely split.</InfoBubble>
          </p>
          <p data-tone={VERDICT_TONE[program.progressVerdict]} className="tone-text mt-1 text-kpi font-bold tracking-tight">{progressVerdictHeadline(program.progressVerdict)}</p>
          <p className="mt-1 text-meta text-fg-muted">
            {summary.exerciseProgress.analyzable > 0
              ? `${summary.exerciseProgress.improving} of ${summary.exerciseProgress.analyzable} analyzable current-program movements improved.`
              : 'Not enough current-program history yet to judge any exercise reliably.'}
          </p>
        </div>
        <div>
          <p className="section-label flex items-center gap-1.5">
            Workload decision
            <InfoBubble><b>Workload decision</b>A different question from progress: should you change the training load itself? Needs at least 2 different exercises declining PLUS a second signal (e.g. sleep down) — never from one exercise alone.</InfoBubble>
          </p>
          <p data-tone={WORKLOAD_TONE[program.workload]} className="tone-text mt-1 text-kpi font-bold tracking-tight">{workloadLabel(program.workload)}</p>
          <p className="mt-1 text-meta text-fg-muted">
            {program.workload === 'review_workload'
              ? `${program.affectedExerciseIds.length} exercises declining, and ${program.corroboratingSignal}.`
              : 'Nothing here suggests you need to change your training load right now.'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 border-t border-line pt-3 lg:grid-cols-4">
        <SummaryCard
          label="Routine adherence" value={adherenceText} note="this week, so far"
          info={<><b>Routine adherence</b>How many sessions you&apos;ve logged this week against your own stated weekly target — never judged before the week is actually over.</>}
        />
        <SummaryCard
          label="Exercise progress" value={`${summary.exerciseProgress.improving}/${summary.exerciseProgress.analyzable}`} note="of exercises judgeable so far"
          info={<><b>Exercise progress</b>Of the current-program exercises with enough logged sessions to judge (the &quot;analyzable&quot; ones — see Data confidence for the full program count), how many are increasing or holding at the top of their range.</>}
        />
        <SummaryCard
          label="Bodyweight" value={bwText} 
          note={summary.bodyweightDirection ? `over ~${summary.bodyweightDirection.days} days` : 'not enough weigh-ins yet'}
          info={<><b>Bodyweight direction</b>A plain before/after comparison, not a smoothed trend — read the direction over months, not this one number.</>}
        />
        <SummaryCard
          label="Data confidence" value={`${summary.dataConfidence.reliable}/${summary.dataConfidence.total}`} note="of ALL current-program exercises"
          info={<><b>Data confidence</b>Out of every exercise actually in your current program&apos;s routines (a different, larger denominator than &quot;Exercise progress&quot; above, which only counts the ones already judgeable), how many have enough comparable sessions (3+) to trust their trend at all.</>}
        />
      </div>
    </Card>
  )
}
