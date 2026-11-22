import { useState, type ReactNode } from 'react'
import { FlaskConical, GitCompare, Hash, Send } from 'lucide-react'
import { Button, Card, CardHeader, EmptyState, PageBoard, SegmentedControl, Skeleton, cx } from '../../../../shared/ui'
import type { BenchAnswer, BenchCount, BenchPick } from '../../../ai/claude/benchJobs'
import { useBenchCount, useBenchRun, useClaudeDescribe } from '../../../ai/claude/hooks/useClaude'
import { callCost, formatCount, formatDuration, formatTokens, formatUsd, modelNameOf } from '../../../ai/claude/ledgerRules'
import type { Describe } from '../../../ai/claude/types'
import { AI_BENCH_BOARD, type AiBenchSection } from '../../developerBoards'
import { ReadFailed, Term } from './aiBits'

// Developer → AI → Test bench: send any question to the model with the model, effort and thinking you pick, to learn
// how it behaves. "Count tokens" is free (Anthropic counts the prompt without answering). "Ask" is a real call:
// reserved against the budget, written to Calls like any other. "Compare thinking" asks the same question twice,
// once with thinking adaptive and once off, so cost and time can be read side by side. Nothing here is saved
// beyond the ledger; the function has no tools and sees none of your data.

const MAX_KEPT = 6
const THINKING_OPTIONS = [{ value: 'adaptive', label: 'Adaptive' }, { value: 'off', label: 'Off' }] as const

function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="field-label">{label}</span>
      {children}
    </div>
  )
}

function CountLine({ count, about }: { count: BenchCount; about: Describe }) {
  const price = about.prices.models.find(m => m.model === count.model)
  const input = price ? callCost(price, { input: count.inputTokens }) : null
  const job = about.jobs.find(j => j.name === 'test_bench')
  return (
    <p role="status" className="text-meta text-fg-2">
      <span className="font-semibold tabular-nums text-fg">{formatTokens(count.inputTokens)}</span> in the prompt
      {input !== null && <> — about <span className="font-semibold tabular-nums text-fg">{formatUsd(input, { fine: true })}</span> of input</>}
      {job && <>; the answer adds output tokens, at most {formatCount(job.defaults.maxOutputTokens)}</>}
      . Anthropic’s count is an estimate.
    </p>
  )
}

function AnswerCard({ a, about }: { a: BenchAnswer; about: Describe }) {
  const c = a.call
  const prompt = c ? c.input_tokens + c.cache_read_tokens + c.cache_write_tokens : 0
  return (
    <Card className="flex flex-col gap-2">
      <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-meta text-fg-muted">
        <span className="font-semibold text-fg">{modelNameOf(about.models, a.servedModel)} · {a.pick.effort} effort · thinking {a.pick.thinking}</span>
        {c && <span className="tabular-nums">{formatDuration(c.duration_ms)} · {formatUsd(c.cost_usd, { fine: true })}</span>}
      </p>
      <p className="whitespace-pre-wrap break-words text-body text-fg">{a.text}</p>
      {c && (
        <p className="text-meta tabular-nums text-fg-muted">
          {formatTokens(prompt)} in · {formatTokens(c.output_tokens)} out, {formatTokens(c.thinking_tokens)} of it thinking
          {c.cache_read_tokens > 0 ? ` · ${formatTokens(c.cache_read_tokens)} read from the cache` : ''}
        </p>
      )}
      <details className="text-meta text-fg-2">
        <summary className="cursor-pointer select-none font-medium">Thinking summary</summary>
        <p className="mt-1 whitespace-pre-wrap break-words">{a.thinking || (a.pick.thinking === 'off' ? 'Thinking was switched off.' : 'The model did not think about this one.')}</p>
      </details>
    </Card>
  )
}

export function AiTestBench() {
  const about = useClaudeDescribe()
  const job = about.data?.jobs.find(j => j.name === 'test_bench')
  const count = useBenchCount()
  const run = useBenchRun()
  const [question, setQuestion] = useState('')
  const [model, setModel] = useState('')
  const [effort, setEffort] = useState('')
  const [thinking, setThinking] = useState<'adaptive' | 'off'>('adaptive')
  const [counted, setCounted] = useState<BenchCount | null>(null)
  const [answers, setAnswers] = useState<BenchAnswer[]>([])
  const [comparing, setComparing] = useState(false)

  if (about.isError) return <ReadFailed what="the Test bench" error={about.error} onRetry={() => { void about.refetch() }} retrying={about.isFetching} />
  if (!about.data || !job) return <Skeleton rounded="rounded-card" className="h-72 w-full max-w-3xl" />
  const d = about.data
  const max = d.limits.benchTextMax
  const pick: BenchPick = { model: model || job.defaults.model, effort: effort || job.defaults.effort, thinking }
  const text = question.trim()
  const busy = run.isPending || comparing
  const keep = (a: BenchAnswer) => setAnswers(list => [a, ...list].slice(0, MAX_KEPT))
  const edit = (apply: () => void) => { apply(); setCounted(null) }

  function ask(p: BenchPick, then?: () => void) {
    run.mutate({ question: text, pick: p }, { onSuccess: a => { keep(a); then?.() }, onError: () => setComparing(false) })
  }
  function compare() {
    setComparing(true)
    ask({ ...pick, thinking: 'adaptive' }, () => ask({ ...pick, thinking: 'off' }, () => setComparing(false)))
  }

  const sections: Record<AiBenchSection, ReactNode> = {
    ask: (
      <Card className="flex flex-col gap-3">
        <CardHeader variant="label" title="Ask the model anything" />
        <p className="text-body text-fg-2">
          Pick a model, an effort and whether it thinks, count what the question will cost for free, then send it. It has no tools and sees none of your data. A real call costs a fraction of a cent on Haiku.
        </p>
        <textarea
          value={question} onChange={e => edit(() => setQuestion(e.target.value))} rows={4} maxLength={max} placeholder="Type a question…"
          aria-label="The question" className="input resize-y" disabled={busy}
        />
        <p className="-mt-1 text-meta tabular-nums text-fg-muted">{formatCount([...question].length)} of {formatCount(max)} characters</p>
        <div className="flex flex-wrap gap-x-3 gap-y-2.5">
          <Field label={<Term term="Model">Model</Term>}>
            <select value={model} onChange={e => edit(() => setModel(e.target.value))} aria-label="Model" className="select" disabled={busy}>
              <option value="">Default ({modelNameOf(d.models, job.defaults.model)})</option>
              {d.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
          <Field label={<Term term="Effort">Effort</Term>}>
            <select value={effort} onChange={e => edit(() => setEffort(e.target.value))} aria-label="Effort" className="select" disabled={busy}>
              <option value="">Default ({job.defaults.effort})</option>
              {d.efforts.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </Field>
          <Field label={<Term term="Thinking">Thinking</Term>}>
            <SegmentedControl<'adaptive' | 'off'> size="sm" label="Thinking" options={[...THINKING_OPTIONS]} value={thinking} onChange={v => edit(() => setThinking(v))} />
          </Field>
        </div>
        {counted && <CountLine count={counted} about={d} />}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" icon={<Hash />} disabled={!text || busy} loading={count.isPending}
            onClick={() => count.mutate({ question: text, pick }, { onSuccess: setCounted })}>Count tokens</Button>
          <Button variant="primary" icon={<Send />} disabled={!text} loading={run.isPending && !comparing} onClick={() => ask(pick)}>Ask</Button>
          <Button variant="secondary" icon={<GitCompare />} disabled={!text || busy} loading={comparing} onClick={compare}>Compare thinking</Button>
        </div>
        {comparing && <p role="status" className="text-meta text-fg-muted">Asking twice: thinking adaptive, then off…</p>}
      </Card>
    ),
    answer: answers.length === 0
      ? <EmptyState bordered icon={<FlaskConical />} title="No answer yet" description="Ask a question to see its answer, cost, time and thinking summary here." />
      : (
        <div className={cx('flex flex-col gap-3')} aria-live="polite">
          {answers.map((a, i) => <AnswerCard key={`${i}-${a.call?.id ?? a.text.slice(0, 20)}`} a={a} about={d} />)}
        </div>
      ),
  }
  return <PageBoard sections={sections} layout={AI_BENCH_BOARD} stackGap="gap-3" stackClassName="max-w-3xl" />
}
