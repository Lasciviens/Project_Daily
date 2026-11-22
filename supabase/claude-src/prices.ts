// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · prices and cost
//
//  What a call costs, worked out here from the token counts the provider
//  reports. The prices are code on purpose (decided 20.11.2026): the monthly
//  budget wall is worked out from them, so a price the browser could edit
//  would be a way to switch the wall off. A price change is a pull request
//  that re-reads Anthropic's pricing page and moves PRICES_CHECKED_ON.
//
//  Money is USD (Anthropic bills in USD). MTok = a million tokens.
// ─────────────────────────────────────────────────────────────────────────────

import type { CallMode, TokenUsage } from './types.ts'

export interface ModelPrice {
  model: string
  inputPerMTok: number
  outputPerMTok: number
  cacheReadPerMTok: number
  cacheWrite5mPerMTok: number
  cacheWrite1hPerMTok: number
  /** Whether a prompt over the long-prompt line costs more on this model. */
  longPromptPricing: boolean
}

/** The day these numbers were read from Anthropic's pricing page. */
export const PRICES_CHECKED_ON = '2026-11-20'
export const PRICES_SOURCE = 'https://platform.claude.com/docs/en/about-claude/pricing'

/**
 * Haiku 5.5 has two price lists: a request whose prompt is over this many tokens pays five times as much for
 * every token of it. The prompt is every input token: the ones read from and written to the cache included.
 */
export const LONG_PROMPT_OVER_TOKENS = 100_000
export const LONG_PROMPT_MULTIPLIER = 5
/**
 * Anthropic's web search tool: $10 per 1,000 searches, on top of the tokens (the results it reads are input tokens,
 * billed as usual). Read from the pricing page 22.11.2026 (docs/integrations/anthropic.md).
 */
export const WEB_SEARCH_USD_EACH = 0.01
/**
 * What one search's results may add to the prompt, for the reservation: 25,000 tokens (the results of a search are
 * several pages of text). Every later round of the server's search loop reads the whole prompt again, results included.
 */
export const WEB_SEARCH_RESULT_TOKENS = 25_000
/** The most searches any single call may run, whatever a job asks for. */
export const WEB_SEARCH_MAX_USES = 3
/** A batch call (phase 3) costs half. */
export const BATCH_MULTIPLIER = 0.5

export const MODEL_PRICES: readonly ModelPrice[] = [
  { model: 'claude-haiku-5-5', inputPerMTok: 0.10, outputPerMTok: 0.50, cacheReadPerMTok: 0.01, cacheWrite5mPerMTok: 0.125, cacheWrite1hPerMTok: 0.20, longPromptPricing: true },
  { model: 'claude-sonnet-5-5', inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.10, cacheWrite5mPerMTok: 2.50, cacheWrite1hPerMTok: 4, longPromptPricing: false },
  { model: 'claude-opus-5-5', inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.20, cacheWrite5mPerMTok: 5, cacheWrite1hPerMTok: 8, longPromptPricing: false },
]

/** A model with no price here is charged as the dearest one, so the budget wall never counts too little. */
function priceOf(model: string): ModelPrice {
  const dearest = MODEL_PRICES.reduce((a, b) => (b.outputPerMTok > a.outputPerMTok ? b : a))
  return MODEL_PRICES.find(p => p.model === model) ?? dearest
}

/** Tokens the provider adds that we do not send: the hidden system prompt of thinking, and the message framing. */
export const PROMPT_OVERHEAD_TOKENS = 1000

/**
 * The most one call could cost, worked out BEFORE it is sent and held against the budget (the reservation). The
 * prompt is estimated at one token per character (real text is nearer one per three or four, and one per character
 * covers dense text such as digits, code and JSON) plus 1000 for what the provider adds (thinking's hidden system
 * prompt), every token at the dearest prompt price (a one-hour cache write), and the answer is taken to use the
 * whole limit, its thinking included. A prompt over the long-prompt line is priced as one. Only rare symbols that
 * cost several tokens each could push a real call over it; the ledger then records the real, higher cost.
 */
export function worstCostOf(model: string, promptChars: number, maxOutputTokens: number, mode: CallMode = 'live', extra: { imageTokens?: number; webSearches?: number } = {}): number {
  const searches = extra.webSearches ?? 0
  // A photo costs its own tokens (image-rules.ts). A search call is a loop on Anthropic's side: n searches are n + 1 rounds,
  // each reading the prompt again with the results gathered so far, so the input is (n + 1) × the prompt plus
  // n(n + 1) / 2 × the results of one search. All of it is counted at the dearest prompt price, and as one prompt for the
  // long-prompt line (`costOf` multiplies when the sum passes it).
  const promptTokens = Math.ceil(promptChars) + PROMPT_OVERHEAD_TOKENS + (extra.imageTokens ?? 0)
  const readTokens = (searches + 1) * promptTokens + (searches * (searches + 1) / 2) * WEB_SEARCH_RESULT_TOKENS
  return costOf(
    { inputTokens: 0, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: readTokens, outputTokens: maxOutputTokens, thinkingTokens: 0 },
    model, mode, searches,
  ).costUsd
}

/** The cost of one call in USD (to a millionth of a dollar), and whether the long-prompt prices applied. */
export function costOf(usage: TokenUsage, model: string, mode: CallMode, webSearches = 0): { costUsd: number; longPrompt: boolean } {
  const price = priceOf(model)
  const promptTokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheWrite5mTokens + usage.cacheWrite1hTokens
  const longPrompt = price.longPromptPricing && promptTokens > LONG_PROMPT_OVER_TOKENS
  const dollarsAtListPrice = (
    usage.inputTokens * price.inputPerMTok
    + usage.cacheReadTokens * price.cacheReadPerMTok
    + usage.cacheWrite5mTokens * price.cacheWrite5mPerMTok
    + usage.cacheWrite1hTokens * price.cacheWrite1hPerMTok
    // Thinking is part of outputTokens: it is billed as output.
    + usage.outputTokens * price.outputPerMTok
  ) / 1_000_000
  const multiplier = (longPrompt ? LONG_PROMPT_MULTIPLIER : 1) * (mode === 'batch' ? BATCH_MULTIPLIER : 1)
  // A search is billed per search, whatever the model, and the long-prompt price does not apply to it.
  const searchDollars = Math.max(0, Math.floor(webSearches)) * WEB_SEARCH_USD_EACH
  return { costUsd: Math.round((dollarsAtListPrice * multiplier + searchDollars) * 1_000_000) / 1_000_000, longPrompt }
}
