// The pure core of the ScreenScraper scraper: credential scrubbing, response
// normalization and field mapping.
//
// Import-free apart from its sibling pure modules, so a plain node script
// (scripts/verify-screenscraper-v2.cjs) can require it through sucrase, and
// scripts/sync-screenscraper-shared.mjs can copy it into both edge functions,
// which cannot import from src/. **Edit here, then run the sync script.**
//
// Every field name below comes from real captured responses and client source
// (ES-DE, Skyscraper, RomM, Batocera, Recalbox), recorded in
// docs/games/screenscraper-integration.md §16 — not guessed.

import type { MatchBasis, MediaEndpoint, SsCandidate, SsLocalized, SsMediaEntry, SsRomInfo } from './ssTypes'

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>

// ─── Security ────────────────────────────────────────────────────────────────

/**
 * Removes every credential value from a string. ScreenScraper puts
 * devid/devpassword/ssid/sspassword in the query string of every URL it
 * returns — media, hack downloads, and the `header.commandRequested` echo — so
 * any message that quotes one would carry them. Substring replacement, not URL
 * parsing, so a truncated or malformed URL is masked too. Short secrets are
 * skipped: masking every "1" would destroy the message and protect nothing.
 */
export function scrubSecrets(text: string, secrets: (string | undefined | null)[]): string {
  let out = String(text ?? '')
  for (const s of secrets) {
    if (!s || s.length < 4) continue
    out = out.split(s).join('[REDACTED]')
  }
  return out.replace(/\b(devid|devpassword|ssid|sspassword)=[^&\s"']*/gi, '$1=[REDACTED]')
}

const CREDENTIAL_PARAM = /\b(devid|devpassword|ssid|sspassword)=/i
const URL_KEYS = new Set(['url', 'downloadurl', 'commandRequested'])

/** Caps for arrays that can run long on a popular game. */
export const SNAPSHOT_CAPS: Record<string, number> = { roms: 300, hacks: 50, medias: 500, actions: 50, tips: 100 }

/**
 * A deep copy of a ScreenScraper payload with every URL removed — the only
 * form in which any part of their answer may be stored or sent to a browser.
 * Drops URL keys outright and any other string that carries a credential
 * parameter, so a URL hiding under a key nobody anticipated is still caught.
 */
export function stripCredentials(value: unknown, depth = 0): unknown {
  if (depth > 12) return null
  if (typeof value === 'string') return CREDENTIAL_PARAM.test(value) ? null : value
  if (Array.isArray(value)) return value.map(v => stripCredentials(v, depth + 1))
  if (value && typeof value === 'object') {
    const out: Rec = {}
    for (const [k, v] of Object.entries(value as Rec)) {
      if (URL_KEYS.has(k)) continue
      let next = v
      if (Array.isArray(v) && SNAPSHOT_CAPS[k] != null && v.length > SNAPSHOT_CAPS[k]) next = v.slice(0, SNAPSHOT_CAPS[k])
      const clean = stripCredentials(next, depth + 1)
      if (clean !== null && clean !== undefined) out[k] = clean
    }
    return out
  }
  return value
}

// ─── Small readers ───────────────────────────────────────────────────────────

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  if (typeof v === 'object') return str((v as Rec).text)
  const s = String(v).trim()
  return s ? s : null
}
const num = (v: unknown): number | null => {
  const s = str(v)
  if (s == null) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
/** Their flags arrive as "1"/"0", "true"/"false", or real booleans. */
const flag = (v: unknown): boolean => {
  const s = String(v ?? '').trim().toLowerCase()
  return s === '1' || s === 'true' || v === true
}
const arr = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter(e => e && typeof e === 'object') as Rec[] : [])

/** `[{region|langue, text}]` → `{key, text}` list, blanks dropped. */
export function localizedList(list: unknown, key: 'region' | 'langue' | 'type'): SsLocalized[] {
  const out: SsLocalized[] = []
  for (const e of arr(list)) {
    const text = str(e.text)
    if (!text) continue
    out.push({ key: String(e[key] ?? '').trim().toLowerCase(), text })
  }
  return out
}

/** First entry in preference order, then any. `familles` often exists only in
 *  French — falling back to any language keeps a real value instead of none. */
export function pickPreferred(list: SsLocalized[], prefer: string[]): SsLocalized | null {
  for (const want of prefer) {
    const hit = list.find(e => e.key === want.toLowerCase())
    if (hit) return hit
  }
  return list[0] ?? null
}

/** Group arrays (genres, modes, familles, numeros, themes, styles): each entry
 *  carries its own localized `noms`. `principale: "1"` leads. */
export function groupNames(list: unknown, languages: string[]): string[] {
  const items = arr(list).map(g => ({
    primary: flag(g.principale),
    name: pickPreferred(localizedList(g.noms, 'langue'), languages)?.text ?? null,
  })).filter((g): g is { primary: boolean; name: string } => !!g.name)
  const ordered = [...items.filter(g => g.primary), ...items.filter(g => !g.primary)]
  return [...new Set(ordered.map(g => g.name))]
}

// ─── Dates, ratings ──────────────────────────────────────────────────────────

/** Earliest year across every regional date: the game's first release. */
export function earliestYear(dates: SsLocalized[]): number | null {
  const years = dates.map(d => /^(\d{4})/.exec(d.text)?.[1]).map(Number).filter(y => y >= 1950 && y <= 2100)
  return years.length ? Math.min(...years) : null
}

/**
 * A full `YYYY-MM-DD` for the platform variant: the one for the ROM's own
 * region when there is one (this copy's release), else the earliest full date.
 * A year-only value is never padded into a fake day.
 */
export function releaseDateFor(dates: SsLocalized[], romRegions: string[], regionOrder: string[]): string | null {
  const full = dates.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d.text))
  if (!full.length) return null
  for (const r of [...romRegions, ...regionOrder]) {
    const hit = full.find(d => d.key === r.toLowerCase())
    if (hit) return hit.text
  }
  return [...full].sort((a, b) => a.text.localeCompare(b.text))[0].text
}

/** `note.text` is out of TWENTY; game_platforms.rating is 0-100. */
export function note20(note: unknown): number | null {
  const n = num(note)
  return n != null && n >= 0 && n <= 20 ? n : null
}
export const rating100 = (n20: number | null): number | null => (n20 == null ? null : Math.round(n20 * 50) / 10)

/** PEGI first (a European library), then ESRB, CERO, USK, then theirs. */
export function ageRating(classifications: SsLocalized[]): string | null {
  for (const t of ['pegi', 'esrb', 'cero', 'usk', 'ss']) {
    const hit = classifications.find(c => c.key === t)
    if (hit) return `${t.toUpperCase()} ${hit.text}`
  }
  const any = classifications[0]
  return any ? `${any.key.toUpperCase()} ${any.text}`.trim() : null
}

// ─── ROMs ────────────────────────────────────────────────────────────────────

const ROM_FLAGS = ['beta', 'demo', 'proto', 'trad', 'hack', 'unl', 'alt', 'best', 'netplay'] as const

/** Their ROM regions/languages come as parallel arrays (`regions_shortname`),
 *  or on older payloads as one comma-separated string. */
function shortnames(block: unknown, legacy: unknown, key: string): string[] {
  const b = block as Rec | undefined
  const list = b && Array.isArray(b[key]) ? b[key] : null
  if (list) return list.map((x: unknown) => String(x).trim().toLowerCase()).filter(Boolean)
  const s = str(legacy)
  return s ? s.split(',').map(x => x.trim().toLowerCase()).filter(Boolean) : []
}

export function romInfo(rom: unknown): SsRomInfo | null {
  if (!rom || typeof rom !== 'object') return null
  const r = rom as Rec
  const flags = ROM_FLAGS.filter(f => flag(r[f] ?? r[`rom${f}`]))
  const info: SsRomInfo = {
    id: str(r.id),
    filename: str(r.romfilename),
    size: num(r.romsize),
    crc: str(r.romcrc),
    md5: str(r.rommd5),
    sha1: str(r.romsha1),
    serial: str(r.romserial),
    type: str(r.romtype),
    support_type: str(r.romsupporttype),
    disc: str(r.romnumsupport),
    discs: str(r.romtotalsupport),
    regions: shortnames(r.regions, r.romregions, 'regions_shortname'),
    languages: shortnames(r.langues, r.romlangues, 'langues_shortname'),
    flags: [...flags],
    clone_of: str(r.romcloneof) === '0' ? null : str(r.romcloneof),
  }
  return info
}

// ─── Media inventory ─────────────────────────────────────────────────────────

const ENDPOINTS: Record<string, MediaEndpoint> = {
  'mediajeu.php': 'img', 'mediavideojeu.php': 'video', 'mediamanueljeu.php': 'manual',
}
/** `box-2D(us)`, `support-2D(eu)[1]`, `fanart`, `maps(1,0)` — nothing else. */
export const MEDIA_TOKEN = /^[A-Za-z0-9-]{1,40}(\([A-Za-z0-9,]{1,12}\))?(\[\d{1,2}\])?$/

/**
 * The endpoint and token of a media URL, read server-side before the URL is
 * thrown away. The token is exactly what their `media` parameter wants, so
 * the proxy can ask for the same file later without ever storing the URL.
 */
export function mediaRef(url: unknown): { ep: MediaEndpoint; token: string } | null {
  if (typeof url !== 'string') return null
  let u: URL
  try { u = new URL(url) } catch { return null }
  const file = u.pathname.split('/').pop()?.toLowerCase() ?? ''
  const ep = ENDPOINTS[file]
  const token = u.searchParams.get('media') ?? ''
  if (!ep || !MEDIA_TOKEN.test(token)) return null
  return { ep, token }
}

/** The game's own files (`parent: jeu`), without URLs. Pictograms for genres,
 *  publishers and ratings share the array under other parents and are left out. */
export function mediaInventory(medias: unknown): SsMediaEntry[] {
  const out: SsMediaEntry[] = []
  for (const m of arr(medias)) {
    const parent = str(m.parent)
    if (parent && parent !== 'jeu') continue
    const ref = mediaRef(m.url)
    const type = str(m.type)
    if (!ref || !type) continue
    out.push({
      type, region: str(m.region)?.toLowerCase() ?? null, support: str(m.support),
      format: str(m.format)?.toLowerCase() ?? null, size: num(m.size),
      crc: str(m.crc), md5: str(m.md5), sha1: str(m.sha1), token: ref.token, ep: ref.ep,
    })
  }
  return out
}

/** One file of a type, in region order: the wanted regions, then world, their
 *  own, then anything. First disc before later ones. */
export function pickMediaEntry(inventory: SsMediaEntry[], type: string, regions: string[]): SsMediaEntry | null {
  const same = inventory.filter(m => m.type === type)
  if (!same.length) return null
  const disc = (m: SsMediaEntry) => (m.support == null || m.support === '1' ? 0 : 1)
  const order = [...regions.map(r => r.toLowerCase()), 'wor', 'ss']
  const rank = (m: SsMediaEntry) => {
    const i = m.region ? order.indexOf(m.region) : order.length
    return (i < 0 ? order.length + 1 : i) * 2 + disc(m)
  }
  return [...same].sort((a, b) => rank(a) - rank(b))[0]
}

// ─── The candidate ───────────────────────────────────────────────────────────

export interface MapOptions { regions: string[]; languages: string[] }

/** What a match tells us about itself: not a game, a hack, a beta, a clone. */
export function candidateFlags(jeu: Rec, rom: SsRomInfo | null): string[] {
  const flags: string[] = []
  if (flag(jeu.notgame)) flags.push('not a game')
  if (rom) flags.push(...rom.flags.filter(f => f !== 'best'))
  if (rom?.flags.includes('best')) flags.push('best dump')
  const clone = str(jeu.cloneof)
  if (clone && clone !== '0') flags.push('clone')
  return flags
}

/** Their names for non-games carry a `ZZZ(notgame):` prefix. */
const cleanName = (s: string) => s.replace(/^ZZZ\(notgame\):\s*/i, '').trim()

/**
 * `response.jeu` (or one `response.jeux[]` entry) → the normalized candidate
 * the browser sees. Values are picked in the user's own region/language order;
 * every variant is kept alongside so the review can show all of them.
 */
export function toCandidate(jeu: Rec, matchedBy: MatchBasis[], opts: MapOptions, maxRoms = 20): SsCandidate {
  const names = localizedList(jeu.noms, 'region').map(n => ({ ...n, text: cleanName(n.text) }))
  const synopses = localizedList(jeu.synopsis, 'langue')
  const dates = localizedList(jeu.dates, 'region')
  const classifications = localizedList(jeu.classifications, 'type')
  const rom = romInfo(jeu.rom)
  const roms = arr(jeu.roms).map(romInfo).filter((r): r is SsRomInfo => !!r)
  const n20 = note20(jeu.note)
  const genres = groupNames(jeu.genres, opts.languages)
  const modes = groupNames(jeu.modes, opts.languages)
  const families = groupNames(jeu.familles, opts.languages)
  const title = pickPreferred(names, ['ss', ...opts.regions])?.text ?? null
  const description = pickPreferred(synopses, opts.languages)?.text ?? null

  return {
    jeu_id: String(jeu.id ?? ''),
    rom_id: str(jeu.romid),
    system: { id: num((jeu.systeme as Rec | undefined)?.id), name: str(jeu.systeme) },
    matched_by: matchedBy,
    values: {
      title,
      description,
      release_year: earliestYear(dates),
      publisher: str(jeu.editeur),
      developer: str(jeu.developpeur),
      genres: genres.length ? genres : null,
      modes: modes.length ? modes : null,
      players: str(jeu.joueurs),
      age_rating: ageRating(classifications),
      series_name: families[0] ?? null,
      release_date: releaseDateFor(dates, rom?.regions ?? [], opts.regions),
      region: rom?.regions.length ? rom.regions.join(', ') : null,
      rating: rating100(n20),
    },
    names, synopses, dates, classifications,
    genres, modes, families,
    numbers: groupNames(jeu.numeros, opts.languages),
    themes: groupNames(jeu.themes, opts.languages),
    styles: groupNames(jeu.styles, opts.languages),
    note20: n20,
    top_staff: flag(jeu.topstaff),
    not_a_game: flag(jeu.notgame),
    rotation: str(jeu.rotation) === '0' ? null : str(jeu.rotation),
    resolution: str(jeu.resolution),
    clone_of: str(jeu.cloneof) === '0' ? null : str(jeu.cloneof),
    rom,
    roms: roms.slice(0, maxRoms),
    roms_total: roms.length,
    hacks_total: arr(jeu.hacks).length,
    actions_total: arr(jeu.actions).length,
    flags: candidateFlags(jeu, rom),
    media: mediaInventory(jeu.medias),
    media_sig: null,
  }
}

/**
 * The user picked a specific regional title or description language in the
 * review. Only an existing variant can be picked — an unknown key changes
 * nothing, so a stale choice never blanks a field.
 */
export function withOverrides(c: SsCandidate, o: { titleRegion?: string | null; descriptionLang?: string | null } | null | undefined): SsCandidate {
  if (!o) return c
  const title = o.titleRegion ? c.names.find(n => n.key === o.titleRegion)?.text : undefined
  const description = o.descriptionLang ? c.synopses.find(s => s.key === o.descriptionLang)?.text : undefined
  if (title === undefined && description === undefined) return c
  return { ...c, values: { ...c.values, ...(title !== undefined ? { title } : {}), ...(description !== undefined ? { description } : {}) } }
}

/** A jeuRecherche with no hit answers `jeux: [{}]` — an entry without an id is no entry. */
export const isRealJeu = (j: unknown): j is Rec => !!j && typeof j === 'object' && str((j as Rec).id) != null

// ─── Their plain-text answers ────────────────────────────────────────────────

export type SsTextKind = 'not_found' | 'no_media' | 'unchanged' | 'login' | 'quota' | 'closed' | 'busy' | 'bad_request' | 'other'

/**
 * ScreenScraper answers errors in plain text, often with HTTP 200 (a failed
 * login is a 200 whose body reads "Erreur de login…"), so the BODY decides.
 */
export function classifyText(status: number, body: string): SsTextKind {
  const b = body.toLowerCase()
  if (/^\s*(crc|md5|sha1)ok\b/.test(b)) return 'unchanged'
  if (/^\s*nomedia\b/.test(b)) return 'no_media'
  if (status === 404 || /non trouv/.test(b)) return 'not_found'
  if (status === 403 || /erreur de login|identifiants/.test(b)) return 'login'
  if (status === 430 || status === 431 || /quota/.test(b)) return 'quota'
  if (status === 423 || status === 401 || /ferm|closed/.test(b)) return 'closed'
  if (status === 429 || /thread|trop de|too many/.test(b)) return 'busy'
  if (status === 400 || /champs obligatoires|manque/.test(b)) return 'bad_request'
  return 'other'
}

export const TEXT_MESSAGE: Record<SsTextKind, string> = {
  not_found: 'ScreenScraper has no entry for that.',
  no_media: 'ScreenScraper has no such file for this game.',
  unchanged: 'Unchanged since last time.',
  login: 'ScreenScraper refused the login — check the four SCREENSCRAPER_* secrets.',
  quota: "Today's ScreenScraper allowance is used up; it resets at midnight CET.",
  closed: 'ScreenScraper is closed right now (their servers are overloaded) — try again later.',
  busy: 'ScreenScraper is busy (too many requests at once) — try again in a moment.',
  bad_request: 'ScreenScraper rejected the request as incomplete.',
  other: 'ScreenScraper answered with an error.',
}
