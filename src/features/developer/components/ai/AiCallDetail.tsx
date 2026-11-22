import type { ReactNode } from 'react'
import { Copy } from 'lucide-react'
import { toast } from '../../../../app/store'
import { Card, IconButton, Skeleton } from '../../../../shared/ui'
import { formatDateTime } from '../../../../shared/utils/dateFormat'
import { useAiCall, useAiCallMeta, useClaudeDescribe } from '../../../ai/claude/hooks/useClaude'
import {
  callModelLabel, costBreakdown, searchesOf, formatCount, formatDuration, formatPrice, formatUsd, jobTitleOf, logParts, callOutcomeMeta, type CostBreakdown, type LogPart,
} from '../../../ai/claude/ledgerRules'
import type { AiCall, Describe } from '../../../ai/claude/types'
import { Term } from './aiBits'
import { agoLabel } from '../activityLogMeta'
import { OutcomePill, PlainText, ReadFailed } from './aiBits'
import { InfoBubble } from '../../../../shared/components/InfoBubble'

// Everything on one row of the ledger: the call's numbers (from the list's own read), what its cost is made of (each
// kind of token times its price) and — read when it is opened — its text log: what was sent, what came back and the
// reasoning summary. The text is the owner's own
// words and a model's answer: drawn as plain text only (PlainText), never as HTML or links.

function copyText(text: string) {
  navigator.clipboard.writeText(text)
    .then(() => toast.success('Copied'))
    .catch(() => toast.error('Copy failed'))
}

/** Anthropic's own words for why a cache could not be reused, in plain ones (cache diagnostics). */
const CACHE_MISS_WORDS: Record<string, string> = {
  model_changed: 'the model changed since the last answer',
  system_changed: 'the fixed instructions changed since the last answer',
  tools_changed: 'the tool list changed since the last answer',
  messages_changed: 'the messages before this one changed since the last answer',
  previous_message_not_found: 'Anthropic could not find the last answer to compare with (a first message, or too long ago)',
  unavailable: 'Anthropic could not say',
}

/** What an Ask AI answer kept about its cache and about context editing. */
function ChatFacts({ callId }: { callId: string }) {
  const { data } = useAiCallMeta(callId, true)
  if (!data || (!data.cacheMiss && !data.cleared)) return null
  return (
    <section aria-label="Cache" className="border-t border-line pt-3">
      <h4 className="section-label mb-1">Cache and context</h4>
      <dl className="grid grid-cols-[minmax(6.5rem,auto)_1fr] gap-x-3 gap-y-1 text-meta">
        {data.cacheMiss && <Fact label="Cache miss">{CACHE_MISS_WORDS[data.cacheMiss.reason] ?? data.cacheMiss.reason}{data.cacheMiss.tokens ? ` · ${formatCount(data.cacheMiss.tokens)} tokens read again at full price` : ''}</Fact>}
        {data.cleared && <Fact label="Context editing">cleared {formatCount(data.cleared.toolUses)} old tool {data.cleared.toolUses === 1 ? 'result' : 'results'} ({formatCount(data.cleared.tokens)} tokens) from the prompt</Fact>}
      </dl>
    </section>
  )
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
  const whole = parts.map(p => (p.label ? `${p.label}:${p.block ? '\n' : ' '}${p.text}` : p.text)).join('\n\n')
  const short = parts.filter(p => !p.block), blocks = parts.filter(p => p.block)
  return (
    <section aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <h4 className="section-label">{title}</h4>
        <IconButton label={`Copy the ${title.toLowerCase()}`} onClick={() => copyText(whole)}><Copy /></IconButton>
      </div>
      <div className="flex flex-col gap-2">
        {short.length > 0 && (
          <dl className="grid grid-cols-[minmax(6.5rem,auto)_1fr] gap-x-3 gap-y-1 text-meta">
            {short.map(p => <Fact key={p.label} label={p.label}>{p.text}</Fact>)}
          </dl>
        )}
        {blocks.map((p, i) => (
          <div key={i}>
            {p.label && <p className="mb-1 text-meta font-medium text-fg-muted">{p.label}</p>}
            <PlainText>{p.text}</PlainText>
          </div>
        ))}
      </div>
    </section>
  )
}

/** The log's own field names as the owner reads them: which part of the request each is, and what it is billed as. */
const REQUEST_LABELS: Record<string, string> = {
  instructions: 'Instructions (billed as cached input)',
  'user text': 'Your text (billed as input)',
  'sent to provider': 'Sent to the provider, as built',
  'answer schema': 'Answer shape (written into the instructions)',
  'max output tokens': 'Longest answer (tokens)',
}
const relabel = (parts: LogPart[], labels: Record<string, string>): LogPart[] => parts.map(p => ({ ...p, label: labels[p.label] ?? p.label }))

/** What a row's tools say, in plain words: "Searched the web 2 times". */
function toolsInWords(tools: unknown[]): string {
  const n = searchesOf({ tools })
  return n > 0 ? `Searched the web ${n} ${n === 1 ? 'time' : 'times'} (billed per search, on top of the tokens).` : 'No tool was used.'
}

function CostLines({ cost }: { cost: CostBreakdown }) {
  return (
    <section aria-label="What the call cost">
      <div className="flex items-center justify-between gap-2">
        <h4 className="section-label"><Term term="MTok">What it cost</Term></h4>
        <span className="text-body font-semibold tabular-nums text-fg">{formatUsd(cost.stored, { fine: true })}</span>
      </div>
      {cost.held ? (
        <p data-tone="warn" className="tone-text mt-1 text-meta">
          <span className="font-semibold">Held at worst case — the real bill is unknown.</span>{' '}
          No token count came back (the call timed out or was lost), and Anthropic may still have billed it. The most this call could cost stays counted against your budget, so it can only ever be too much, never too little.{' '}
          <InfoBubble label="What “held at worst case” means">{'Before a call is sent, its worst-case cost is reserved. A call that answered replaces the reservation with its real cost; one that did not stays at the reservation. Anthropic’s Console has the official bill.'}</InfoBubble>
        </p>
      ) : cost.unpriced ? (
        <p className="mt-1 text-meta text-fg-muted">This model has no price in the function’s table, so the stored cost is shown as it is.</p>
      ) : cost.lines.length === 0 && cost.searches === 0 ? (
        <p className="mt-1 text-meta text-fg-muted">No tokens were used: nothing was sent, so nothing was billed.</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1.5">
          {cost.lines.map(l => (
            <li key={l.key} className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <p className="text-meta text-fg"><span className="font-medium">{l.label}</span> <span className="text-fg-muted">· {l.what}</span></p>
                <p className="text-meta tabular-nums text-fg-muted">{formatCount(l.tokens)} tokens × {formatPrice(l.perMTok)} per million</p>
              </div>
              <span className="shrink-0 text-meta font-medium tabular-nums text-fg">{formatUsd(l.usd, { fine: true })}</span>
            </li>
          ))}
          {cost.multiplier !== 1 && (
            <li className="flex items-baseline justify-between gap-3 text-meta text-fg-2">
              <span>× {cost.multiplier} ({cost.multiplierWhy.join(', ')})</span>
              <span className="shrink-0 font-medium tabular-nums text-fg">{formatUsd(cost.worked, { fine: true })}</span>
            </li>
          )}
          {cost.searches > 0 && (
            <li className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <p className="text-meta text-fg"><span className="font-medium">Web search</span> <span className="text-fg-muted">· Anthropic searched the web for the answer</span></p>
                <p className="text-meta tabular-nums text-fg-muted">{cost.searches} {cost.searches === 1 ? 'search' : 'searches'} × {formatUsd(cost.searchEach, { fine: true })}</p>
              </div>
              <span className="shrink-0 text-meta font-medium tabular-nums text-fg">{formatUsd(cost.searchUsd, { fine: true })}</span>
            </li>
          )}
          {Math.abs(cost.worked - cost.stored) > 0.0000015 && (
            <li className="text-meta text-fg-muted">The ledger holds {formatUsd(cost.stored, { fine: true })}: the prices may have changed since it was written.</li>
          )}
        </ul>
      )}
    </section>
  )
}

function CallText({ id }: { id: string }) {
  const q = useAiCall(id)
  if (q.isLoading) return <Skeleton rounded="rounded-row" className="h-24 w-full" />
  if (q.isError) return <ReadFailed what="this call’s text" error={q.error} onRetry={() => { void q.refetch() }} retrying={q.isFetching} />
  if (!q.data) return <p className="text-meta text-fg-muted">This call is no longer in the ledger.</p>
  const request = relabel(logParts(q.data.request), REQUEST_LABELS), response = logParts(q.data.response)
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
      {response.length > 0 && <TextBlock title="Answer (billed as output)" parts={response} />}
      {thinking && <TextBlock title="Reasoning summary (billed as output)" parts={[{ label: '', text: thinking, block: true }]} />}
    </div>
  )
}

export function AiCallDetail({ call, jobs, framed }: {
  call: AiCall
  jobs: Describe['jobs'] | undefined
  /** The detail pane's own card (laptop); false under a row on a phone. */
  framed: boolean
}) {
  const meta = callOutcomeMeta(call)
  const prices = useClaudeDescribe().data?.prices
  const cost = costBreakdown(call, prices)
  const body = (
    <>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-body font-semibold text-fg">{jobTitleOf(jobs, call.job)}</p>
          <OutcomePill call={call} />
        </div>
        <p className="text-meta text-fg-2">{meta.what}</p>
        {call.error && <p data-tone="danger" className="tone-text break-words text-meta">{call.error}</p>}
      </div>
      <dl className="grid grid-cols-[minmax(6.5rem,auto)_1fr] gap-x-3 gap-y-1 border-t border-line pt-3 text-meta">
        <Fact label="When">{formatDateTime(call.created_at)} · {agoLabel(call.created_at)}</Fact>
        <Fact label="Job">{call.job}{call.instructions_version && <> · <span className="whitespace-nowrap">instructions version {call.instructions_version}</span></>}</Fact>
        <Fact label="Model">{callModelLabel(call)}{call.served_model && call.served_model !== call.model ? ` · answered by ${call.served_model}` : ''}</Fact>
        {call.effort && <Fact label="Effort">{call.effort}</Fact>}
        <Fact label="Asked from">{[call.caller, call.mode, call.step > 1 ? `step ${call.step}` : ''].filter(Boolean).join(' · ')}</Fact>
        {call.stop_reason && <Fact label="Stop reason">{call.stop_reason === 'count_tokens' ? 'count_tokens (a free token count of the Test bench: nothing was generated)' : call.stop_reason}</Fact>}
        {call.duration_ms != null && <Fact label="Duration">{formatDuration(call.duration_ms)}</Fact>}
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
      <div className="border-t border-line pt-3"><CostLines cost={cost} /></div>
      {call.job === 'chat' && call.outcome !== 'budget' && <ChatFacts callId={call.id} />}
      {call.tools.length > 0 && (
        <section aria-label="Tools" className="border-t border-line pt-3">
          <h4 className="section-label mb-1">Tools</h4>
          <p className="text-body text-fg">{toolsInWords(call.tools)}</p>
        </section>
      )}
      <div className="border-t border-line pt-3"><CallText id={call.id} /></div>
    </>
  )
  return framed
    ? <Card aria-label="Call details" className="flex max-h-[calc(100dvh-7rem)] flex-col gap-3 overflow-y-auto">{body}</Card>
    : <div className="flex flex-col gap-3">{body}</div>
}
