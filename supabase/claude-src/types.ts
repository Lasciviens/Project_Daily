// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · the shared words
//
//  The shapes the other parts hand to each other. Nothing here belongs to a
//  model provider: a request is "these instructions, this text, this answer
//  shape", and an answer is "this text, how it ended, these token counts".
//  provider-anthropic.ts is the one part that turns them into Anthropic's own
//  names and back, so another provider would be another such part.
//
//  The parts are joined into supabase/functions/claude/index.ts by
//  scripts/build-claude-function.mjs — edit the parts, never that file.
// ─────────────────────────────────────────────────────────────────────────────

/** How much the model reasons and writes. The owner picks one per job. */
export type Effort = 'low' | 'medium' | 'high'

/**
 * Who started a run: `app` (the signed-in owner's browser), `phone` and `kobo` (the two device functions,
 * phone-gateway and kobo-sync, after they checked their own device secret), `schedule` (phase 3).
 */
export type Caller = 'app' | 'phone' | 'kobo' | 'schedule'

/** `live` answers now; `batch` (phase 3) is queued and costs half. */
export type CallMode = 'live' | 'batch'

/** A JSON Schema: the shape an answer must have. */
export type JsonSchema = { [key: string]: unknown }

/** What one request asks the model for. */
export interface ModelRequest {
  model: string
  /** The longest answer allowed, in tokens. The model's thinking counts toward it. */
  maxOutputTokens: number
  effort: Effort
  /** The job's fixed instructions: the same bytes on every call, so the provider can cache them. */
  instructions: string
  /** The part that changes from call to call. */
  userText: string
  /** The shape the answer must have, or null for free text. */
  answerSchema: JsonSchema | null
  /**
   * `adaptive` (the default): the model decides how much to reason and returns a summary of it. `off`: no
   * reasoning at all, which costs and takes less. The owner picks one per job (Settings; adaptive until a job's
   * answers are measured to be as good without), and the Test bench's request may pick it for one run.
   */
  thinking?: 'adaptive' | 'off'
  /** How long the provider may take, in milliseconds. Left out: the provider's own limit (30 s). */
  timeoutMs?: number
  /** Photos the model looks at (a quick guess, a receipt). Already checked by image-rules.ts; never stored anywhere. */
  images?: RequestImage[]
  /** The provider's own web search, at most `maxUses` searches in this one call (a place's ideas). Absent: no tools at all. */
  webSearch?: { maxUses: number }
}

/** One photo as it travels: its type and its bytes as base64 (no `data:` prefix). Only these three types ever pass. */
export interface RequestImage {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp'
  base64: string
}

/** What a request cost, in tokens. A token is a piece of text, about ¾ of a word. */
export interface TokenUsage {
  /** Prompt tokens billed at the full price. */
  inputTokens: number
  /** Prompt tokens read from the provider's cache (a tenth of the price). */
  cacheReadTokens: number
  /** Prompt tokens written to the cache, kept 5 minutes. */
  cacheWrite5mTokens: number
  /** Prompt tokens written to the cache, kept 1 hour. */
  cacheWrite1hTokens: number
  /** Everything the model wrote, its thinking included: this is what is billed as output. */
  outputTokens: number
  /** How much of `outputTokens` was thinking. */
  thinkingTokens: number
}

/**
 * How an answer ended: `complete` is the only good ending. `refused`: the model declined. `cut_off`: it ran into
 * the length limit. `unexpected`: anything this code doesn't handle yet, which is never treated as an answer.
 */
export type AnswerEnding = 'complete' | 'refused' | 'cut_off' | 'unexpected'

/**
 * The request exactly as the provider part built it, for the text log: the settings that shaped it (the cache mark,
 * the thinking setting, the answer shape, the time limit). The instructions and the owner's text are not repeated in
 * it (the log already holds them), and it never holds a key: the provider sends that in a header, not in the body.
 */
export type SentRequest = Record<string, unknown>

/** The model answered (which doesn't yet mean the answer is usable: read `ending` first). */
export interface ModelAnswer {
  ok: true
  text: string
  /** A summary of the model's reasoning, or '' when there was none. */
  thinking: string
  ending: AnswerEnding
  /** The provider's own word for the ending, kept for the ledger. */
  stopReason: string
  /** Why it declined, when the provider says. */
  refusal: string
  usage: TokenUsage
  /** The provider's id for this request: what its support asks for. */
  requestId: string | null
  /** The model that really answered. */
  servedModel: string | null
  /** What the provider part built and sent (see SentRequest). */
  sent: SentRequest | null
  /** How many web searches the provider ran for this answer (each one is billed on its own). */
  webSearches: number
}

/** The call failed. Nothing here is the provider's raw error: `message` and `detail` are already scrubbed. */
export interface ModelFailure {
  ok: false
  kind: 'key' | 'billing' | 'rate_limit' | 'overloaded' | 'refused_request' | 'network' | 'timeout' | 'provider_fault' | 'unknown'
  /** The HTTP status, when there was an answer at all. */
  status: number | null
  /** One plain sentence the app shows as it is. */
  message: string
  /** The provider's own short explanation, for the ledger. */
  detail: string
  requestId: string | null
  /** What the provider part built and sent (see SentRequest); null when nothing was built. */
  sent: SentRequest | null
}

/** The ids of the models the provider lists for this key. */
export interface ModelList {
  ok: true
  modelIds: string[]
}

/** What the provider counted for a request, without running it. */
export interface TokenCount {
  ok: true
  inputTokens: number
}

/** A batch the provider accepted: its id (a link to an outside service, kept server-side only). */
export interface BatchSubmitted {
  ok: true
  batchId: string
}

/** How far a batch is: `in_progress` and `canceling` are not done; `ended` means every line has a result. */
export interface BatchStatus {
  ok: true
  status: 'in_progress' | 'canceling' | 'ended'
}

/** One result line of an ended batch, found by the id we gave the request. */
export type BatchLine =
  | { customId: string; kind: 'succeeded'; answer: ModelAnswer }
  | { customId: string; kind: 'errored' | 'canceled' | 'expired'; detail: string }

export interface BatchResults {
  ok: true
  lines: BatchLine[]
}

/**
 * A model provider, as the run part sees it. `send` is the real request. The other two are free checks that
 * Diagnose uses: they cost no tokens and never generate anything.
 */
export interface Provider {
  name: string
  send(request: ModelRequest): Promise<ModelAnswer | ModelFailure>
  /** Lists the models this key may use. */
  listModels(timeoutMs: number): Promise<ModelList | ModelFailure>
  /** Counts the tokens of a request exactly as `send` would build it (`request.timeoutMs` is its limit). */
  countTokens(request: ModelRequest): Promise<TokenCount | ModelFailure>
  /** Queues requests at the batch price: each is built exactly as `send` builds it and found again by its `customId`. */
  submitBatch(items: readonly { customId: string; request: ModelRequest }[], timeoutMs: number): Promise<BatchSubmitted | ModelFailure>
  /** Asks how far a batch is. Free. */
  batchStatus(batchId: string, timeoutMs: number): Promise<BatchStatus | ModelFailure>
  /** Reads the results of an ended batch, in whatever order they come. Free. */
  batchResults(batchId: string, timeoutMs: number): Promise<BatchResults | ModelFailure>
  /** One round of a chat, streamed: `onDelta` gets our own small events while the answer arrives (see ChatRequest). */
  chatRound(request: ChatRequest, onDelta: (delta: ChatDelta) => void): Promise<ChatAnswer | ModelFailure>
  /** Counts the prompt tokens of a chat request exactly as `chatRound` would send it. Free. */
  countChat(request: ChatRequest): Promise<TokenCount | ModelFailure>
}

// ── Ask AI (chat) ────────────────────────────────────────────────────────────

/**
 * One block of a message, exactly as the provider part produced it (the model's own blocks: text, thinking with its
 * signature, tool calls) or as this code built it (the owner's text, a live-context line, a tool result). Other parts
 * read only `type`, `text`, `id`, `name` and `input` and never change a block they did not make: a chat is replayed
 * byte for byte.
 */
export type Block = Record<string, unknown>

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: Block[]
}

/** A tool the model may call. The schema lists every field as required (no optional parameters, ever). */
export interface ChatTool {
  name: string
  description: string
  properties: Record<string, JsonSchema>
}

export interface ChatRequest {
  model: string
  maxOutputTokens: number
  effort: Effort
  thinking: 'adaptive' | 'off'
  /** The fixed instructions of the chat (the same bytes for its whole life). */
  system: string
  /** The owner's own instructions (a second, cached block; '' leaves it out). */
  ownerInstructions: string
  /** The chat's frozen tool list, in a fixed order. */
  tools: ChatTool[]
  /** true: the model may not call a tool this round (the round that must answer). */
  noTools: boolean
  messages: ChatMessage[]
  /** The provider's id of the previous answer of this chat, for the cache diagnostics (null: the first). */
  previousMessageId: string | null
  /** When the provider clears old tool results from a long prompt (tokens). */
  contextEditing: { triggerTokens: number; keepToolUses: number; clearAtLeastTokens: number }
  timeoutMs: number
  /** Stops the request when the app goes away. */
  signal?: AbortSignal
}

/** What the provider tells the chat while an answer arrives. Only these two, never a raw provider event. */
export type ChatDelta = { kind: 'text'; text: string } | { kind: 'tool'; name: string }

/** Why the provider's prompt cache could not be reused (a short word and the tokens that missed), or null. */
export interface CacheMiss {
  reason: string
  tokens: number | null
}

export interface ChatAnswer {
  ok: true
  /** The blocks of the answer, exactly as received. */
  content: Block[]
  ending: AnswerEnding | 'tool_calls'
  stopReason: string
  refusal: string
  usage: TokenUsage
  requestId: string | null
  /** The provider's id of this answer. */
  messageId: string | null
  servedModel: string | null
  /** The thinking summary, '' when there was none. */
  thinking: string
  cacheMiss: CacheMiss | null
  /** What context editing cleared from the prompt, when it did. */
  cleared: { toolUses: number; tokens: number } | null
  sent: SentRequest | null
}

/** What the "How it works" page says about the provider. */
export interface ProviderInfo {
  name: 'anthropic'
  sdk: string
  apiVersion: string
  endpoint: string
}

/** What a job may use from the answer besides its text: the thinking summary and the model that really answered. */
export interface AnswerDetails {
  thinking: string
  servedModel: string | null
  /** How many web searches the answer is based on (0: the model's own knowledge). */
  webSearches: number
}

/** A job's reading of the model's text: its checked result, or why the text can't be used. */
export type AnswerCheck = { ok: true; result: Record<string, unknown> } | { ok: false; problem: string }

/**
 * One DNS question for the page fetch: the addresses of a name (type A: IPv4, AAAA: IPv6). "No such record" is an
 * empty list; "this runtime cannot look names up" is an error named `NoLookup`; any other error is a failure.
 */
export type DnsLookup = (name: string, type: 'A' | 'AAAA', signal: AbortSignal) => Promise<string[]>

/** What a job may use to read an outside page: the network and the name lookup, both handed in by main.ts. */
export interface PageEnv {
  fetch: typeof fetch
  /** null: no lookup at all (the hostname check alone). */
  dnsLookup: DnsLookup | null
}

/**
 * What a job's step before the model decides. `answer`: code alone made the result (no model is called; the run
 * writes a finished zero-cost ledger row, provider `page`, model `none`, so the rate caps count it; `note` is what
 * the row's text log shows, only while the owner keeps the text log on). `model`: send this as the live part of
 * the prompt. `stop`: nothing usable, in one plain sentence.
 */
export type EarlyStep =
  | { kind: 'answer'; result: Record<string, unknown>; note?: string }
  | { kind: 'model'; userText: string }
  | { kind: 'stop'; outcome: 'bad_input' | 'error'; message: string }

/**
 * What a request may pick for one run, for the one job that offers it (the Test bench): a model, an effort and
 * whether the model thinks. The run checks it again against the code's lists, so a job cannot widen them.
 */
export interface RunChoice {
  model?: string
  effort?: Effort
  thinking?: 'adaptive' | 'off'
}

/** A run that passed the job's input check: the live part of the prompt, and the reader of its answer. */
export interface PreparedRun {
  userText: string
  /** Checked photos for the model to look at (only a job with `acceptsImage`). */
  images?: RequestImage[]
  /** What the photos cost in prompt tokens (image-rules.ts), held in the reservation. */
  imageTokens?: number
  /** Let the model search the web, at most this many times in the call (only a job with `webSearchMax`). */
  webSearchMax?: number
  read(answerText: string, details: AnswerDetails): AnswerCheck
  /** What the request picked, when the job lets it (see RunChoice). Absent: the owner's settings decide. */
  choice?: RunChoice
  /**
   * AI last: work that code can do before any model is asked (fetching a page, finding the recipe the page already
   * holds). It runs after the job's switch and the key are checked and before anything is reserved or sent. It
   * never throws; whatever it did not answer, `model` carries on to the model with the text it found.
   */
  early?(env: PageEnv): Promise<EarlyStep>
}

/** One job: a fixed task the model does, with its own instructions, answer shape and checks. */
export interface JobDefinition {
  /** The name the app asks for: lower case, digits and underscores. */
  name: string
  title: string
  /** What it does for the owner, in a sentence. */
  what: string
  /** `one_shot`: one request, one answer. `conversation`: Ask AI (chat-loop.ts): a stored chat with tools, started from the chat action. */
  kind: 'one_shot' | 'conversation'
  /** `live` (the default) answers now; `batch` is queued at half price and read back later (batch.ts). */
  mode?: CallMode
  callers: readonly Caller[]
  /** Changes whenever the instructions or the answer shape change; every ledger row carries it. */
  version: string
  defaults: { model: string; effort: Effort; maxOutputTokens: number }
  /**
   * How long the model may take, in milliseconds, when the job has a caller that gives up sooner than
   * `requestTimeoutMs` would wait (the phone's shortcut answers within about 22 s). Left out: `requestTimeoutMs`.
   */
  timeLimitMs?: number
  /** true: a request may pick the model, the effort and the thinking (inside the lists): the Test bench. */
  pickable?: boolean
  /** true: the request may carry one photo (image-rules.ts), so main.ts reads a body up to the image limit for it. */
  acceptsImage?: boolean
  instructions: string
  answerSchema: JsonSchema | null
  /**
   * true: the provider enforces the shape (Anthropic's structured output). false: the shape is written into the
   * instructions and only our own check holds the answer to it. ✨ is false: Anthropic could not prepare its shape
   * (21 optional fields) within 90 s in production, while the same request without it answers in about a second
   * (Diagnose, 22.11.2026).
   */
  enforceAnswerSchema: boolean
  /** Repo-relative paths of the files that define this job. */
  sourceFiles: readonly string[]
  /** The tools the job lets the model use (only place_ideas: Anthropic's web search), for the Developer page. */
  tools?: readonly { name: string; what: string }[]
  /** What else the Developer page says about this job (a step done by code before the model, say). */
  extraFeatures?: readonly string[]
  /** Checks the input. Answers why it can't be used, or the prompt's live part with the reader of its answer. */
  prepare(input: unknown, now: Date): { problem: string } | PreparedRun
}

/** How a call ended, as the ledger stores it. */
export type Outcome = 'ok' | 'refused' | 'cut_off' | 'invalid' | 'error' | 'budget' | 'off' | 'not_configured' | 'bad_input'

/** Why a run gave no result. `busy` (a rate cap) is the one that is not written to the ledger. */
export type Reason = Exclude<Outcome, 'ok'> | 'busy'

/** The numbers of one ledger row, sent back with every answer. */
export interface CallSummary {
  id: string
  run_id: string
  job: string
  model: string
  outcome: string
  input_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  output_tokens: number
  thinking_tokens: number
  cost_usd: number
  duration_ms: number
  /** The model that really answered, or null when none did. */
  served_model: string | null
}

/** The answer to `{ action: 'count' }`: what a Test bench question would cost in prompt tokens, before it is sent. */
export type CountReply =
  | { ok: true; input_tokens: number; model: string; effort: Effort; thinking: 'adaptive' | 'off' }
  | { ok: false; reason: 'bad_input' | 'busy' | 'off' | 'not_configured' | 'error'; message: string }

/** The answer to `{ action: 'run' }`. */
export type RunReply =
  // `source: 'page'`: code alone answered from the page itself. No model was asked; the `call` is a zero-cost row.
  | { ok: true; job: string; result: Record<string, unknown>; call?: CallSummary; source?: 'page' }
  | { ok: false; reason: Reason; message: string; call?: CallSummary }

/**
 * The answer to `{ action: 'report_make' }`. `queued`: the batch was accepted and the report row exists.
 * `skipped`: nothing was done on purpose (outside the schedule's window, or a report for that week exists).
 */
export type ReportMakeReply =
  | { ok: true; queued: true; report_id: string; week_start: string; kind: 'scheduled' | 'redo' | 'copy' | 'so_far' }
  | { ok: true; queued: false; skipped: 'not_the_time' | 'already_made' | 'already_queued' | 'no_data'; week_start: string | null }
  | { ok: false; reason: Reason | 'failed'; message: string; report_id?: string }

/** The answer to `{ action: 'report_check' }`: what the check found among the queued reports. */
export type ReportCheckReply =
  | { ok: true; checked: number; ready: number; failed: number; waiting: number; pushed: number }
  | { ok: false; message: string }

/** One check of Diagnose, as the app shows it. `detail` is one plain sentence with numbers, already scrubbed. */
export interface DiagnoseStep {
  name: 'network_key' | 'request_shape' | 'tiny_answer' | 'fill_request'
  title: string
  ok: boolean
  /** How long the step took, in milliseconds. */
  ms: number
  detail: string
}

/** The answer to `{ action: 'diagnose' }`. `busy`: one was run less than a minute ago. */
export type DiagnoseReply =
  | { ok: true; steps: DiagnoseStep[] }
  | { ok: false; reason: 'busy' | 'error'; message: string }

/** The answer to `{ action: 'describe' }`: what this code is and does, for the Developer → AI page. */
export interface Describe {
  /** Whether the API key is set. Never the key, never its length. */
  configured: boolean
  provider: ProviderInfo
  /** The models a job may use, the default first. */
  models: { id: string; name: string; note: string }[]
  efforts: Effort[]
  limits: {
    monthlyBudgetMaxUsd: number
    callsPerMinute: number
    callsPerDay: number
    maxOutputTokens: { min: number; max: number }
    logDays: { min: number; max: number }
    requestMaxBytes: number
    /** The most a request that carries a photo may be (only the jobs that accept one). */
    imageRequestMaxBytes: number
    /** The longest question the Test bench takes, in characters. */
    benchTextMax: number
    /** What one device (the Kobo, the phone) may ask in a day. */
    deviceCallsPerDay: { kobo: number; phone: number }
  }
  defaults: { monthlyBudgetUsd: number; logText: boolean; logDays: number }
  prices: {
    /** ISO date; the app formats it. */
    checkedOn: string
    source: string
    longPromptOverTokens: number
    longPromptMultiplier: number
    batchMultiplier: number
    /** What one web search costs, on top of the tokens (only the ideas for a place use it), and the most a call may run. */
    webSearchUsdEach: number
    webSearchMaxUses: number
    models: {
      model: string
      inputPerMTok: number
      outputPerMTok: number
      cacheReadPerMTok: number
      cacheWrite5mPerMTok: number
      cacheWrite1hPerMTok: number
      /** Whether the long-prompt prices apply to this model. */
      longPromptPricing: boolean
    }[]
  }
  jobs: {
    name: string
    title: string
    what: string
    kind: 'one_shot' | 'conversation'
    mode: CallMode
    callers: string[]
    version: string
    defaults: { model: string; effort: string; maxOutputTokens: number }
    /** The longest the model may take for this job, in milliseconds. */
    timeLimitMs: number | null
    instructions: string
    answerSchema: unknown | null
    tools: { name: string; what: string }[]
    features: string[]
    sourceFiles: string[]
  }[]
  steps: { title: string; text: string; part: string }[]
  parts: { name: string; file: string; what: string }[]
  safetyRules: string[]
}
