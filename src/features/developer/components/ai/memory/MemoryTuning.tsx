import { Check, FlaskConical, History, X } from 'lucide-react'
import { Button, Truncate } from '../../../../../shared/ui'
import { useDecideTuning, useLearnEvalRuns, useLearnJobs, useRunSelfTestNow } from '../../../../ai/claude/hooks/useLearn'
import { jobWords, percent, SETUP_LABEL, STRATEGY_LABEL, type EvalJob, type EvalRun, type EvalSetup, type JobLearning } from '../../../../ai/claude/learnRules'
import { formatUsd } from '../../../../ai/claude/ledgerRules'
import { ReadState, StatePill } from './memoryBits'
import { count, day } from './memoryDay'

// Tuning: the weekly self-test. Once a week (Monday, after the report) the owner's own confirmed cases are sent again in one
// batch at half price, with today's setup and up to two other setups, twice each, and code scores every answer against what
// the owner saved. A setup wins only when it beats today's by more than the noise floor, wins more cases than it loses, is
// worse on no field and costs at most 20 % more tokens — and even then it waits for Approve. After an approved change the next
// 20 saves are watched, and a clearly worse result rolls it back by itself. The batch is deleted at Anthropic right after.

function Bar({ value }: { value: number }) {
  return (
    <span aria-hidden className="inline-block h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-surface-2 align-middle">
      <span className="block h-full rounded-full bg-accent-500" style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
    </span>
  )
}

function SetupLine({ s, best }: { s: EvalSetup; best: boolean }) {
  return (
    <li className="flex flex-col gap-0.5">
      <p className="flex items-center gap-2 text-meta text-fg-2">
        <span className={`min-w-0 flex-1 ${best ? 'font-semibold text-fg' : ''}`}><Truncate lines={1}>{SETUP_LABEL(s.setup)}</Truncate></span>
        <Bar value={s.mean} /> <span className="w-10 shrink-0 text-right tabular-nums">{percent(s.mean)}</span>
      </p>
      <p className="text-meta tabular-nums text-fg-muted">{count(s.tokens)} tokens a request{s.failed ? ` · ${s.failed} unusable` : ''}{s.reasons.length ? ` · not better: ${s.reasons.join('; ')}` : ''}</p>
    </li>
  )
}

function JobResult({ run, j, state }: { run: EvalRun; j: EvalJob; state: JobLearning | undefined }) {
  const decide = useDecideTuning()
  const busy = decide.isPending
  // Approve: the function decides first, then the notes it tested are turned on with your own rights — one toast with Undo.
  const approve = () => decide.mutate({ runId: run.id, job: j.job, decision: 'approve' })
  return (
    <li className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-body font-medium text-fg">{jobWords(j.job)}</p>
        {j.decision !== 'none' && <StatePill tone={j.decision === 'approved' ? 'success' : j.decision === 'proposed' ? 'accent' : 'neutral'}>{j.decision === 'proposed' ? 'Waiting for you' : j.decision === 'approved' ? 'Approved' : 'Rejected'}</StatePill>}
      </div>
      {j.skipped && <p className="text-meta text-fg-muted">{j.skipped}</p>}
      {j.champion && (
        <ul className="flex flex-col gap-1">
          <SetupLine s={j.champion} best={!j.winner} />
          {j.challengers.map(c => <SetupLine key={c.setup} s={c} best={j.winner?.setup === c.setup} />)}
        </ul>
      )}
      {j.cases > 0 && <p className="text-meta text-fg-muted">{j.cases} test cases × 2 repeats{j.notesAdded ? ` · ${j.notesAdded} new ${j.notesAdded === 1 ? 'note' : 'notes'} waiting in Notes` : ''}</p>}
      {!j.cases && j.notesAdded > 0 && <p className="text-meta text-fg-muted">{j.notesAdded} new {j.notesAdded === 1 ? 'note' : 'notes'} waiting in Notes</p>}
      {j.decision === 'proposed' && j.winner && (
        <>
          <p className="text-meta text-fg-2">Proposed: {SETUP_LABEL(j.winner.setup)}{j.winner.lessons.length ? ` — turns on: ${j.winner.lessons.join(' · ')}` : ''}</p>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="primary" icon={<Check />} loading={busy} onClick={approve}>Approve</Button>
            <Button size="sm" variant="ghost" icon={<X />} disabled={busy} onClick={() => decide.mutate({ runId: run.id, job: j.job, decision: 'reject' })}>Reject</Button>
          </div>
        </>
      )}
      {state && j.decision === 'approved' && state.previous && (
        <div><Button size="sm" variant="ghost" icon={<History />} disabled={busy} onClick={() => decide.mutate({ job: j.job, decision: 'roll_back' })}>Roll back</Button></div>
      )}
    </li>
  )
}

function Champions({ jobs }: { jobs: readonly JobLearning[] }) {
  if (!jobs.length) return null
  return (
    <section aria-label="In use now" className="flex flex-col gap-1.5">
      <h3 className="field-label px-1">In use now</h3>
      <ul className="card divide-y divide-line overflow-hidden">
        {jobs.map(j => (
          <li key={j.job} className="flex flex-col gap-0.5 px-3 py-2">
            <p className="text-body text-fg"><span className="font-medium">{jobWords(j.job)}</span> · {j.strategy === 'none' ? 'no examples' : `${j.k} examples, ${STRATEGY_LABEL[j.strategy]}`}</p>
            {j.tripwire_left > 0 && <p className="text-meta tabular-nums text-fg-2">Watching: {j.tripwire_saves} of 20 saves, {j.tripwire_corrected} needed fixes</p>}
            {j.last_event && <p className="text-meta text-fg-muted">{j.last_event}{j.last_event_at ? ` · ${day(j.last_event_at)}` : ''}</p>}
          </li>
        ))}
      </ul>
    </section>
  )
}

function runLine(r: EvalRun): string {
  const when = `Week of ${day(`${r.week_start}T12:00:00Z`)}`
  if (r.status === 'queued') return `${when}: ${r.requests} requests waiting for their results`
  if (r.status === 'skipped') return `${when}: nothing to test`
  if (r.status === 'failed') return `${when}: failed — ${r.failure ?? 'no reason given'}`
  const deleted = r.batch_deleted_at ? ` · batch deleted at Anthropic ${day(r.batch_deleted_at)}` : r.batch_delete_note ? ` · ${r.batch_delete_note}` : ''
  return `${when}: ${r.requests} requests · ${formatUsd(r.cost_usd)}${deleted}`
}

export function MemoryTuning() {
  const runs = useLearnEvalRuns()
  const jobs = useLearnJobs()
  const make = useRunSelfTestNow()
  const list = runs.data ?? []
  const latest = list[0]
  const waiting = latest?.status === 'queued'
  const total = list.reduce((s, r) => s + r.cost_usd, 0)
  return (
    <>
      <section className="card flex flex-col gap-2 p-3">
        <p className="text-meta text-fg-2">Every Monday after the weekly report. {list.length ? `${list.length} ${list.length === 1 ? 'run' : 'runs'} kept, ${formatUsd(total)} in all.` : ''}</p>
        <div><Button size="sm" icon={<FlaskConical />} loading={make.isPending} disabled={waiting} onClick={() => make.mutate()}>Run the self-test now</Button></div>
      </section>
      <Champions jobs={jobs.data ?? []} />
      <ReadState query={runs} what="the self-tests" count={list.length} empty="No self-test yet. A job needs 4 saved cases in its test share and new fixes since the last run — with only a few cases that can take weeks, and nothing can win until then." />
      {latest && latest.status === 'done' && latest.jobs.length > 0 && (
        <section aria-label="The latest self-test" className="flex flex-col gap-1.5">
          <h3 className="field-label px-1">Latest · {day(latest.created_at)}</h3>
          <ul className="card divide-y divide-line overflow-hidden">
            {latest.jobs.map(j => <JobResult key={j.job} run={latest} j={j} state={(jobs.data ?? []).find(x => x.job === j.job)} />)}
          </ul>
        </section>
      )}
      {list.length > 0 && (
        <section aria-label="History" className="flex flex-col gap-1.5">
          <h3 className="field-label px-1">History</h3>
          <ul className="card divide-y divide-line overflow-hidden">
            {list.map(r => <li key={r.id} className="break-words px-3 py-2 text-meta text-fg-2">{runLine(r)}</li>)}
          </ul>
        </section>
      )}
    </>
  )
}
