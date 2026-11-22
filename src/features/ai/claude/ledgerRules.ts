// Pure rules of the Claude layer's app side (Developer → AI): reading the database's and the function's
// answers where they enter, money in USD, the Europe/Oslo month, totals, what the cache saved and budget
// progress. No imports but the types' own lists, so scripts/verify-ai-ledger-ui.cjs runs it through sucrase.

import {
  CALL_OUTCOMES, CLAUDE_REASONS,
  type AiCall, type AiCallWithText, type AiJobSettings, type AiSettings, type AiUsageRow, type CallOutcome, type CallSummary,
  DIAGNOSE_STEP_NAMES, type ClaudeReason, type Describe, type DiagnoseStep, type DescribeJob, type DescribeModelPrice, type DescribePrices,
} from './types'

// ── Values as they enter ─────────────────────────────────────────────────────
// PostgREST sends `numeric` and `bigint` as JSON numbers, but a driver or a proxy may hand them over as
// text ("0.012300"), and a jsonb or a function answer can hold anything: every value is read, never trusted.

/** A count or an amount: a finite number of zero or more, also from numeric text; anything else is 0. */
export function num(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*-?\d+(\.\d+)?([eE][-+]?\d+)?\s*$/.test(v) ? Number(v) : NaN
  return Number.isFinite(n) && n > 0 ? n : 0
}
const int = (v: unknown): number => Math.round(num(v))
const text = (v: unknown, max = 200): string => (typeof v === 'string' ? v.slice(0, max) : '')
const textOrNull = (v: unknown, max = 200): string | null => (typeof v === 'string' && v !== '' ? v.slice(0, max) : null)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})
const flag = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)
const DAY = /^\d{4}-\d{2}-\d{2}$/
/** Money adds up in floating point: rounded to the ledger's own six decimals. */
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6

export function readUsageRows(raw: unknown): AiUsageRow[] {
  const out: AiUsageRow[] = []
  for (const item of list(raw)) {
    const r = rec(item)
    const day = text(r.day, 10)
    if (!DAY.test(day) || typeof r.job !== 'string') continue
    out.push({
      day, job: text(r.job, 40), mode: text(r.mode, 20) || 'live', model: text(r.model, 80),
      calls: int(r.calls), failed: int(r.failed), input_tokens: int(r.input_tokens), cache_read_tokens: int(r.cache_read_tokens),
      cache_write_tokens: int(r.cache_write_tokens), output_tokens: int(r.output_tokens), thinking_tokens: int(r.thinking_tokens),
      cost_usd: num(r.cost_usd),
    })
  }
  return out
}

/** A ledger row without its text; null when it has no id or time (not a row). */
export function readCall(raw: unknown): AiCall | null {
  const r = rec(raw)
  if (typeof r.id !== 'string' || !r.id || typeof r.created_at !== 'string' || Number.isNaN(Date.parse(r.created_at))) return null
  return {
    id: r.id, created_at: r.created_at, run_id: text(r.run_id, 40), step: int(r.step) || 1,
    job: text(r.job, 40), caller: text(r.caller, 20), mode: text(r.mode, 20) || 'live', provider: text(r.provider, 30),
    model: text(r.model, 80), served_model: textOrNull(r.served_model, 80), effort: textOrNull(r.effort, 20),
    outcome: text(r.outcome, 40), stop_reason: textOrNull(r.stop_reason, 60), error: textOrNull(r.error, 500),
    request_id: textOrNull(r.request_id, 120),
    input_tokens: int(r.input_tokens), cache_read_tokens: int(r.cache_read_tokens), cache_write_5m_tokens: int(r.cache_write_5m_tokens),
    cache_write_1h_tokens: int(r.cache_write_1h_tokens), output_tokens: int(r.output_tokens), thinking_tokens: int(r.thinking_tokens),
    long_prompt: r.long_prompt === true, cost_usd: num(r.cost_usd),
    duration_ms: r.duration_ms == null ? null : int(r.duration_ms),
    instructions_version: textOrNull(r.instructions_version, 40), tools: list(r.tools),
  }
}

export function readCalls(raw: unknown): AiCall[] {
  return list(raw).map(readCall).filter((c): c is AiCall => c !== null)
}

export function readCallWithText(raw: unknown): AiCallWithText | null {
  const call = readCall(raw)
  if (!call) return null
  const r = rec(raw)
  return { ...call, request: r.request ?? null, response: r.response ?? null, thinking: typeof r.thinking === 'string' && r.thinking !== '' ? r.thinking : null }
}

/** The stored settings row, or the function's defaults when there is none (or a field isn't what it should be). */
export function readSettings(raw: unknown, defaults: Describe['defaults']): AiSettings {
  if (raw == null) return { monthly_budget_usd: defaults.monthlyBudgetUsd, log_text: defaults.logText, log_days: defaults.logDays }
  const r = rec(raw)
  return {
    monthly_budget_usd: r.monthly_budget_usd == null ? defaults.monthlyBudgetUsd : num(r.monthly_budget_usd),
    log_text: flag(r.log_text, defaults.logText),
    log_days: int(r.log_days) || defaults.logDays,
  }
}

export function readJobSettings(raw: unknown): AiJobSettings[] {
  const out: AiJobSettings[] = []
  for (const item of list(raw)) {
    const r = rec(item)
    if (typeof r.job !== 'string' || !r.job) continue
    out.push({
      job: text(r.job, 40), enabled: flag(r.enabled, true), model: textOrNull(r.model, 80), effort: textOrNull(r.effort, 20),
      max_output_tokens: r.max_output_tokens == null ? null : int(r.max_output_tokens),
      monthly_budget_usd: r.monthly_budget_usd == null ? null : num(r.monthly_budget_usd),
    })
  }
  return out
}

/** One job's stored changes, or "everything default" when the owner changed nothing. */
export function jobSettingsOf(rows: readonly AiJobSettings[], job: string): AiJobSettings {
  return rows.find(r => r.job === job) ?? { job, enabled: true, model: null, effort: null, max_output_tokens: null, monthly_budget_usd: null }
}

export function readCallSummary(raw: unknown): CallSummary | undefined {
  const r = rec(raw)
  if (typeof r.id !== 'string' || !r.id) return undefined
  return {
    id: r.id, run_id: text(r.run_id, 40), job: text(r.job, 40), model: text(r.model, 80), outcome: text(r.outcome, 40),
    input_tokens: int(r.input_tokens), cache_read_tokens: int(r.cache_read_tokens), cache_write_tokens: int(r.cache_write_tokens),
    output_tokens: int(r.output_tokens), thinking_tokens: int(r.thinking_tokens), cost_usd: num(r.cost_usd), duration_ms: int(r.duration_ms),
  }
}

export type RunAnswer =
  // `source: 'page'`: the function's code alone answered from the page (a recipe link), no model was asked, no `call`.
  | { ok: true; result: unknown; call: CallSummary | undefined; source: 'page' | undefined }
  | { ok: false; reason: ClaudeReason; message: string; call: CallSummary | undefined }

/** Said when the function gave a reason without a sentence of its own. */
export const REASON_FALLBACK: Record<ClaudeReason, string> = {
  bad_input: 'That request can\'t be sent as it is.',
  off: 'This AI job is switched off (Developer → AI → Settings).',
  budget: 'The monthly AI budget is reached (Developer → AI → Settings).',
  busy: 'Too many AI calls just now — try again in a minute.',
  not_configured: 'AI is not set up yet: ANTHROPIC_API_KEY is missing on the server.',
  refused: 'The model declined this request.',
  cut_off: 'The answer was cut off before it was finished.',
  invalid: 'The answer didn\'t pass the app\'s check, so nothing was used.',
  error: 'The AI call failed — try again in a moment.',
}

/** The function's answer to a run: a result, or a known reason with its sentence. Anything else is an error. */
export function readRunAnswer(raw: unknown): RunAnswer {
  const r = rec(raw)
  const call = readCallSummary(r.call)
  if (r.ok === true) return { ok: true, result: r.result, call, source: r.source === 'page' ? 'page' : undefined }
  const reason = (CLAUDE_REASONS as readonly string[]).includes(r.reason as string) ? r.reason as ClaudeReason : 'error'
  const said = typeof r.message === 'string' ? r.message.trim().slice(0, 300) : ''
  return { ok: false, reason, message: said || REASON_FALLBACK[reason], call }
}

/** The function's answer to Diagnose: its steps, or the sentence of why it did not run. Anything else is an error. */
export type DiagnoseAnswer = { ok: true; steps: DiagnoseStep[] } | { ok: false; reason: 'busy' | 'error'; message: string }

export function readDiagnoseAnswer(raw: unknown): DiagnoseAnswer {
  const r = rec(raw)
  if (r.ok === true) {
    const steps: DiagnoseStep[] = []
    for (const item of list(r.steps)) {
      const s = rec(item)
      const name = (DIAGNOSE_STEP_NAMES as readonly string[]).includes(s.name as string) ? s.name as DiagnoseStep['name'] : null
      if (!name || typeof s.ok !== 'boolean') continue
      steps.push({ name, title: text(s.title, 80) || name, ok: s.ok, ms: int(s.ms), detail: text(s.detail, 500) })
    }
    return steps.length > 0 ? { ok: true, steps } : { ok: false, reason: 'error', message: 'Diagnose gave no result — try again in a moment.' }
  }
  const said = typeof r.message === 'string' ? r.message.trim().slice(0, 300) : ''
  return { ok: false, reason: r.reason === 'busy' ? 'busy' : 'error', message: said || 'Diagnose could not run — try again in a moment.' }
}

/** The step's time in seconds, as the rows and the verdict say it: "1.2 s", "48 s". */
export function stepSeconds(ms: number): string {
  const s = ms / 1000
  return `${s < 10 ? s.toFixed(1) : Math.round(s)}${NBSP}s`
}

export interface DiagnoseVerdict { tone: LedgerTone; text: string }

// A fill this much slower than a tiny answer, and slower than this, points at the answer form (the schema).
const SLOW_FILL_MS = 10_000
const SLOW_FILL_FACTOR = 3
// ✨'s own limit in the function: a request that takes longer fails there.
const FILL_LIMIT_MS = 30_000

/** One plain sentence about where the trouble is, worked out from the four steps. */
export function diagnoseVerdict(steps: readonly DiagnoseStep[]): DiagnoseVerdict {
  const by = (name: DiagnoseStep['name']) => steps.find(s => s.name === name)
  const net = by('network_key'), shape = by('request_shape'), tiny = by('tiny_answer'), fill = by('fill_request')
  if (!net) return { tone: 'neutral', text: 'Diagnose gave no result for the network check.' }
  if (!net.ok && !shape) return { tone: 'danger', text: `Anthropic could not be reached from the server, or it did not accept the key: ${net.detail}` }
  const works = net.ok ? 'The network and key work' : 'The network works, but the list of models is not what ✨ needs'
  if (shape && !shape.ok) return { tone: 'danger', text: `${works}, but Anthropic did not accept ✨’s request as it is built: ${shape.detail}` }
  if (tiny && !tiny.ok) return { tone: 'danger', text: `${works}, but even a tiny answer did not come back: ${tiny.detail}` }
  const tinyIs = tiny ? `, and a tiny answer came in ${stepSeconds(tiny.ms)}` : ''
  if (!fill) return { tone: 'neutral', text: `${works}${tinyIs}; ✨’s own request was not tried.` }
  if (!fill.ok) {
    return fill.ms >= FILL_LIMIT_MS
      ? { tone: 'danger', text: `${works}${tinyIs}, but ✨’s request ran ${stepSeconds(fill.ms)} and then failed: ${fill.detail}` }
      : { tone: 'danger', text: `${works}${tinyIs}, but ✨’s request failed after ${stepSeconds(fill.ms)}: ${fill.detail}` }
  }
  const slowAgainstTiny = tiny ? fill.ms >= SLOW_FILL_FACTOR * Math.max(tiny.ms, 1) : true
  if (fill.ms >= SLOW_FILL_MS && slowAgainstTiny) {
    return {
      tone: 'warn',
      text: `${works}${tinyIs}, but ✨’s request took ${stepSeconds(fill.ms)}: the answer form is the slow part.${fill.ms > FILL_LIMIT_MS ? ' That is over ✨’s 30 s limit, which is why it times out.' : ''} Run Diagnose again: a first call with a new form is slower once.`,
    }
  }
  if (fill.ms > FILL_LIMIT_MS) return { tone: 'warn', text: `${works}${tinyIs}, and ✨’s request took ${stepSeconds(fill.ms)}, over its 30 s limit: Anthropic is slow overall right now.` }
  return { tone: 'success', text: `${works}${tinyIs}, and ✨’s request took ${stepSeconds(fill.ms)}: everything answers in time.` }
}

function readPrices(raw: unknown): DescribePrices {
  const p = rec(raw)
  return {
    checkedOn: DAY.test(text(p.checkedOn, 10)) ? text(p.checkedOn, 10) : '',
    source: text(p.source, 300),
    longPromptOverTokens: int(p.longPromptOverTokens), longPromptMultiplier: num(p.longPromptMultiplier), batchMultiplier: num(p.batchMultiplier),
    models: list(p.models).map(rec).filter(m => typeof m.model === 'string' && m.model).map(m => ({
      model: text(m.model, 80), inputPerMTok: num(m.inputPerMTok), outputPerMTok: num(m.outputPerMTok), cacheReadPerMTok: num(m.cacheReadPerMTok),
      cacheWrite5mPerMTok: num(m.cacheWrite5mPerMTok), cacheWrite1hPerMTok: num(m.cacheWrite1hPerMTok),
    })),
  }
}

function readJob(raw: unknown): DescribeJob | null {
  const j = rec(raw)
  if (typeof j.name !== 'string' || !j.name) return null
  const d = rec(j.defaults)
  return {
    name: text(j.name, 40), title: text(j.title, 80) || text(j.name, 40), what: text(j.what, 600), kind: text(j.kind, 30),
    callers: list(j.callers).map(c => text(c, 20)).filter(Boolean), version: text(j.version, 40),
    defaults: { model: text(d.model, 80), effort: text(d.effort, 20), maxOutputTokens: int(d.maxOutputTokens) },
    instructions: text(j.instructions, 60_000), answerSchema: j.answerSchema ?? null,
    tools: list(j.tools).map(rec).filter(t => typeof t.name === 'string').map(t => ({ name: text(t.name, 60), what: text(t.what, 400) })),
    features: list(j.features).map(f => text(f, 80)).filter(Boolean),
    sourceFiles: list(j.sourceFiles).map(f => text(f, 200)).filter(Boolean),
  }
}

/** What the function says about itself, field by field: a missing or odd field becomes empty, never a crash. */
export function readDescribe(raw: unknown): Describe {
  const a = rec(raw)
  const provider = rec(a.provider), limits = rec(a.limits), defaults = rec(a.defaults)
  const range = (v: unknown) => { const r = rec(v); return { min: int(r.min), max: int(r.max) } }
  return {
    configured: a.configured === true,
    provider: { name: text(provider.name, 40), sdk: text(provider.sdk, 80), apiVersion: text(provider.apiVersion, 40), endpoint: text(provider.endpoint, 200) },
    models: list(a.models).map(rec).filter(m => typeof m.id === 'string' && m.id).map(m => ({ id: text(m.id, 80), name: text(m.name, 80) || text(m.id, 80), note: text(m.note, 300) })),
    efforts: list(a.efforts).map(e => text(e, 20)).filter(Boolean),
    limits: {
      monthlyBudgetMaxUsd: num(limits.monthlyBudgetMaxUsd), callsPerMinute: int(limits.callsPerMinute), callsPerDay: int(limits.callsPerDay),
      maxOutputTokens: range(limits.maxOutputTokens), logDays: range(limits.logDays), requestMaxBytes: int(limits.requestMaxBytes),
    },
    defaults: { monthlyBudgetUsd: num(defaults.monthlyBudgetUsd), logText: flag(defaults.logText, true), logDays: int(defaults.logDays) },
    prices: readPrices(a.prices),
    jobs: list(a.jobs).map(readJob).filter((j): j is DescribeJob => j !== null),
    steps: list(a.steps).map(rec).map(s => ({ title: text(s.title, 120), text: text(s.text, 800), part: text(s.part, 60) })).filter(s => s.title || s.text),
    parts: list(a.parts).map(rec).filter(p => typeof p.name === 'string').map(p => ({ name: text(p.name, 60), file: text(p.file, 200), what: text(p.what, 600) })),
    safetyRules: list(a.safetyRules).map(r => text(r, 600)).filter(Boolean),
  }
}

/** A job's title from the function's own list; one it no longer lists shows its name. */
export function jobTitleOf(jobs: readonly Pick<DescribeJob, 'name' | 'title'>[] | undefined, name: string): string {
  return jobs?.find(j => j.name === name)?.title || name
}

/** What a ledger row names as its model: a row for work code did alone (provider `page`) says so; any other shows the model id. */
export function callModelLabel(call: { provider: string; model: string }): string {
  return call.provider === 'page' ? 'Read by code, no AI' : call.model
}

/** A model's name from the function's own list; one it no longer lists shows its id. */
export function modelNameOf(models: Describe['models'] | undefined, id: string): string {
  return models?.find(m => m.id === id)?.name || id
}

// ── Outcomes: a plain word and a tone each ───────────────────────────────────

export type LedgerTone = 'success' | 'warn' | 'danger' | 'info' | 'neutral'

export interface OutcomeMeta { label: string; tone: LedgerTone; what: string }

export const OUTCOME_META: Record<CallOutcome, OutcomeMeta> = {
  ok: { label: 'Answered', tone: 'success', what: 'The model answered and the answer passed the app\'s check.' },
  refused: { label: 'Refused', tone: 'warn', what: 'The model declined the request.' },
  cut_off: { label: 'Cut off', tone: 'warn', what: 'The answer reached the longest-answer limit before it was finished.' },
  invalid: { label: 'Invalid answer', tone: 'danger', what: 'The answer failed the app\'s own check, so nothing was used.' },
  error: { label: 'Failed', tone: 'danger', what: 'The request failed: the network, Anthropic or the function.' },
  budget: { label: 'Budget reached', tone: 'warn', what: 'A monthly budget was reached, so nothing was sent.' },
  off: { label: 'Switched off', tone: 'neutral', what: 'The job is switched off, so nothing was sent.' },
  not_configured: { label: 'No key', tone: 'neutral', what: 'ANTHROPIC_API_KEY is not set on the server, so nothing was sent.' },
  bad_input: { label: 'Bad input', tone: 'neutral', what: 'The request was refused before anything was sent.' },
}

/** An outcome's word and tone; one this version doesn't know shows its own word, grey. */
export function outcomeMeta(outcome: unknown): OutcomeMeta & { known: boolean } {
  if (typeof outcome === 'string' && (CALL_OUTCOMES as readonly string[]).includes(outcome)) return { ...OUTCOME_META[outcome as CallOutcome], known: true }
  const word = typeof outcome === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(outcome) ? outcome.replace(/_/g, ' ') : ''
  return { label: word ? word[0].toUpperCase() + word.slice(1) : 'Unknown', tone: 'neutral', what: 'This version of the app doesn\'t know this outcome.', known: false }
}

// ── Money and counts ─────────────────────────────────────────────────────────

/**
 * "$0.0123", "$0.50", "$5.00": USD, two decimals for whole cents and from a dollar up, four below a dollar
 * (a call costs a fraction of a cent), "< $0.0001" for less than that. `fine` shows a small amount to the
 * ledger's own six decimals ("$0.000270").
 */
export function formatUsd(amount: unknown, opts: { fine?: boolean } = {}): string {
  const a = num(amount)
  if (a === 0) return '$0.00'
  if (a >= 0.99995) return `$${a.toFixed(2)}`
  const micro = Math.round(a * 1e6)
  if (micro === 0) return opts.fine ? '< $0.000001' : '< $0.0001'
  if (micro % 10_000 === 0) return `$${(micro / 1e6).toFixed(2)}`
  if (opts.fine) return `$${(micro / 1e6).toFixed(6)}`
  return micro < 50 ? '< $0.0001' : `$${a.toFixed(4)}`
}

/** A price per million tokens: "$0.10", "$0.125", "$2.00" (two decimals, more only when the price has them). */
export function formatPrice(perMTok: unknown): string {
  const [whole, decimals] = num(perMTok).toFixed(4).split('.')
  return `$${whole}.${decimals.replace(/0{1,2}$/, '')}`
}

/** A space a line never breaks at. */
const NBSP = ' '

/** "1 234" — a whole number with its thousands apart. */
export function formatCount(n: unknown): string {
  return String(int(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
}

/** Tokens in a tight place: "850", "12.3k", "1.25M". */
export function formatTokens(n: unknown): string {
  const v = int(n)
  if (v < 10_000) return formatCount(v)
  if (v < 1_000_000) return `${(v / 1000).toFixed(v < 100_000 ? 1 : 0)}k`
  return `${(v / 1_000_000).toFixed(2)}M`
}

/** "850 ms", "1.2 s", "14 s"; '' when the row has none. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.round(ms)}${NBSP}ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}${NBSP}s`
}

// ── The month, on Oslo's clock ───────────────────────────────────────────────
// The budget counts a calendar month in Europe/Oslo (the function's own rule), whatever zone the device is in.

const OSLO = 'Europe/Oslo'
const pad = (n: number) => String(n).padStart(2, '0')

let osloFormat: Intl.DateTimeFormat | null = null

function osloParts(ms: number): { y: number; m: number; d: number; h: number; min: number } {
  osloFormat ??= new Intl.DateTimeFormat('en-US', { timeZone: OSLO, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
  const p: Record<string, number> = {}
  for (const part of osloFormat.formatToParts(new Date(ms))) if (part.type !== 'literal') p[part.type] = Number(part.value)
  return { y: p.year, m: p.month, d: p.day, h: p.hour, min: p.minute }
}

/** The instant an Oslo calendar day starts, in ms. */
function osloMidnight(y: number, m: number, d: number): number {
  const wall = Date.UTC(y, m - 1, d)
  let at = wall
  // Twice: the offset at the guess is the offset at the answer except around a clock change.
  for (let i = 0; i < 2; i++) {
    const p = osloParts(at)
    at -= Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - wall
  }
  return at
}

/** The Oslo calendar day of an instant: 'YYYY-MM-DD'. */
export function osloDay(at: Date): string {
  const p = osloParts(at.getTime())
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`
}

export interface MonthRange {
  /** The month's first instant and the next month's first instant (ISO, UTC): `ai_usage`'s p_from and p_to. */
  from: string
  to: string
  firstDay: string
  lastDay: string
  today: string
}

/** The Oslo calendar month `now` is in. */
export function osloMonthRange(now: Date): MonthRange {
  const p = osloParts(now.getTime())
  const next = p.m === 12 ? { y: p.y + 1, m: 1 } : { y: p.y, m: p.m + 1 }
  const lastDay = new Date(Date.UTC(next.y, next.m - 1, 0)).getUTCDate()
  return {
    from: new Date(osloMidnight(p.y, p.m, 1)).toISOString(),
    to: new Date(osloMidnight(next.y, next.m, 1)).toISOString(),
    firstDay: `${p.y}-${pad(p.m)}-01`,
    lastDay: `${p.y}-${pad(p.m)}-${pad(lastDay)}`,
    today: `${p.y}-${pad(p.m)}-${pad(p.d)}`,
  }
}

/** Every calendar day from `first` to `last` ('YYYY-MM-DD'), both included. */
export function daysBetween(first: string, last: string): string[] {
  if (!DAY.test(first) || !DAY.test(last)) return []
  const out: string[] = []
  const end = Date.parse(`${last}T00:00:00Z`)
  for (let t = Date.parse(`${first}T00:00:00Z`); t <= end && out.length < 400; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}

// ── Totals ───────────────────────────────────────────────────────────────────

export interface UsageTotals {
  calls: number
  failed: number
  input_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  output_tokens: number
  thinking_tokens: number
  cost_usd: number
}

const NO_USAGE: UsageTotals = { calls: 0, failed: 0, input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, thinking_tokens: 0, cost_usd: 0 }

function add(a: UsageTotals, r: UsageTotals): UsageTotals {
  return {
    calls: a.calls + r.calls, failed: a.failed + r.failed, input_tokens: a.input_tokens + r.input_tokens,
    cache_read_tokens: a.cache_read_tokens + r.cache_read_tokens, cache_write_tokens: a.cache_write_tokens + r.cache_write_tokens,
    output_tokens: a.output_tokens + r.output_tokens, thinking_tokens: a.thinking_tokens + r.thinking_tokens,
    cost_usd: round6(a.cost_usd + r.cost_usd),
  }
}

export function usageTotals(rows: readonly AiUsageRow[]): UsageTotals {
  return rows.reduce<UsageTotals>(add, NO_USAGE)
}

/** One total per job, the most expensive first (then the most used, then by name). */
export function totalsByJob(rows: readonly AiUsageRow[]): Array<UsageTotals & { job: string }> {
  const by = new Map<string, UsageTotals>()
  for (const r of rows) by.set(r.job, add(by.get(r.job) ?? NO_USAGE, r))
  return [...by].map(([job, t]) => ({ job, ...t })).sort((a, b) => b.cost_usd - a.cost_usd || b.calls - a.calls || a.job.localeCompare(b.job))
}

/** One total per day of `days`, in their order: a day without calls is a zero, so the chart has no holes. */
export function totalsByDay(rows: readonly AiUsageRow[], days: readonly string[]): Array<UsageTotals & { day: string }> {
  const by = new Map<string, UsageTotals>()
  for (const r of rows) by.set(r.day, add(by.get(r.day) ?? NO_USAGE, r))
  return days.map(day => ({ day, ...(by.get(day) ?? NO_USAGE) }))
}

// ── Prices ───────────────────────────────────────────────────────────────────

export interface CallTokens { input?: number; cacheRead?: number; cacheWrite5m?: number; cacheWrite1h?: number; output?: number }

/** What a call costs at one model's prices (per million tokens); `multiplier` for a batch or a long prompt. */
export function callCost(price: DescribeModelPrice, t: CallTokens, multiplier = 1): number {
  const usd = (t.input ?? 0) * price.inputPerMTok + (t.cacheRead ?? 0) * price.cacheReadPerMTok + (t.cacheWrite5m ?? 0) * price.cacheWrite5mPerMTok
    + (t.cacheWrite1h ?? 0) * price.cacheWrite1hPerMTok + (t.output ?? 0) * price.outputPerMTok
  return round6((usd / 1_000_000) * multiplier)
}

export interface CacheEffect {
  /** What reading from the cache saved against the full input price. */
  saved: number
  /** What writing to the cache cost over the full input price. */
  extra: number
  /** saved − extra: below zero while what was written hasn't been read back often enough. */
  net: number
  readTokens: number
}

/**
 * What the cache did to the bill: a cached read costs a fraction of the input price, a write a little more
 * than it. Worked out from the function's own price table; `ai_usage` adds the two kinds of write together, so
 * a write counts at the 5-minute price (the only one phase 1 uses). A model without a price counts nothing.
 */
export function cacheEffect(rows: readonly AiUsageRow[], prices: DescribePrices): CacheEffect {
  let saved = 0, extra = 0, readTokens = 0
  for (const r of rows) {
    readTokens += r.cache_read_tokens
    const p = prices.models.find(m => m.model === r.model)
    if (!p) continue
    const k = (r.mode === 'batch' && prices.batchMultiplier > 0 ? prices.batchMultiplier : 1) / 1_000_000
    saved += r.cache_read_tokens * Math.max(0, p.inputPerMTok - p.cacheReadPerMTok) * k
    extra += r.cache_write_tokens * Math.max(0, p.cacheWrite5mPerMTok - p.inputPerMTok) * k
  }
  return { saved: round6(saved), extra: round6(extra), net: round6(saved - extra), readTokens }
}

// ── Budget ───────────────────────────────────────────────────────────────────

/** From this share of a budget the bar warns. */
export const BUDGET_NEAR = 0.8

export interface BudgetProgress {
  /** 0–1, for the bar. */
  share: number
  percent: number
  state: 'ok' | 'near' | 'over'
  tone: LedgerTone
  left: number
}

/**
 * Where a month's cost stands against its budget. "Over" is the function's own wall: cost at or past the
 * budget stops the next call — so a budget of 0 is reached before the first one.
 */
export function budgetProgress(spent: unknown, budget: unknown): BudgetProgress {
  const s = num(spent), b = num(budget)
  const share = b > 0 ? Math.min(1, s / b) : 1
  const state = s >= b ? 'over' : s >= b * BUDGET_NEAR ? 'near' : 'ok'
  return { share, percent: b > 0 ? Math.round((s / b) * 100) : 100, state, tone: state === 'over' ? 'danger' : state === 'near' ? 'warn' : 'success', left: round6(Math.max(0, b - s)) }
}

// ── What the owner types on Settings ─────────────────────────────────────────

/** A typed dollar amount: '' → null (the default); 0–max with at most two decimals → the number; else undefined. */
export function readUsdInput(typed: string, max: number): number | null | undefined {
  const t = typed.trim().replace(/^\$/, '').replace(',', '.')
  if (t === '') return null
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(t)) return undefined
  const n = Number(t)
  return n >= 0 && n <= max ? n : undefined
}

/** A typed whole number: '' → null (the default); min–max → the number; else undefined. */
export function readIntInput(typed: string, min: number, max: number): number | null | undefined {
  const t = typed.trim().replace(/[\s\u00a0]/g, '')
  if (t === '') return null
  if (!/^\d{1,7}$/.test(t)) return undefined
  const n = Number(t)
  return n >= min && n <= max ? n : undefined
}

// ── The text log, as plain text ──────────────────────────────────────────────

const json = (v: unknown): string => { try { return JSON.stringify(v, null, 2) ?? '' } catch { return String(v) } }

/** The words in a logged value: text as it is, a list of text blocks joined, anything else as indented JSON. */
function wordsOf(v: unknown, depth = 0): string {
  if (typeof v === 'string') return v
  if (v == null) return ''
  if (depth < 4 && Array.isArray(v)) {
    return v.map(item => {
      const o = rec(item)
      if (typeof item === 'string') return item
      if (typeof o.text === 'string' && (o.type === undefined || o.type === 'text')) return o.text
      if (typeof o.role === 'string' && 'content' in o) return `${o.role}:\n${wordsOf(o.content, depth + 1)}`
      return json(item)
    }).join('\n\n')
  }
  return json(v)
}

export interface LogPart {
  label: string
  text: string
  /** A text of its own (instructions, the sentence, a schema) — false for a short value that fits beside its label. */
  block: boolean
}

function logPart(label: string, v: unknown): LogPart {
  const text = wordsOf(v)
  return { label: label.replace(/_/g, ' ').slice(0, 60), text, block: (typeof v === 'object' && v !== null) || text.length > 60 || text.includes('\n') }
}

/**
 * A logged request or answer as labelled plain text: an object's own fields one by one, so long instructions
 * read as text and not as one escaped JSON line. Shown as text only — never as HTML or links.
 */
export function logParts(v: unknown): LogPart[] {
  if (v == null || v === '') return []
  if (typeof v !== 'object' || Array.isArray(v)) return [{ ...logPart('', v), block: true }]
  return Object.entries(v as Record<string, unknown>).filter(([, x]) => x != null && x !== '').map(([label, x]) => logPart(label, x))
}

// ── Links the page builds ────────────────────────────────────────────────────

const REPO_BLOB = 'https://github.com/Lasciviens/Project_Daily/blob/main/'

/** A source file's page on GitHub — only for a plain repo path (letters, digits, `._-/`, no `..`). */
export function sourceUrl(file: string): string | null {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_./-]{0,198}$/.test(file) || file.includes('..') || file.includes('//')) return null
  return REPO_BLOB + file
}

const PRICE_HOSTS = new Set(['platform.claude.com', 'docs.claude.com', 'claude.com', 'www.claude.com', 'www.anthropic.com', 'anthropic.com', 'docs.anthropic.com'])

/** The price table's source as a link — only an https address on one of Anthropic's own hosts. */
export function priceSourceUrl(source: string): string | null {
  try {
    const u = new URL(source)
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && PRICE_HOSTS.has(u.hostname) ? u.href : null
  } catch {
    return null
  }
}
