// Read several receipts → a money chain (owner, 23.11.2026: "an option to create money chain of them"): which sold line
// paid for which bought line(s), and how each link is written. All code: the model is never asked and no id comes from
// an answer — a link's two ends are ids of the owner's own things or of rows a write of this session answered with.
// `suggestChainPairs` only SUGGESTS (the owner ticks the targets, one or several, or none); `chainPlan` says which
// write makes each link; `linksToMake` lists what is still missing once the saves are done.
// Pure: scripts/verify-shop-receipt-batch.cjs.
import { foldName } from '../ai/claude/featureRules'

/** What the suggestion needs of one line (sold or bought). */
export interface ChainLine {
  key: string
  /** The file it came from (a sold and a bought line of one file score highest). */
  file: number
  /** The receipt's day, YYYY-MM-DD, or null. */
  day: string | null
  /** The top category of the line (its matched thing's, else the receipt's own pick), or null. */
  topCategory: string | null
  brand?: string
  /** The words that name it: its product, brand and model. */
  text: string
  amount: number | null
  currency: string | null
}

/** A sale counts from this many days before the purchase to this many days after it. */
export const WINDOW_BEFORE_DAYS = 30
export const WINDOW_AFTER_DAYS = 60
/** The least score that makes a suggestion. */
export const SUGGEST_MIN = 3

const dayNumber = (d: string): number => Math.floor(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000)

/** Words with letters and a digit ("x1", "xm5", "128gb"): a model-like word is a strong sign two lines are about one thing. */
const digitWords = (s: string): Set<string> => new Set((s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[a-z0-9]{2,}/g) ?? []).filter(w => /\d/.test(w) && /[a-z]/.test(w)))

/**
 * How well a sale and a purchase fit, or null when they cannot be one chain: the sale's day must be from 30 days before
 * to 60 days after the purchase (a missing day only passes inside one file). Same file and same day is worth 4, the same
 * file 2, the same top category 3, a shared brand 2 and a shared model-like word 2. The amount never adds to it.
 */
export function pairScore(sold: ChainLine, bought: ChainLine): number | null {
  const sameFile = sold.file === bought.file
  let score = 0
  if (sold.day && bought.day) {
    const diff = dayNumber(sold.day) - dayNumber(bought.day)
    if (diff < -WINDOW_BEFORE_DAYS || diff > WINDOW_AFTER_DAYS) return null
    score += sameFile && diff === 0 ? 4 : sameFile ? 2 : 1
  } else if (sameFile) score += 2
  else return null
  if (sold.topCategory && sold.topCategory === bought.topCategory) score += 3
  if (sold.brand && bought.brand && foldName(sold.brand) === foldName(bought.brand) && foldName(sold.brand).length >= 2) score += 2
  const a = digitWords(sold.text)
  if ([...digitWords(bought.text)].some(w => a.has(w))) score += 2
  return score
}

/** How far apart two amounts are, only when both are printed in one currency. */
const amountGap = (a: ChainLine, b: ChainLine): number | null => (a.amount != null && b.amount != null && a.currency && a.currency === b.currency ? Math.abs(a.amount - b.amount) : null)

/**
 * For each sold line, the one bought line it most likely paid for, or null. The best score wins; the amount is a tiebreak
 * only, and when two lines are still level there is no suggestion (the owner ticks). Never more than one per sold line.
 */
export function suggestChainPairs(sold: readonly ChainLine[], bought: readonly ChainLine[]): Map<string, string | null> {
  const out = new Map<string, string | null>()
  for (const s of sold) {
    const scored = bought.flatMap(b => { const v = pairScore(s, b); return v !== null && v >= SUGGEST_MIN ? [{ b, v }] : [] })
    if (!scored.length) { out.set(s.key, null); continue }
    const top = Math.max(...scored.map(x => x.v))
    let best = scored.filter(x => x.v === top)
    if (best.length > 1) {
      const gaps = best.map(x => ({ x, gap: amountGap(s, x.b) }))
      if (gaps.every(g => g.gap !== null)) {
        const least = Math.min(...gaps.map(g => g.gap as number))
        best = gaps.filter(g => g.gap === least).map(g => g.x)
      }
    }
    out.set(s.key, best.length === 1 ? best[0].b.key : null)
  }
  return out
}

// ── how each link is written ─────────────────────────────────────────────────

export interface ChainPlan {
  /** A sold line's first target, linked by the write that records the sale (Sell's "Money goes to", or the created "I had it" thing's). */
  first: Map<string, string>
  /** A bought line's source that is already sold in the app: linked by the bought thing's own "Paid with money from". */
  paidFrom: Map<string, string>
  /** Every other pair: one link each (`createShopLink`, with its Undo). */
  extras: { soldKey: string; boughtKey: string }[]
}

/**
 * Which write makes each ticked pair. `ticks` is each sold line's chosen bought lines; `boughtOrder` is the bought lines'
 * order on screen (the first ticked in that order is the first target); `inApp` are the sold lines whose thing was already
 * sold in the app, so there is no sale to carry the link. A sold line may go to many bought lines and the other way round.
 */
export function chainPlan(ticks: ReadonlyMap<string, ReadonlySet<string>>, boughtOrder: readonly string[], inApp: ReadonlySet<string>): ChainPlan {
  const plan: ChainPlan = { first: new Map(), paidFrom: new Map(), extras: [] }
  for (const [soldKey, set] of ticks) {
    const ordered = boughtOrder.filter(b => set.has(b))
    if (!ordered.length) continue
    if (inApp.has(soldKey)) {
      for (const b of ordered) { if (!plan.paidFrom.has(b)) plan.paidFrom.set(b, soldKey); else plan.extras.push({ soldKey, boughtKey: b }) }
    } else {
      plan.first.set(soldKey, ordered[0])
      for (const b of ordered.slice(1)) plan.extras.push({ soldKey, boughtKey: b })
    }
  }
  return plan
}

/** The pair as one string, for the set of pairs a write already linked. */
export const pairKey = (soldKey: string, boughtKey: string): string => `${soldKey}>${boughtKey}`

export interface LinkToMake { soldKey: string; boughtKey: string; from_id: string; to_id: string }

/**
 * The links still to make: every ticked pair that no write has linked, whose two ends both have an id (an owner's thing or
 * a row a save of this session answered with) and that is not linked already. A pair with an end that was never saved is
 * `missing` — said to the owner, never guessed. A thing is never linked to itself.
 */
export function linksToMake(
  ticks: ReadonlyMap<string, ReadonlySet<string>>, ids: ReadonlyMap<string, string>, done: ReadonlySet<string>, existing: readonly { from_id: string; to_id: string }[],
): { make: LinkToMake[]; missing: number } {
  const have = new Set(existing.map(l => `${l.from_id}>${l.to_id}`))
  const make: LinkToMake[] = []
  let missing = 0
  for (const [soldKey, set] of ticks) {
    for (const boughtKey of set) {
      if (done.has(pairKey(soldKey, boughtKey))) continue
      const from = ids.get(soldKey), to = ids.get(boughtKey)
      if (!from || !to) { missing++; continue }
      if (from === to || have.has(`${from}>${to}`) || make.some(m => m.from_id === from && m.to_id === to)) continue
      make.push({ soldKey, boughtKey, from_id: from, to_id: to })
    }
  }
  return { make, missing }
}
