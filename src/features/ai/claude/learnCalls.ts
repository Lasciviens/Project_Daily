// The AI call that last filled a form, by form, until that form is saved (then its save reports it for learning: Developer →
// AI → Learned). For forms whose fill and save live in different hooks (a recipe's Estimate, a preset's Suggest options, a Dev
// Request's Tidy up). A call is taken once, and one older than an hour is never reported (the form was left and opened again).

export type LearnSlot = 'recipe_macros' | 'quick_guess_options' | 'dev_request_draft'

const LEARN_CALL_TTL_MS = 60 * 60_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const calls = new Map<LearnSlot, { callId: string; at: number }>()

/** The AI call that just filled the slot's form (a later fill replaces it). */
export function rememberLearnCall(slot: LearnSlot, callId: string | null | undefined): void {
  if (typeof callId === 'string' && UUID.test(callId)) calls.set(slot, { callId, at: Date.now() })
}

/** The slot's call, once, when it is recent; null otherwise. */
export function takeLearnCall(slot: LearnSlot): string | null {
  const it = calls.get(slot)
  calls.delete(slot)
  return it && Date.now() - it.at <= LEARN_CALL_TTL_MS ? it.callId : null
}

/** A form opened afresh: an older fill of it is never reported with this save. */
export function forgetLearnCall(slot: LearnSlot): void {
  calls.delete(slot)
}

/** A preset's option groups as one line, written exactly as the function writes the AI's (learn-specs.ts `optionGroupsLine`). */
export function optionGroupsLine(groups: unknown): string {
  const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  return (Array.isArray(groups) ? groups : []).filter(obj)
    .map(g => `${str(g.name)}: ${(Array.isArray(g.choices) ? g.choices : []).filter(obj).map(c => str(c.name)).filter(Boolean).join(', ')}`).join(' | ')
}
