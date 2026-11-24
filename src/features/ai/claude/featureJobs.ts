import { runClaudeJob } from './claudeApi'
import { rememberLearnCall } from './learnCalls'
import type { CallSummary } from './types'
import {
  errorContextForAi, readIdeas, readReceipt, readRequestDraft, scrubErrorForAi, type PdfInput, type PhotoInput, type ReceiptRead, type RequestDraft,
} from './featureRules'

/** What the call cost, from its ledger row, or null: shown after each result (featureRules.costNote). */
const costOf = (call: CallSummary | undefined): number | null => (call && typeof call.cost_usd === 'number' && Number.isFinite(call.cost_usd) ? call.cost_usd : null)

// The app's side of the AI features of 22.11.2026 (docs/features/ai-plan.md), each one job of the `claude` function.
// They only fill a form or show a text; the owner confirms. Every answer is read again here with the same limits as
// the function's (featureRules.ts). A stopped run throws a ClaudeJobError whose message is the function's own sentence.

/** Food → Quick guess → "From a photo": the photo (and optional words) → the diary line, read by the caller (readGuessEstimate). */
export async function describeGuessPhoto(photo: PhotoInput, text: string): Promise<{ result: unknown; costUsd: number | null; callId: string | null }> {
  const input: Record<string, unknown> = { image: photo }
  if (text.trim()) input.text = text.trim().slice(0, 500)
  const { result, call } = await runClaudeJob<unknown>('quick_guess_photo', input)
  return { result, costUsd: costOf(call), callId: call?.id ?? null }
}

/** One of the owner's own categories as the function takes it ('Top' or 'Top / Sub'). The function numbers them; the model never sees an id. */
export interface ReceiptCategory { id: string; path: string }
/** The most categories that go with a receipt (the function's `RECEIPT_LIMITS.categories`). */
export const RECEIPT_CATEGORIES_MAX = 200

/** What a receipt job reads: one photo or one PDF, never both. */
export type ReceiptInput = { image: PhotoInput } | { document: PdfInput }

/** Shop → "Read a receipt" / "From a receipt": a photo or a PDF → what is printed on it, checked again. Throws when nothing usable was read. */
export async function readReceiptInput(input: ReceiptInput, today: string, categories: readonly ReceiptCategory[] = [], preferredHosts: readonly string[] = []): Promise<ReceiptRead & { costUsd: number | null; callId: string | null }> {
  // The owner's own categories go with the file, so a line may come back with one (by number, mapped to an id by the function).
  const sent: ReceiptCategory[] = categories.slice(0, RECEIPT_CATEGORIES_MAX)
  // The sites that worked for this owner before (at most 3 host names): a hint for its search, as data.
  const hint = preferredHosts.length ? { preferred_hosts: preferredHosts.slice(0, 3) } : {}
  const { result, call } = await runClaudeJob<unknown>('receipt_read', { ...input, ...(sent.length ? { categories: sent } : {}), ...hint })
  const read = readReceipt(result, today, new Set(sent.map(c => c.id)))
  if (!read) throw new Error("That didn't read as a receipt — try a flatter, brighter photo or another PDF")
  return { ...read, costUsd: costOf(call), callId: call?.id ?? null }
}

/** Shop → "Tidy up info": one thing's name, brand, model and category now, and the owner's own categories → a suggestion, read and checked by the caller (`readTidySuggestion`). */
export async function tidyThing(input: Record<string, unknown>): Promise<{ result: unknown; costUsd: number | null; callId: string | null }> {
  const { result, call } = await runClaudeJob<unknown>('shop_tidy', input)
  // The call's id: the save reports it, so the function can compare what was kept with its own copy of the answer.
  return { result, costUsd: costOf(call), callId: call?.id ?? null }
}

/** Dev Requests ✨: dictated words → a request draft; the page is taken only from `pages` (the app's own list). */
export async function draftDevRequest(text: string, pages: readonly string[], currentPage: string): Promise<RequestDraft & { costUsd: number | null }> {
  const { result, call } = await runClaudeJob<unknown>('dev_request_draft', { text: text.trim().slice(0, 4000), pages, current_page: currentPage })
  // The composer's save reports this call with what was saved (Developer → AI → Learned).
  rememberLearnCall('dev_request_draft', call?.id)
  const draft = readRequestDraft(result, pages)
  if (!draft) throw new Error("The AI didn't send a usable request — try again")
  return { ...draft, costUsd: costOf(call) }
}

/** What "Explain" gives for one error. */
export interface ErrorExplanation {
  explanation: string
  terms: { term: string; meaning: string }[]
  request: RequestDraft
  costUsd: number | null
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Developer → Errors → "Explain": the message and its context, scrubbed here first and again by the function. */
export async function explainError(message: string, context: Record<string, unknown> | null): Promise<ErrorExplanation> {
  const input: Record<string, unknown> = { message: scrubErrorForAi(message, 800) }
  const ctx = errorContextForAi(context)
  if (ctx) input.context = ctx
  const { result, call } = await runClaudeJob<unknown>('error_explain', input)
  if (!isObj(result) || typeof result.explanation !== 'string' || !result.explanation.trim()) throw new Error("The AI didn't send an explanation — try again")
  const request = readRequestDraft(result.request, ['other'], 'bug')
  if (!request) throw new Error("The AI didn't send a request draft — try again")
  const terms = (Array.isArray(result.terms) ? result.terms : []).slice(0, 5).flatMap(t => (
    isObj(t) && typeof t.term === 'string' && typeof t.meaning === 'string' && t.term.trim() && t.meaning.trim() ? [{ term: t.term.trim().slice(0, 40), meaning: t.meaning.trim().slice(0, 220) }] : []
  ))
  return { explanation: result.explanation.trim().slice(0, 1400), terms, request, costUsd: costOf(call) }
}

/** Work → "Write my week": the status text, shown with a Copy button (never saved). */
export async function writeWeek(input: Record<string, unknown>): Promise<{ text: string; costUsd: number | null }> {
  const { result, call } = await runClaudeJob<unknown>('work_week', input)
  if (!isObj(result) || typeof result.text !== 'string' || !result.text.trim()) throw new Error("The AI didn't write a text — try again")
  return { text: result.text.trim().slice(0, 1500), costUsd: costOf(call) }
}

/** Shop → "Write the ad" → "Improve": the template's ad rewritten with the owner's condition notes (shown, never saved). */
export async function improveAd(title: string, template: string, notes: string): Promise<{ text: string; costUsd: number | null }> {
  const { result, call } = await runClaudeJob<unknown>('ad_improve', { title: title.trim().slice(0, 120), template: template.trim().slice(0, 3000), notes: notes.trim().slice(0, 1000) })
  if (!isObj(result) || typeof result.text !== 'string' || !result.text.trim()) throw new Error("The AI didn't write a text — try again")
  return { text: result.text.trim().slice(0, 3500), costUsd: costOf(call) }
}

/** Wishes → "Ideas" for a place: 5–8 lines, and whether a web search was used. */
export async function placeIdeas(place: string, wish: string, notes: string): Promise<{ ideas: string[]; fromSearch: boolean; costUsd: number | null }> {
  const { result, call } = await runClaudeJob<unknown>('place_ideas', { place: place.trim().slice(0, 120), wish: wish.trim().slice(0, 120), notes: notes.trim().slice(0, 500) })
  const read = readIdeas(result)
  if (!read) throw new Error("The AI didn't find ideas for that place — try again")
  return { ...read, costUsd: costOf(call) }
}
