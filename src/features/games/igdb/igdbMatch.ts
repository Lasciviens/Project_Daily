// Pure IGDB matching rules — no imports with side effects, so
// scripts/verify-igdb-match.cjs can require it through sucrase.
//
// A library row is matched to an IGDB game in one of two ways:
//   · Steam rows by their app id (IGDB's external_games maps Steam ids) — exact.
//   · Everything else by title + platform + year, scored here. Only an
//     unambiguous "exact" match is saved on its own; the rest wait for a tick.

import type { GameLibrary } from '../types'

export interface IgdbCandidate {
  id: number
  name: string
  slug: string | null
  year: number | null
  platformIds: number[]
  platformNames: string[]
  altNames: string[]
  coverId: string | null
  /** IGDB's game type ("Main Game", "DLC", "Bundle"…), when it sent one. */
  type: string | null
  /** How many people rated it — a tie-breaker between equal titles. */
  ratingCount: number
}

export interface MatchTarget {
  title: string
  year: number | null
  platformKey: string
  library: GameLibrary
}

export type MatchConfidence = 'exact' | 'likely' | 'unsure'

export interface ScoredCandidate extends IgdbCandidate {
  score: number
  confidence: MatchConfidence
  titleMatch: 'same' | 'subtitle' | 'close' | 'weak'
  platformMatch: boolean | null
  yearMatch: boolean | null
}

// ─── Platforms ────────────────────────────────────────────────────────────────
// This app's platform keys (testGameModel's PLATFORMS) → IGDB platform ids,
// from IGDB's platform list (PS4 = 48 is the docs' own example). A platform is
// a scoring signal, never a filter: a wrong or missing id only makes a match
// "likely" instead of "exact", it never hides the right game.
export const IGDB_PLATFORMS: Record<string, number[]> = {
  nes: [18, 99], snes: [19, 58], snesna: [19], n64: [4], gc: [21], wii: [5], wiiu: [41], switch: [130],
  gba: [24], gbc: [22], gb: [33], nds: [20], n3ds: [37],
  genesis: [29], megadrive: [29], segacd: [78], saturn: [32], dreamcast: [23],
  psx: [7], ps2: [8], ps3: [9], psp: [38], psvita: [46],
  xbox: [11], xbox360: [12],
  fbneo: [52], mame: [52],
  pc: [6], steam: [6], androidgames: [34], androidapps: [34],
  playstation: [48, 167, 9, 46, 38],
}

/** Words that name the same platform in IGDB's platform names (the fallback
 *  when an id above is wrong). */
const PLATFORM_WORDS: Record<string, string[]> = {
  nes: ['nintendo entertainment system', 'famicom'], snes: ['super nintendo', 'super famicom'], snesna: ['super nintendo'],
  n64: ['nintendo 64'], gc: ['gamecube'], wii: ['wii'], wiiu: ['wii u'], switch: ['switch'],
  gba: ['game boy advance'], gbc: ['game boy color'], gb: ['game boy'], nds: ['nintendo ds'], n3ds: ['3ds'],
  genesis: ['genesis', 'mega drive'], megadrive: ['mega drive', 'genesis'], segacd: ['sega cd', 'mega-cd', 'mega cd'],
  saturn: ['saturn'], dreamcast: ['dreamcast'], psx: ['playstation'], ps2: ['playstation 2'], ps3: ['playstation 3'],
  psp: ['playstation portable'], psvita: ['vita'], xbox: ['xbox'], xbox360: ['xbox 360'],
  fbneo: ['arcade'], mame: ['arcade'], pc: ['pc', 'windows'], steam: ['pc', 'windows'],
  playstation: ['playstation 4', 'playstation 5', 'playstation 3', 'vita'],
}

export function igdbPlatformsFor(platformKey: string, library: GameLibrary): number[] {
  if (library === 'steam') return IGDB_PLATFORMS.steam
  if (library === 'playstation') return IGDB_PLATFORMS.playstation
  return IGDB_PLATFORMS[platformKey] ?? []
}

function platformMatches(t: MatchTarget, c: IgdbCandidate): boolean | null {
  const key = t.library === 'retro' ? t.platformKey : t.library
  const ids = igdbPlatformsFor(t.platformKey, t.library)
  const words = PLATFORM_WORDS[key] ?? []
  if (!ids.length && !words.length) return null
  if (!c.platformIds.length && !c.platformNames.length) return null
  if (c.platformIds.some(id => ids.includes(id))) return true
  const names = c.platformNames.map(n => n.toLowerCase())
  // "PlayStation" must not count for "PlayStation 2": compare whole names first.
  if (key === 'psx') return names.some(n => n === 'playstation' || n === 'playstation (original)')
  if (key === 'gb') return names.some(n => n === 'game boy')
  if (key === 'xbox') return names.some(n => n === 'xbox')
  return names.some(n => words.some(w => n.includes(w)))
}

// ─── Titles ───────────────────────────────────────────────────────────────────

// No "x": "Mega Man X" and "Mega Man 10" are different games.
const ROMAN: Record<string, string> = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', xi: '11', xii: '12', xiii: '13' }

/** A title reduced to what identifies it: no region/dump tags, accents,
 *  marks, punctuation or leading "The"; roman numerals as digits. */
export function normTitle(raw: string): string {
  // Marks first: NFKD would spell ™ out as "TM".
  let s = raw.replace(/[™®©]/g, '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  s = s.replace(/\s*[([][^)\]]*[)\]]/g, ' ') // (USA), [!], (Rev 1)
  s = s.replace(/&/g, ' and ').replace(/\+/g, ' plus ')
  s = s.replace(/,\s*the\b/g, ' ').replace(/^the\s+/, '')
  s = s.replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
  return s.split(' ').map(w => ROMAN[w] ?? w).filter(Boolean).join(' ')
}

/** The part before a subtitle ("Final Fantasy VII: Remake" → "final fantasy 7"). */
export function baseTitle(raw: string): string {
  const cut = raw.split(/\s*[:–—]\s*|\s+-\s+/)[0] ?? raw
  return normTitle(cut)
}

function dice(a: string, b: string): number {
  const A = new Set(a.split(' ').filter(Boolean)), B = new Set(b.split(' ').filter(Boolean))
  if (!A.size || !B.size) return 0
  let both = 0
  for (const w of A) if (B.has(w)) both++
  return (2 * both) / (A.size + B.size)
}

export function compareTitles(ours: string, theirs: string): { kind: ScoredCandidate['titleMatch']; score: number } {
  const a = normTitle(ours), b = normTitle(theirs)
  if (a && a === b) return { kind: 'same', score: 1 }
  // Same with spaces squeezed out ("Mega Man" / "MegaMan").
  if (a && a.replace(/ /g, '') === b.replace(/ /g, '')) return { kind: 'same', score: 1 }
  const ba = baseTitle(ours), bb = baseTitle(theirs)
  if (ba && (ba === b || a === bb || ba === bb)) return { kind: 'subtitle', score: 0.75 }
  const d = dice(a, b)
  return d >= 0.6 ? { kind: 'close', score: 0.4 + d * 0.3 } : { kind: 'weak', score: d * 0.4 }
}

const SIDE_TYPES = /dlc|add-?on|bundle|pack|mod\b|update|season|episode/i

/** Scores one candidate for one library row. */
export function scoreCandidate(t: MatchTarget, c: IgdbCandidate): ScoredCandidate {
  const names = [c.name, ...c.altNames]
  let best = { kind: 'weak' as ScoredCandidate['titleMatch'], score: 0 }
  for (const n of names) {
    const r = compareTitles(t.title, n)
    if (r.score > best.score) best = r
  }
  const platformMatch = platformMatches(t, c)
  const yearMatch = t.year && c.year ? Math.abs(t.year - c.year) <= 1 : null
  let score = best.score
  if (platformMatch === true) score += 0.15
  if (platformMatch === false) score -= 0.25
  if (yearMatch === true) score += 0.1
  if (yearMatch === false) score -= 0.1
  if (c.type && SIDE_TYPES.test(c.type)) score -= 0.3
  const exact = best.kind === 'same' && platformMatch !== false && yearMatch !== false
    && !(c.type && SIDE_TYPES.test(c.type))
    // A bare title with nothing else agreeing is not proof enough.
    && (platformMatch === true || yearMatch === true)
  const confidence: MatchConfidence = exact ? 'exact' : score >= 0.75 ? 'likely' : 'unsure'
  return { ...c, score: Math.round(score * 1000) / 1000, confidence, titleMatch: best.kind, platformMatch, yearMatch }
}

/** Every candidate scored, best first. Two "exact" candidates that cannot be
 *  told apart (no year to settle it) are both demoted to "likely". */
export function rankCandidates(t: MatchTarget, cands: IgdbCandidate[]): ScoredCandidate[] {
  const scored = cands.map(c => scoreCandidate(t, c))
    .sort((a, b) => b.score - a.score || b.ratingCount - a.ratingCount || a.id - b.id)
  const exact = scored.filter(s => s.confidence === 'exact')
  if (exact.length > 1) {
    const withYear = exact.filter(s => s.yearMatch === true)
    const keep = withYear.length === 1 ? withYear[0].id : null
    for (const s of exact) if (s.id !== keep) s.confidence = 'likely'
    if (keep != null) {
      // The settled one goes first.
      scored.sort((a, b) => Number(b.id === keep) - Number(a.id === keep))
    }
  }
  return scored
}

// ─── Display ──────────────────────────────────────────────────────────────────

/** "12 h", "1.5 h", "45 min" — for an IGDB time-to-beat in seconds. */
export function formatLength(seconds: number | null | undefined): string | null {
  if (!seconds || seconds <= 0) return null
  const h = seconds / 3600
  if (h < 1) return `${Math.max(1, Math.round(seconds / 60))} min`
  if (h < 10) return `${Math.round(h * 2) / 2} h`
  return `${Math.round(h)} h`
}

export function igdbImage(imageId: string | null | undefined, size: 'cover_small' | 'cover_big' | 'thumb' = 'cover_big'): string | null {
  return imageId ? `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg` : null
}

/** The game's page on igdb.com. IGDB sends `url`; the slug is the fallback. */
export function igdbPageUrl(g: { igdb_url?: string | null; igdb_slug?: string | null }): string | null {
  if (g.igdb_url) return g.igdb_url
  return g.igdb_slug ? `https://www.igdb.com/games/${g.igdb_slug}` : null
}

// ─── Decisions ────────────────────────────────────────────────────────────────

export interface MatchDecision {
  /** exact → saved on its own · review → waits for a tick · none → nothing found. */
  status: 'exact' | 'review' | 'none'
  kind: 'steam' | 'exact' | null
  best: ScoredCandidate | null
  candidates: ScoredCandidate[]
}

export function decideMatch(t: MatchTarget, steam: IgdbCandidate | null, cands: IgdbCandidate[]): MatchDecision {
  if (steam) {
    const s = { ...scoreCandidate(t, steam), confidence: 'exact' as const }
    return { status: 'exact', kind: 'steam', best: s, candidates: [s] }
  }
  const ranked = rankCandidates(t, cands)
  const best = ranked[0] ?? null
  if (!best) return { status: 'none', kind: null, best: null, candidates: [] }
  if (best.confidence === 'exact') return { status: 'exact', kind: 'exact', best, candidates: ranked }
  return { status: 'review', kind: null, best, candidates: ranked }
}

/** What to type into IGDB's search for a library title. */
export function searchQuery(title: string): string {
  return title.replace(/[™®©]/g, '').replace(/\s*[([][^)\]]*[)\]]/g, ' ').replace(/\s+/g, ' ').trim()
}
