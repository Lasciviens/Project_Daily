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

/**
 * The most one call could cost, worked out BEFORE it is sent and held against the budget (the reservation). The
 * prompt is estimated generously at one token per two characters (real text is nearer one per four), every one of
 * them at the dearest prompt price (a one-hour cache write), and the answer is taken to use the whole limit, its
 * thinking included. A prompt over the long-prompt line is priced as one. The real cost is never above this.
 */
export function worstCostOf(model: string, promptChars: number, maxOutputTokens: number): number {
  const promptTokens = Math.ceil(promptChars / 2)
  return costOf(
    { inputTokens: 0, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: promptTokens, outputTokens: maxOutputTokens, thinkingTokens: 0 },
    model, 'live',
  ).costUsd
}

/** The cost of one call in USD (to a millionth of a dollar), and whether the long-prompt prices applied. */
export function costOf(usage: TokenUsage, model: string, mode: CallMode): { costUsd: number; longPrompt: boolean } {
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
  return { costUsd: Math.round(dollarsAtListPrice * multiplier * 1_000_000) / 1_000_000, longPrompt }
}
