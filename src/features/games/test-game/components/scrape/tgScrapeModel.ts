// Pure decisions for the Scrape page: what the search form starts with, how a
// result compares with the game, what each field and media type defaults to,
// and what a save will do. Type imports + import-free pure modules only, so
// scripts/verify-tg-scrape-model.cjs can require it through sucrase.

import type { Game, GamePlatform } from '../../../types'
import type { FieldPolicy, MatchBasis, SsCandidate, SsField, SsMediaEntry, SsPrefs, SsRomQuery } from '../../../scraper/ssTypes'
import { ALL_FIELDS, EXACT_BASES, FIELD_COLUMN, FIELD_LABEL, FIELD_MEDIA, isEmptyValue, mediaModeFor, romFileName, sameValue } from '../../../scraper/ssPlan'
import { MEDIA_GROUPS, MEDIA_TYPES, canStore, mediaInfo, type MediaGroup, type MediaMode, type MediaTypeInfo } from '../../../scraper/ssMediaCatalog'
import { pickMediaEntry } from '../../../scraper/ssRules'

// ─── Words ───────────────────────────────────────────────────────────────────

/** Per-file choices, in words a non-expert reads right: a small copy in your
 *  storage, shown online from ScreenScraper (no storage), or ignored. */
export const MODE_LABEL: Record<MediaMode, string> = { store: 'Copy', on_demand: 'Online', skip: 'Skip' }
export const MODE_HINT: Record<MediaMode, string> = {
  store: 'Keeps a small copy in your storage',
  on_demand: 'Shown from ScreenScraper when you look at it — uses no storage',
  skip: 'Ignored',
}

// ─── The search form ─────────────────────────────────────────────────────────

export type SearchBy = 'name' | 'rom' | 'both'

export interface SearchForm {
  name: string
  /** ES-DE folder name ("snes") or a ScreenScraper id as text; '' = any system. */
  system: string
  filename: string
  size: string
  crc: string
  md5: string
  sha1: string
  serial: string
  jeuId: string
  /** The id is the game's previous match (prefilled, untouched) — labelled so. */
  previousId: boolean
  useName: boolean
  useRom: boolean
}

export const EMPTY_FORM: SearchForm = {
  name: '', system: '', filename: '', size: '', crc: '', md5: '', sha1: '', serial: '', jeuId: '', previousId: false,
  useName: true, useRom: true,
}

export const primaryVariant = (g: Pick<Game, 'platforms'> | null | undefined): GamePlatform | null =>
  g?.platforms?.find(p => p.is_primary_variant) ?? g?.platforms?.[0] ?? null

/** Matched on ScreenScraper — by this version (`ss_jeu_id`) or the old one. */
export const isScraped = (g: Pick<Game, 'external_source'> & { ss_jeu_id?: string | null }) =>
  !!g.ss_jeu_id || g.external_source === 'screenscraper'
/** The ScreenScraper id a game was matched to, if any. */
export const scrapedId = (g: Pick<Game, 'external_source' | 'external_ref'> & { ss_jeu_id?: string | null }) =>
  g.ss_jeu_id ?? (g.external_source === 'screenscraper' ? g.external_ref : null) ?? null

/** "Sonic The Hedgehog (USA, Europe) [!]" → "Sonic The Hedgehog": the region
 *  and dump tags help a filename match and hurt a name search. */
export const cleanSearchName = (t: string) => t.replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/\s+/g, ' ').trim()

/** What the form starts with for a game: its cleaned title, its system, its
 *  ROM filename, and the id of its previous match. */
export function formForGame(g: Game | null): SearchForm {
  if (!g) return { ...EMPTY_FORM, useRom: false }
  const p = primaryVariant(g)
  const filename = romFileName(p?.esde_path) ?? ''
  const prev = scrapedId(g) ?? ''
  return {
    ...EMPTY_FORM,
    name: cleanSearchName(g.title ?? ''),
    system: p?.esde_system ?? '',
    filename,
    jeuId: prev,
    previousId: !!prev,
    useRom: !!filename || !!prev,
  }
}

export const searchBy = (f: SearchForm): SearchBy => (f.useName && f.useRom ? 'both' : f.useRom ? 'rom' : 'name')
export const withSearchBy = (f: SearchForm, by: SearchBy): SearchForm =>
  ({ ...f, useName: by !== 'rom', useRom: by !== 'name' })

/** How many ROM fields hold something (the id counts: it is exact too). */
export function romFilled(f: SearchForm): number {
  return [f.filename, f.size, f.crc, f.md5, f.sha1, f.serial, f.jeuId].filter(v => v.trim()).length
}

export function formToRom(f: SearchForm): SsRomQuery | null {
  const rom: SsRomQuery = {
    filename: f.filename.trim() || null,
    size: f.size.trim() && Number.isFinite(Number(f.size)) ? Number(f.size) : null,
    crc: f.crc.trim() || null, md5: f.md5.trim() || null, sha1: f.sha1.trim() || null, serial: f.serial.trim() || null,
  }
  return Object.values(rom).some(v => v != null) ? rom : null
}

const HEX = { crc: [8, /^[0-9a-f]{8}$/i], md5: [32, /^[0-9a-f]{32}$/i], sha1: [40, /^[0-9a-f]{40}$/i] } as const

/** Field-level problems, shown under each input as it is typed. */
export function fieldErrors(f: SearchForm): Partial<Record<'crc' | 'md5' | 'sha1' | 'jeuId', string>> {
  const out: Partial<Record<'crc' | 'md5' | 'sha1' | 'jeuId', string>> = {}
  for (const k of ['crc', 'md5', 'sha1'] as const) {
    const v = f[k].trim()
    if (v && !HEX[k][1].test(v)) out[k] = `${HEX[k][0]} characters, 0-9 and a-f`
  }
  if (f.jeuId.trim() && !/^\d{1,10}$/.test(f.jeuId.trim())) out.jeuId = 'Digits only'
  return out
}

/** Why Search cannot run yet (the button stays disabled and says so). */
export function formProblem(f: SearchForm): string | null {
  if (Object.keys(fieldErrors(f)).length) return 'Fix the highlighted ROM info first.'
  const hasName = f.useName && f.name.trim().length > 0
  const hasRom = f.useRom && romFilled(f) > 0
  if (!hasName && !hasRom) return f.useRom && !f.useName ? 'Add ROM info (a file name, a hash or an id) — or search by name.' : 'Type a name to search for.'
  return null
}

/** The request a form makes. The id belongs to the ROM side: "by name only"
 *  searches without the previous match's anchor. */
export function formToRequest(f: SearchForm) {
  return {
    name: f.useName ? f.name.trim() : undefined,
    system: f.system || null,
    rom: f.useRom ? formToRom(f) : null,
    jeu_id: f.useRom && f.jeuId.trim() ? f.jeuId.trim() : undefined,
    previous_id: f.useRom && f.previousId,
    use_name: f.useName, use_rom: f.useRom,
  }
}

// ─── Results ─────────────────────────────────────────────────────────────────

export const BASIS_LABEL: Record<MatchBasis, string> = {
  hash: 'Exact ROM', filename: 'ROM file', filename_guess: 'File name guess', serial: 'Serial',
  id: 'ScreenScraper id', previous: 'Previous match', name: 'Name match',
}
/** Found by what identifies the ROM (or entry) itself, not a similar name. */
export const isExact = (c: Pick<SsCandidate, 'matched_by'>) => c.matched_by.some(b => EXACT_BASES.includes(b))

export function candidateLine(c: SsCandidate): string {
  return [c.system.name, c.values.release_year].filter(v => v != null && v !== '').join(' · ')
}

/** "42 images & files" — what the entry has, counting every region. */
export function mediaCount(c: Pick<SsCandidate, 'media'>): string {
  const n = c.media.length
  return `${n} image${n === 1 ? '' : 's'} & files`
}
export const playersText = (p: unknown) => (p ? `${p} player${String(p) === '1' ? '' : 's'}` : null)

// ─── Values on screen ────────────────────────────────────────────────────────

export function display(v: unknown, field?: SsField): string {
  if (isEmptyValue(v)) return '—'
  if (field === 'rating' && typeof v === 'number') return `${Math.round(v / 5 * 10) / 10}/20`
  if (field === 'rom_status' && v === 'verified') return 'Verified by hash'
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(1)
  return String(v)
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

// ─── Field review ────────────────────────────────────────────────────────────

export interface FieldRow {
  field: SsField
  label: string
  /** The game's value now (a URL for image fields). */
  current: unknown
  /** Theirs (for image fields: the media type when a file exists). */
  theirs: unknown
  isImage: boolean
  currentEmpty: boolean
  theirsEmpty: boolean
  same: boolean
}

/** Every field, the game's value beside theirs. Image fields ask "is there a
 *  file of that type", since the copy is only made on save. A variant field
 *  is left out when the game has no platform row to write it to. */
export function fieldRows(game: Game, cand: SsCandidate): FieldRow[] {
  const platform = primaryVariant(game)
  return ALL_FIELDS
    .filter(field => FIELD_COLUMN[field].table === 'games' || !!platform)
    .map(field => {
      const { table, column } = FIELD_COLUMN[field]
      const row = (table === 'games' ? game : platform) as unknown as Record<string, unknown> | null
      const current = row ? row[column] : null
      const mediaType = FIELD_MEDIA[field]
      const theirs = mediaType ? (cand.media.some(m => m.type === mediaType) ? mediaType : null) : cand.values[field] ?? null
      return {
        field, label: FIELD_LABEL[field], current, theirs, isImage: !!mediaType,
        currentEmpty: isEmptyValue(current), theirsEmpty: isEmptyValue(theirs),
        same: !mediaType && sameValue(current, theirs),
      }
    })
}

/** The segmented choice a field row starts on. "Keep" is skip; a fill that
 *  would do nothing (the game already has a value) reads as Keep too. */
export type FieldChoice = 'keep' | 'fill' | 'replace'
export function initialChoice(row: FieldRow, policy: FieldPolicy): FieldChoice {
  if (row.theirsEmpty || row.same) return 'keep'
  if (policy === 'replace') return 'replace'
  if (policy === 'fill' && row.currentEmpty) return 'fill'
  return 'keep'
}
export const choiceToPolicy = (c: FieldChoice): FieldPolicy => (c === 'keep' ? 'skip' : c)
/** The choice that writes this row (Fill on an empty field, Replace otherwise). */
export const writingChoice = (row: FieldRow): FieldChoice => (row.currentEmpty ? 'fill' : 'replace')

/** Will this row change the game? (an image field only when its media is copied) */
export function writes(row: FieldRow, choice: FieldChoice, mediaMode?: MediaMode): boolean {
  if (choice === 'keep' || row.theirsEmpty || row.same) return false
  if (row.isImage && mediaMode !== 'store') return false
  return choice === 'replace' || row.currentEmpty
}

// ─── Media review ────────────────────────────────────────────────────────────

export interface MediaRow {
  type: string
  info: MediaTypeInfo
  /** Every file of this type (regions, discs). */
  entries: SsMediaEntry[]
  /** The one that would be used, in the user's region order. */
  chosen: SsMediaEntry
  mode: MediaMode
  canStore: boolean
}

const CATALOG_ORDER = new Map(MEDIA_TYPES.map((t, i) => [t.type, i]))

/** The candidate's media, one row per type, in catalogue order. */
export function mediaRows(cand: SsCandidate, prefs: SsPrefs): MediaRow[] {
  const types = [...new Set(cand.media.map(m => m.type))]
  return types
    .sort((a, b) => (CATALOG_ORDER.get(a) ?? 999) - (CATALOG_ORDER.get(b) ?? 999) || a.localeCompare(b))
    .map(type => {
      const entries = cand.media.filter(m => m.type === type)
      const mode = mediaModeFor(prefs, type)
      return {
        type, info: mediaInfo(type), entries,
        chosen: pickMediaEntry(entries, type, prefs.regions) ?? entries[0],
        mode: mode === 'store' && !canStore(type) ? 'on_demand' : mode,
        canStore: canStore(type),
      }
    })
}

export function groupMediaRows(rows: MediaRow[]): { key: MediaGroup; label: string; rows: MediaRow[] }[] {
  return MEDIA_GROUPS.map(g => ({ ...g, rows: rows.filter(r => r.info.group === g.key) })).filter(g => g.rows.length)
}

/** A copy's likely size: their original, capped at what a resized copy of
 *  that type usually weighs (measured: box art 24-61 KB at 640 px). */
const TYPICAL_STORED: Record<string, number> = { fanart: 140_000, 'box-texture': 180_000, 'wheel-hd': 20_000, wheel: 20_000 }
export function estimateStored(entry: SsMediaEntry, scale: number): number {
  const typical = (TYPICAL_STORED[entry.type] ?? 70_000) * (scale === 0 ? 4 : scale * scale)
  return entry.size ? Math.min(entry.size, typical) : typical
}

export interface ApplySummary { fields: number; store: number; onDemand: number; skip: number; bytes: number }

export function applySummary(
  rows: FieldRow[], choices: Partial<Record<SsField, FieldChoice>>,
  media: { row: MediaRow; mode: MediaMode; entry: SsMediaEntry }[], scale: number,
): ApplySummary {
  const modeOf = (type: string) => media.find(m => m.row.type === type)?.mode
  const fields = rows.filter(r => writes(r, choices[r.field] ?? 'keep', r.isImage ? modeOf(FIELD_MEDIA[r.field]!) : undefined)).length
  const s: ApplySummary = { fields, store: 0, onDemand: 0, skip: 0, bytes: 0 }
  for (const m of media) {
    if (m.mode === 'store') { s.store++; s.bytes += estimateStored(m.entry, scale) }
    else if (m.mode === 'on_demand') s.onDemand++
    else s.skip++
  }
  return s
}

/** "5 fields · 3 images copied (≈ 180 KB) · 9 shown online" */
export function summaryText(s: ApplySummary): string {
  const parts = [
    s.fields ? `${s.fields} field${s.fields === 1 ? '' : 's'}` : null,
    s.store ? `${s.store} image${s.store === 1 ? '' : 's'} copied (≈ ${formatBytes(s.bytes)})` : null,
    s.onDemand ? `${s.onDemand} shown online` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Nothing selected to save'
}
