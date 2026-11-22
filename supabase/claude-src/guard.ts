// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · the guard
//
//  The fixed rules: which models and efforts exist, the hard limits, and how
//  everything that comes from outside is read. "Outside" includes the owner's
//  own settings rows: the browser can write them, so a stolen session could
//  too. A stored model must be on the list here, a stored number is clamped
//  to the limits here, and a database CHECK is only the first of two walls.
//
//  No part of this file talks to the network or the database: it decides.
// ─────────────────────────────────────────────────────────────────────────────

import type { Caller, Effort, JobDefinition, RunChoice } from './types.ts'

/** The models a job may run on, the default first. A stored model that is not here is ignored. */
export const MODELS: readonly { id: string; name: string; note: string }[] = [
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', note: 'The default: the fastest and cheapest. A prompt over 100,000 tokens costs five times as much.' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', note: 'Stronger, at 20 times the price of Haiku.' },
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', note: 'The strongest here, at 40 times the price of Haiku.' },
]

export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high']

/** The hard limits. The owner's settings move inside them; nothing moves them but a code change. */
export const LIMITS = {
  monthlyBudgetMaxUsd: 50,
  callsPerMinute: 20,
  callsPerDay: 600,
  maxOutputTokens: { min: 256, max: 16_000 },
  logDays: { min: 1, max: 90 },
  requestMaxBytes: 16 * 1024,
  /** The longest question the Test bench takes, in characters. */
  benchTextMax: 2000,
  /**
   * What one device may ask in a rolling 24 hours, counted from the ledger's own rows by `caller`. A leaked device
   * secret can cost at most this many answers a day (the Kobo's own 100 a day is kept, kobo-sync counts it too).
   */
  deviceCallsPerDay: { kobo: 100, phone: 100 },
  /** The Test bench's free token count: at most this many a minute for the account (counted from the ledger). */
  countsPerMinute: 10,
} as const

/** The callers that are server-side device functions: they act as the owner with the server key, never with a token. */
export const DEVICE_CALLERS: readonly Caller[] = ['kobo', 'phone']

/** The most calls one caller may have in a rolling 24 hours: a device's own cap, else the account's daily cap. */
export function callerDailyCap(caller: Caller): number {
  return caller === 'kobo' || caller === 'phone' ? LIMITS.deviceCallsPerDay[caller] : LIMITS.callsPerDay
}

/** `caller` as a device caller, or null: only the two names above ever pass, whatever a request says. */
export function deviceCaller(value: unknown): Caller | null {
  return DEVICE_CALLERS.find(c => c === value) ?? null
}

/**
 * Constant-time secret check (security review 26.10.2026): both sides are
 * hashed to the same length first, so the answer time shows neither the
 * secret's length nor how much of it matched. Never log either value.
 */
export async function sameSecret(given: string, expected: string): Promise<boolean> {
  const hash = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  const [a, b] = await Promise.all([hash(given), hash(expected)])
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

// What a device function sends to `claude` instead of the service key itself: HMAC-SHA256 of a fixed label, keyed with
// the service key, as hex. The raw service key would give whoever reads a header (a gateway, a log) the whole database;
// this value proves the sender holds the key and opens nothing else. The same few lines are in kobo-sync, phone-gateway
// and this file (`verify-claude-function` compares them).
export async function claudeDeviceCredential(serviceKey: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(serviceKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('claude-device-v1')))
  return [...mac].map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * A request's time limit, worked out from the longest answer its job may write: 30 s up to 2000 tokens (a ✨ fill),
 * then 10 s more for every further 1000, at most 100 s: a 4000-token recipe is not cut at 30 s, and the whole run
 * (a page read first, the ledger) still ends inside the edge function's 150 s.
 */
export function requestTimeoutMs(maxOutputTokens: number): number {
  const extra = Math.max(0, maxOutputTokens - 2000)
  return Math.min(30_000 + Math.ceil(extra / 1000) * 10_000, 100_000)
}

/** What applies while the owner has saved no settings. */
export const DEFAULTS = { monthlyBudgetUsd: 5, logText: true, logDays: 30 } as const

/** The text log keeps at most this much of a request, an answer or a thinking summary. */
export const TEXT_LOG_MAX_BYTES = 200 * 1024

/** An object's own value only: a key like "constructor" or "__proto__" never reads Object's. */
export function ownValue(from: unknown, key: string): unknown {
  if (from === null || typeof from !== 'object') return undefined
  return Object.prototype.hasOwnProperty.call(from, key) ? (from as Record<string, unknown>)[key] : undefined
}

/** A finite number, also when the database sends it as text ("5.00"); anything else is null. */
function numberFrom(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max)
}

/** The settings one run uses, after every stored value has been through its list or its limits. */
export interface RunSettings {
  /** The master switch (ai_settings.ai_enabled): false stops every job, the devices' too. */
  aiEnabled: boolean
  /** This job's own switch. */
  enabled: boolean
  model: string
  effort: Effort
  maxOutputTokens: number
  /** Whether the model reasons (`adaptive`, the default) or not (`off`), as the owner set it for this job. */
  thinking: 'adaptive' | 'off'
  /** The total monthly budget, in USD. */
  monthlyBudgetUsd: number
  /** This job's own monthly budget in USD, or null when it has none. */
  jobBudgetUsd: number | null
  /** Whether the request and answer text is kept in the ledger. */
  logText: boolean
}

/**
 * The owner's stored settings as this run's settings. `accountRow` is the account's ai_settings row and `jobRow`
 * its ai_job_settings row for this job; either may be missing, which means the defaults.
 */
export function settingsFor(job: JobDefinition, accountRow: unknown, jobRow: unknown): RunSettings {
  const enabled = ownValue(jobRow, 'enabled')
  const model = ownValue(jobRow, 'model')
  const effort = ownValue(jobRow, 'effort')
  const maxTokens = numberFrom(ownValue(jobRow, 'max_output_tokens'))
  const jobBudget = numberFrom(ownValue(jobRow, 'monthly_budget_usd'))
  const budget = numberFrom(ownValue(accountRow, 'monthly_budget_usd'))
  const logText = ownValue(accountRow, 'log_text')
  const aiEnabled = ownValue(accountRow, 'ai_enabled')
  const thinking = ownValue(jobRow, 'thinking')
  return {
    // A stored value that is neither true nor false switches the job off and the text log off: the careful side.
    // A value that is missing altogether (no row yet, or a schema from before migration 195) is the default: on.
    aiEnabled: aiEnabled === undefined ? true : aiEnabled === true,
    enabled: enabled === undefined ? true : enabled === true,
    model: MODELS.some(m => m.id === model) ? (model as string) : job.defaults.model,
    effort: EFFORTS.includes(effort as Effort) ? (effort as Effort) : job.defaults.effort,
    maxOutputTokens: maxTokens === null
      ? job.defaults.maxOutputTokens
      : clamp(Math.round(maxTokens), LIMITS.maxOutputTokens.min, LIMITS.maxOutputTokens.max),
    // Only the word "off" turns reasoning off; anything else (null, an unknown word) is the default.
    thinking: thinking === 'off' ? 'off' : 'adaptive',
    monthlyBudgetUsd: budget === null ? DEFAULTS.monthlyBudgetUsd : clamp(budget, 0, LIMITS.monthlyBudgetMaxUsd),
    jobBudgetUsd: jobBudget === null ? null : clamp(jobBudget, 0, LIMITS.monthlyBudgetMaxUsd),
    logText: logText === undefined ? DEFAULTS.logText : logText === true,
  }
}

/**
 * What a request may pick for one run, after the code's lists have had their say: a model that is not on the list
 * or an effort that is not on it is refused (null), and `thinking` is either of its two words. Left out stays the
 * owner's setting (or, for thinking, the default).
 */
export function checkedChoice(choice: RunChoice): RunChoice | null {
  if (choice.model !== undefined && !MODELS.some(m => m.id === choice.model)) return null
  if (choice.effort !== undefined && !EFFORTS.includes(choice.effort)) return null
  if (choice.thinking !== undefined && choice.thinking !== 'adaptive' && choice.thinking !== 'off') return null
  return choice
}

/** What the ledger says about the account right now (the database's `ai_gate`). */
export interface Gate {
  /** This month's cost so far, in USD, over every job. */
  monthCost: number
  /** This month's cost of the job that is asked for. */
  jobMonthCost: number
  callsLastMinute: number
  callsToday: number
  /** A device run only: this device's own calls in the last 24 hours. Null for the app. */
  callsTodayByCaller: number | null
}

/** The database's answer as a Gate, or null when it can't be read: the caller then sends nothing. */
export function gateOf(data: unknown): Gate | null {
  const row = Array.isArray(data) ? data[0] : data
  const monthCost = numberFrom(ownValue(row, 'month_cost'))
  const jobMonthCost = numberFrom(ownValue(row, 'job_month_cost'))
  const callsLastMinute = numberFrom(ownValue(row, 'calls_last_minute'))
  const callsToday = numberFrom(ownValue(row, 'calls_today'))
  if (monthCost === null || jobMonthCost === null || callsLastMinute === null || callsToday === null) return null
  if (monthCost < 0 || jobMonthCost < 0 || callsLastMinute < 0 || callsToday < 0) return null
  return { monthCost, jobMonthCost, callsLastMinute, callsToday, callsTodayByCaller: null }
}

/** Why this call is one too many right now, or null. */
export function rateCapProblem(gate: Gate, caller: Caller): string | null {
  const deviceCap = caller === 'kobo' || caller === 'phone' ? LIMITS.deviceCallsPerDay[caller] : null
  if (deviceCap !== null && (gate.callsTodayByCaller ?? 0) >= deviceCap) {
    return `That is ${deviceCap} AI calls from this device in 24 hours. Try again tomorrow.`
  }
  if (gate.callsLastMinute >= LIMITS.callsPerMinute) {
    return `That is more than ${LIMITS.callsPerMinute} AI calls in a minute. Wait a moment and try again.`
  }
  if (gate.callsToday >= LIMITS.callsPerDay) {
    return `Today's limit of ${LIMITS.callsPerDay} AI calls is reached. It starts again at midnight.`
  }
  return null
}

/** `text`, or its first `max` characters. Whole characters (code points): a cut never splits a pair in two. */
export function cutChars(text: string, max: number): string {
  return text.length <= max ? text : [...text].slice(0, max).join('')
}

const dollars = (usd: number) => `$${usd.toFixed(2)}`

/** Why the reservation was refused for the budget: this call's worst case does not fit in what is left of the month. */
export function reservationBudgetProblem(settings: RunSettings, jobTitle: string): string {
  const which = settings.jobBudgetUsd !== null && settings.jobBudgetUsd < settings.monthlyBudgetUsd
    ? `the budget of ${dollars(settings.jobBudgetUsd)} for "${jobTitle}"`
    : `the AI budget of ${dollars(settings.monthlyBudgetUsd)}`
  return `This month's ${which} cannot cover another call: what is left is less than the most this call could cost. Nothing is sent until next month, or until you raise it in Developer → AI → Settings.`
}

/**
 * A message with every secret taken out: the values this function holds (`secrets`), and anything shaped like an
 * Anthropic key, a Supabase secret key or a sign-in token, whoever's it is. Every error goes through here before
 * it is sent back or written down.
 */
export function hideSecrets(text: string, secrets: readonly (string | null | undefined)[]): string {
  let out = String(text ?? '')
  for (const secret of secrets) {
    if (secret && secret.length >= 8) out = out.split(secret).join('[hidden]')
  }
  return out
    .replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, '[hidden]')
    .replace(/sb_secret_[A-Za-z0-9_-]{8,}/g, '[hidden]')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[hidden]')
}

const byteLength = (text: string) => new TextEncoder().encode(text).length

/** `text`, or its first `maxBytes` bytes (cut on a whole character) with a note of its full size. */
export function trimText(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text)
  if (bytes.length <= maxBytes) return text
  // A character cut in half decodes to U+FFFD, which is dropped.
  const start = new TextDecoder().decode(bytes.slice(0, maxBytes)).replace(/�+$/, '')
  return `${start}… [cut: ${bytes.length} bytes in all]`
}

/** A value for the text log: as it is while its JSON fits in `maxBytes`, else the start of that JSON. */
export function trimForLog(value: Record<string, unknown>, maxBytes: number): Record<string, unknown> {
  const json = JSON.stringify(value)
  const bytes = byteLength(json)
  return bytes <= maxBytes ? value : { trimmed: true, bytes, start: trimText(json, maxBytes) }
}

/** A request body as text, or null when it is larger than `maxBytes` (reading stops there). */
export async function readCapped(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<string | null> {
  if (!body) return ''
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const whole = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    whole.set(chunk, at)
    at += chunk.byteLength
  }
  return new TextDecoder().decode(whole)
}

/** JSON text as an object, or null when it isn't JSON or isn't an object. */
export function parseObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text)
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Where an unexpected error happened, for the server log: its kind and the first line of code in its stack.
 * Never its message: a message can quote the text that was being read (a JSON error quotes its input).
 */
export function errorPlace(error: unknown): string {
  if (!(error instanceof Error)) return 'a thrown value that is not an Error'
  const frame = (error.stack ?? '').split('\n').find(line => /^\s+at /.test(line))
  return `${error.name}${frame ? ` ${frame.trim()}` : ''}`
}
