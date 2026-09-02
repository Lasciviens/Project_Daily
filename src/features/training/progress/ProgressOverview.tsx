import { useProgressData } from '../hooks/useProgressData'
import { progressVerdictHeadline, workloadLabel, statusLabel } from '../progressCopy'
import type { ProgramDecision } from '../progressDecisions'

// The page's headline — answers "what's happening / why / how reliable" in
// the first viewport, per the redesign's own acceptance criteria. Two
// DISTINCT facets are shown side by side, deliberately never collapsed into
// one score: progressVerdict (is this exercise-level progress real?) and
// workload (should the program as a whole change?) — see
// progressDecisions.ts's header comment for why "review workload" was
// pulled out of a single exercise's own status.

function verdictTone(verdict: ProgramDecision['progressVerdict']): string {
  if (verdict === 'confirmed') return 'text-green-700'
  if (verdict === 'likely') return 'text-accent-700'
  if (verdict === 'stable') return 'text-ink-600'
  return 'text-ink-400'
}

function workloadTone(workload: ProgramDecision['workload']): string {
  if (workload === 'continue') return 'text-accent-700'
  if (workload === 'review_workload') return 'text-amber-700'
  return 'text-red-700'
}

export function ProgressOverview() {
  const { isLoading, program, decisions } = useProgressData()

  if (isLoading) return <div className="h-32 rounded-2xl bg-cream-200 animate-pulse" />
  if (!program) return null

  const analyzable = decisions.filter(d => d.status !== 'insufficient_data')
  const improving = analyzable.filter(d => d.status === 'increase' || d.status === 'keep')

  return (
    <div className="bg-cream-50 border border-ink-200 rounded-2xl p-4 sm:p-5 flex flex-col gap-3">
      <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">🎯 Progress</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Progress result</p>
          <p className={`text-2xl font-bold ${verdictTone(program.progressVerdict)}`}>{progressVerdictHeadline(program.progressVerdict)}</p>
          <p className="text-xs text-ink-500 mt-1">
            {analyzable.length > 0
              ? `${improving.length} of ${analyzable.length} analyzable current-program movement${analyzable.length === 1 ? '' : 's'} improved.`
              : 'Not enough current-program history yet to judge any exercise reliably.'}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Workload decision</p>
          <p className={`text-2xl font-bold ${workloadTone(program.workload)}`}>{workloadLabel(program.workload)}</p>
          <p className="text-xs text-ink-500 mt-1">
            {program.workload === 'review_workload'
              ? `${program.affectedExerciseIds.length} exercises declining, and ${program.corroboratingSignal} — worth a look.`
              : 'A different question from the one above: should you change the training load itself, not whether any one lift is progressing.'}
          </p>
        </div>
      </div>

      {decisions.length - analyzable.length > 0 && (
        <p className="text-[11px] text-ink-400">
          {decisions.length - analyzable.length} more exercise{decisions.length - analyzable.length === 1 ? '' : 's'} in your current program {decisions.length - analyzable.length === 1 ? 'doesn\'t' : 'don\'t'} have enough comparable sessions yet ({statusLabel('insufficient_data')}).
        </p>
      )}
    </div>
  )
}
