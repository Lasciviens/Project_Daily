import { useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Settings2 } from 'lucide-react'
import { useSetCurrentProgramRoutines } from '../hooks/useAthleteProfile'
import { useProgressDataContext } from './progressDataContext'
import { progressVerdictHeadline, workloadLabel, type ProgramDecision } from '../progress-engine/program'
import type { BodyweightChange } from '../progressAggregate'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import { Button, Card, CardHeader, Skeleton, type Tone } from '../../../shared/ui'

// The page's headline — answers "what's happening / why / how reliable" in
// the first viewport. Two DISTINCT facets are shown side by side and never
// collapsed into one score: progressVerdict (is progress real across the
// program?) and workload (should the training load itself change?).
//
// GATING: with no current program selected it refuses to produce a verdict
// and asks for a selection, offering the routines actually TRAINED in the
// last 28 days as a suggestion the athlete must still confirm.

const VERDICT_TONE: Record<ProgramDecision['progressVerdict'], Tone> = {
  progressing: 'success',
  mixed: 'warn',
  insufficient_data: 'neutral',
}

const WORKLOAD_TONE: Record<ProgramDecision['workload'], Tone> = {
  continue: 'success',
  review_workload: 'warn',
}

function ProgramSettingsButton({ label }: { label: string }) {
  const navigate = useNavigate()
  return (
    <Button variant="ghost" size="sm" className="gap-1.5 !px-2" onClick={() => navigate('/training?tab=program')}>
      <Settings2 aria-hidden className="h-4 w-4" /> {label}
    </Button>
  )
}

function GatingCard() {
  const { suggestedRoutines } = useProgressDataContext()
  const setProgram = useSetCurrentProgramRoutines()

  return (
    <div className="flex flex-col items-start gap-3 rounded-card border-2 border-dashed border-accent-200 bg-surface p-5">
      <p className="section-label text-accent-600">Setup needed</p>
      <p className="text-title font-semibold text-fg">Select your current training program to get progress decisions.</p>
      <p className="max-w-2xl text-body text-fg-muted">
        Every decision below is scoped to the routines you confirm here — never guessed from recent activity alone, so an
        old program never quietly mixes in with what you&apos;re training today.
      </p>
      {suggestedRoutines.length > 0 && (
        <div className="flex w-full flex-col gap-2">
          <p className="text-meta text-fg-muted">Trained in the last 4 weeks — is this your current program?</p>
          <div className="flex flex-wrap gap-2">
            {suggestedRoutines.map(r => <span key={r.id} className="chip text-body">{r.title}</span>)}
          </div>
          <Button variant="primary" className="mt-1 self-start" loading={setProgram.isPending} onClick={() => setProgram.mutate(suggestedRoutines.map(r => r.id))}>
            Use these as my current program
          </Button>
        </div>
      )}
      <ProgramSettingsButton label="Pick routines myself" />
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

function bodyweightText(bw: BodyweightChange): { value: string; note: string } {
  if (bw.kind === 'change') return { value: `${bw.deltaKg > 0 ? '+' : ''}${bw.deltaKg} kg`, note: `${bw.priorAvgKg} → ${bw.recentAvgKg} kg (weekly averages)` }
  if (bw.kind === 'stale') return { value: `${bw.latestKg} kg`, note: `last weigh-in ${bw.daysAgo} days ago` }
  return { value: '—', note: 'not enough weigh-ins yet' }
}

export function ProgressOverview() {
  const { isLoading, needsCurrentProgram, program, summary } = useProgressDataContext()

  if (isLoading) return <Skeleton rounded="rounded-card" className="h-32" />
  if (needsCurrentProgram) return <GatingCard />
  if (!program || !summary) return null

  const { adherence } = summary
  const adherenceText = adherence.target ? `${adherence.completedThisWeek} of ${adherence.target}` : `${adherence.completedThisWeek}`
  const bw = bodyweightText(summary.bodyweight)

  return (
    <Card className="@container flex flex-col gap-4">
      <CardHeader variant="label" title="Progress" className="!mb-0" action={<ProgramSettingsButton label="Program" />} />

      <div className="grid grid-cols-1 gap-4 @[34rem]:grid-cols-2">
        <div>
          <p className="section-label flex items-center gap-1.5">
            Progress result
            <InfoBubble>
              <b>Progress result</b> An exercise counts as improved when its recent trend is progressing (load or clean reps went
              up more often than down over its last few comparable sessions), or when the latest session set a 6-month best or
              completed its target. &quot;Progressing&quot; means more than half of the judgeable exercises improved; otherwise
              &quot;Mixed&quot;. Holding the same load doesn&apos;t count as improving on its own.
            </InfoBubble>
          </p>
          <p data-tone={VERDICT_TONE[program.progressVerdict]} className="tone-text mt-1 text-kpi font-bold tracking-tight">{progressVerdictHeadline(program.progressVerdict)}</p>
          <p className="mt-1 text-meta text-fg-muted">
            {summary.exerciseProgress.analyzable > 0
              ? `${summary.exerciseProgress.improving} of ${summary.exerciseProgress.analyzable} judgeable exercises in your current program improved.`
              : 'Not enough current-program history yet to judge any exercise.'}
          </p>
        </div>
        <div>
          <p className="section-label flex items-center gap-1.5">
            Workload decision
            <InfoBubble>
              <b>Workload decision</b> A different question from progress: should the training load itself change? It needs at
              least 2 exercises declining at their current load session after session PLUS a second, independent signal (average
              sleep down by more than 45 minutes a night over the last 2 complete weeks) — never one exercise alone.
            </InfoBubble>
          </p>
          <p data-tone={WORKLOAD_TONE[program.workload]} className="tone-text mt-1 text-kpi font-bold tracking-tight">{workloadLabel(program.workload)}</p>
          <p className="mt-1 text-meta text-fg-muted">
            {program.workload === 'review_workload'
              ? `${program.affectedExerciseIds.length} exercises declining, and ${program.corroboratingSignal}.`
              : 'Nothing here suggests you need to change your training load right now.'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 border-t border-line pt-3 @[40rem]:grid-cols-4">
        <SummaryCard
          label="Sessions" value={adherenceText} note={adherence.target ? 'planned, this week so far' : 'this week so far'}
          info={<><b>Sessions this week</b> Current-program workouts logged since Monday, against your weekly training-days target (set it under Program). It&apos;s a running count for the week in progress, not a verdict — the week isn&apos;t over yet.</>}
        />
        <SummaryCard
          label="Improved" value={`${summary.exerciseProgress.improving}/${summary.exerciseProgress.analyzable}`} note="judgeable exercises"
          info={<><b>Improved</b> Of the current-program exercises with at least 2 comparable sessions, how many improved by the same rule as the progress result above (a progressing trend, a 6-month best or a completed target).</>}
        />
        <SummaryCard
          label="Bodyweight" value={bw.value} note={bw.note}
          info={<><b>Bodyweight</b> The average of your weigh-ins in the week up to the latest one, against the average 2–4 weeks before it — averages, so a single day&apos;s water swing doesn&apos;t move it. If the latest weigh-in is more than 2 weeks old, it just says when that was.</>}
        />
        <SummaryCard
          label="Enough history" value={`${summary.dataConfidence.reliable}/${summary.dataConfidence.total}`} note="of all current-program exercises"
          info={<><b>Enough history</b> Of every exercise in your current program&apos;s routines, how many have at least 4 comparable sessions spanning at least 2 weeks in their recent window — enough for a moderate or strong trend read.</>}
        />
      </div>
    </Card>
  )
}
