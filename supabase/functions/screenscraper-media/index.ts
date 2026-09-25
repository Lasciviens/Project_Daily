// screenscraper-media — streams one ScreenScraper file to the browser without
// ever showing the browser a ScreenScraper URL.
//
// Every URL ScreenScraper hands out carries devid/devpassword/ssid/sspassword
// in its query string, so it can never reach a browser, a log or the database.
// This function takes a signed reference instead — ?j=<game>&s=<system>&m=
// <their media token>&k=<signature> (+ w/f for a resized image, e for a video
// or manual) — adds the credentials server-side and streams the bytes back.
// Nothing is stored: this is how "fetch on demand" media costs no Storage at
// all. (Stored copies are made by screenscraper-sync, not here.)
//
// ── Auth: JWT verification OFF, signature ON ───────────────────────────────
// An <img> or <video> tag cannot send an Authorization header, so platform
// JWT checks must be off for this function (supabase/config.toml). Instead
// every request carries an HMAC that screenscraper-sync issued, binding ONE
// game on ONE system. Without a valid signature nothing is fetched, so the
// account's daily allowance cannot be spent by strangers; with one, the most a
// leaked link fetches is that one game's own artwork.
//
// ── Politeness ──────────────────────────────────────────────────────────────
// ScreenScraper answers 429 above the account's thread limit and 401/423 when
// their servers are overloaded or closed. The browser side queues proxy loads
// (a few at a time); here a busy answer is retried once after a short pause
// and otherwise passed on as 503 with Retry-After, never as a broken image
// the browser would cache.
//
// ── Security, all load-bearing ─────────────────────────────────────────────
//  1. No upstream URL, header or body text is ever returned or logged; errors
//     are fixed short strings.
//  2. Redirects are not followed with credentials: `redirect: 'manual'`, and
//     a Location is followed once, bare.
//  3. Only the content types a media file can have are passed through, and
//     only a whitelist of response headers.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'range, apikey, authorization, x-client-info',
  'Access-Control-Expose-Headers': 'content-length, content-range, accept-ranges',
}

const API = 'https://api.screenscraper.fr/api2'
const SOFTNAME = 'lascisboard'
const DEVID = Deno.env.get('SCREENSCRAPER_DEVID') ?? ''
const DEVPASSWORD = Deno.env.get('SCREENSCRAPER_DEVPASSWORD') ?? ''
const SSID = Deno.env.get('SCREENSCRAPER_SSID') ?? ''
const SSPASSWORD = Deno.env.get('SCREENSCRAPER_SSPASSWORD') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const text = (status: number, body: string, extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra } })

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

function upstreamUrl(req: ProxyRequest): string {
  const { file, params } = upstreamFor(req)
  const u = new URL(`${API}/${file}`)
  u.searchParams.set('devid', DEVID)
  u.searchParams.set('devpassword', DEVPASSWORD)
  u.searchParams.set('softname', SOFTNAME)
  if (SSID) u.searchParams.set('ssid', SSID)
  if (SSPASSWORD) u.searchParams.set('sspassword', SSPASSWORD)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  return u.toString()
}

/** One upstream fetch; a redirect is followed once WITHOUT the credentials. */
async function fetchUpstream(url: string, range: string | null): Promise<Response> {
  const headers: Record<string, string> = { 'User-Agent': SOFTNAME }
  if (range) headers.Range = range
  let res = await fetch(url, { redirect: 'manual', headers })
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location')
    await res.body?.cancel()
    if (!location) return new Response(null, { status: 502 })
    res = await fetch(location, { redirect: 'follow', headers: range ? { Range: range } : {} })
  }
  return res
}

const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'GET' && req.method !== 'HEAD') return text(405, 'Method Not Allowed')
  if (!DEVID || !DEVPASSWORD || !SERVICE_KEY) return text(503, 'not configured')

  const parsed = parseProxyQuery(new URL(req.url).searchParams)
  if ('error' in parsed) return text(400, parsed.error)

  const expected = await signMedia(SERVICE_KEY, parsed.jeuId, parsed.systemId)
  if (!safeEqual(expected, parsed.sig)) return text(403, 'bad signature')

  const url = upstreamUrl(parsed)
  const range = parsed.ep === 'video' ? req.headers.get('range') : null

  // A file, or the KIND of their plain-text answer (read only to classify —
  // never echoed). A busy answer is worth one short retry; any other is final.
  type Attempt = { file: Response } | { kind: SsTextKind }
  const attempt = async (): Promise<Attempt> => {
    const res = await fetchUpstream(url, range)
    const ct = res.headers.get('content-type') ?? ''
    if ((res.ok || res.status === 206) && allowedContentType(parsed.ep, ct)) return { file: res }
    const body = await res.text().catch(() => '')
    return { kind: classifyText(res.status, body) }
  }
  let got: Attempt
  try {
    got = await attempt()
    if ('kind' in got && got.kind === 'busy') {
      await new Promise(r => setTimeout(r, 1500))
      got = await attempt()
    }
  } catch {
    return text(502, 'upstream unreachable', { 'Retry-After': '30' })
  }

  if ('file' in got) {
    const res = got.file
    const headers = new Headers(CORS)
    for (const h of PASS_HEADERS) {
      const v = res.headers.get(h)
      if (v) headers.set(h, v)
    }
    // Same signed parameters, same bytes — safe to cache for a year. A new
    // version of their artwork arrives under a new token or a re-scrape.
    headers.set('Cache-Control', 'public, max-age=31536000, immutable')
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin')
    headers.set('X-Content-Type-Options', 'nosniff')
    if (req.method === 'HEAD') { await res.body?.cancel(); return new Response(null, { status: res.status, headers }) }
    return new Response(res.body, { status: res.status, headers })
  }

  const kind = got.kind
  if (kind === 'no_media' || kind === 'not_found') return text(404, 'no such media', { 'Cache-Control': 'public, max-age=86400' })
  if (kind === 'busy' || kind === 'closed') return text(503, 'screenscraper busy', { 'Retry-After': '20' })
  if (kind === 'quota') return text(503, 'daily quota used', { 'Retry-After': '3600' })
  if (kind === 'login') return text(502, 'upstream login failed')
  return text(502, 'upstream error')
})
