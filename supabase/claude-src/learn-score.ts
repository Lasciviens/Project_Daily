// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · learning: scoring the weekly self-test, the decision rule and the tripwire (pure)
//
//  The model never grades itself. A replayed answer is compared by CODE with what the owner saved:
//    · a short field (a category, a brand, a number, a date) scores 1 when it equals the saved value after
//      normalising (case, accents, spaces, a number's form), else 0;
//    · a free-text field (a title, an ingredient list) scores by word overlap (Jaccard), so a reworded but equal answer
//      is not counted as wrong. A model judge for free text is allowed only once it has agreed with the owner's own
//      decisions (`judgeAllowed`): until then code alone decides.
//  A challenger replaces the champion only when ALL of these hold (the decision rule):
//    1. its test mean beats the champion's by more than the noise floor, 1/√(cases × repeats);
//    2. it wins more paired cases than it loses (the same case, both setups);
//    3. no field is worse by more than the noise floor;
//    4. it spends at most 20 % more tokens a request.
//  Even then nothing changes by itself: the owner taps Approve. After a change the tripwire watches the next saves of that
//  job, and a correction rate worse than the champion's by more than 15 points rolls it back.
//  No imports: the verify scripts run this file as it is.
// ─────────────────────────────────────────────────────────────────────────────

export const SCORE_LIMITS = { tokenGrowthMax: 1.2, freeTextPass: 0.8, tripwireCalls: 20, tripwireMargin: 0.15, judgeAgreementMin: 0.8, judgeSamplesMin: 10 } as const

function scoreKey(value: string): string {
  const t = value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
  // A number in any form ("12", "12.0", "12,0") is the same number.
  const n = Number(t.replace(',', '.'))
  return t !== '' && Number.isFinite(n) ? String(n) : t.replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim()
}

function wordsOfScore(value: string): Set<string> {
  return new Set(scoreKey(value).split(' ').filter(Boolean))
}

/** One field: 1 when equal (normalised), a free-text field by word overlap (a pass from 0.8 counts as 1). Missing on both sides is 1. */
export function fieldScore(gold: string | null | undefined, got: string | null | undefined, freeText: boolean): number {
  const g = gold ? scoreKey(gold) : ''
  const a = got ? scoreKey(got) : ''
  if (!g && !a) return 1
  if (!g || !a) return 0
  if (g === a) return 1
  if (!freeText) return 0
  const x = wordsOfScore(gold as string)
  const y = wordsOfScore(got as string)
  let shared = 0
  for (const w of x) if (y.has(w)) shared += 1
  const jaccard = shared / (x.size + y.size - shared || 1)
  return jaccard >= SCORE_LIMITS.freeTextPass ? 1 : Math.round(jaccard * 1000) / 1000
}

/** One replayed answer against the owner's saved values: the mean over the gold fields, and each field's score. */
export function scoreCase(gold: Record<string, string>, got: Record<string, string> | null, freeFields: ReadonlySet<string>): { mean: number; fields: Record<string, number> } {
  const fields: Record<string, number> = {}
  const names = Object.keys(gold)
  if (!names.length) return { mean: 0, fields }
  for (const name of names) {
    const leaf = name.split('.').pop() as string
    fields[name] = got ? fieldScore(gold[name], got[name], freeFields.has(leaf)) : 0
  }
  return { mean: names.reduce((s, n) => s + fields[n], 0) / names.length, fields }
}

/** The noise floor: how big a difference a run of this size can show by chance (about 1/√(cases × repeats)). */
export function noiseFloor(cases: number, reps: number): number {
  const n = Math.max(1, Math.floor(cases) * Math.max(1, Math.floor(reps)))
  return 1 / Math.sqrt(n)
}

/** One setup's numbers on the test split: the mean per case (over its repeats), the mean per field, tokens per request. */
export interface SetupScore {
  setup: string
  perCase: Record<string, number>
  perField: Record<string, number>
  tokensPerRequest: number
  answered: number
  failed: number
}

export interface Decision {
  wins: boolean
  reasons: string[]
  champion: number
  challenger: number
  floor: number
  pairedWins: number
  pairedLosses: number
}

const meanOf = (values: number[]) => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0)

/** The decision rule (see the header). Every reason a challenger did not win is named, for the Tuning view. */
export function decideChallenger(champion: SetupScore, challenger: SetupScore, reps: number): Decision {
  const ids = Object.keys(champion.perCase).filter(id => id in challenger.perCase)
  const floor = noiseFloor(ids.length, reps)
  const a = meanOf(ids.map(id => champion.perCase[id]))
  const b = meanOf(ids.map(id => challenger.perCase[id]))
  let pairedWins = 0
  let pairedLosses = 0
  for (const id of ids) {
    if (challenger.perCase[id] > champion.perCase[id]) pairedWins += 1
    else if (challenger.perCase[id] < champion.perCase[id]) pairedLosses += 1
  }
  const reasons: string[] = []
  if (ids.length === 0) reasons.push('no case was answered by both')
  if (!(b - a > floor)) reasons.push(`not clearly better yet (needs more than ${points(floor)} points on ${ids.length * Math.max(1, Math.floor(reps))} tries; it was ${points(b - a)})`)
  if (!(pairedWins > pairedLosses)) reasons.push(`better on ${pairedWins} cases, worse on ${pairedLosses}`)
  const worse = Object.keys(champion.perField).filter(f => f in challenger.perField && champion.perField[f] - challenger.perField[f] > floor)
  if (worse.length) reasons.push(`worse on ${worse.slice(0, 5).join(', ')}`)
  if (champion.tokensPerRequest > 0 && challenger.tokensPerRequest > champion.tokensPerRequest * SCORE_LIMITS.tokenGrowthMax) {
    reasons.push(`it spends ${Math.round((challenger.tokensPerRequest / champion.tokensPerRequest - 1) * 100)} % more tokens (at most 20 %)`)
  }
  return { wins: reasons.length === 0, reasons, champion: round(a), challenger: round(b), floor: round(floor), pairedWins, pairedLosses }
}

const round = (n: number) => Math.round(n * 10000) / 10000
/** A difference of two shares in points of a hundred ("35 points"; a negative one says "−3"). */
const points = (n: number) => `${n < 0 ? '−' : ''}${Math.round(Math.abs(n) * 100)}`

/** A whole setup's score from its replayed lines: each case's mean over its repeats; each field's mean over every answer. */
export function setupScore(setup: string, lines: readonly { caseId: string; score: { mean: number; fields: Record<string, number> } | null; tokens: number }[]): SetupScore {
  const byCase = new Map<string, number[]>()
  const byField = new Map<string, number[]>()
  let tokens = 0
  let answered = 0
  let failed = 0
  for (const line of lines) {
    tokens += line.tokens
    const scores = byCase.get(line.caseId) ?? []
    if (line.score) {
      answered += 1
      scores.push(line.score.mean)
      for (const [f, v] of Object.entries(line.score.fields)) {
        const leaf = f.replace(/^items\.\d+\./, 'items.')
        byField.set(leaf, [...(byField.get(leaf) ?? []), v])
      }
    } else {
      failed += 1
      // A replay that gave no usable answer is a 0 for that case: a setup that breaks the answer must lose.
      scores.push(0)
    }
    byCase.set(line.caseId, scores)
  }
  const perCase: Record<string, number> = {}
  for (const [id, s] of byCase) perCase[id] = round(meanOf(s))
  const perField: Record<string, number> = {}
  for (const [f, s] of byField) perField[f] = round(meanOf(s))
  return { setup, perCase, perField, tokensPerRequest: lines.length ? Math.round(tokens / lines.length) : 0, answered, failed }
}

/**
 * The tripwire after a change: once `tripwireCalls` saves were watched, a correction rate worse than the champion's
 * by more than 15 points rolls the change back. Answers 'watch' (keep counting), 'keep' (it passed) or 'roll_back'.
 */
export function tripwireVerdict(baseline: number, saves: number, corrected: number): 'watch' | 'keep' | 'roll_back' {
  const rate = saves > 0 ? corrected / saves : 0
  // Clearly worse already before the 20th save: no need to keep hurting.
  if (saves >= 5 && (corrected - Math.ceil((baseline + SCORE_LIMITS.tripwireMargin) * SCORE_LIMITS.tripwireCalls)) > 0) return 'roll_back'
  if (saves < SCORE_LIMITS.tripwireCalls) return 'watch'
  return rate > baseline + SCORE_LIMITS.tripwireMargin ? 'roll_back' : 'keep'
}

/** A model judge for free text may be used only after it agreed with the owner's own decisions often enough. */
export function judgeAllowed(agreements: number, samples: number): boolean {
  return samples >= SCORE_LIMITS.judgeSamplesMin && agreements / samples >= SCORE_LIMITS.judgeAgreementMin
}
