// screenscraper-sync — search ScreenScraper, then save exactly what the user
// chose from a result: fields, artwork, and their full record.
//
// Rewritten from scratch (2026-09-25). Browser-JWT auth (verify_jwt ON): the
// caller is resolved from their token and every read and write is scoped to
// them. The pure logic — normalization, search planning, field policies,
// credential stripping, media signing — lives in src/features/games/scraper/
// and is copied into the `<ss-shared>` region below by
// scripts/sync-screenscraper-shared.mjs. Edit it there.
//
// ── Actions ─────────────────────────────────────────────────────────────────
//  status          account, quota, library counts, storage usage
//  storage         storage usage only (no ScreenScraper request)
//  refresh_systems cache their system list (ES-DE folder → numeric id)
//  search          name and/or ROM (filename, size, CRC/MD5/SHA1, serial)
//                  and/or ScreenScraper id — all at once, merged
//  candidate       one entry in full, with its complete record
//  apply           write one chosen entry to one game, as chosen
//  find_batch      best match for up to 10 games (no writes)
//  apply_batch     apply with the saved defaults, up to 5 games
//  undo            take a whole apply run back
//  sweep_pending   delete the old scraper's review quarantine
//
// ── Security, all load-bearing ─────────────────────────────────────────────
//  1. No ScreenScraper URL is ever returned, logged or stored: every URL they
//     send carries devid/devpassword/ssid/sspassword. Responses are passed
//     through `stripCredentials` before they leave this function, media is
//     either copied into Storage here or served by the signed
//     `screenscraper-media` proxy.
//  2. Every error string is scrubbed — failures end up in app_error_logs,
//     which ai-proxy can read.
//  3. Redirects are never followed with the credentials attached.
//
// ── Storage budget ─────────────────────────────────────────────────────────
// The Free plan's 1 GB is a hard wall: over quota, the project is eventually
// locked (402 on every request — tasks, food, training, not only Games). So
// nothing is stored without first reading the bucket's size
// (game_media_usage(), migration 104) and staying under the user's budget. An
// image that would cross it is linked on demand instead, and said so.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const API = 'https://api.screenscraper.fr/api2'
const SOFTNAME = 'lascisboard'
const BUCKET = 'game-media'
/** Below this many requests left today, nothing starts (the handheld's own
 *  ES-DE scraping spends from the same account-wide allowance). */
const QUOTA_FLOOR = 300
/** Concurrent ScreenScraper requests from one invocation. The account grants 7
 *  threads; the proxy and the handheld need some of them too. */
const PARALLEL = 3
const FIND_MAX = 10
const APPLY_BATCH_MAX = 5

const DEVID = Deno.env.get('SCREENSCRAPER_DEVID') ?? ''
const DEVPASSWORD = Deno.env.get('SCREENSCRAPER_DEVPASSWORD') ?? ''
const SSID = Deno.env.get('SCREENSCRAPER_SSID') ?? ''
const SSPASSWORD = Deno.env.get('SCREENSCRAPER_SSPASSWORD') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SECRETS = [DEVID, DEVPASSWORD, SSID, SSPASSWORD]

const admin = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY)

// <ss-shared>
// GENERATED from src/features/games/scraper/ by scripts/sync-screenscraper-shared.mjs.
// Do not edit here — edit the source and re-run the script.
// deno-lint-ignore no-explicit-any
type Rec = Record<string, any>

// ── ssTypes.ts ──
// The contract between the browser and the `screenscraper-sync` /
// `screenscraper-media` edge functions. Type-only and import-free: it is
// copied verbatim into both functions by scripts/sync-screenscraper-shared.mjs.

/** Game-level fields (the `games` row) and the primary variant's own fields
 *  (`game_platforms`), in the order the review lists them. */
type SsGameField =
  | 'title' | 'description' | 'release_year' | 'publisher' | 'developer'
  | 'genres' | 'modes' | 'players' | 'age_rating' | 'series_name'
  | 'cover' | 'screenshot' | 'fanart'
type SsPlatformField = 'release_date' | 'region' | 'rating'
type SsField = SsGameField | SsPlatformField

/** fill = only when empty · replace = overwrite what is there · skip = never */
type FieldPolicy = 'fill' | 'replace' | 'skip'

/** How a search result was found. `hash`/`filename` are ROM identity (strong),
 *  `name` is a text search (weak), `id` is a ScreenScraper game id. */
type MatchBasis = 'hash' | 'filename' | 'serial' | 'id' | 'name'

/** Which ScreenScraper media endpoint a file comes from. */
type MediaEndpoint = 'img' | 'video' | 'manual'

/** One file ScreenScraper has for a game — everything but its URL, which
 *  carries the developer and member credentials and never leaves the server. */
interface SsMediaEntry {
  type: string
  region: string | null
  /** Disc/cartridge number for multi-disc media. */
  support: string | null
  format: string | null
  /** Bytes of THEIR original file (a resized copy is smaller). */
  size: number | null
  crc: string | null
  md5: string | null
  sha1: string | null
  /** Their own media token, e.g. `box-2D(us)` or `support-2D(eu)[1]` — what
   *  the proxy asks for. Parsed from the URL's `media` parameter. */
  token: string
  ep: MediaEndpoint
}

interface SsLocalized { key: string; text: string }

interface SsRomInfo {
  id: string | null
  filename: string | null
  size: number | null
  crc: string | null
  md5: string | null
  sha1: string | null
  serial: string | null
  type: string | null
  support_type: string | null
  disc: string | null
  discs: string | null
  regions: string[]
  languages: string[]
  flags: string[]
  clone_of: string | null
}

/** A normalized search result. Carries values, never a media URL. */
interface SsCandidate {
  jeu_id: string
  rom_id: string | null
  system: { id: number | null; name: string | null }
  matched_by: MatchBasis[]
  /** Mapped values in the user's preferred language/region order. */
  values: Partial<Record<SsField, string | number | string[] | null>>
  /** Every variant they have, so the review can show and pick any of them. */
  names: SsLocalized[]
  synopses: SsLocalized[]
  dates: SsLocalized[]
  classifications: SsLocalized[]
  genres: string[]
  modes: string[]
  families: string[]
  numbers: string[]
  themes: string[]
  styles: string[]
  note20: number | null
  top_staff: boolean
  not_a_game: boolean
  rotation: string | null
  resolution: string | null
  clone_of: string | null
  /** The ROM ScreenScraper matched ours to (ROM lookups only). */
  rom: SsRomInfo | null
  /** Every known dump of the game — the first few, and how many in total. */
  roms: SsRomInfo[]
  roms_total: number
  hacks_total: number
  actions_total: number
  flags: string[]
  media: SsMediaEntry[]
  /** Signs `jeu_id|system` for the media proxy (see ssProxy.ts). */
  media_sig: string | null
}

interface SsRomQuery {
  filename?: string | null
  size?: number | null
  crc?: string | null
  md5?: string | null
  sha1?: string | null
  serial?: string | null
}

interface SsQueryOutcome {
  kind: MatchBasis
  status: 'ok' | 'no_match' | 'skipped' | 'error'
  count: number
  message?: string
}

/** A media type the user wants on apply, and how. */
interface SsMediaChoice { type: string; token?: string | null; mode: 'store' | 'on_demand' }

/** Saved per user (screenscraper_prefs.prefs) and sent with every apply. */
interface SsPrefs {
  v: 1
  fields: Record<SsField, FieldPolicy>
  /** Per media type; a type missing here uses the catalogue default. */
  media: Record<string, 'store' | 'on_demand' | 'skip'>
  /** Multiplies every type's stored width (0.5 small … 2 large); 0 = original size. */
  imageScale: number
  /** Region order for titles, dates and media (their codes: wor, eu, us, jp, ss, …). */
  regions: string[]
  /** Language order for descriptions, genres, modes, series. */
  languages: string[]
  /** Keep their full record (all titles, dates, ROMs, ratings) in provider_data. */
  snapshot: boolean
  /** Stop storing images once the artwork bucket passes this many megabytes. */
  budgetMb: number
}

// ── ssMediaCatalog.ts ──
// The ScreenScraper media vocabulary: every type their API answers with, what
// it is called on screen, how it is grouped, and what the scraper does with
// it by default.
//
// Pure and import-free — the edge functions carry a hand-mirrored copy
// (supabase/functions/screenscraper-sync and screenscraper-media). **Change one,
// change the other**, and re-run scripts/verify-screenscraper-v2.cjs.
//
// Defaults are set by the storage budget, not by taste. The Free plan's 1 GB is
// a hard wall (a project over quota ends up answering 402 to EVERY request, not
// just Games), and 537 MB of it already holds ES-DE originals. So only what the
// library, the detail hero and the screenshot strip actually show is stored,
// small; everything else is fetched through the signed proxy when looked at,
// and composites/theme assets are skipped. Measured sizes at these widths:
// box art 24-61 KB as JPEG/WebP at 640 px, a transparent logo ~14 KB.

/** save a resized copy in Storage · fetch through the proxy when viewed · ignore */
type MediaMode = 'store' | 'on_demand' | 'skip'

type MediaGroup = 'box' | 'support' | 'screens' | 'art' | 'logos' | 'extras' | 'documents' | 'video'

/** What kind of file a type is. Only images can be stored; the rest stream. */
type MediaKind = 'image' | 'pdf' | 'video'

interface MediaTypeInfo {
  type: string
  label: string
  group: MediaGroup
  kind: MediaKind
  mode: MediaMode
  /** Width asked of ScreenScraper when storing or previewing (their `maxwidth`). */
  width: number
  /** Has transparency — must stay PNG. Opaque art may become JPEG when that is smaller. */
  alpha: boolean
}

const MEDIA_GROUPS: { key: MediaGroup; label: string }[] = [
  { key: 'box', label: 'Box' },
  { key: 'support', label: 'Cartridge & disc' },
  { key: 'screens', label: 'Screens' },
  { key: 'art', label: 'Artwork' },
  { key: 'logos', label: 'Logos & marquees' },
  { key: 'extras', label: 'Extras' },
  { key: 'documents', label: 'Manual' },
  { key: 'video', label: 'Video' },
]

const T = (type: string, label: string, group: MediaGroup, mode: MediaMode, width: number, alpha = false, kind: MediaKind = 'image'): MediaTypeInfo =>
  ({ type, label, group, kind, mode, width, alpha })

const MEDIA_TYPES: MediaTypeInfo[] = [
  T('box-2D', 'Box front', 'box', 'store', 640),
  T('box-2D-back', 'Box back', 'box', 'store', 640),
  T('box-2D-side', 'Box spine', 'box', 'on_demand', 320),
  T('box-3D', '3D box', 'box', 'on_demand', 640, true),
  T('box-texture', 'Box texture (unfolded)', 'box', 'on_demand', 1280),
  T('support-2D', 'Cartridge / disc', 'support', 'on_demand', 480, true),
  T('support-texture', 'Label texture', 'support', 'skip', 960),
  T('ss', 'Screenshot', 'screens', 'store', 640),
  T('sstitle', 'Title screen', 'screens', 'store', 640),
  T('fanart', 'Fan art', 'art', 'store', 1280),
  T('steamgrid', 'Steam grid', 'art', 'on_demand', 640),
  T('mixrbv1', 'Mix image 1', 'art', 'skip', 640, true),
  T('mixrbv2', 'Mix image 2', 'art', 'skip', 640, true),
  T('wheel-hd', 'Logo (HD)', 'logos', 'store', 480, true),
  T('wheel', 'Logo', 'logos', 'on_demand', 480, true),
  T('wheel-carbon', 'Logo (carbon)', 'logos', 'skip', 480, true),
  T('wheel-steel', 'Logo (steel)', 'logos', 'skip', 480, true),
  T('marquee', 'Marquee', 'logos', 'on_demand', 640, true),
  T('screenmarquee', 'Screen marquee', 'logos', 'on_demand', 640, true),
  T('screenmarqueesmall', 'Screen marquee (small)', 'logos', 'on_demand', 480, true),
  T('bezel-16-9', 'Bezel 16:9', 'extras', 'skip', 1280, true),
  T('themehs', 'HyperSpin theme', 'extras', 'skip', 960, true),
  T('pictocouleur', 'Pictogram (colour)', 'extras', 'skip', 240, true),
  T('pictoliste', 'Pictogram (list)', 'extras', 'skip', 240, true),
  T('pictomonochrome', 'Pictogram (mono)', 'extras', 'skip', 240, true),
  T('manuel', 'Manual (PDF)', 'documents', 'on_demand', 0, false, 'pdf'),
  T('video-normalized', 'Video (normalized)', 'video', 'skip', 0, false, 'video'),
  T('video', 'Video (original)', 'video', 'skip', 0, false, 'video'),
]

const BY_TYPE = new Map(MEDIA_TYPES.map(m => [m.type, m]))

/** A type ScreenScraper sends that this list does not know yet is still usable:
 *  an image, fetched on demand, labelled by its own name. */
function mediaInfo(type: string): MediaTypeInfo {
  const known = BY_TYPE.get(type)
  if (known) return known
  const kind: MediaKind = /^video/.test(type) ? 'video' : /^manuel/.test(type) ? 'pdf' : 'image'
  return { type, label: type, group: kind === 'image' ? 'extras' : kind === 'pdf' ? 'documents' : 'video', kind, mode: kind === 'video' ? 'skip' : 'on_demand', width: 640, alpha: true }
}

/** Only images are ever copied into Storage; a manual or video only streams. */
const canStore = (type: string) => mediaInfo(type).kind === 'image'

/**
 * The media types whose chosen copy also goes into `games.media`, which the
 * library list loads for EVERY game. Exactly what the cover chain, the detail
 * hero and the screenshot strip read (testGameModel.ts) — anything more would
 * be shipped a thousand times on every library load for nothing.
 */
const LIST_MEDIA_TYPES = ['box-2D', 'box-3D', 'fanart', 'ss', 'sstitle'] as const

/** Media type → the `games` column it also fills (when the field policy allows). */
const MEDIA_COLUMN: Record<string, 'primary_cover_url' | 'screenshot_url' | 'fanart_url'> = {
  'box-2D': 'primary_cover_url',
  ss: 'screenshot_url',
  fanart: 'fanart_url',
}

/** Is a type's upstream format the kind a pixel-art screenshot comes in? A
 *  native-resolution retro screen is a 3-4 KB palette PNG that a lossy JPEG
 *  makes BIGGER and blurrier, so small originals stay PNG. */
const SMALL_ORIGINAL_BYTES = 64 * 1024

/**
 * The format asked of ScreenScraper (`outputformat`) for a stored copy.
 * Transparency forces PNG; otherwise PNG only when the original is already
 * small (the keep-whichever-is-smaller rule, decided from the inventory size
 * rather than by downloading both).
 */
function outputFormatFor(type: string, originalBytes: number | null | undefined): 'png' | 'jpg' {
  const info = mediaInfo(type)
  if (info.alpha) return 'png'
  if (originalBytes != null && originalBytes > 0 && originalBytes <= SMALL_ORIGINAL_BYTES) return 'png'
  return 'jpg'
}

// ── ssRules.ts ──
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



// ─── Security ────────────────────────────────────────────────────────────────

/**
 * Removes every credential value from a string. ScreenScraper puts
 * devid/devpassword/ssid/sspassword in the query string of every URL it
 * returns — media, hack downloads, and the `header.commandRequested` echo — so
 * any message that quotes one would carry them. Substring replacement, not URL
 * parsing, so a truncated or malformed URL is masked too. Short secrets are
 * skipped: masking every "1" would destroy the message and protect nothing.
 */
function scrubSecrets(text: string, secrets: (string | undefined | null)[]): string {
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
const SNAPSHOT_CAPS: Record<string, number> = { roms: 300, hacks: 50, medias: 500, actions: 50, tips: 100 }

/**
 * A deep copy of a ScreenScraper payload with every URL removed — the only
 * form in which any part of their answer may be stored or sent to a browser.
 * Drops URL keys outright and any other string that carries a credential
 * parameter, so a URL hiding under a key nobody anticipated is still caught.
 */
function stripCredentials(value: unknown, depth = 0): unknown {
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
function localizedList(list: unknown, key: 'region' | 'langue' | 'type'): SsLocalized[] {
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
function pickPreferred(list: SsLocalized[], prefer: string[]): SsLocalized | null {
  for (const want of prefer) {
    const hit = list.find(e => e.key === want.toLowerCase())
    if (hit) return hit
  }
  return list[0] ?? null
}

/** Group arrays (genres, modes, familles, numeros, themes, styles): each entry
 *  carries its own localized `noms`. `principale: "1"` leads. */
function groupNames(list: unknown, languages: string[]): string[] {
  const items = arr(list).map(g => ({
    primary: flag(g.principale),
    name: pickPreferred(localizedList(g.noms, 'langue'), languages)?.text ?? null,
  })).filter((g): g is { primary: boolean; name: string } => !!g.name)
  const ordered = [...items.filter(g => g.primary), ...items.filter(g => !g.primary)]
  return [...new Set(ordered.map(g => g.name))]
}

// ─── Dates, ratings ──────────────────────────────────────────────────────────

/** Earliest year across every regional date: the game's first release. */
function earliestYear(dates: SsLocalized[]): number | null {
  const years = dates.map(d => /^(\d{4})/.exec(d.text)?.[1]).map(Number).filter(y => y >= 1950 && y <= 2100)
  return years.length ? Math.min(...years) : null
}

/**
 * A full `YYYY-MM-DD` for the platform variant: the one for the ROM's own
 * region when there is one (this copy's release), else the earliest full date.
 * A year-only value is never padded into a fake day.
 */
function releaseDateFor(dates: SsLocalized[], romRegions: string[], regionOrder: string[]): string | null {
  const full = dates.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d.text))
  if (!full.length) return null
  for (const r of [...romRegions, ...regionOrder]) {
    const hit = full.find(d => d.key === r.toLowerCase())
    if (hit) return hit.text
  }
  return [...full].sort((a, b) => a.text.localeCompare(b.text))[0].text
}

/** `note.text` is out of TWENTY; game_platforms.rating is 0-100. */
function note20(note: unknown): number | null {
  const n = num(note)
  return n != null && n >= 0 && n <= 20 ? n : null
}
const rating100 = (n20: number | null): number | null => (n20 == null ? null : Math.round(n20 * 50) / 10)

/** PEGI first (a European library), then ESRB, CERO, USK, then theirs. */
function ageRating(classifications: SsLocalized[]): string | null {
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

function romInfo(rom: unknown): SsRomInfo | null {
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
const MEDIA_TOKEN = /^[A-Za-z0-9-]{1,40}(\([A-Za-z0-9,]{1,12}\))?(\[\d{1,2}\])?$/

/**
 * The endpoint and token of a media URL, read server-side before the URL is
 * thrown away. The token is exactly what their `media` parameter wants, so
 * the proxy can ask for the same file later without ever storing the URL.
 */
function mediaRef(url: unknown): { ep: MediaEndpoint; token: string } | null {
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
function mediaInventory(medias: unknown): SsMediaEntry[] {
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
function pickMediaEntry(inventory: SsMediaEntry[], type: string, regions: string[]): SsMediaEntry | null {
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

interface MapOptions { regions: string[]; languages: string[] }

/** What a match tells us about itself: not a game, a hack, a beta, a clone. */
function candidateFlags(jeu: Rec, rom: SsRomInfo | null): string[] {
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
function toCandidate(jeu: Rec, matchedBy: MatchBasis[], opts: MapOptions, maxRoms = 20): SsCandidate {
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
function withOverrides(c: SsCandidate, o: { titleRegion?: string | null; descriptionLang?: string | null } | null | undefined): SsCandidate {
  if (!o) return c
  const title = o.titleRegion ? c.names.find(n => n.key === o.titleRegion)?.text : undefined
  const description = o.descriptionLang ? c.synopses.find(s => s.key === o.descriptionLang)?.text : undefined
  if (title === undefined && description === undefined) return c
  return { ...c, values: { ...c.values, ...(title !== undefined ? { title } : {}), ...(description !== undefined ? { description } : {}) } }
}

/** A jeuRecherche with no hit answers `jeux: [{}]` — an entry without an id is no entry. */
const isRealJeu = (j: unknown): j is Rec => !!j && typeof j === 'object' && str((j as Rec).id) != null

// ─── Their plain-text answers ────────────────────────────────────────────────

type SsTextKind = 'not_found' | 'no_media' | 'unchanged' | 'login' | 'quota' | 'closed' | 'busy' | 'bad_request' | 'other'

/**
 * ScreenScraper answers errors in plain text, often with HTTP 200 (a failed
 * login is a 200 whose body reads "Erreur de login…"), so the BODY decides.
 */
function classifyText(status: number, body: string): SsTextKind {
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

const TEXT_MESSAGE: Record<SsTextKind, string> = {
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

// ── ssProxy.ts ──
// The media proxy's contract, shared by the browser (which builds URLs), the
// `screenscraper-media` function (which checks and serves them) and
// `screenscraper-sync` (which signs them). Import-free; copied into both
// functions by scripts/sync-screenscraper-shared.mjs.
//
// Why a proxy: every ScreenScraper media URL carries the developer and member
// credentials, so the browser can never be handed one. The proxy takes a game
// id, a system id and their media token, adds the credentials server-side and
// streams the file back — nothing stored, nothing leaked.
//
// Why signed: the function has to run without JWT verification (an <img> tag
// cannot send a header), and an open proxy would let anyone spend this
// account's daily allowance. The signature binds ONE game on ONE system, so a
// leaked URL can fetch that game's own box art and nothing else — which is why
// it does not expire (it is also what lets a saved game keep browsing its
// media months later).


const PROXY_PATH = '/functions/v1/screenscraper-media'

/** The exact bytes that get signed. Versioned so the scheme can change. */
const sigPayload = (jeuId: string, systemId: number | string) => `ssm1|${jeuId}|${systemId}`

interface ProxyRef { jeuId: string; systemId: number; sig: string }

interface ProxyRequest {
  jeuId: string
  systemId: number
  ep: MediaEndpoint
  token: string
  /** maxwidth / outputformat — images only. */
  width: number | null
  format: 'png' | 'jpg' | null
  sig: string
}

const EP: MediaEndpoint[] = ['img', 'video', 'manual']

/** Validates a proxy query string. Everything is whitelisted: anything outside
 *  these shapes is refused before a request is spent on it. */
function parseProxyQuery(q: URLSearchParams): ProxyRequest | { error: string } {
  const j = q.get('j') ?? ''
  const s = q.get('s') ?? ''
  const ep = (q.get('e') ?? 'img') as MediaEndpoint
  const token = q.get('m') ?? ''
  const w = q.get('w')
  const f = q.get('f')
  const sig = q.get('k') ?? ''
  if (!/^\d{1,10}$/.test(j)) return { error: 'bad game id' }
  if (!/^\d{1,6}$/.test(s)) return { error: 'bad system id' }
  if (!EP.includes(ep)) return { error: 'bad endpoint' }
  if (!MEDIA_TOKEN.test(token)) return { error: 'bad media token' }
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(sig)) return { error: 'bad signature' }
  let width: number | null = null
  if (w != null && w !== '') {
    const n = Number(w)
    if (!Number.isInteger(n) || n < 32 || n > 2500) return { error: 'bad width' }
    width = n
  }
  const format = f === 'png' || f === 'jpg' ? f : null
  if (f != null && f !== '' && !format) return { error: 'bad format' }
  return { jeuId: j, systemId: Number(s), ep, token, width: ep === 'img' ? width : null, format: ep === 'img' ? format : null, sig }
}

/** The query string for one file. Order is fixed so equal requests are equal
 *  URLs — which is what lets the browser cache them. */
function proxyQuery(ref: ProxyRef, entry: Pick<SsMediaEntry, 'ep' | 'token'>, opts: { width?: number | null; format?: 'png' | 'jpg' | null } = {}): string {
  const p = new URLSearchParams()
  p.set('j', ref.jeuId)
  p.set('s', String(ref.systemId))
  if (entry.ep !== 'img') p.set('e', entry.ep)
  p.set('m', entry.token)
  if (entry.ep === 'img' && opts.width) p.set('w', String(Math.round(opts.width)))
  if (entry.ep === 'img' && opts.format) p.set('f', opts.format)
  p.set('k', ref.sig)
  return p.toString()
}

const UPSTREAM_FILE: Record<MediaEndpoint, string> = { img: 'mediaJeu.php', video: 'mediaVideoJeu.php', manual: 'mediaManuelJeu.php' }

/** The ScreenScraper endpoint and parameters for a proxy request (credentials
 *  are added by the caller and never pass through here). */
function upstreamFor(req: ProxyRequest): { file: string; params: Record<string, string> } {
  const params: Record<string, string> = { systemeid: String(req.systemId), jeuid: req.jeuId, media: req.token }
  if (req.width) params.maxwidth = String(req.width)
  if (req.format) params.outputformat = req.format
  return { file: UPSTREAM_FILE[req.ep], params }
}

/** Where a stored copy lives. Keyed by our own game id so a re-scrape
 *  overwrites its own object instead of growing a second one. */
const storedPath = (gameId: string, type: string, ext: string) => `${gameId}/${type}.${ext}`

/** The content types the proxy passes through; anything else (their plain-text
 *  errors included) is not a file. */
function allowedContentType(ep: MediaEndpoint, contentType: string): boolean {
  const t = contentType.toLowerCase()
  if (ep === 'img') return t.startsWith('image/')
  if (ep === 'video') return t.startsWith('video/') || t === 'application/octet-stream'
  return t === 'application/pdf' || t === 'application/octet-stream'
}

/** Constant-time comparison for signatures. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Bytes → base64url, the signature's text form. */
function base64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * HMAC-SHA256 over `sigPayload`, keyed from the project's service-role key.
 * That key is injected into every function, so the two functions agree
 * without a new secret to set up; it is hashed with a label first so the
 * signing key is never the service key itself. 32 characters (192 bits).
 */
async function signMedia(serviceKey: string, jeuId: string, systemId: number | string): Promise<string> {
  const enc = new TextEncoder()
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`screenscraper-media-v1:${serviceKey}`))
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(sigPayload(jeuId, systemId)))
  return base64url(new Uint8Array(mac)).slice(0, 32)
}

// ── ssPlan.ts ──
// The pure decisions around a scrape: which lookups a search runs, how their
// answers merge, what the user's saved preferences mean, and what an apply
// writes. Import-free apart from sibling pure modules; copied into the edge
// function by scripts/sync-screenscraper-shared.mjs. **Edit here, then run it.**



// ─── Fields ──────────────────────────────────────────────────────────────────

const GAME_FIELDS = [
  'title', 'description', 'release_year', 'publisher', 'developer',
  'genres', 'modes', 'players', 'age_rating', 'series_name',
  'cover', 'screenshot', 'fanart',
] as const
const PLATFORM_FIELDS = ['release_date', 'region', 'rating'] as const
const ALL_FIELDS: SsField[] = [...GAME_FIELDS, ...PLATFORM_FIELDS]

const FIELD_LABEL: Record<SsField, string> = {
  title: 'Title', description: 'Description', release_year: 'Release year',
  publisher: 'Publisher', developer: 'Developer', genres: 'Genres', modes: 'Modes',
  players: 'Players', age_rating: 'Age rating', series_name: 'Series',
  cover: 'Cover', screenshot: 'Screenshot', fanart: 'Fan art',
  release_date: 'Release date (this version)', region: 'Region (this ROM)', rating: 'ScreenScraper score',
}

/** Field → the column it writes. Media fields take the chosen image's URL. */
const FIELD_COLUMN: Record<SsField, { table: 'games' | 'game_platforms'; column: string }> = {
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
}

/** Media field → the media type that supplies it. */
const FIELD_MEDIA: Partial<Record<SsField, string>> = { cover: 'box-2D', screenshot: 'ss', fanart: 'fanart' }

// ─── Preferences ─────────────────────────────────────────────────────────────

/** Every field fills gaps and never overwrites — the promise the old scraper
 *  made. Replacing is always an explicit choice, per field or per game. */
function defaultPrefs(): SsPrefs {
  const fields = {} as Record<SsField, FieldPolicy>
  for (const f of ALL_FIELDS) fields[f] = 'fill'
  return {
    v: 1, fields, media: {}, imageScale: 1,
    regions: ['wor', 'eu', 'us', 'ss', 'jp'],
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
function normalizePrefs(raw: unknown): SsPrefs {
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
const mediaModeFor = (prefs: SsPrefs, type: string): MediaMode => prefs.media[type] ?? mediaInfo(type).mode

/** Width to ask for when storing; null = their original size. */
function storeWidth(prefs: SsPrefs, type: string): number | null {
  if (prefs.imageScale === 0) return null
  const w = mediaInfo(type).width
  return w > 0 ? Math.round(w * prefs.imageScale) : null
}

/** How many catalogue types each mode ends up with — the settings summary. */
function modeCounts(prefs: SsPrefs): Record<MediaMode, number> {
  const c: Record<MediaMode, number> = { store: 0, on_demand: 0, skip: 0 }
  for (const t of MEDIA_TYPES) c[mediaModeFor(prefs, t.type)]++
  return c
}

// ─── Search planning ─────────────────────────────────────────────────────────

interface SearchInput {
  name?: string | null
  /** ScreenScraper numeric system id, when known. */
  systemId?: number | null
  rom?: SsRomQuery | null
  jeuId?: string | null
  useName?: boolean
  useRom?: boolean
}

interface PlannedQuery { kind: MatchBasis; endpoint: 'jeuInfos.php' | 'jeuRecherche.php'; params: Record<string, string> }
interface SearchPlan { queries: PlannedQuery[]; notes: { kind: MatchBasis; message: string }[] }

const HEX: Record<'crc' | 'md5' | 'sha1', RegExp> = { crc: /^[0-9a-f]{8}$/i, md5: /^[0-9a-f]{32}$/i, sha1: /^[0-9a-f]{40}$/i }

/** Their search ignores "the" and a trailing "+" and refuses under 4 characters. */
function searchableLength(name: string): number {
  return name.toLowerCase().replace(/\bthe\b/g, '').replace(/\+\s*$/, '').replace(/\s+/g, ' ').trim().length
}

/** A filename exactly as `romnom` wants it: no directory, never a path. */
function romFileName(path: string | null | undefined): string | null {
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
function planSearch(input: SearchInput): SearchPlan {
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
      queries.push({ kind: 'hash', endpoint: 'jeuInfos.php', params: withSys({ ...base, ...hashes }) })
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

const BASIS_RANK: Record<MatchBasis, number> = { id: 0, hash: 1, serial: 2, filename: 3, name: 4 }

/**
 * One list from several lookups: an entry found more than once is shown once,
 * carrying every way it was found; exact matches (id, hash, serial, filename)
 * lead, then name results in their own relevance order.
 */
function mergeCandidates(groups: { kind: MatchBasis; items: SsCandidate[] }[]): SsCandidate[] {
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

const isEmptyValue = (v: unknown) =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)

/** Order-sensitive equality for what a scrape writes (strings, numbers, text arrays). */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameValue(x, b[i]))
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b)
  return false
}

interface PatchPlan {
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
function planPatch(
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

// </ss-shared>

const scrub = (t: string) => scrubSecrets(t, SECRETS)
const fail = (message: string, status = 500, extra: Rec = {}) => json({ status: 'error', error: scrub(message), ...extra }, status)

// ─── ScreenScraper calls ─────────────────────────────────────────────────────

let issued = 0
let lastUser: { used: number; max: number } | null = null

function apiUrl(endpoint: string, params: Record<string, string>): string {
  const u = new URL(`${API}/${endpoint}`)
  u.searchParams.set('devid', DEVID)
  u.searchParams.set('devpassword', DEVPASSWORD)
  u.searchParams.set('softname', SOFTNAME)
  u.searchParams.set('output', 'json')
  if (SSID) u.searchParams.set('ssid', SSID)
  if (SSPASSWORD) u.searchParams.set('sspassword', SSPASSWORD)
  for (const [k, v] of Object.entries(params)) if (v !== '') u.searchParams.set(k, v)
  return u.toString()
}

/** Their JSON has known defects: trailing commas, unescaped backslashes. */
function parseLenient(body: string): Rec | null {
  try { return JSON.parse(body) } catch { /* try the repaired form */ }
  try {
    return JSON.parse(body.replace(/,(\s*[}\]])/g, '$1').replace(/\\(?!["\\/bfnrtu])/g, '\\\\'))
  } catch { return null }
}

type ApiResult = { ok: true; data: Rec } | { ok: false; kind: SsTextKind; status: number; message: string }

/**
 * One API call. Errors arrive as PLAIN TEXT, often with HTTP 200 (a failed
 * login is a 200 reading "Erreur de login…"), so the body decides, not the
 * status. A 404 is a normal answer ("not in their database"), not a failure.
 */
async function callApi(endpoint: string, params: Record<string, string>): Promise<ApiResult> {
  issued++
  let res: Response
  try {
    res = await fetch(apiUrl(endpoint, params), { headers: { 'User-Agent': SOFTNAME }, redirect: 'manual' })
  } catch (e) {
    return { ok: false, kind: 'other', status: 0, message: scrub((e as Error).message) }
  }
  const body = await res.text().catch(() => '')
  const data = body.trimStart().startsWith('{') ? parseLenient(body) : null
  if (!res.ok || !data) {
    const kind = classifyText(res.status, body)
    return { ok: false, kind, status: res.status, message: TEXT_MESSAGE[kind] }
  }
  const u = data?.response?.ssuser
  if (u && u.maxrequestsperday != null) lastUser = { used: Number(u.requeststoday ?? 0), max: Number(u.maxrequestsperday ?? 0) }
  return { ok: true, data }
}

/** Runs tasks a few at a time — never more than the share of the account's
 *  threads this function allows itself. */
async function inParallel<T, R>(items: T[], fn: (item: T, i: number) => Promise<R>, width = PARALLEL): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker))
  return out
}

async function readQuota(): Promise<{ used: number; max: number; threads: number; level: string } | { error: string }> {
  const r = await callApi('ssuserInfos.php', {})
  if (!r.ok) return { error: r.message }
  const u = r.data?.response?.ssuser ?? {}
  return {
    used: Number(u.requeststoday ?? 0), max: Number(u.maxrequestsperday ?? 0),
    threads: Number(u.maxthreads ?? 1), level: String(u.niveau ?? '0'),
  }
}
const remaining = () => (lastUser ? Math.max(0, lastUser.max - lastUser.used) : null)

// ─── Systems ─────────────────────────────────────────────────────────────────

/**
 * ES-DE folder → numeric system id. Several systems claim the same alias
 * (snes: 4 Super Nintendo | 202 "Super Mario World Hacks"); the LOWEST id is
 * the real console every time — a last-write-wins map once sent 604 games to
 * a ROM-hack database.
 */
async function loadSystems(): Promise<Map<string, { id: number; name: string }>> {
  const { data, error } = await admin.from('screenscraper_systems').select('id, name, retropie_names')
  if (error) throw new Error(`systems read: ${error.message}`)
  const map = new Map<string, { id: number; name: string }>()
  for (const s of data ?? []) {
    const id = Number(s.id)
    if (!Number.isFinite(id)) continue
    map.set(`#${id}`, { id, name: s.name ?? String(id) })
    for (const alias of (s.retropie_names ?? []) as string[]) {
      const key = String(alias ?? '').trim().toLowerCase()
      const cur = key ? map.get(key) : undefined
      if (key && (!cur || id < cur.id)) map.set(key, { id, name: s.name ?? String(id) })
    }
  }
  return map
}

/** A system as the caller names it: their numeric id, or an ES-DE folder. */
function resolveSystem(map: Map<string, { id: number; name: string }>, raw: unknown): { id: number; name: string } | null {
  if (raw === null || raw === undefined || raw === '') return null
  const s = String(raw).trim().toLowerCase()
  if (/^\d+$/.test(s)) return map.get(`#${s}`) ?? { id: Number(s), name: s }
  return map.get(s) ?? null
}

// ─── Media ───────────────────────────────────────────────────────────────────

/** Every media URL of an entry, by token — server memory only, never returned. */
function urlsByToken(jeu: Rec): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of Array.isArray(jeu.medias) ? jeu.medias : []) {
    const ref = mediaRef(m?.url)
    if (ref && !map.has(ref.token)) map.set(ref.token, m.url)
  }
  return map
}

/** Downloads one image — resized by ScreenScraper itself (`maxwidth`,
 *  `outputformat`), so no CPU is spent here. */
async function downloadImage(url: string, width: number | null, format: 'png' | 'jpg'): Promise<{ bytes: Uint8Array; type: string } | { error: string }> {
  issued++
  const u = new URL(url)
  if (width) u.searchParams.set('maxwidth', String(width))
  u.searchParams.set('outputformat', format)
  try {
    let res = await fetch(u.toString(), { redirect: 'manual', headers: { 'User-Agent': SOFTNAME } })
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      await res.body?.cancel()
      if (!loc) return { error: 'redirect without a location' }
      res = await fetch(loc, { redirect: 'follow' })
    }
    const ct = res.headers.get('content-type') ?? ''
    if (!res.ok || !ct.startsWith('image/')) {
      const body = await res.text().catch(() => '')
      return { error: TEXT_MESSAGE[classifyText(res.status, body)] }
    }
    return { bytes: new Uint8Array(await res.arrayBuffer()), type: ct }
  } catch (e) {
    return { error: scrub((e as Error).message) }
  }
}

/** Bytes used by the artwork bucket, or null when it cannot be read (then
 *  nothing is stored — guessing is how a project gets locked). */
async function bucketBytes(): Promise<{ total: number; groups: Rec[] } | null> {
  const { data, error } = await admin.rpc('game_media_usage')
  if (error || !Array.isArray(data)) return null
  const groups = data.map((r: Rec) => ({ category: String(r.category), files: Number(r.files), bytes: Number(r.bytes) }))
  return { total: groups.reduce((s: number, g: Rec) => s + g.bytes, 0), groups }
}

// ─── Journal ─────────────────────────────────────────────────────────────────

async function journal(userId: string, row: Rec): Promise<void> {
  let { error } = await admin.from('scrape_decisions').insert({ user_id: userId, ...row })
  if (error && isMissingColumn(error) && 'prior_values' in row) {
    const { prior_values: _p, ...rest } = row
    ;({ error } = await admin.from('scrape_decisions').insert({ user_id: userId, ...rest }))
  }
  if (error) console.log(`scrape_decisions insert skipped (${(error as Rec).code ?? 'unknown'})`)
}

function isMissingColumn(e: unknown): boolean {
  const x = e as { code?: string; message?: string } | null
  return x?.code === '42703' || x?.code === 'PGRST204' || /column .* does not exist/i.test(x?.message ?? '')
}
const jsonEqual = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

// ─── Search ──────────────────────────────────────────────────────────────────

async function signed(c: SsCandidate): Promise<SsCandidate> {
  return c.system.id != null ? { ...c, media_sig: await signMedia(SERVICE_KEY, c.jeu_id, c.system.id) } : c
}

async function runSearch(body: Rec, prefs: SsPrefs) {
  const systems = await loadSystems()
  const sys = resolveSystem(systems, body.system)
  const rom = (body.rom && typeof body.rom === 'object' ? body.rom : null) as SsRomQuery | null
  const plan = planSearch({
    name: body.name, systemId: sys?.id ?? null, rom, jeuId: body.jeu_id,
    useName: body.use_name !== false, useRom: body.use_rom !== false,
  })
  const opts = { regions: prefs.regions, languages: prefs.languages }
  const outcomes: SsQueryOutcome[] = plan.notes.map(n => ({ kind: n.kind, status: 'skipped' as const, count: 0, message: n.message }))
  if (body.system && !sys) outcomes.push({ kind: 'name', status: 'skipped', count: 0, message: `"${body.system}" is not in the cached system list, so nothing was narrowed by system.` })

  const groups = await inParallel(plan.queries, async (q) => {
    const r = await callApi(q.endpoint, q.params)
    if (!r.ok) {
      outcomes.push({ kind: q.kind, status: r.kind === 'not_found' ? 'no_match' : 'error', count: 0, message: r.kind === 'not_found' ? undefined : r.message })
      return { kind: q.kind, items: [] as SsCandidate[] }
    }
    const list = q.endpoint === 'jeuRecherche.php'
      ? (Array.isArray(r.data?.response?.jeux) ? r.data.response.jeux : [])
      : [r.data?.response?.jeu]
    const items = list.filter(isRealJeu).map((j: Rec) => toCandidate(j, [q.kind], opts))
    outcomes.push({ kind: q.kind, status: items.length ? 'ok' : 'no_match', count: items.length })
    return { kind: q.kind, items }
  })
  const candidates = await Promise.all(mergeCandidates(groups).map(signed))
  return { candidates, outcomes, system: sys }
}

// ─── Apply ───────────────────────────────────────────────────────────────────

interface ApplyInput {
  gameId: string
  jeuId: string
  system: unknown
  rom: SsRomQuery | null
  fields: Partial<Record<SsField, FieldPolicy>>
  media: SsMediaChoice[]
  prefs: SsPrefs
  runId: string
  basis: MatchBasis[]
  overrides: { titleRegion?: string | null; descriptionLang?: string | null } | null
}

const PLATFORM_KEY = (c: string) => `platform.${c}`

async function applyOne(userId: string, input: ApplyInput): Promise<Rec> {
  const { data: game, error: gErr } = await admin.from('games').select('*').eq('user_id', userId).eq('id', input.gameId).maybeSingle()
  if (gErr) return { game_id: input.gameId, outcome: 'error', reason: scrub(gErr.message) }
  if (!game) return { game_id: input.gameId, outcome: 'error', reason: 'game not found' }
  const { data: plats } = await admin.from('game_platforms').select('*').eq('user_id', userId).eq('game_id', input.gameId)
  const platform = (plats ?? []).find((p: Rec) => p.is_primary_variant) ?? (plats ?? [])[0] ?? null

  const systems = await loadSystems()
  const sys = resolveSystem(systems, input.system)

  // Fetch the chosen entry. With ROM identity, ask by ROM first so the answer
  // carries the `rom` block for THIS dump (its regions, languages, flags);
  // only when that names a different game is the entry fetched by id.
  let jeu: Rec | null = null
  const romPlan = input.rom ? planSearch({ rom: input.rom, systemId: sys?.id ?? null, useName: false }).queries.find(q => q.kind !== 'serial') : null
  if (romPlan) {
    const r = await callApi(romPlan.endpoint, romPlan.params)
    if (r.ok && String(r.data?.response?.jeu?.id ?? '') === input.jeuId) jeu = r.data.response.jeu
  }
  if (!jeu) {
    const r = await callApi('jeuInfos.php', { gameid: input.jeuId })
    if (!r.ok) return { game_id: input.gameId, outcome: r.kind === 'not_found' ? 'no_match' : 'error', reason: r.message }
    jeu = r.data?.response?.jeu ?? null
  }
  if (!jeu || String(jeu.id) !== input.jeuId) {
    return { game_id: input.gameId, outcome: 'stale', reason: 'ScreenScraper answered with a different entry than the one chosen — search again.' }
  }
  const left = remaining()
  const opts = { regions: input.prefs.regions, languages: input.prefs.languages }
  const cand = withOverrides(await signed(toCandidate(jeu, input.basis, opts, SNAPSHOT_CAPS.roms)), input.overrides)
  const urls = urlsByToken(jeu)

  // ── Media ──
  // Copies saved by an earlier apply of THIS entry stay valid; after a
  // different match they belong to the wrong game and are forgotten.
  const prev = game.provider_data?.jeu_id === cand.jeu_id ? (game.provider_data as Rec) : null
  const saved: Rec = prev?.saved && typeof prev.saved === 'object' ? { ...prev.saved } : {}
  const linked = new Set<string>(Array.isArray(prev?.linked) ? prev.linked : [])
  const mediaResults: Rec[] = []
  const paths: string[] = []
  let addedBytes = 0
  const wantsStore = input.media.some(m => m.mode === 'store')
  const usage = wantsStore ? await bucketBytes() : null
  const budget = input.prefs.budgetMb * 1024 * 1024
  const lowQuota = left != null && left < QUOTA_FLOOR

  await inParallel(input.media, async (choice) => {
    const entry = (choice.token ? cand.media.find(m => m.token === choice.token) : null) ?? pickMediaEntry(cand.media, choice.type, input.prefs.regions)
    if (!entry) { mediaResults.push({ type: choice.type, mode: choice.mode, ok: false, reason: 'not available' }); return }
    if (choice.mode === 'on_demand' || !canStore(entry.type)) {
      linked.add(entry.type)
      mediaResults.push({ type: entry.type, mode: 'on_demand', ok: true, token: entry.token })
      return
    }
    const reasonNotStored =
      lowQuota ? 'quota nearly used up today' :
      !usage ? 'storage usage unknown (apply migration 104)' :
      usage.total + addedBytes + (entry.size ?? 500_000) > budget ? 'over your storage budget' : null
    if (reasonNotStored) {
      linked.add(entry.type)
      mediaResults.push({ type: entry.type, mode: 'on_demand', ok: true, token: entry.token, reason: `linked instead of saved: ${reasonNotStored}` })
      return
    }
    const url = urls.get(entry.token)
    if (!url) { mediaResults.push({ type: entry.type, mode: 'store', ok: false, reason: 'no file' }); return }
    const format = outputFormatFor(entry.type, entry.size)
    const got = await downloadImage(url, storeWidth(input.prefs, entry.type), format)
    if ('error' in got) { mediaResults.push({ type: entry.type, mode: 'store', ok: false, reason: got.error }); return }
    const ext = got.type.includes('png') ? 'png' : got.type.includes('webp') ? 'webp' : 'jpg'
    const path = storedPath(input.gameId, entry.type, ext)
    const { error } = await admin.storage.from(BUCKET).upload(path, got.bytes, { contentType: got.type, upsert: true, cacheControl: '31536000' })
    if (error) { mediaResults.push({ type: entry.type, mode: 'store', ok: false, reason: scrub(error.message) }); return }
    addedBytes += got.bytes.byteLength
    // A version stamp, because the path is reused on a re-scrape and the
    // object is cached for a year.
    saved[entry.type] = `${admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl}?v=${Date.now()}`
    linked.delete(entry.type)
    paths.push(path)
    mediaResults.push({ type: entry.type, mode: 'store', ok: true, bytes: got.bytes.byteLength, token: entry.token })
  })

  // ── Fields ── Columns only ever take a STORED copy: a proxied cover in the
  // library grid would be a thousand ScreenScraper requests per scroll.
  const values: Partial<Record<SsField, unknown>> = { ...cand.values }
  for (const [field, type] of Object.entries(FIELD_MEDIA)) values[field as SsField] = saved[type as string] ?? null
  const plan = planPatch({ games: game, platform }, values, input.fields)

  // games.media holds only what the library list reads, and only stored copies.
  const listMedia: Rec = { ...(game.media ?? {}) }
  for (const t of LIST_MEDIA_TYPES) if (saved[t]) listMedia[t] = saved[t]

  const snapshot = input.prefs.snapshot ? stripCredentials({ ...jeu, medias: undefined }) : undefined
  const providerData = {
    v: 2, source: 'screenscraper', fetched_at: new Date().toISOString(),
    jeu_id: cand.jeu_id, rom_id: cand.rom_id, system_id: cand.system.id, system_name: cand.system.name,
    matched_by: input.basis, media_sig: cand.media_sig,
    saved, linked: [...linked],
    // The full ROM list lives in the raw record; the summary keeps the first few.
    summary: { ...cand, roms: cand.roms.slice(0, 20), media_sig: undefined },
    ...(snapshot ? { jeu: snapshot } : {}),
  }

  const gamePatch: Rec = {
    ...plan.games, media: listMedia, provider_data: providerData,
    external_ref: cand.jeu_id, external_source: 'screenscraper', synced_at: new Date().toISOString(), needs_review: false,
  }
  const priorGame: Rec = {}
  for (const k of Object.keys(gamePatch)) priorGame[k] = game[k] ?? null
  const { error: uErr } = await admin.from('games').update(gamePatch).eq('id', input.gameId).eq('user_id', userId)
  if (uErr) return { game_id: input.gameId, outcome: 'error', reason: scrub(uErr.message) }

  const platPatch: Rec = platform ? { ...plan.platform, external_ref: cand.jeu_id, external_source: 'screenscraper', synced_at: new Date().toISOString() } : {}
  const priorPlat: Rec = {}
  if (platform) {
    for (const k of Object.keys(platPatch)) priorPlat[PLATFORM_KEY(k)] = platform[k] ?? null
    const { error } = await admin.from('game_platforms').update(platPatch).eq('id', platform.id).eq('user_id', userId)
    if (error) mediaResults.push({ type: 'platform', ok: false, reason: scrub(error.message) })
  }

  // Everything written is journaled with what it replaced, so undo can put
  // the old values back exactly (fill-only undo used to mean "set to null").
  // `synced_at` is bookkeeping (and a timestamp reads back in a different
  // text form), `needs_review` has its own column in the journal.
  const written: Rec = {}
  for (const [k, v] of Object.entries(gamePatch)) if (k !== 'synced_at' && k !== 'needs_review') written[k] = v
  for (const [k, v] of Object.entries(platPatch)) if (k !== 'synced_at') written[PLATFORM_KEY(k)] = v
  const priorAll: Rec = {}
  for (const k of Object.keys(written)) priorAll[k] = { ...priorGame, ...priorPlat }[k] ?? null
  await journal(userId, {
    game_id: input.gameId, run_id: input.runId, decision: 'applied', jeu_id: cand.jeu_id,
    matched_title: cand.values.title ?? null, system_used: cand.system.name,
    fields_written: Object.keys(written), written_values: written,
    prior_values: priorAll, storage_paths: paths, prior_needs_review: game.needs_review === true,
  })

  return {
    game_id: input.gameId, outcome: 'applied', matched_title: cand.values.title ?? null,
    written: plan.written, skipped: plan.skipped, media: mediaResults, bytes_stored: addedBytes,
    remaining_today: remaining(),
  }
}

// ─── Undo ────────────────────────────────────────────────────────────────────

async function undoRun(userId: string, runId: string): Promise<Rec> {
  const { data: rows, error } = await admin.from('scrape_decisions').select('*')
    .eq('user_id', userId).eq('run_id', runId).in('decision', ['applied', 'undone'])
  if (error) {
    const code = (error as Rec).code
    if (code === '42P01' || code === 'PGRST205') return { status: 'no_journal', message: 'Migration 097 is not applied, so there is no record of what to undo.' }
    throw new Error(`journal read: ${error.message}`)
  }
  const undone = new Set((rows ?? []).filter((r: Rec) => r.decision === 'undone').map((r: Rec) => String(r.game_id)))
  let reverted = 0
  const skipped: Rec[] = []
  for (const row of (rows ?? []).filter((r: Rec) => r.decision === 'applied')) {
    if (undone.has(String(row.game_id))) continue
    const written = (row.written_values ?? {}) as Rec
    const prior = (row.prior_values ?? {}) as Rec
    const hasPrior = row.prior_values && Object.keys(prior).length > 0
    const { data: live } = await admin.from('games').select('*').eq('id', row.game_id).eq('user_id', userId).maybeSingle()
    if (!live) { skipped.push({ game_id: row.game_id, reason: 'game no longer exists' }); continue }
    const { data: plats } = await admin.from('game_platforms').select('*').eq('user_id', userId).eq('game_id', row.game_id)
    const platform = (plats ?? []).find((p: Rec) => p.is_primary_variant) ?? (plats ?? [])[0] ?? null

    const gamePatch: Rec = {}
    const platPatch: Rec = {}
    const kept: string[] = []
    for (const key of (row.fields_written ?? []) as string[]) {
      const isPlat = key.startsWith('platform.')
      const col = isPlat ? key.slice(9) : key
      const liveRow = isPlat ? platform : live
      if (!liveRow) continue
      if (!jsonEqual(liveRow[col], written[key])) { kept.push(col); continue }
      // Old journal rows (before migration 104) have no prior values: the old
      // apply only ever filled empty fields, so empty is the true inverse.
      const restore = hasPrior ? (prior[key] ?? null) : null
      ;(isPlat ? platPatch : gamePatch)[col] = restore
    }
    if (live.needs_review === false && row.prior_needs_review === true && 'needs_review' in gamePatch === false) gamePatch.needs_review = true
    if (!Object.keys(gamePatch).length && !Object.keys(platPatch).length) {
      skipped.push({ game_id: row.game_id, reason: 'everything has been edited since — nothing to revert' }); continue
    }
    if (Object.keys(gamePatch).length) {
      const { error: e } = await admin.from('games').update(gamePatch).eq('id', row.game_id).eq('user_id', userId)
      if (e) { skipped.push({ game_id: row.game_id, reason: scrub(e.message) }); continue }
    }
    if (platform && Object.keys(platPatch).length) {
      await admin.from('game_platforms').update(platPatch).eq('id', platform.id).eq('user_id', userId)
    }
    // Remove a stored copy only when nothing on the row points at it any more.
    const { data: now } = await admin.from('games').select('primary_cover_url, screenshot_url, fanart_url, media, provider_data').eq('id', row.game_id).maybeSingle()
    const refs = JSON.stringify(now ?? {})
    const removable = ((row.storage_paths ?? []) as string[]).filter(p => !refs.includes(p))
    if (removable.length) await admin.storage.from(BUCKET).remove(removable)
    await journal(userId, {
      game_id: row.game_id, run_id: runId, decision: 'undone', jeu_id: row.jeu_id, matched_title: row.matched_title,
      system_used: row.system_used, fields_written: Object.keys({ ...gamePatch, ...platPatch }), written_values: {},
      storage_paths: removable, prior_needs_review: row.prior_needs_review,
    })
    reverted++
    if (kept.length) skipped.push({ game_id: row.game_id, reason: `kept your own edits to ${kept.join(', ')}` })
  }
  return { status: 'ok', reverted, skipped }
}

// ─── Batch find ──────────────────────────────────────────────────────────────

/** "Sonic The Hedgehog (USA, Europe) [!]" → "Sonic The Hedgehog" — what a name search wants. */
const searchTitle = (t: string) => t.replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/\s+/g, ' ').trim()

async function findBatch(userId: string, gameIds: string[], prefs: SsPrefs): Promise<Rec[]> {
  const { data: games } = await admin.from('games').select('id, title').eq('user_id', userId).in('id', gameIds)
  const { data: plats } = await admin.from('game_platforms').select('game_id, esde_path, esde_system, is_primary_variant').eq('user_id', userId).in('game_id', gameIds)
  const systems = await loadSystems()
  const opts = { regions: prefs.regions, languages: prefs.languages }
  const runId = crypto.randomUUID()
  return inParallel(games ?? [], async (g: Rec) => {
    const mine = (plats ?? []).filter((p: Rec) => p.game_id === g.id)
    const p = mine.find((x: Rec) => x.is_primary_variant) ?? mine[0]
    const sys = resolveSystem(systems, p?.esde_system)
    const file = romFileName(p?.esde_path)
    const plan = planSearch({ name: searchTitle(String(g.title ?? '')), systemId: sys?.id ?? null, rom: file ? { filename: file } : null })
    // The strongest lookup first; a name search only when there is no ROM lookup to make.
    const q = plan.queries.find(x => x.kind === 'filename') ?? plan.queries.find(x => x.kind === 'name')
    if (!q) {
      await journal(userId, { game_id: g.id, run_id: runId, decision: 'unmatchable', system_used: sys?.name ?? p?.esde_system ?? null })
      return { game_id: g.id, outcome: 'unmatchable', reason: plan.notes[0]?.message ?? 'nothing to search with' }
    }
    const r = await callApi(q.endpoint, q.params)
    if (!r.ok) {
      if (r.kind === 'not_found') await journal(userId, { game_id: g.id, run_id: runId, decision: 'no_match', system_used: sys?.name ?? null })
      return { game_id: g.id, outcome: r.kind === 'not_found' ? 'no_match' : 'error', basis: q.kind, reason: r.kind === 'not_found' ? undefined : r.message }
    }
    const jeu = q.endpoint === 'jeuRecherche.php' ? (r.data?.response?.jeux ?? []).find(isRealJeu) : r.data?.response?.jeu
    if (!isRealJeu(jeu)) {
      await journal(userId, { game_id: g.id, run_id: runId, decision: 'no_match', system_used: sys?.name ?? null })
      return { game_id: g.id, outcome: 'no_match', basis: q.kind }
    }
    const cand = await signed(toCandidate(jeu, [q.kind], opts, 0))
    return { game_id: g.id, outcome: 'match', basis: q.kind, rom_filename: file, system: sys, candidate: cand }
  })
}

// ─── Handler ─────────────────────────────────────────────────────────────────

async function loadPrefs(userId: string, override: unknown): Promise<SsPrefs> {
  if (override && typeof override === 'object') return normalizePrefs(override)
  const { data } = await admin.from('screenscraper_prefs').select('prefs').eq('user_id', userId).maybeSingle()
  return normalizePrefs(data?.prefs)
}

function mediaChoices(raw: unknown, prefs: SsPrefs, inventoryTypes?: string[]): SsMediaChoice[] {
  if (Array.isArray(raw)) {
    return raw.filter((m: Rec) => m && typeof m.type === 'string' && /^[A-Za-z0-9-]{1,40}$/.test(m.type) && (m.mode === 'store' || m.mode === 'on_demand'))
      .map((m: Rec) => ({ type: m.type, token: typeof m.token === 'string' && MEDIA_TOKEN.test(m.token) ? m.token : null, mode: m.mode }))
      .slice(0, 60)
  }
  // No explicit list: the saved defaults, for every type in the catalogue.
  const types = inventoryTypes ?? MEDIA_TYPES.map(t => t.type)
  return types.map(t => ({ type: t, mode: mediaModeFor(prefs, t) }))
    .filter((c): c is SsMediaChoice => c.mode === 'store' || c.mode === 'on_demand')
}

function fieldPolicies(raw: unknown, prefs: SsPrefs): Partial<Record<SsField, FieldPolicy>> {
  const out: Partial<Record<SsField, FieldPolicy>> = { ...prefs.fields }
  if (raw && typeof raw === 'object') {
    for (const f of ALL_FIELDS) {
      const v = (raw as Rec)[f]
      if (v === 'fill' || v === 'replace' || v === 'skip') out[f] = v
    }
  }
  return out
}

const CODE_RE = /^[a-z]{2,4}$/
function overridesOf(raw: unknown): ApplyInput['overrides'] {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Rec
  const titleRegion = typeof r.title_region === 'string' && CODE_RE.test(r.title_region) ? r.title_region : null
  const descriptionLang = typeof r.description_lang === 'string' && CODE_RE.test(r.description_lang) ? r.description_lang : null
  return titleRegion || descriptionLang ? { titleRegion, descriptionLang } : null
}

const BASES: MatchBasis[] = ['hash', 'filename', 'serial', 'id', 'name']
const basisOf = (raw: unknown): MatchBasis[] => (Array.isArray(raw) ? raw.filter((b): b is MatchBasis => BASES.includes(b)) : [])

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return fail('Method Not Allowed', 405)
  if (!DEVID || !DEVPASSWORD) return json({ status: 'not_configured', error: 'SCREENSCRAPER_DEVID / SCREENSCRAPER_DEVPASSWORD are not set' })

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  if (userErr || !userData?.user) return fail('Unauthorized', 401)
  const userId = userData.user.id
  issued = 0
  lastUser = null

  const body = await req.json().catch(() => ({})) as Rec
  const action = String(body.action ?? 'status')

  try {
    switch (action) {
      case 'status': {
        const [quota, usage, counts] = await Promise.all([
          readQuota(),
          bucketBytes(),
          Promise.all([
            admin.from('games').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('library', 'retro'),
            admin.from('games').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('library', 'retro').eq('external_source', 'screenscraper'),
            admin.from('games').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('library', 'retro').is('primary_cover_url', null),
            admin.from('games').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('library', 'retro').is('description', null),
            admin.from('screenscraper_systems').select('id', { count: 'exact', head: true }),
          ]),
        ])
        const [all, scraped, noCover, noDesc, systems] = counts.map(c => c.count ?? 0)
        return json({
          status: 'ok',
          account: 'error' in quota ? null : { level: quota.level, premium: quota.level !== '0', threads: quota.threads, used: quota.used, max: quota.max },
          account_error: 'error' in quota ? quota.error : undefined,
          remaining_today: 'error' in quota ? null : Math.max(0, quota.max - quota.used),
          storage: usage,
          library: { retro: all, scraped, missing_cover: noCover, missing_description: noDesc },
          systems_known: systems,
        })
      }

      case 'storage':
        return json({ status: 'ok', storage: await bucketBytes() })

      case 'refresh_systems': {
        const r = await callApi('systemesListe.php', {})
        if (!r.ok) return fail(`systemesListe: ${r.message}`, 502)
        const list = r.data?.response?.systemes
        if (!Array.isArray(list)) return fail('systemesListe returned no system list', 502)
        const rows = list.map((s: Rec) => {
          const noms = (s.noms ?? {}) as Rec
          // `nom_retropie` is optional and comma-separated; every other name
          // is an alias too (ES-DE's `n3ds` is not in their retropie field).
          const extra = [noms.nom_eu, noms.nom_us, noms.nom_jp, noms.noms_commun, noms.nom_recalbox, noms.nom_launchbox]
            .flatMap(v => String(v ?? '').split(',')).map(a => a.trim().toLowerCase()).filter(Boolean)
          const aliases = [
            ...String(noms.nom_retropie ?? '').split(',').map(a => a.trim().toLowerCase()).filter(Boolean),
            ...extra, ...extra.map(a => a.replace(/[^a-z0-9]/g, '')).filter(Boolean),
          ]
          return { id: Number(s.id), name: noms.nom_eu ?? noms.nom_us ?? noms.noms_commun ?? null,
                   retropie_names: aliases.length ? [...new Set(aliases)] : null, company: s.compagnie ?? null,
                   fetched_at: new Date().toISOString() }
        }).filter((x: Rec) => Number.isFinite(x.id))
        const { error } = await admin.from('screenscraper_systems').upsert(rows, { onConflict: 'id' })
        if (error) return fail(`systems upsert: ${error.message}`)
        return json({ status: 'ok', systems: rows.length })
      }

      case 'search': {
        const prefs = await loadPrefs(userId, body.prefs)
        const out = await runSearch(body, prefs)
        return json({ status: 'ok', ...out, requests: issued, remaining_today: remaining() })
      }

      case 'candidate': {
        const jeuId = String(body.jeu_id ?? '')
        if (!/^\d{1,10}$/.test(jeuId)) return fail('candidate needs a numeric jeu_id', 400)
        const prefs = await loadPrefs(userId, body.prefs)
        const r = await callApi('jeuInfos.php', { gameid: jeuId })
        if (!r.ok) return json({ status: r.kind === 'not_found' ? 'not_found' : 'error', error: r.message })
        const jeu = r.data?.response?.jeu
        if (!isRealJeu(jeu)) return json({ status: 'not_found', error: TEXT_MESSAGE.not_found })
        const candidate = await signed(toCandidate(jeu, basisOf(body.matched_by), { regions: prefs.regions, languages: prefs.languages }, SNAPSHOT_CAPS.roms))
        return json({ status: 'ok', candidate, record: stripCredentials({ ...jeu, medias: undefined }), remaining_today: remaining() })
      }

      case 'apply': {
        const gameId = String(body.game_id ?? '')
        const jeuId = String(body.jeu_id ?? '')
        if (!gameId || !/^\d{1,10}$/.test(jeuId)) return fail('apply needs game_id and a numeric jeu_id', 400)
        const prefs = await loadPrefs(userId, body.prefs)
        const runId = typeof body.run_id === 'string' && body.run_id ? body.run_id : crypto.randomUUID()
        const result = await applyOne(userId, {
          gameId, jeuId, system: body.system, rom: body.rom && typeof body.rom === 'object' ? body.rom : null,
          fields: fieldPolicies(body.fields, prefs), media: mediaChoices(body.media, prefs), prefs, runId, basis: basisOf(body.matched_by),
          overrides: overridesOf(body.overrides),
        })
        return json({ status: 'ok', run_id: runId, result, requests: issued })
      }

      case 'find_batch': {
        const ids = Array.isArray(body.game_ids) ? body.game_ids.map(String).slice(0, FIND_MAX) : []
        if (!ids.length) return fail('find_batch needs game_ids', 400)
        const quota = await readQuota()
        if (!('error' in quota) && quota.max - quota.used < QUOTA_FLOOR) {
          return json({ status: 'quota_exhausted', remaining_today: Math.max(0, quota.max - quota.used) })
        }
        const prefs = await loadPrefs(userId, body.prefs)
        const results = await findBatch(userId, ids, prefs)
        return json({ status: 'ok', results, requests: issued, remaining_today: remaining() })
      }

      case 'apply_batch': {
        const items = Array.isArray(body.items) ? body.items.slice(0, APPLY_BATCH_MAX) : []
        if (!items.length) return fail('apply_batch needs items', 400)
        const prefs = await loadPrefs(userId, body.prefs)
        const runId = typeof body.run_id === 'string' && body.run_id ? body.run_id : crypto.randomUUID()
        const results: Rec[] = []
        // One game at a time: each already downloads its images in parallel.
        for (const it of items as Rec[]) {
          const jeuId = String(it.jeu_id ?? '')
          if (!/^\d{1,10}$/.test(jeuId)) { results.push({ game_id: it.game_id, outcome: 'error', reason: 'bad jeu_id' }); continue }
          results.push(await applyOne(userId, {
            gameId: String(it.game_id), jeuId, system: it.system ?? null,
            rom: it.rom_filename ? { filename: String(it.rom_filename) } : null,
            fields: fieldPolicies(null, prefs), media: mediaChoices(null, prefs), prefs, runId, basis: basisOf(it.matched_by),
            overrides: null,
          }))
        }
        return json({ status: 'ok', run_id: runId, results, requests: issued, remaining_today: remaining() })
      }

      case 'undo': {
        const runId = String(body.run_id ?? '')
        if (!runId) return fail('undo needs a run_id', 400)
        return json(await undoRun(userId, runId))
      }

      case 'sweep_pending': {
        let removed = 0
        const list = async (prefix: string) => {
          const names: string[] = []
          for (let offset = 0; ; offset += 100) {
            const { data, error } = await admin.storage.from(BUCKET).list(prefix, { limit: 100, offset })
            if (error) throw new Error(error.message)
            names.push(...(data ?? []).map(d => d.name))
            if (!data || data.length < 100) break
          }
          return names
        }
        for (const g of await list('pending')) {
          for (const j of await list(`pending/${g}`)) {
            const base = `pending/${g}/${j}`
            const paths = (await list(base)).map(n => `${base}/${n}`)
            if (paths.length) { await admin.storage.from(BUCKET).remove(paths); removed += paths.length }
          }
        }
        return json({ status: 'ok', removed })
      }

      default:
        return fail(`Unknown action "${action}"`, 400)
    }
  } catch (e) {
    return fail((e as Error).message)
  }
})
