// The Claude layer's shapes on the app side (docs/features/ai.md → "The Claude layer"), written by hand:
// the `claude` edge function's requests and answers (supabase/claude-src) and the ledger's tables
// (migration 194: ai_calls, ai_settings, ai_job_settings, ai_usage).

/** Why a run gave no result. `message` beside it is one plain sentence, shown as it is. */
export const CLAUDE_REASONS = ['bad_input', 'off', 'budget', 'busy', 'not_configured', 'refused', 'cut_off', 'invalid', 'error'] as const
export type ClaudeReason = typeof CLAUDE_REASONS[number]

/** How a call ended, as the ledger stores it (`ai_calls.outcome`). */
export const CALL_OUTCOMES = ['ok', 'refused', 'cut_off', 'invalid', 'error', 'budget', 'off', 'not_configured', 'bad_input'] as const
export type CallOutcome = typeof CALL_OUTCOMES[number]

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
  /** The model that really answered (`model` is the one asked for), or null when none did. */
  served_model: string | null
}

/** The four checks of Diagnose, in the order the function runs them. */
export const DIAGNOSE_STEP_NAMES = ['network_key', 'request_shape', 'tiny_answer', 'fill_request'] as const
export type DiagnoseStepName = typeof DIAGNOSE_STEP_NAMES[number]

/** One check: `detail` is the function's own sentence (secrets already taken out), `ms` how long it took. */
export interface DiagnoseStep {
  name: DiagnoseStepName
  title: string
  ok: boolean
  ms: number
  detail: string
}

export interface DescribeModel { id: string; name: string; note: string }

export interface DescribeLimits {
  monthlyBudgetMaxUsd: number
  callsPerMinute: number
  callsPerDay: number
  maxOutputTokens: { min: number; max: number }
  logDays: { min: number; max: number }
  requestMaxBytes: number
  /** The longest question the Test bench takes, in characters. */
  benchTextMax: number
  deviceCallsPerDay: { kobo: number; phone: number }
}

export interface DescribeModelPrice {
  model: string
  inputPerMTok: number
  outputPerMTok: number
  cacheReadPerMTok: number
  cacheWrite5mPerMTok: number
  cacheWrite1hPerMTok: number
}

export interface DescribePrices {
  /** ISO date the table was checked against Anthropic's page. */
  checkedOn: string
  source: string
  longPromptOverTokens: number
  longPromptMultiplier: number
  batchMultiplier: number
  models: DescribeModelPrice[]
}

export interface DescribeJob {
  name: string
  title: string
  what: string
  kind: string
  callers: string[]
  version: string
  defaults: { model: string; effort: string; maxOutputTokens: number }
  /** The longest the model may take for this job, in milliseconds; null: by the length of its answer. */
  timeLimitMs: number | null
  instructions: string
  answerSchema: unknown | null
  tools: { name: string; what: string }[]
  features: string[]
  sourceFiles: string[]
}

/** What the function says about itself (`{ action: 'describe' }`): its own lists, limits, prices and jobs. */
export interface Describe {
  configured: boolean
  provider: { name: string; sdk: string; apiVersion: string; endpoint: string }
  models: DescribeModel[]
  efforts: string[]
  limits: DescribeLimits
  defaults: { monthlyBudgetUsd: number; logText: boolean; logDays: number }
  prices: DescribePrices
  jobs: DescribeJob[]
  steps: { title: string; text: string; part: string }[]
  parts: { name: string; file: string; what: string }[]
  safetyRules: string[]
}

/** One row of the ledger, without its text. */
export interface AiCall {
  id: string
  created_at: string
  run_id: string
  step: number
  job: string
  caller: string
  mode: string
  provider: string
  model: string
  served_model: string | null
  effort: string | null
  outcome: string
  stop_reason: string | null
  error: string | null
  request_id: string | null
  input_tokens: number
  cache_read_tokens: number
  cache_write_5m_tokens: number
  cache_write_1h_tokens: number
  output_tokens: number
  thinking_tokens: number
  long_prompt: boolean
  cost_usd: number
  duration_ms: number | null
  instructions_version: string | null
  tools: unknown[]
}

/** A call with its text log: null when the log was off, or after its days. */
export interface AiCallWithText extends AiCall {
  request: unknown | null
  response: unknown | null
  thinking: string | null
}

export interface AiCallsFilter {
  /** '' = every job. */
  job: string
  /** '' = every outcome. */
  outcome: string
}

export interface AiCallsPage {
  calls: AiCall[]
  /** Calls matching the filter, over every page. */
  total: number
}

/** The account's own settings row; with no row yet, the function's defaults. */
export interface AiSettings {
  monthly_budget_usd: number
  log_text: boolean
  log_days: number
}

/** The owner's changes to one job: null = the job's default. */
export interface AiJobSettings {
  job: string
  enabled: boolean
  model: string | null
  effort: string | null
  max_output_tokens: number | null
  monthly_budget_usd: number | null
}

/** One row of `ai_usage`: a day (Europe/Oslo), a job, a mode and a model. */
export interface AiUsageRow {
  day: string
  job: string
  mode: string
  model: string
  calls: number
  failed: number
  input_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  output_tokens: number
  thinking_tokens: number
  cost_usd: number
}
