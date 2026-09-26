// The pure decisions around a scrape: which lookups a search runs, how their
// answers merge, what the user's saved preferences mean, and what an apply
// writes. Import-free apart from sibling pure modules; copied into the edge
// function by scripts/sync-screenscraper-shared.mjs. **Edit here, then run it.**

import type { FieldPolicy, MatchBasis, SsCandidate, SsField, SsPrefs, SsRomQuery } from './ssTypes'
import { MEDIA_TYPES, mediaInfo, type MediaMode } from './ssMediaCatalog'

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>

// ─── Fields ──────────────────────────────────────────────────────────────────

export const GAME_FIELDS = [
  'title', 'description', 'release_year', 'publisher', 'developer',
  'genres', 'modes', 'players', 'age_rating', 'series_name',
  'cover', 'screenshot', 'fanart',
] as const
export const PLATFORM_FIELDS = ['release_date', 'region', 'rating', 'wheel', 'version_title', 'rom_status'] as const
export const ALL_FIELDS: SsField[] = [...GAME_FIELDS, ...PLATFORM_FIELDS]

export const FIELD_LABEL: Record<SsField, string> = {
  title: 'Title', description: 'Description', release_year: 'Release year',
  publisher: 'Publisher', developer: 'Developer', genres: 'Genres', modes: 'Modes',
  players: 'Players', age_rating: 'Age rating', series_name: 'Series',
  cover: 'Cover', screenshot: 'Screenshot', fanart: 'Fan art',
  release_date: 'Release date (this version)', region: 'Region (this ROM)', rating: 'ScreenScraper score',
  wheel: 'Logo', version_title: 'Version (this ROM)', rom_status: 'ROM verified',
}

/** Field → the column it writes. Media fields take the chosen image's URL. */
export const FIELD_COLUMN: Record<SsField, { table: 'games' | 'game_platforms'; column: string }> = {
  title: { table: 'games', column: 'title' },
  description: { table: 'games', column: 'description' },
  release_year: { table: 'games', column: 'release_year' },
  publisher: { table: 'games', column: 'publisher' },
  developer: { table: 'games', column: 'developer' },
  genres: { table: 'games', column: 'genres' },
  modes: { table: 'games', column: 'modes' },
  players: { table: 'games', column: 'players' },
  age_rating: { table: 'games', column: 'age_rating' },
  series_name: { table: 'games', column: 'series_name' },
  cover: { table: 'games', column: 'primary_cover_url' },
  screenshot: { table: 'games', column: 'screenshot_url' },
  fanart: { table: 'games', column: 'fanart_url' },
  release_date: { table: 'game_platforms', column: 'release_date' },
  region: { table: 'game_platforms', column: 'region' },
  rating: { table: 'game_platforms', column: 'rating' },
  wheel: { table: 'game_platforms', column: 'wheel_url' },
  version_title: { table: 'game_platforms', column: 'version_title' },
  rom_status: { table: 'game_platforms', column: 'rom_status' },
}

/** Media field → the media type that supplies it. */
export const FIELD_MEDIA: Partial<Record<SsField, string>> = { cover: 'box-2D', screenshot: 'ss', fanart: 'fanart', wheel: 'wheel-hd' }

/** Media type → the ES-DE asset category that already holds the same picture.
 *  A type whose picture the handheld has already uploaded is not copied again
 *  by default (it would spend the budget on a duplicate). */
export const ESDE_CATEGORY: Record<string, string> = {
  'box-2D': 'covers', 'box-3D': '3dboxes', ss: 'screenshots', sstitle: 'titlescreens', fanart: 'fanart',
  'box-2D-back': 'backcovers', 'wheel-hd': 'marquees', 'support-2D': 'physicalmedia',
}

// ─── Preferences ─────────────────────────────────────────────────────────────

/** Every field fills gaps and never overwrites — the promise the old scraper
 *  made. Replacing is always an explicit choice, per field or per game. */
export function defaultPrefs(): SsPrefs {
  const fields = {} as Record<SsField, FieldPolicy>
  for (const f of ALL_FIELDS) fields[f] = 'fill'
  return {
    v: 1, fields, media: {}, imageScale: 1,
    // `ss` first: their canonical title ("Sonic The Hedgehog"), not a regional one.
    regions: ['ss', 'wor', 'eu', 'us', 'jp'],
    languages: ['en', 'fr', 'de', 'es', 'it', 'pt'],
    snapshot: true,
    budgetMb: 800,
  }
}

const POLICIES: FieldPolicy[] = ['fill', 'replace', 'skip']
const MODES: MediaMode[] = ['store', 'on_demand', 'skip']
const CODE = /^[a-z]{2,4}$/

/** Anything read from the database or a request, made safe to use: unknown
 *  keys dropped, bad values replaced by defaults, numbers clamped. */
export function normalizePrefs(raw: unknown): SsPrefs {
  const d = defaultPrefs()
  const r = (raw && typeof raw === 'object' ? raw : {}) as Rec
  const fields = { ...d.fields }
  for (const f of ALL_FIELDS) if (POLICIES.includes(r.fields?.[f])) fields[f] = r.fields[f]
  const media: Record<string, MediaMode> = {}
  if (r.media && typeof r.media === 'object') {
    for (const [t, m] of Object.entries(r.media as Rec)) {
      if (!/^[A-Za-z0-9-]{1,40}$/.test(t) || !MODES.includes(m as MediaMode)) continue
      // A manual or video can only stream; "store" is read as on-demand.
      media[t] = m === 'store' && mediaInfo(t).kind !== 'image' ? 'on_demand' : m as MediaMode
    }
  }
  const codes = (v: unknown, fallback: string[]) => {
    const list = Array.isArray(v) ? v.map(x => String(x).trim().toLowerCase()).filter(x => CODE.test(x)) : []
    return list.length ? [...new Set(list)].slice(0, 12) : fallback
  }
  const scale = Number(r.imageScale)
  const budget = Number(r.budgetMb)
  return {
    v: 1, fields, media,
    imageScale: scale === 0 ? 0 : Number.isFinite(scale) ? Math.min(2, Math.max(0.5, scale)) : d.imageScale,
    regions: codes(r.regions, d.regions),
    languages: codes(r.languages, d.languages),
    snapshot: typeof r.snapshot === 'boolean' ? r.snapshot : d.snapshot,
    budgetMb: Number.isFinite(budget) ? Math.min(100_000, Math.max(50, Math.round(budget))) : d.budgetMb,
  }
}

/** The mode a media type gets: the user's choice, else the catalogue default. */
export const mediaModeFor = (prefs: SsPrefs, type: string): MediaMode => prefs.media[type] ?? mediaInfo(type).mode

/** Width to ask for when storing; null = their original size. */
export function storeWidth(prefs: SsPrefs, type: string): number | null {
  if (prefs.imageScale === 0) return null
  const w = mediaInfo(type).width
  return w > 0 ? Math.round(w * prefs.imageScale) : null
}

/** How many catalogue types each mode ends up with — the settings summary. */
export function modeCounts(prefs: SsPrefs): Record<MediaMode, number> {
  const c: Record<MediaMode, number> = { store: 0, on_demand: 0, skip: 0 }
  for (const t of MEDIA_TYPES) c[mediaModeFor(prefs, t.type)]++
  return c
}

// ─── Search planning ─────────────────────────────────────────────────────────

export interface SearchInput {
  name?: string | null
  /** ScreenScraper numeric system id, when known. */
  systemId?: number | null
  rom?: SsRomQuery | null
  jeuId?: string | null
  useName?: boolean
  useRom?: boolean
}

export interface PlannedQuery { kind: MatchBasis; endpoint: 'jeuInfos.php' | 'jeuRecherche.php'; params: Record<string, string> }
export interface SearchPlan { queries: PlannedQuery[]; notes: { kind: MatchBasis; message: string }[] }

const HEX: Record<'crc' | 'md5' | 'sha1', RegExp> = { crc: /^[0-9a-f]{8}$/i, md5: /^[0-9a-f]{32}$/i, sha1: /^[0-9a-f]{40}$/i }

/** Their search ignores "the" and a trailing "+" and refuses under 4 characters. */
export function searchableLength(name: string): number {
  return name.toLowerCase().replace(/\bthe\b/g, '').replace(/\+\s*$/, '').replace(/\s+/g, ' ').trim().length
}

/** A filename exactly as `romnom` wants it: no directory, never a path. */
export function romFileName(path: string | null | undefined): string | null {
  if (typeof path !== 'string') return null
  const base = path.replace(/\\/g, '/').split('/').filter(s => s && s !== '.' && s !== '..').pop()?.trim()
  return base || null
}

/**
 * Which lookups one search runs. Up to four, all at once:
 *  - a game id → jeuInfos `gameid` (exact, no system needed);
 *  - a ROM hash → jeuInfos with every hash, the filename and size (their
 *    reference client sends all of them; a hash needs no system);
 *  - a serial → jeuInfos `serialnum`;
 *  - a filename without a hash → jeuInfos `romnom` — this one needs the system
 *    ("systemeid obligatoire si aucun CRC");
 *  - a name → jeuRecherche, up to 30 results, narrowed by system when known.
 * A lookup that cannot run is reported with the reason instead of silently
 * missing from the results.
 */
export function planSearch(input: SearchInput): SearchPlan {
  const queries: PlannedQuery[] = []
  const notes: SearchPlan['notes'] = []
  const sys = input.systemId != null && Number.isFinite(input.systemId) ? String(input.systemId) : null
  const withSys = (p: Record<string, string>) => (sys ? { ...p, systemeid: sys } : p)

  const jeuId = (input.jeuId ?? '').trim()
  if (jeuId) {
    if (/^\d{1,10}$/.test(jeuId)) queries.push({ kind: 'id', endpoint: 'jeuInfos.php', params: { gameid: jeuId } })
    else notes.push({ kind: 'id', message: 'A ScreenScraper id is digits only.' })
  }

  if (input.useRom !== false && input.rom) {
    const rom = input.rom
    const file = romFileName(rom.filename)
    const size = rom.size != null && Number.isFinite(Number(rom.size)) && Number(rom.size) > 0 ? String(Math.round(Number(rom.size))) : null
    const hashes: Record<string, string> = {}
    for (const k of ['crc', 'md5', 'sha1'] as const) {
      const v = (rom[k] ?? '').trim()
      if (!v) continue
      if (HEX[k].test(v)) hashes[k] = v.toLowerCase()
      else notes.push({ kind: 'hash', message: `That ${k.toUpperCase()} is not ${k === 'crc' ? 8 : k === 'md5' ? 32 : 40} hex characters, so it was not sent.` })
    }
    const base: Record<string, string> = { romtype: 'rom', ...(file ? { romnom: file } : {}), ...(size ? { romtaille: size } : {}) }
    if (Object.keys(hashes).length) {
      // A filename needs a system unless a CRC travels with it; an MD5/SHA1
      // alone identifies the dump, so without either the name is left out
      // rather than turning a good lookup into their 400.
      const hashBase = hashes.crc || sys ? base : { romtype: 'rom' }
      queries.push({ kind: 'hash', endpoint: 'jeuInfos.php', params: withSys({ ...hashBase, ...hashes }) })
    } else if (file) {
      if (sys) queries.push({ kind: 'filename', endpoint: 'jeuInfos.php', params: { ...base, systemeid: sys } })
      else notes.push({ kind: 'filename', message: 'A filename lookup needs a system — pick one, or add a CRC/MD5/SHA1.' })
    }
    const serial = (rom.serial ?? '').trim()
    if (serial) queries.push({ kind: 'serial', endpoint: 'jeuInfos.php', params: withSys({ serialnum: serial }) })
  }

  const name = (input.name ?? '').trim()
  if (input.useName !== false && name) {
    if (searchableLength(name) < 4) notes.push({ kind: 'name', message: 'ScreenScraper needs at least 4 letters to search by name ("the" does not count).' })
    else queries.push({ kind: 'name', endpoint: 'jeuRecherche.php', params: withSys({ recherche: name.slice(0, 120) }) })
  }
  return { queries, notes }
}

const BASIS_RANK: Record<MatchBasis, number> = { id: 0, hash: 1, serial: 2, filename: 3, previous: 4, filename_guess: 5, name: 6 }

/** Bases that prove which dump (or entry) this is — a batch may pre-tick these. */
export const EXACT_BASES: MatchBasis[] = ['hash', 'filename', 'serial', 'id']

/** "./roms/Sonic (USA).zip" → "sonic (usa)": the comparable part of a ROM name
 *  (their list may name the .zip or the file inside it). */
export function romStem(name: string | null | undefined): string | null {
  const base = romFileName(name)
  if (!base) return null
  return base.replace(/\.[A-Za-z0-9]{1,5}$/, '').trim().toLowerCase() || null
}

/**
 * Is a filename lookup's answer really about THIS file? ScreenScraper answers
 * an unknown filename with its best guess, which is how 604 games once landed
 * in ROM-hack collections. Verified only when their `rom` block names the same
 * file, on the system asked for, and — when sent — the same size/CRC.
 */
export function verifyFilenameMatch(
  query: { filename?: string | null; systemId?: number | null; size?: number | null; crc?: string | null },
  c: Pick<SsCandidate, 'rom' | 'system'>,
): boolean {
  const want = romStem(query.filename)
  if (!want || !c.rom) return false
  if (romStem(c.rom.filename) !== want) return false
  if (query.systemId != null && c.system.id != null && query.systemId !== c.system.id) return false
  if (query.size != null && c.rom.size != null && Number(query.size) !== c.rom.size) return false
  if (query.crc && c.rom.crc && query.crc.toLowerCase() !== c.rom.crc.toLowerCase()) return false
  return true
}

/**
 * Did a hash lookup really find THIS dump? ScreenScraper answers a hash it
 * does not know with its best guess by filename, so the answer counts as
 * exact only when its ROM carries one of the hashes asked for.
 */
export function verifyHashMatch(
  query: { crc?: string | null; md5?: string | null; sha1?: string | null },
  c: Pick<SsCandidate, 'rom'>,
): boolean {
  if (!c.rom) return false
  const eq = (a?: string | null, b?: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()
  return eq(query.crc, c.rom.crc) || eq(query.md5, c.rom.md5) || eq(query.sha1, c.rom.sha1)
}

/**
 * The stored-copy decision per media type for one game. A type is copied only
 * when that copy will be used: a field-backed type (box front → cover, …) only
 * when its field will be written, any other type only when the handheld has
 * not already uploaded the same picture — unless the user chose Copy for this
 * game explicitly in the review. Everything not copied is kept online.
 */
export function decideMediaModes(
  choices: { type: string; mode: 'store' | 'on_demand' }[],
  opts: { explicit: boolean; fieldWrites: Partial<Record<SsField, boolean>>; esdeCategories: string[] },
): Record<string, 'store' | 'on_demand'> {
  const out: Record<string, 'store' | 'on_demand'> = {}
  const fieldOf = Object.fromEntries(Object.entries(FIELD_MEDIA).map(([f, t]) => [t, f as SsField]))
  for (const c of choices) {
    if (c.mode !== 'store' || opts.explicit) { out[c.type] = c.mode; continue }
    const field = fieldOf[c.type]
    if (field) { out[c.type] = opts.fieldWrites[field] ? 'store' : 'on_demand'; continue }
    const cat = ESDE_CATEGORY[c.type]
    out[c.type] = cat && opts.esdeCategories.includes(cat) ? 'on_demand' : 'store'
  }
  return out
}

/**
 * One list from several lookups: an entry found more than once is shown once,
 * carrying every way it was found; exact matches (id, hash, serial, filename)
 * lead, then name results in their own relevance order.
 */
export function mergeCandidates(groups: { kind: MatchBasis; items: SsCandidate[] }[]): SsCandidate[] {
  const byId = new Map<string, SsCandidate & { _order: number }>()
  let order = 0
  for (const g of [...groups].sort((a, b) => BASIS_RANK[a.kind] - BASIS_RANK[b.kind])) {
    for (const c of g.items) {
      if (!c.jeu_id) continue
      const seen = byId.get(c.jeu_id)
      if (!seen) {
        byId.set(c.jeu_id, { ...c, matched_by: [...new Set([...c.matched_by, g.kind])], _order: order++ })
        continue
      }
      seen.matched_by = [...new Set([...seen.matched_by, g.kind])]
      // A ROM lookup's copy knows which dump matched; a name result does not.
      if (!seen.rom && c.rom) { seen.rom = c.rom; seen.rom_id = c.rom_id; seen.values = { ...seen.values, region: c.values.region, release_date: c.values.release_date }; seen.flags = c.flags }
    }
  }
  const best = (c: SsCandidate) => Math.min(...c.matched_by.map(k => BASIS_RANK[k]))
  return [...byId.values()]
    .sort((a, b) => best(a) - best(b) || a._order - b._order)
    .map(({ _order, ...c }) => { void _order; return c })
}

// ─── Apply ───────────────────────────────────────────────────────────────────

export const isEmptyValue = (v: unknown) =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)

/** Order-sensitive equality for what a scrape writes (strings, numbers, text arrays). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameValue(x, b[i]))
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b)
  return false
}

export interface PatchPlan {
  /** column → new value, per table */
  games: Rec
  platform: Rec
  /** field → what the column held before (null when empty) — for undo */
  prior: Partial<Record<SsField, unknown>>
  written: SsField[]
  skipped: { field: SsField; reason: 'policy' | 'has_value' | 'no_value' | 'same' }[]
}

/**
 * What an apply writes, field by field. `fill` writes only into an empty
 * column; `replace` overwrites; `skip` never writes. An unchanged value is not
 * a write (it would only make undo think it had something to restore).
 */
export function planPatch(
  current: { games: Rec; platform: Rec | null },
  values: Partial<Record<SsField, unknown>>,
  policies: Partial<Record<SsField, FieldPolicy>>,
): PatchPlan {
  const plan: PatchPlan = { games: {}, platform: {}, prior: {}, written: [], skipped: [] }
  for (const field of ALL_FIELDS) {
    const policy = policies[field] ?? 'skip'
    const next = values[field]
    if (policy === 'skip') { if (!isEmptyValue(next)) plan.skipped.push({ field, reason: 'policy' }); continue }
    if (isEmptyValue(next)) { plan.skipped.push({ field, reason: 'no_value' }); continue }
    const { table, column } = FIELD_COLUMN[field]
    const row = table === 'games' ? current.games : current.platform
    if (!row) { plan.skipped.push({ field, reason: 'no_value' }); continue }
    const cur = row[column]
    if (policy === 'fill' && !isEmptyValue(cur)) { plan.skipped.push({ field, reason: 'has_value' }); continue }
    if (sameValue(cur, next)) { plan.skipped.push({ field, reason: 'same' }); continue }
    ;(table === 'games' ? plan.games : plan.platform)[column] = next
    plan.prior[field] = isEmptyValue(cur) ? null : cur
    plan.written.push(field)
  }
  return plan
}
