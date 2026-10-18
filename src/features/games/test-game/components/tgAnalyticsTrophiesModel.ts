// PlayStation trophy figures for the Analytics Play tab, from the trophy-set
// list the PSN tab already reads (usePsnTitles). Pure: the titles go in, the
// numbers come out. Sony's payload is reverse-engineered, so every count is
// read defensively — a missing or odd field counts as zero, never NaN.

import type { PsnTrophyTitle } from '../../api/psnApi'

export type TgaTrophyGrade = 'platinum' | 'gold' | 'silver' | 'bronze'
export type TgaTrophyCounts = Record<TgaTrophyGrade, number>

/** Rarest first — the order the card lists them in. */
export const TGA_TROPHY_GRADES: { key: TgaTrophyGrade; label: string }[] = [
  { key: 'platinum', label: 'Platinum' },
  { key: 'gold', label: 'Gold' },
  { key: 'silver', label: 'Silver' },
  { key: 'bronze', label: 'Bronze' },
]

export interface TgaTrophyStats {
  titles: number
  /** Platinum trophies earned. */
  platinums: number
  earned: TgaTrophyCounts
  defined: TgaTrophyCounts
  /** Mean completion (0–100) of the sets that report one; null when none does. */
  averageProgress: number | null
  /** Sets with a platinum not yet earned and progress under 100, highest progress first (top 3). */
  nearest: PsnTrophyTitle[]
}

const count = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/** A set's completion, 0–100; null when Sony sent nothing usable. */
export function titleProgress(t: PsnTrophyTitle): number | null {
  const raw: unknown = t?.progress
  // Number(null) and Number('') are 0 — a missing progress must not read as "0% done".
  if (raw == null || raw === '') return null
  const p = Number(raw)
  return Number.isFinite(p) ? Math.min(100, Math.max(0, p)) : null
}

/** "PS4,PSVITA" → "PS4 · PS Vita". */
export function titlePlatform(t: PsnTrophyTitle): string {
  const names: Record<string, string> = { PSVITA: 'PS Vita', PSPC: 'PC' }
  return String(t?.trophyTitlePlatform ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)
    .map(s => names[s.toUpperCase()] ?? s).join(' · ')
}

const zero = (): TgaTrophyCounts => ({ platinum: 0, gold: 0, silver: 0, bronze: 0 })

export function trophyStats(titles: PsnTrophyTitle[], nearestMax = 3): TgaTrophyStats {
  const list = Array.isArray(titles) ? titles.filter(t => t && typeof t === 'object') : []
  const earned = zero()
  const defined = zero()
  let progressSum = 0
  let progressed = 0
  const chase: { t: PsnTrophyTitle; p: number }[] = []
  for (const t of list) {
    for (const { key } of TGA_TROPHY_GRADES) {
      earned[key] += count(t.earnedTrophies?.[key])
      defined[key] += count(t.definedTrophies?.[key])
    }
    const p = titleProgress(t)
    if (p != null) { progressSum += p; progressed++ }
    if (count(t.definedTrophies?.platinum) > 0 && count(t.earnedTrophies?.platinum) === 0 && (p ?? 0) < 100) {
      chase.push({ t, p: p ?? 0 })
    }
  }
  chase.sort((a, b) => b.p - a.p || String(a.t.trophyTitleName ?? '').localeCompare(String(b.t.trophyTitleName ?? '')))
  return {
    titles: list.length,
    platinums: earned.platinum,
    earned,
    defined,
    averageProgress: progressed ? progressSum / progressed : null,
    nearest: chase.slice(0, nearestMax).map(x => x.t),
  }
}
