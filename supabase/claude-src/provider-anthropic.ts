// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · the Anthropic provider
//
//  The only part that imports Anthropic's SDK or uses one of Anthropic's own
//  field names. It turns our request (types.ts) into a Messages API request,
//  and the answer or the error back into our words. Every fact used here is
//  in docs/integrations/anthropic.md; the SDK's own types check each name.
//
//  The API key and the `fetch` to use are arguments, so a test runs the real
//  SDK against a pretend network (scripts/verify-claude-function.cjs).
// ─────────────────────────────────────────────────────────────────────────────

import {
  Anthropic,
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  BadRequestError,
  ContentTooLargeError,
  InternalServerError,
  NotFoundError,
  OverloadedError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError,
  type ClientOptions,
} from 'npm:@anthropic-ai/sdk@1.5.0'
import type {
  AnswerEnding, BatchLine, BatchResults, BatchStatus, BatchSubmitted, Block, CacheMiss, ChatAnswer, ChatDelta, ChatRequest, ModelAnswer, ModelFailure, ModelList, ModelRequest, Provider,
  ProviderInfo, SentRequest, TokenCount, TokenUsage,
} from './types.ts'
import { searchResultBlock } from './search-results.ts'

/** What the "How it works" page shows. The verify script compares each line with what the SDK really sends. */
export const ANTHROPIC_INFO: ProviderInfo = {
  name: 'anthropic',
  sdk: '@anthropic-ai/sdk@1.5.0',
  apiVersion: '2026-10-21',
  endpoint: 'https://api.anthropic.com/v1/messages',
}

// Given to the SDK outright: left out, it would take the address from an environment variable.
const ANTHROPIC_BASE_URL = 'https://api.anthropic.com'
// An edge function lives for a short time, so a call may not wait the SDK's default 10 minutes. A request may
// ask for another limit (ModelRequest.timeoutMs: Diagnose gives ✨ 90 s once, to see its true time).
const ANTHROPIC_TIMEOUT_MS = 30_000
// The model list is read once, whole: Anthropic lists a handful of models, and 1000 is the most a page takes.
const ANTHROPIC_LIST_LIMIT = 1000
// No retry by the SDK: one request is one generation, so one reservation covers one possible bill. (A timeout may
// still be billed; a second try would be a second bill nobody reserved.)
const ANTHROPIC_RETRIES = 0
const ANTHROPIC_DETAIL_MAX = 300
// A count the provider reports is input too: it must fit the ledger's integer columns.
const ANTHROPIC_COUNT_MAX = 2_000_000_000
/** The search results kept from one answer: how many, and the longest address (a longer one is never a link a job may use). */
const ANTHROPIC_SEARCH_URLS_MAX = 40
const ANTHROPIC_SEARCH_URL_MAX = 2_048

/** What the person reads when a chat round was cut for taking too long. */
export const ANTHROPIC_CHAT_TIMEOUT_MESSAGE = 'No answer — Anthropic took too long. Try again.'

const ANTHROPIC_SPEND_LIMIT_START = 'You have reached your specified API usage limits'
const ANTHROPIC_SPEND_LIMIT_MESSAGE = "Your monthly spend limit in Anthropic's Console is reached, so Anthropic refused the request. Raise it in the Console (Settings → Limits) or wait for the new month."

const ANTHROPIC_FAILURES: Record<ModelFailure['kind'], string> = {
  key: 'Anthropic did not accept the API key for this request. Check ANTHROPIC_API_KEY in Supabase → Edge Functions → Secrets.',
  billing: "Anthropic stopped the request for a billing reason: the account's spend limit or its credit. Look at Billing in the Anthropic Console.",
  rate_limit: 'Anthropic is getting too many requests from this account right now. Try again in a minute.',
  overloaded: 'Anthropic is overloaded right now. Try again in a moment.',
  refused_request: 'Anthropic refused this request (an app problem). Try again; if it repeats, Developer → AI → Calls has the reason.',
  network: 'Anthropic could not be reached (a network error). Try again in a moment.',
  timeout: `Anthropic did not answer within ${ANTHROPIC_TIMEOUT_MS / 1000} seconds. Try again in a moment.`, // the default; a request with its own limit says its own
  provider_fault: 'Anthropic had a problem on its side. Try again in a moment.',
  unknown: 'The call to Anthropic failed in a way this app does not know yet.',
}

/** A provider that calls Anthropic with `apiKey`. `fetchWith` replaces the network in a test. */
export function anthropicProvider(apiKey: string, fetchWith?: ClientOptions['fetch']): Provider {
  const client = new Anthropic({
    // Sent as the header `Authorization: Bearer <key>`: never in the address, never in the body.
    apiKey,
    baseURL: ANTHROPIC_BASE_URL,
    timeout: ANTHROPIC_TIMEOUT_MS,
    maxRetries: ANTHROPIC_RETRIES,
    // The SDK can print requests to the server log and send them to a tracing service. Both are off:
    // the owner's text goes to Anthropic and to the owner's own ledger, nowhere else.
    logLevel: 'off',
    openTelemetry: false,
    ...(fetchWith ? { fetch: fetchWith } : {}),
  })

  return {
    name: ANTHROPIC_INFO.name,
    async send(request: ModelRequest): Promise<ModelAnswer | ModelFailure> {
      const timeout = anthropicTimeout(request.timeoutMs)
      const body = anthropicRequest(request)
      const sent = anthropicSent(request, body, timeout)
      try {
        return { ...anthropicAnswer(await client.messages.create(body, { timeout })), sent }
      } catch (error) {
        // The SDK's error object can hold the request and its headers: only single, named fields are read from it.
        return { ...anthropicFailure(error, apiKey, timeout), sent }
      }
    },
    // Free: GET /v1/models.
    async listModels(timeoutMs: number): Promise<ModelList | ModelFailure> {
      const timeout = anthropicTimeout(timeoutMs)
      try {
        const page = await client.models.list({ limit: ANTHROPIC_LIST_LIMIT }, { timeout })
        return { ok: true, modelIds: page.data.map(model => model.id).filter(id => typeof id === 'string').slice(0, ANTHROPIC_LIST_LIMIT) }
      } catch (error) {
        return { ...anthropicFailure(error, apiKey, timeout), sent: null }
      }
    },
    // Free: POST /v1/messages/count_tokens, with the same body `send` would send (but for the answer limit).
    async countTokens(request: ModelRequest): Promise<TokenCount | ModelFailure> {
      const timeout = anthropicTimeout(request.timeoutMs)
      try {
        const counted: Partial<Anthropic.MessageCreateParamsNonStreaming> = anthropicRequest(request)
        // Counting takes no answer limit.
        delete counted.max_tokens
        const count = await client.messages.countTokens(counted as Anthropic.MessageCountTokensParams, { timeout })
        return { ok: true, inputTokens: anthropicCount(count.input_tokens) }
      } catch (error) {
        return { ...anthropicFailure(error, apiKey, timeout), sent: null }
      }
    },
    // POST /v1/messages/batches: one request per item, at half price, answered within 24 hours (usually within one).
    async submitBatch(items, timeoutMs): Promise<BatchSubmitted | ModelFailure> {
      const timeout = anthropicTimeout(timeoutMs)
      try {
        const batch = await client.messages.batches.create({
          requests: items.map(item => ({ custom_id: item.customId, params: anthropicRequest(item.request) })),
        }, { timeout })
        return typeof batch.id === 'string' && ANTHROPIC_BATCH_ID.test(batch.id)
          ? { ok: true, batchId: batch.id }
          : { ...anthropicOddAnswer(), sent: null }
      } catch (error) {
        return { ...anthropicFailure(error, apiKey, timeout), sent: null }
      }
    },
    // GET /v1/messages/batches/{id}: free.
    async batchStatus(batchId, timeoutMs): Promise<BatchStatus | ModelFailure> {
      const timeout = anthropicTimeout(timeoutMs)
      try {
        const batch = await client.messages.batches.retrieve(batchId, {}, { timeout })
        const status = batch.processing_status
        return status === 'in_progress' || status === 'canceling' || status === 'ended' ? { ok: true, status } : { ...anthropicOddAnswer(), sent: null }
      } catch (error) {
        return { ...anthropicFailure(error, apiKey, timeout), sent: null }
      }
    },
    // GET /v1/messages/batches/{id}/results (the batch's own results_url): a .jsonl stream, lines in any order.
    async batchResults(batchId, timeoutMs, maxLines): Promise<BatchResults | ModelFailure> {
      const cap = Math.max(1, Math.min(Math.floor(maxLines ?? ANTHROPIC_BATCH_MAX_LINES), ANTHROPIC_BATCH_LINES_MAX))
      const timeout = anthropicTimeout(timeoutMs)
      try {
        const stream = await client.messages.batches.results(batchId, {}, { timeout })
        const lines: BatchLine[] = []
        for await (const line of stream) {
          if (lines.length >= cap) break
          const customId = line.custom_id
          if (typeof customId !== 'string' || !customId) continue
          const result = line.result
          if (result.type === 'succeeded') lines.push({ customId, kind: 'succeeded', answer: { ...anthropicAnswer(result.message), sent: null } })
          else if (result.type === 'errored') {
            lines.push({ customId, kind: 'errored', detail: anthropicPlainText(`${result.error?.error?.type ?? 'error'}: ${result.error?.error?.message ?? ''}`, apiKey) })
          } else if (result.type === 'canceled' || result.type === 'expired') lines.push({ customId, kind: result.type, detail: '' })
        }
        return { ok: true, lines }
      } catch (error) {
        return { ...anthropicFailure(error, apiKey, timeout), sent: null }
      }
    },
    // DELETE /v1/messages/batches/{id}: the batch and its results are gone at Anthropic (an ended batch only).
    async deleteBatch(batchId, timeoutMs): Promise<{ ok: true } | ModelFailure> {
      const timeout = anthropicTimeout(timeoutMs)
      try {
        const deleted = await client.messages.batches.delete(batchId, {}, { timeout })
        return deleted?.id === batchId ? { ok: true } : { ...anthropicOddAnswer(), sent: null }
      } catch (error) {
        return { ...anthropicFailure(error, apiKey, timeout), sent: null }
      }
    },
    // POST /v1/messages/batches/{id}/cancel: the batch stops (results so far are kept until it is deleted).
    async cancelBatch(batchId, timeoutMs): Promise<{ ok: true } | ModelFailure> {
      const timeout = anthropicTimeout(timeoutMs)
      try {
        const batch = await client.messages.batches.cancel(batchId, {}, { timeout })
        return batch?.id === batchId ? { ok: true } : { ...anthropicOddAnswer(), sent: null }
      } catch (error) {
        return { ...anthropicFailure(error, apiKey, timeout), sent: null }
      }
    },
    // One round of a chat, streamed: the SDK's own `messages.stream()` accumulates the events, `finalMessage()` is the
    // answer. Only our two small deltas leave this part (text pieces, "a tool is being called"), never a raw event.
    async chatRound(request: ChatRequest, onDelta: (delta: ChatDelta) => void): Promise<ChatAnswer | ModelFailure> {
      const timeout = anthropicTimeout(request.timeoutMs)
      const body = anthropicChatBody(request)
      const sent = anthropicChatSent(request, body, timeout)
      // The SDK's own timeout covers only the wait for the response headers: a stream that opens and then says nothing
      // would wait for ever (seen live, 22.11.2026). So the round has its own two clocks, and a signal of its own.
      const controller = new AbortController()
      let stoppedBy: 'first_event' | 'idle' | 'round' | null = null
      const stop = (why: 'first_event' | 'idle' | 'round') => { if (!stoppedBy) { stoppedBy = why; controller.abort() } }
      const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('round stopped')), { once: true }))
      aborted.catch(() => {})
      const outer = request.signal
      const onOuterAbort = () => controller.abort()
      if (outer) { if (outer.aborted) controller.abort(); else outer.addEventListener('abort', onOuterAbort, { once: true }) }
      const roundTimer = setTimeout(() => stop('round'), timeout)
      // One silence clock: the first-event limit until the first event, then the idle limit, started again by every event.
      let quiet: ReturnType<typeof setTimeout> | undefined = typeof request.firstEventTimeoutMs === 'number' ? setTimeout(() => stop('first_event'), request.firstEventTimeoutMs) : undefined
      let began = false
      try {
        const stream = client.beta.messages.stream(body, { timeout, signal: controller.signal })
        stream.on('text', piece => { if (piece) onDelta({ kind: 'text', text: piece }) })
        stream.on('streamEvent', event => {
          if ((event.type as string) === 'ping') return
          if (!began) { began = true; onDelta({ kind: 'started' }) }
          if (quiet) clearTimeout(quiet)
          quiet = typeof request.idleTimeoutMs === 'number' ? setTimeout(() => stop('idle'), request.idleTimeoutMs) : undefined
          if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') onDelta({ kind: 'tool', name: anthropicCut(event.content_block.name, 60) })
        })
        const finished = stream.finalMessage()
        finished.catch(() => {})
        const message = await Promise.race([finished, aborted])
        return { ...anthropicChatAnswer(message), sent }
      } catch (error) {
        // Stopped by one of the two clocks: a timeout, whatever error the cut stream raised (the bill is unknown).
        if (stoppedBy) {
          return {
            ok: false, kind: 'timeout', status: null, requestId: null, sent,
            detail: stoppedBy === 'first_event' ? 'no first stream event in time' : stoppedBy === 'idle' ? 'the stream went silent' : 'the round took too long',
            message: ANTHROPIC_CHAT_TIMEOUT_MESSAGE,
          }
        }
        // A failure in the middle of a stream (an error event, a dropped connection, the app going away) lands here too.
        return { ...anthropicFailure(error, apiKey, timeout), sent }
      } finally {
        clearTimeout(roundTimer)
        if (quiet) clearTimeout(quiet)
        outer?.removeEventListener('abort', onOuterAbort)
      }
    },
    // Free: the chat's prompt tokens, counted with the same body (context editing included) but for the answer limit.
    async countChat(request: ChatRequest): Promise<TokenCount | ModelFailure> {
      const timeout = anthropicTimeout(request.timeoutMs)
      try {
        const body = anthropicChatBody(request)
        const count = await client.beta.messages.countTokens({
          model: body.model, messages: body.messages, system: body.system, tools: body.tools, thinking: body.thinking,
          context_management: body.context_management, betas: body.betas,
        }, { timeout })
        return { ok: true, inputTokens: anthropicCount(count.input_tokens) }
      } catch (error) {
        return { ...anthropicFailure(error, apiKey, timeout), sent: null }
      }
    },
  }
}

// A batch id is shaped msgbatch_… ; anything else is an answer this code does not know.
const ANTHROPIC_BATCH_ID = /^[A-Za-z0-9_-]{1,100}$/
// We queue one request at a time, so a batch has one result line; a few more are read in case of a surprise.
const ANTHROPIC_BATCH_MAX_LINES = 50
// The weekly self-test sends one batch of many replays: its own cap, and never more than this.
const ANTHROPIC_BATCH_LINES_MAX = 5000

function anthropicOddAnswer(): Omit<ModelFailure, 'sent'> {
  return { ok: false, kind: 'unknown', status: null, message: ANTHROPIC_FAILURES.unknown, detail: 'an answer this code does not know', requestId: null }
}

/** The limit for one request: the one it asks for (at least a second, at most 2 minutes), else the default. */
function anthropicTimeout(timeoutMs: number | undefined): number {
  return typeof timeoutMs === 'number' && Number.isFinite(timeoutMs)
    ? Math.min(Math.max(Math.round(timeoutMs), 1_000), 120_000)
    : ANTHROPIC_TIMEOUT_MS
}

/** Our request in Anthropic's shape. No temperature, top_p or top_k: this API version refuses them. */
function anthropicRequest(request: ModelRequest): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: request.model,
    // The hard ceiling for the answer. Thinking counts toward it.
    max_tokens: request.maxOutputTokens,
    // The fixed instructions, as one block marked for the cache: when the same bytes come again within
    // 5 minutes, Anthropic reads them from its cache at a tenth of the price.
    system: [{ type: 'text', text: request.instructions, cache_control: { type: 'ephemeral' } }],
    // Everything that changes from call to call comes after the cached block.
    messages: [{ role: 'user', content: anthropicContent(request) }],
    // The model decides how much to reason. `summarized` returns a readable summary for the ledger. `disabled` asks
    // for no reasoning at all (the SDK's ThinkingConfigDisabled): it takes no `display`, and no summary comes back.
    thinking: request.thinking === 'off' ? { type: 'disabled' } : { type: 'adaptive', display: 'summarized' },
    // The one server-side tool: Anthropic's web search, run by Anthropic (no result passes through this code), at most
    // `max_uses` searches in the call. No other tool is ever sent.
    ...(request.webSearch ? { tools: [{ type: 'web_search_20250305' as const, name: 'web_search' as const, max_uses: request.webSearch.maxUses }] } : {}),
    output_config: {
      effort: request.effort,
      // A fixed answer shape: the answer is JSON that follows this schema, in a text block.
      ...(request.answerSchema ? { format: { type: 'json_schema' as const, schema: request.answerSchema } } : {}),
    },
  }
}

/**
 * The message's content: the live text, or, with photos, the photos first and the text after them (Anthropic's advice
 * for a question about an image). A photo is an `image` block with a base64 source; the type is one of three.
 */
function anthropicContent(request: ModelRequest): string | Anthropic.ContentBlockParam[] {
  if (!request.images?.length && !request.documents?.length && !request.knowledge?.length) return request.userText
  return [
    // What the app learned (cases, lessons): `search_result` blocks, each with its own source label and title, before the
    // live text. Data the model may use, never instructions (the job's rule line says so). Citations unset on all of them:
    // a job with an answer shape may not use citations, and one request never mixes the two (search-results.ts).
    ...(request.knowledge ?? []).map(k => searchResultBlock({ source: k.source, title: k.title, text: k.text }, 'unset') as unknown as Anthropic.SearchResultBlockParam),
    // A PDF is a `document` block with a base64 source (the SDK's DocumentBlockParam); the one type is application/pdf.
    ...(request.documents ?? []).map(doc => ({ type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: doc.base64 } })),
    ...(request.images ?? []).map(image => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: image.mediaType, data: image.base64 } })),
    { type: 'text' as const, text: request.userText },
  ]
}

/**
 * The request as built, for the text log: every field that shapes the call (the model, the answer limit, the cache
 * mark on the instructions, the thinking setting, the effort and answer shape, the time limit). The two long texts
 * are named by their length, since the log already holds them; the key is never in a body, so it cannot be here.
 */
function anthropicSent(request: ModelRequest, body: Anthropic.MessageCreateParamsNonStreaming, timeoutMs: number): SentRequest {
  return {
    model: body.model,
    max_tokens: body.max_tokens,
    system: [{ type: 'text', cache_control: { type: 'ephemeral' }, text: `(the job's fixed instructions: ${request.instructions.length} characters, shown above)` }],
    messages: [{ role: 'user', content: `(the live text: ${request.userText.length} characters, shown above)` }],
    // A photo is never kept: only how many were sent and how big (in base64 characters).
    ...(request.images?.length ? { images: request.images.map(i => ({ media_type: i.mediaType, base64_chars: i.base64.length })) } : {}),
    // A PDF is never kept either: only how many were sent and how big.
    ...(request.documents?.length ? { documents: request.documents.map(d => ({ media_type: 'application/pdf', base64_chars: d.base64.length })) } : {}),
    // What the app learned and sent with it: the search_result blocks' sources and titles (their text is in the log's request).
    ...(request.knowledge?.length ? { search_results: request.knowledge.map(k => ({ type: 'search_result', source: k.source, title: k.title, text_chars: k.text.length })) } : {}),
    ...(body.tools ? { tools: body.tools } : {}),
    thinking: body.thinking,
    output_config: body.output_config,
    timeout_ms: timeoutMs,
  }
}

function anthropicAnswer(message: Anthropic.Message & { _request_id?: string | null }): Omit<ModelAnswer, 'sent'> {
  let text = ''
  const thoughts: string[] = []
  const searchUrls: string[] = []
  // An answer is a list of blocks; one that thought first begins with thinking blocks. Read each by its type.
  for (const block of message.content) {
    if (block.type === 'text') text += block.text
    else if (block.type === 'thinking' && block.thinking) thoughts.push(block.thinking)
    // What Anthropic's own search returned: `content` is a list of `web_search_result` (url, title, ...) or, on an error, one error object.
    else if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const hit of block.content) {
        if (hit.type === 'web_search_result' && typeof hit.url === 'string' && hit.url.length <= ANTHROPIC_SEARCH_URL_MAX && searchUrls.length < ANTHROPIC_SEARCH_URLS_MAX) searchUrls.push(hit.url)
      }
    }
  }
  return {
    ok: true,
    text,
    thinking: thoughts.join('\n\n'),
    ending: anthropicEnding(message.stop_reason),
    stopReason: /^[a-z_]{1,60}$/.test(message.stop_reason ?? '') ? String(message.stop_reason) : 'unknown',
    refusal: anthropicPlainText(message.stop_details?.explanation ?? message.stop_details?.category ?? '', ''),
    usage: anthropicUsage(message.usage),
    requestId: typeof message._request_id === 'string' ? anthropicCut(message._request_id, 120) : null,
    servedModel: typeof message.model === 'string' ? anthropicCut(message.model, 80) : null,
    webSearches: anthropicCount(message.usage?.server_tool_use?.web_search_requests),
    searchUrls,
  }
}

/** Anthropic's reason for stopping as one of our endings. Only `end_turn` is a finished answer. */
function anthropicEnding(stopReason: Anthropic.StopReason | null): AnswerEnding {
  if (stopReason === 'end_turn') return 'complete'
  // A decline arrives as a normal answer (HTTP 200) and is billed.
  if (stopReason === 'refusal') return 'refused'
  if (stopReason === 'max_tokens') return 'cut_off'
  return 'unexpected'
}

/** The first `max` characters, whole ones: a cut never splits a character that is two code units long. */
function anthropicCut(text: string, max: number): string {
  return text.length <= max ? text : [...text].slice(0, max).join('')
}

function anthropicCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(Math.round(value), ANTHROPIC_COUNT_MAX) : 0
}

function anthropicUsage(usage: Anthropic.Usage): TokenUsage {
  const written = anthropicCount(usage.cache_creation_input_tokens)
  const written1h = anthropicCount(usage.cache_creation?.ephemeral_1h_input_tokens)
  const outputTokens = anthropicCount(usage.output_tokens)
  return {
    // input_tokens is only the part after the cached block: the three prompt counts add up to the whole prompt.
    inputTokens: anthropicCount(usage.input_tokens),
    cacheReadTokens: anthropicCount(usage.cache_read_input_tokens),
    // A total with no breakdown counts as 5-minute entries: the only kind this function asks for.
    cacheWrite5mTokens: Math.max(anthropicCount(usage.cache_creation?.ephemeral_5m_input_tokens), written - written1h),
    cacheWrite1hTokens: written1h,
    outputTokens,
    thinkingTokens: Math.min(anthropicCount(usage.output_tokens_details?.thinking_tokens), outputTokens),
  }
}

/** Text from Anthropic as one short line, with the API key taken out should it ever be quoted. */
function anthropicPlainText(text: string, apiKey: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return anthropicCut(apiKey ? oneLine.split(apiKey).join('[hidden]') : oneLine, ANTHROPIC_DETAIL_MAX)
}

function anthropicFailure(error: unknown, apiKey: string, timeoutMs: number): Omit<ModelFailure, 'sent'> {
  const failed = (kind: ModelFailure['kind'], status: number | null, detail: string, requestId: string | null): Omit<ModelFailure, 'sent'> => ({
    ok: false, kind, status, detail, requestId,
    message: kind === 'timeout'
      ? `Anthropic did not answer within ${Math.round(timeoutMs / 1000)} seconds. Try again in a moment.`
      : kind === 'billing' && status === 400 ? ANTHROPIC_SPEND_LIMIT_MESSAGE : ANTHROPIC_FAILURES[kind],
  })
  // The most specific kind first: a timeout is a connection error, and both are API errors.
  if (error instanceof APIConnectionTimeoutError) return failed('timeout', null, '', null)
  if (error instanceof APIConnectionError) return failed('network', null, '', null)
  if (!(error instanceof APIError)) return failed('unknown', null, '', null)
  const status = typeof error.status === 'number' ? error.status : null
  const requestId = typeof error.requestID === 'string' ? anthropicCut(error.requestID, 120) : null
  return failed(anthropicFailureKind(error, status), status, anthropicPlainText(error.apiMessage ?? '', apiKey), requestId)
}

function anthropicFailureKind(error: APIError, status: number | null): ModelFailure['kind'] {
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) return 'key'
  // A 429 is "slow down" or the account's spend limit; only the first is worth trying again.
  if (error instanceof RateLimitError) return error.errorCode === 'enforced_spend_limit_reached' ? 'billing' : 'rate_limit'
  if (error instanceof OverloadedError) return 'overloaded'
  if (error instanceof InternalServerError) return 'provider_fault'
  if (error.type === 'billing_error') return 'billing'
  // The Console's own spend limit answers 400 invalid_request_error, not 429 (rate-limits page): told apart by its
  // message, which starts with a fixed sentence. Any other 400 is a request Anthropic did not accept.
  if (status === 400 && (error.apiMessage ?? '').startsWith(ANTHROPIC_SPEND_LIMIT_START)) return 'billing'
  if (error instanceof BadRequestError || error instanceof NotFoundError || error instanceof ContentTooLargeError
    || error instanceof UnprocessableEntityError) return 'refused_request'
  return 'unknown'
}

// ── Ask AI (chat) ────────────────────────────────────────────────────────────

// The two beta features the chat asks for. Context editing clears old tool results from a long prompt; the thinking
// binding control makes a history whose thinking blocks no longer match fail with a 400 instead of reaching the model
// (docs/integrations/anthropic.md, trap 4). Both are in the Developer page's description.
const ANTHROPIC_CHAT_BETAS = ['context-management-2025-06-27', 'thinking-binding-controls-2026-08-01']

/** The chat request in Anthropic's shape. Every breakpoint of the cache layout is here: the last tool, the fixed instructions, the owner's instructions, and the top-level automatic one for the messages. */
function anthropicChatBody(request: ChatRequest): Anthropic.Beta.Messages.MessageCreateParamsNonStreaming {
  const mark = { type: 'ephemeral' as const }
  const last = request.tools.length - 1
  return {
    model: request.model,
    max_tokens: request.maxOutputTokens,
    betas: ANTHROPIC_CHAT_BETAS,
    // Automatic caching of the whole conversation so far: the cache follows the end of the messages.
    cache_control: mark,
    system: [
      { type: 'text', text: request.system, cache_control: mark },
      ...(request.ownerInstructions ? [{ type: 'text' as const, text: request.ownerInstructions, cache_control: mark }] : []),
    ],
    // A chat the owner switched every tool off for has none: no tools field at all (and no tool_choice).
    ...(request.tools.length ? { tools: request.tools.map((tool, i) => ({
      name: tool.name,
      description: tool.description,
      // Not strict (trap 16): a strict tool makes Anthropic compile a grammar on the first request with that tool set, which
      // can take up to 180 s, longer than an edge function lives. Our own check (chat-tools.ts) holds every input instead.
      // The schema stays small and flat: every property listed as required and nothing else allowed, as a hint to the model.
      input_schema: { type: 'object' as const, properties: tool.properties, required: Object.keys(tool.properties), additionalProperties: false },
      ...(i === last ? { cache_control: mark } : {}),
    })) } : {}),
    ...(request.noTools && request.tools.length ? { tool_choice: { type: 'none' as const } } : {}),
    messages: request.messages as unknown as Anthropic.Beta.Messages.BetaMessageParam[],
    thinking: request.thinking === 'off'
      ? { type: 'disabled' }
      : { type: 'adaptive', display: 'summarized', block_binding: { prefix_mismatch_behavior: 'error' } },
    output_config: { effort: request.effort },
    context_management: {
      edits: [{
        type: 'clear_tool_uses_20250919',
        trigger: { type: 'input_tokens', value: request.contextEditing.triggerTokens },
        keep: { type: 'tool_uses', value: request.contextEditing.keepToolUses },
        clear_at_least: { type: 'input_tokens', value: request.contextEditing.clearAtLeastTokens },
      }],
    },
    // Why the cache missed, compared with the previous answer of this chat (stable, no header).
    diagnostics: { previous_message_id: request.previousMessageId },
  }
}

/** The chat request as built, for the text log: its settings, the sizes of the long parts, never the key or the messages themselves (they are in ai_messages). */
function anthropicChatSent(request: ChatRequest, body: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming, timeoutMs: number): SentRequest {
  return {
    model: body.model,
    max_tokens: body.max_tokens,
    betas: body.betas,
    cache_control: body.cache_control,
    system: `(the chat's fixed instructions: ${request.system.length} characters, and ${request.ownerInstructions.length} of the owner's own)`,
    tools: request.tools.map(t => t.name),
    tool_choice: request.noTools ? 'none' : 'auto',
    messages: `(${request.messages.length} messages, stored in the chat)`,
    thinking: body.thinking,
    output_config: body.output_config,
    context_management: body.context_management,
    diagnostics: body.diagnostics,
    timeout_ms: timeoutMs,
  }
}

function anthropicChatAnswer(message: Anthropic.Beta.Messages.BetaMessage & { _request_id?: string | null }): Omit<ChatAnswer, 'sent'> {
  const thoughts: string[] = []
  for (const block of message.content) if (block.type === 'thinking' && block.thinking) thoughts.push(block.thinking)
  const ending: ChatAnswer['ending'] = message.stop_reason === 'tool_use' ? 'tool_calls' : anthropicEnding(message.stop_reason as Anthropic.StopReason | null)
  const reason = message.diagnostics?.cache_miss_reason
  const cacheMiss: CacheMiss | null = reason && typeof reason.type === 'string' && /^[a-z_]{1,40}$/.test(reason.type)
    ? { reason: reason.type, tokens: 'cache_missed_input_tokens' in reason ? anthropicCount(reason.cache_missed_input_tokens) : null }
    : null
  let cleared = null as ChatAnswer['cleared']
  for (const edit of message.context_management?.applied_edits ?? []) {
    if (edit.type === 'clear_tool_uses_20250919') {
      cleared = { toolUses: (cleared?.toolUses ?? 0) + anthropicCount(edit.cleared_tool_uses), tokens: (cleared?.tokens ?? 0) + anthropicCount(edit.cleared_input_tokens) }
    }
  }
  return {
    ok: true,
    // The blocks exactly as received: they are stored and sent back unchanged (a chat is only added to).
    content: message.content as unknown as Block[],
    ending,
    stopReason: /^[a-z_]{1,60}$/.test(message.stop_reason ?? '') ? String(message.stop_reason) : 'unknown',
    refusal: anthropicPlainText(message.stop_details?.explanation ?? message.stop_details?.category ?? '', ''),
    usage: anthropicUsage(message.usage as Anthropic.Usage),
    requestId: typeof message._request_id === 'string' ? anthropicCut(message._request_id, 120) : null,
    messageId: typeof message.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(message.id) ? message.id : null,
    servedModel: typeof message.model === 'string' ? anthropicCut(message.model, 80) : null,
    thinking: thoughts.join('\n\n'),
    cacheMiss,
    cleared,
  }
}
