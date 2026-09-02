import type { ReactNode } from 'react'
import { useProgressData } from '../hooks/useProgressData'
import { useSetCurrentProgramRoutines } from '../hooks/useAthleteProfile'
import { progressVerdictHeadline, workloadLabel } from '../progressCopy'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import type { ProgramDecision } from '../progressDecisions'

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

function verdictTone(verdict: ProgramDecision['progressVerdict']): string {
  if (verdict === 'progressing') return 'text-green-700'
  if (verdict === 'mixed') return 'text-amber-700'
  return 'text-ink-400'
}

function workloadTone(workload: ProgramDecision['workload']): string {
  if (workload === 'continue') return 'text-accent-700'
  if (workload === 'review_workload') return 'text-amber-700'
  return 'text-red-700'
}

function GatingCard() {
  const { suggestedRoutines } = useProgressData()
  const setProgram = useSetCurrentProgramRoutines()

  return (
    <div className="bg-cream-50 border-2 border-dashed border-accent-300 rounded-2xl p-5 flex flex-col gap-3 items-start">
      <p className="text-[11px] font-bold uppercase tracking-wider text-accent-600">Setup needed</p>
      <p className="text-lg font-bold text-ink-900">Select your current training program to generate progress decisions.</p>
      <p className="text-sm text-ink-500 max-w-2xl">
        Every decision below (increase/keep/watch, muscle dose, the overall verdict) is scoped to the routines you
        confirm here — never guessed from recent activity alone, so an old program never quietly mixes in with what
        you&apos;re training today.
      </p>
      {suggestedRoutines.length > 0 && (
        <div className="flex flex-col gap-2 w-full">
          <p className="text-xs text-ink-500">Recently trained — looks like your current program?</p>
          <div className="flex flex-wrap gap-2">
            {suggestedRoutines.map(r => (
              <span key={r.id} className="px-3 py-1.5 rounded-full bg-cream-100 border border-ink-200 text-sm text-ink-700">{r.title}</span>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setProgram.mutate(suggestedRoutines.map(r => r.id))}
            disabled={setProgram.isPending}
            className="self-start min-h-[44px] px-4 rounded-xl bg-accent-500 text-white text-sm font-semibold hover:bg-accent-600 disabled:opacity-50 transition-colors mt-1"
          >
            Yes, use these as my current program
          </button>
        </div>
      )}
      <p className="text-xs text-ink-400">Or pick exactly which routines count in Training → Coach → Profile → Current program.</p>
    </div>
  )
}

function SummaryCard({ label, value, valueClass, note, info }: { label: string; value: string; valueClass?: string; note: string; info: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400 flex items-center gap-1.5">{label} <InfoBubble>{info}</InfoBubble></p>
      <p className={`text-2xl font-bold ${valueClass ?? 'text-ink-900'}`}>{value}</p>
      <p className="text-xs text-ink-500 mt-1">{note}</p>
    </div>
  )
}

export function ProgressOverview() {
  const { isLoading, needsCurrentProgram, program, summary } = useProgressData()

  if (isLoading) return <div className="h-32 rounded-2xl bg-cream-200 animate-pulse" />
  if (needsCurrentProgram) return <GatingCard />
  if (!program || !summary) return null

  const adherenceText = summary.adherence?.target
    ? `${summary.adherence.completedThisWeek} of ${summary.adherence.target} planned`
    : `${summary.adherence?.completedThisWeek ?? 0} logged`
  const bwText = summary.bodyweightDirection
    ? `${summary.bodyweightDirection.deltaKg > 0 ? '+' : ''}${summary.bodyweightDirection.deltaKg} kg`
    : '—'

  return (
    <div className="bg-cream-50 border border-ink-200 rounded-2xl p-4 sm:p-5 flex flex-col gap-4">
      <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">🎯 Progress</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400 flex items-center gap-1.5">
            Progress result
            <InfoBubble><b>Progress result</b>Compares each analyzable exercise&apos;s recent direction. &quot;Progressing&quot; needs most of them trending up; &quot;Mixed&quot; means it&apos;s genuinely split.</InfoBubble>
          </p>
          <p className={`text-2xl font-bold ${verdictTone(program.progressVerdict)}`}>{progressVerdictHeadline(program.progressVerdict)}</p>
          <p className="text-xs text-ink-500 mt-1">
            {summary.exerciseProgress.analyzable > 0
              ? `${summary.exerciseProgress.improving} of ${summary.exerciseProgress.analyzable} analyzable current-program movements improved.`
              : 'Not enough current-program history yet to judge any exercise reliably.'}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400 flex items-center gap-1.5">
            Workload decision
            <InfoBubble><b>Workload decision</b>A different question from progress: should you change the training load itself? Needs at least 2 different exercises declining PLUS a second signal (e.g. sleep down) — never from one exercise alone.</InfoBubble>
          </p>
          <p className={`text-2xl font-bold ${workloadTone(program.workload)}`}>{workloadLabel(program.workload)}</p>
          <p className="text-xs text-ink-500 mt-1">
            {program.workload === 'review_workload'
              ? `${program.affectedExerciseIds.length} exercises declining, and ${program.corroboratingSignal}.`
              : 'Nothing here suggests you need to change your training load right now.'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-3 border-t border-ink-100">
        <SummaryCard
          label="Routine adherence" value={adherenceText} note="this week, so far"
          info={<><b>Routine adherence</b>How many sessions you&apos;ve logged this week against your own stated weekly target — never judged before the week is actually over.</>}
        />
        <SummaryCard
          label="Exercise progress" value={`${summary.exerciseProgress.improving}/${summary.exerciseProgress.analyzable}`} note="improving or holding steady"
          info={<><b>Exercise progress</b>Of the exercises with enough logged sessions to judge, how many are increasing or holding at the top of their range.</>}
        />
        <SummaryCard
          label="Bodyweight" value={bwText} valueClass={summary.bodyweightDirection && summary.bodyweightDirection.deltaKg < 0 ? 'text-green-700' : undefined}
          note={summary.bodyweightDirection ? `over ~${summary.bodyweightDirection.days} days` : 'not enough weigh-ins yet'}
          info={<><b>Bodyweight direction</b>A plain before/after comparison, not a smoothed trend — read the direction over months, not this one number.</>}
        />
        <SummaryCard
          label="Data confidence" value={`${summary.dataConfidence.reliable}/${summary.dataConfidence.total}`} note="exercises with a reliable trend"
          info={<><b>Data confidence</b>How many of your current-program exercises have enough comparable sessions (3+) to trust their trend at all.</>}
        />
      </div>
    </div>
  )
}
