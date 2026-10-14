// Pure matching/resolution logic for exercise demo GIFs — split out of
// exerciseMedia.tsx (2026-09-01) so it stays import-free of React/Supabase,
// same convention as progressAggregate.ts/trainingInsights.ts/muscleMap.ts:
// exerciseMedia.tsx now pulls in the manual-override React Query hooks
// (useExerciseGifOverrides etc.), which transitively import the live
// Supabase client — requiring THAT file directly via sucrase (this repo's
// no-unit-test-runner verification convention) breaks on the client's own
// ESM/CJS interop. The actual logic worth testing has zero dependency on
// any of that, so it lives here instead.

export interface IndexedExercise {
  name: string
  tokens: Set<string>
  equipment: string | null
  gifUrl: string
  instructions: string[]
}

// Tokens that add noise rather than identity when matching exercise names.
const NOISE = new Set([
  'the', 'with', 'grip', 'medium', 'wide', 'close', 'standing', 'seated',
  'machine', 'exercise', 'a', 'of', 'to', 'and', 'or', 'bar', 'v', 'up',
])
const EQUIP = ['barbell', 'dumbbell', 'cable', 'machine', 'kettlebell', 'band', 'bodyweight', 'smith']

export function normalizeTokens(title: string): { tokens: Set<string>; equip: string | null } {
  const lower = title.toLowerCase()
  const paren = lower.match(/\(([^)]+)\)/)?.[1] ?? ''
  let equip: string | null = null
  for (const e of EQUIP) {
    if (paren.includes(e) || lower.includes(e)) { equip = e; break }
  }
  const cleaned = lower.replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9 ]/g, ' ')
  const tokens = new Set(cleaned.split(/\s+/).filter(t => t.length > 1 && !NOISE.has(t)))
  return { tokens, equip }
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

export function matchExercise(hevyTitle: string, db: IndexedExercise[]): IndexedExercise | null {
  const { tokens, equip } = normalizeTokens(hevyTitle)
  if (tokens.size === 0) return null
  let best: { ex: IndexedExercise; s: number } | null = null
  for (const ex of db) {
    let s = jaccard(tokens, ex.tokens)
    if (equip && ex.equipment === equip) s += 0.15
    if (!best || s > best.s) best = { ex, s }
  }
  if (!best || best.s < 0.5) return null
  return best.ex
}

export interface ResolvedExerciseMedia { gifUrl: string; name: string; instructions: string[]; overridden: boolean }

/** A manual override (keyed by exercise_template_id) always wins over the
 *  fuzzy matcher — checked first, no threshold, no fallback needed once one
 *  exists. Added 2026-09-01 after real user-reported wrong matches; keyed on
 *  the template id rather than title because Hevy exercise titles can be
 *  renamed inside the Hevy app itself, which would silently detach a
 *  title-keyed override from the exercise it was meant to fix. */
export function resolveExerciseGif(
  templateId: string | undefined,
  title: string,
  overridesByTemplateId: Map<string, string>,
  db: IndexedExercise[] | null | undefined,
): ResolvedExerciseMedia | null {
  const overrideUrl = templateId ? overridesByTemplateId.get(templateId) : undefined
  if (overrideUrl) return { gifUrl: overrideUrl, name: title, instructions: [], overridden: true }
  // The manifest is only needed for the fuzzy match — a manually set GIF
  // must still show when the jsDelivr manifest failed to load.
  if (!db) return null
  const match = matchExercise(title, db)
  if (!match) return null
  return { gifUrl: match.gifUrl, name: match.name, instructions: match.instructions, overridden: false }
}

// ── Hevy's own picture first (migration 154, 14.10.2026) ────────────────────
// Owner: "change that as primarily to Hevy". Hevy's exercise templates carry
// `thumbnail_url` (its OpenAPI; no live sample was read, so nothing assumes it
// is animated). Hevy's picture is the card thumbnail AND the popup's main
// picture; the ExerciseGymGifsDB GIF is the fallback thumbnail when Hevy has
// none, and the small labelled "Animated demo" below it in the popup.

/** True for a URL whose file is a GIF (the extension, before any query). */
export function isAnimatedImageUrl(url: string | null | undefined): boolean {
  if (!url) return false
  return /\.gif$/i.test(url.split(/[?#]/)[0])
}

export type ExerciseMediaSource = 'hevy' | 'override' | 'gifdb'

export interface ExerciseMediaChoice {
  /** Pictures for the small thumbnail, best first: the next one is tried when one fails to load. */
  thumbs: { url: string; source: ExerciseMediaSource }[]
  /** Hevy's picture — the popup's main picture when Hevy has one. */
  hevyUrl: string | null
  /** The popup's "Animated demo" (a Fix GIF pick or the name-matched GIF);
   *  null when there is none, or when Hevy's own picture already moves. */
  demo: (ResolvedExerciseMedia & { source: 'override' | 'gifdb' }) | null
}

/**
 * - Thumbnail: Hevy's picture → a GIF you set with Fix GIF → the name-matched GIF.
 * - Popup: Hevy's picture on top; below it the animated demo — the GIF you
 *   set (Fix GIF picks it on purpose), else the name-matched GIF — unless
 *   Hevy's picture is itself a GIF and nothing was set.
 */
export function chooseExerciseMedia(
  templateId: string | undefined,
  title: string,
  hevyThumbnailUrl: string | null | undefined,
  overridesByTemplateId: Map<string, string>,
  db: IndexedExercise[] | null | undefined,
): ExerciseMediaChoice {
  const hevyUrl = hevyThumbnailUrl && /^https?:\/\//i.test(hevyThumbnailUrl) ? hevyThumbnailUrl : null
  const gif = resolveExerciseGif(templateId, title, overridesByTemplateId, db)
  const gifSource = gif?.overridden ? 'override' as const : 'gifdb' as const

  const thumbs: ExerciseMediaChoice['thumbs'] = []
  if (hevyUrl) thumbs.push({ url: hevyUrl, source: 'hevy' })
  if (gif && gif.gifUrl !== hevyUrl) thumbs.push({ url: gif.gifUrl, source: gifSource })

  const demo = !gif || gif.gifUrl === hevyUrl || (!gif.overridden && isAnimatedImageUrl(hevyUrl)) ? null : { ...gif, source: gifSource }
  return { thumbs, hevyUrl, demo }
}
