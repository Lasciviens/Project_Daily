import type { ReactNode } from 'react'
import { Copy } from 'lucide-react'
import { toast } from '../../../../app/store'
import { Card, IconButton, Skeleton } from '../../../../shared/ui'
import { formatDateTime } from '../../../../shared/utils/dateFormat'
import { useAiCall } from '../../../ai/claude/hooks/useClaude'
import { formatCount, formatDuration, formatUsd, jobTitleOf, logParts, outcomeMeta, type LogPart } from '../../../ai/claude/ledgerRules'
import type { AiCall, Describe } from '../../../ai/claude/types'
import { agoLabel } from '../activityLogMeta'
import { OutcomePill, PlainText, ReadFailed } from './aiBits'

// Everything on one row of the ledger: the call's numbers (from the list's own read) and — read when it is
// opened — its text log: what was sent, what came back and the reasoning summary. The text is the owner's own
// words and a model's answer: drawn as plain text only (PlainText), never as HTML or links.

function copyText(text: string) {
  navigator.clipboard.writeText(text)
    .then(() => toast.success('Copied'))
    .catch(() => toast.error('Copy failed'))
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="font-medium text-fg-muted">{label}</dt>
      <dd className="min-w-0 break-words tabular-nums text-fg">{children}</dd>
    </div>
  )
}

function TextBlock({ title, parts }: { title: string; parts: LogPart[] }) {
  const whole = parts.map(p => (p.label ? `${p.label}:\n${p.text}` : p.text)).join('\n\n')
  return (
    <section aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <h4 className="section-label">{title}</h4>
        <IconButton label={`Copy the ${title.toLowerCase()}`} onClick={() => copyText(whole)}><Copy /></IconButton>
      </div>
      <div className="flex flex-col gap-2">
        {parts.map((p, i) => (
          <div key={i}>
            {p.label && <p className="mb-1 text-meta font-medium text-fg-muted">{p.label}</p>}
            <PlainText>{p.text}</PlainText>
          </div>
        ))}
      </div>
    </section>
  )
}

function CallText({ id }: { id: string }) {
  const q = useAiCall(id)
  if (q.isLoading) return <Skeleton rounded="rounded-row" className="h-24 w-full" />
  if (q.isError) return <ReadFailed what="this call’s text" error={q.error} onRetry={() => { void q.refetch() }} retrying={q.isFetching} />
  if (!q.data) return <p className="text-meta text-fg-muted">This call is no longer in the ledger.</p>
  const request = logParts(q.data.request), response = logParts(q.data.response)
  const thinking = q.data.thinking
  if (request.length === 0 && response.length === 0 && !thinking) {
    return (
      <p className="text-meta text-fg-muted">
        <span className="font-medium text-fg-2">The text of this call wasn’t kept.</span>{' '}
        The text log was off when it ran, its days have passed, or it was stopped before anything was sent.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {request.length > 0 && <TextBlock title="Request" parts={request} />}
      {response.length > 0 && <TextBlock title="Answer" parts={response} />}
      {thinking && <TextBlock title="Reasoning summary" parts={[{ label: '', text: thinking }]} />}
    </div>
  )
}

export function AiCallDetail({ call, jobs, framed }: {
  call: AiCall
  jobs: Describe['jobs'] | undefined
  /** The detail pane's own card (laptop); false under a row on a phone. */
  framed: boolean
}) {
  const meta = outcomeMeta(call.outcome)
  const written = call.cache_write_5m_tokens + call.cache_write_1h_tokens
  const body = (
    <>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-body font-semibold text-fg">{jobTitleOf(jobs, call.job)}</p>
          <OutcomePill outcome={call.outcome} />
        </div>
        <p className="text-meta text-fg-2">{meta.what}</p>
        {call.error && <p data-tone="danger" className="tone-text break-words text-meta">{call.error}</p>}
      </div>
      <dl className="grid grid-cols-[minmax(6.5rem,auto)_1fr] gap-x-3 gap-y-1 border-t border-line pt-3 text-meta">
        <Fact label="When">{formatDateTime(call.created_at)} · {agoLabel(call.created_at)}</Fact>
        <Fact label="Job">{call.job}{call.instructions_version ? ` · instructions ${call.instructions_version}` : ''}</Fact>
        <Fact label="Model">{call.model}{call.served_model && call.served_model !== call.model ? ` · answered by ${call.served_model}` : ''}</Fact>
        {call.effort && <Fact label="Effort">{call.effort}</Fact>}
        <Fact label="Asked from">{[call.caller, call.mode, call.step > 1 ? `step ${call.step}` : ''].filter(Boolean).join(' · ')}</Fact>
        {call.stop_reason && <Fact label="Stop reason">{call.stop_reason}</Fact>}
        {call.duration_ms != null && <Fact label="Duration">{formatDuration(call.duration_ms)}</Fact>}
        <Fact label="Cost">{formatUsd(call.cost_usd, { fine: true })}{call.long_prompt ? ' · long prompt (higher prices)' : ''}</Fact>
        <Fact label="Input">{formatCount(call.input_tokens)} tokens</Fact>
        <Fact label="Cached">{formatCount(call.cache_read_tokens)} read · {formatCount(written)} written{call.cache_write_1h_tokens > 0 ? ` (${formatCount(call.cache_write_1h_tokens)} for 1 h)` : ''}</Fact>
        <Fact label="Output">{formatCount(call.output_tokens)} tokens{call.thinking_tokens > 0 ? ` · thinking ${formatCount(call.thinking_tokens)}` : ''}</Fact>
        {call.request_id && (
          <Fact label="Anthropic id">
            <span className="inline-flex max-w-full items-center gap-1">
              <span className="min-w-0 break-all font-mono">{call.request_id}</span>
              <IconButton label="Copy Anthropic’s request id" onClick={() => copyText(call.request_id ?? '')}><Copy /></IconButton>
            </span>
          </Fact>
        )}
        {call.run_id && <Fact label="Run"><span className="break-all font-mono">{call.run_id}</span></Fact>}
      </dl>
      {call.tools.length > 0 && (
        <section aria-label="Tools" className="border-t border-line pt-3">
          <h4 className="section-label mb-1">Tools</h4>
          <PlainText>{JSON.stringify(call.tools, null, 2)}</PlainText>
        </section>
      )}
      <div className="border-t border-line pt-3"><CallText id={call.id} /></div>
    </>
  )
  return framed
    ? <Card aria-label="Call details" className="flex max-h-[calc(100dvh-7rem)] flex-col gap-3 overflow-y-auto">{body}</Card>
    : <div className="flex flex-col gap-3">{body}</div>
}
