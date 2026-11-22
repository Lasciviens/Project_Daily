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
import type { AnswerEnding, ModelAnswer, ModelFailure, ModelList, ModelRequest, Provider, ProviderInfo, TokenCount, TokenUsage } from './types.ts'

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

const ANTHROPIC_SPEND_LIMIT_START = 'You have reached your specified API usage limits'
const ANTHROPIC_SPEND_LIMIT_MESSAGE = "Your monthly spend limit in Anthropic's Console is reached, so Anthropic refused the request. Raise it in the Console (Settings → Limits) or wait for the new month."

const ANTHROPIC_FAILURES: Record<ModelFailure['kind'], string> = {
  key: 'Anthropic did not accept the API key for this request. Check ANTHROPIC_API_KEY in Supabase → Edge Functions → Secrets.',
  billing: "Anthropic stopped the request for a billing reason: the account's spend limit or its credit. Look at Billing in the Anthropic Console.",
  rate_limit: 'Anthropic is getting too many requests from this account right now. Try again in a minute.',
  overloaded: 'Anthropic is overloaded right now. Try again in a moment.',
  refused_request: 'Anthropic did not accept the request as it was built. The call in Developer → AI → Calls has its explanation.',
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
      try {
        return anthropicAnswer(await client.messages.create(anthropicRequest(request), { timeout }))
      } catch (error) {
        // The SDK's error object can hold the request and its headers: only single, named fields are read from it.
        return anthropicFailure(error, apiKey, timeout)
      }
    },
    // Free: GET /v1/models.
    async listModels(timeoutMs: number): Promise<ModelList | ModelFailure> {
      const timeout = anthropicTimeout(timeoutMs)
      try {
        const page = await client.models.list({ limit: ANTHROPIC_LIST_LIMIT }, { timeout })
        return { ok: true, modelIds: page.data.map(model => model.id).filter(id => typeof id === 'string').slice(0, ANTHROPIC_LIST_LIMIT) }
      } catch (error) {
        return anthropicFailure(error, apiKey, timeout)
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
        return anthropicFailure(error, apiKey, timeout)
      }
    },
  }
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
    messages: [{ role: 'user', content: request.userText }],
    // The model decides how much to reason. `summarized` returns a readable summary for the ledger. `disabled` asks
    // for no reasoning at all (the SDK's ThinkingConfigDisabled): it takes no `display`, and no summary comes back.
    thinking: request.thinking === 'off' ? { type: 'disabled' } : { type: 'adaptive', display: 'summarized' },
    output_config: {
      effort: request.effort,
      // A fixed answer shape: the answer is JSON that follows this schema, in a text block.
      ...(request.answerSchema ? { format: { type: 'json_schema' as const, schema: request.answerSchema } } : {}),
    },
  }
}

function anthropicAnswer(message: Anthropic.Message & { _request_id?: string | null }): ModelAnswer {
  let text = ''
  const thoughts: string[] = []
  // An answer is a list of blocks; one that thought first begins with thinking blocks. Read each by its type.
  for (const block of message.content) {
    if (block.type === 'text') text += block.text
    else if (block.type === 'thinking' && block.thinking) thoughts.push(block.thinking)
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

function anthropicFailure(error: unknown, apiKey: string, timeoutMs: number): ModelFailure {
  const failed = (kind: ModelFailure['kind'], status: number | null, detail: string, requestId: string | null): ModelFailure => ({
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
