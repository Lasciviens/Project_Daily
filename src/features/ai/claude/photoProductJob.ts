import { runClaudeJob } from './claudeApi'
import type { PhotoInput } from './featureRules'
import { readProductPhoto, PRODUCT_PHOTO_LIMITS, type PhotoAnswer } from './photoProductRules'
import type { CallSummary } from './types'

// Shop's 📷✨ (the `product_photo` job, owner, 25.11.2026): the app's side of the call. Its own module, loaded with the Shop's
// autofill, so the other AI features' pages never carry it. The answer is read again here (`readProductPhoto`).

/** The most categories that go with the photos (the function's `PRODUCT_PHOTO_LIMITS.categories`, as a receipt's). */
export const PHOTO_CATEGORIES_MAX = 200

/** What Shop's 📷✨ sends: 1–2 shrunk photos, the owner's line, and on the second call the answers (an empty list: skipped). */
export interface PhotoProductInput {
  photos: readonly PhotoInput[]
  text: string
  answers?: readonly { question: string; answer: string }[]
  /** The owner's own categories ('Top' or 'Top / Sub'): the function numbers them, the model never sees an id. */
  categories: readonly { id: string; path: string }[]
  preferredHosts: readonly string[]
}

const costOf = (call: CallSummary | undefined): number | null => (call && typeof call.cost_usd === 'number' && Number.isFinite(call.cost_usd) ? call.cost_usd : null)

/**
 * The photos (held in memory by the caller for the second call, never stored) → questions or a draft, checked again here.
 * Throws when nothing usable came back.
 */
export async function productFromPhotos(input: PhotoProductInput): Promise<{ answer: PhotoAnswer; costUsd: number | null; callId: string | null }> {
  const sent = input.categories.slice(0, PHOTO_CATEGORIES_MAX)
  const body: Record<string, unknown> = { images: input.photos.slice(0, PRODUCT_PHOTO_LIMITS.photos) }
  const text = input.text.replace(/\s+/g, ' ').trim()
  if (text) body.text = [...text].slice(0, PRODUCT_PHOTO_LIMITS.text).join('')
  if (input.answers) body.answers = input.answers.slice(0, PRODUCT_PHOTO_LIMITS.answers)
  if (sent.length) body.categories = sent
  if (input.preferredHosts.length) body.preferred_hosts = input.preferredHosts.slice(0, 3)
  const { result, call } = await runClaudeJob<unknown>('product_photo', body)
  const answer = readProductPhoto(result, new Set(sent.map(c => c.id)))
  if (!answer) throw new Error("The AI couldn't tell what the product is — try a clearer photo or add a few words")
  return { answer, costUsd: costOf(call), callId: call?.id ?? null }
}
