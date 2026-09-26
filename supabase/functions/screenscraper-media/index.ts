// screenscraper-media — streams one ScreenScraper file to the browser without
// ever showing the browser a ScreenScraper URL.
//
// Every URL ScreenScraper hands out carries devid/devpassword/ssid/sspassword
// in its query string, so it can never reach a browser, a log or the database.
// This function takes a signed reference instead — ?j=<game>&s=<system>&m=
// <their media token>&x=<expiry>&k=<signature> (+ w/f for a resized image, e
// for a video or manual) — adds the credentials server-side and streams the
// bytes back. Nothing is stored: this is how "online" media costs no Storage.
// (Stored copies are made by screenscraper-sync, not here.)
//
// ── Auth: JWT verification OFF, signature ON ───────────────────────────────
// An <img> or <video> tag cannot send an Authorization header, so platform
// JWT checks are off for this function (supabase/config.toml). Instead every
// request carries an HMAC that screenscraper-sync minted for the OWNER only,
// binding ONE game on ONE system until an expiry (at most two weeks), and only
// a few fixed widths are served. A leaked link therefore fetches one game's
// own media, a handful of variants, for a week or two — never anything else.
//
// ── Politeness ──────────────────────────────────────────────────────────────
// ScreenScraper answers 429 above the account's thread limit and 401/423 when
// their servers are overloaded or closed. The browser queues proxy loads (3 at
// a time); here a busy answer is retried once after a pause, and otherwise
// passed on as 503 with Retry-After — never as a broken image a browser caches.
//
// ── Security, all load-bearing ─────────────────────────────────────────────
//  1. No upstream URL, header or body text is ever returned or logged; errors
//     are fixed short strings.
//  2. A redirect is followed at most once, by hand, and only to an https
//     screenscraper.fr host — their credentials sit in the query string.
//  3. Only real media types pass (png/jpeg/webp/gif, pdf, mp4/webm — never
//     SVG or HTML), with a response-header whitelist, `nosniff` and a sandbox
//     CSP.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'range, apikey, authorization, x-client-info',
  'Access-Control-Expose-Headers': 'content-length, content-range, accept-ranges',
}

const API = 'https://api.screenscraper.fr/api2'
const SOFTNAME = 'lascisboard'
const DEVID = Deno.env.get('SCREENSCRAPER_DEVID') ?? ''
const DEVPASSWORD = Deno.env.get('SCREENSCRAPER_DEVPASSWORD') ?? ''
const SSID = Deno.env.get('SCREENSCRAPER_SSID') ?? ''
const SSPASSWORD = Deno.env.get('SCREENSCRAPER_SSPASSWORD') ?? ''
const MEDIA_KEY = Deno.env.get('SCREENSCRAPER_MEDIA_KEY') || (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
const TIMEOUT_MS = 30_000

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
type SsPlatformField = 'release_date' | 'region' | 'rating' | 'wheel' | 'version_title' | 'rom_status'
type SsField = SsGameField | SsPlatformField

/** fill = only when empty · replace = overwrite what is there · skip = never */
type FieldPolicy = 'fill' | 'replace' | 'skip'

/** How a search result was found. `hash` and a VERIFIED `filename` (their
 *  answer names the same dump) are ROM identity; `filename_guess` is their
 *  best guess for a filename they do not know (a renamed or hacked ROM);
 *  `previous` is the id this game was matched to before; `id` an id typed in;
 *  `name` a text search (weak). */
type MatchBasis = 'hash' | 'filename' | 'filename_guess' | 'serial' | 'id' | 'previous' | 'name'

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

/** A file ScreenScraper attaches to something other than the game itself — a
 *  genre or rating pictogram, a publisher logo, a hack's screenshot. Kept as
 *  an inventory (what exists), not served. */
interface SsExtraMedia { parent: string; parent_label: string | null; type: string; region: string | null; format: string | null; size: number | null }

interface SsHack { id: string | null; name: string | null; author: string | null; status: string | null; version: string | null; synopses: SsLocalized[] }

/** A normalized search result. Carries values, never a media URL. */
interface SsCandidate {
  jeu_id: string
  rom_id: string | null
  system: { id: number | null; name: string | null }
  publisher_id: string | null
  developer_id: string | null
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
  /** Their controls / colours text (arcade cabinets mostly), when given. */
  controls: string | null
  colours: string | null
  /** Tips and tricks, per language. */
  tips: { lang: string; title: string | null; text: string }[]
  /** Hacks of this game they know (no download links — those carry credentials). */
  hacks: SsHack[]
  /** Control mappings as text ("BTN-A|BTN-B=Spin Dash"). */
  actions: string[]
  flags: string[]
  media: SsMediaEntry[]
  extra_media: SsExtraMedia[]
  /** Signs `jeu_id|system|expiry` for the media proxy (see ssProxy.ts). */
  media_sig: string | null
  /** Unix seconds the signature stops working. */
  media_exp: number | null
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
  /** Also keep their raw answer (minus URLs) beside the normalized record, in game_scrape_records. */
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
// app actually shows is copied, small — the cover, screenshot, title screen and
// fan art (library, hero, screenshot strip) and the HD logo (the variant's
// wheel_url) — and even those only when the copy will be used (ssPlan.ts
// decideMediaModes). Everything else is shown online through the signed proxy
// when looked at; composites and theme assets are skipped. Measured sizes at
// these widths: box art 24-61 KB at 640 px, a transparent logo ~14 KB.
//
// Pictograms (genre, rating, publisher logos) are not game media — their
// `parent` is not `jeu` — and are kept as an inventory only (extra_media).

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
  T('box-2D-back', 'Box back', 'box', 'on_demand', 640),
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
  T('bezel-4-3', 'Bezel 4:3', 'extras', 'skip', 1280, true),
  T('maps', 'Maps', 'extras', 'on_demand', 1280),
  T('box-scan', 'Box scan', 'box', 'on_demand', 1280),
  T('support-scan', 'Cartridge / disc scan', 'support', 'on_demand', 1280),
  T('flyer', 'Flyer', 'art', 'on_demand', 1280),
  T('figurine', 'Figurine', 'art', 'on_demand', 640, true),
  T('themehs', 'HyperSpin theme', 'extras', 'skip', 960, true),
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

// `=` or its percent-encoded form, as it appears inside a nested encoded URL.
const CREDENTIAL_PARAM = /\b(devid|devpassword|ssid|sspassword)(=|%3d)/i
const URL_KEYS = new Set(['url', 'downloadurl', 'commandRequested'])

/** Caps for arrays that can run long on a popular game. */
const SNAPSHOT_CAPS: Record<string, number> = { roms: 300, hacks: 50, medias: 500, actions: 50, tips: 100 }

/**
 * A deep copy of a ScreenScraper payload with every URL removed — the only
 * form in which any part of their answer may be stored or sent to a browser.
 * Drops URL keys outright, any string that carries a credential parameter
 * (plain or percent-encoded), and any string containing one of the secret
 * VALUES themselves (their `ssuser.id` is the member login in plain text).
 */
function stripCredentials(value: unknown, secrets: (string | null | undefined)[] = [], depth = 0): unknown {
  if (depth > 12) return null
  if (typeof value === 'string') {
    if (CREDENTIAL_PARAM.test(value)) return null
    for (const s of secrets) if (s && s.length >= 4 && value.includes(s)) return null
    return value
  }
  if (Array.isArray(value)) return value.map(v => stripCredentials(v, secrets, depth + 1))
  if (value && typeof value === 'object') {
    const out: Rec = {}
    for (const [k, v] of Object.entries(value as Rec)) {
      if (URL_KEYS.has(k)) continue
      let next = v
      if (Array.isArray(v) && SNAPSHOT_CAPS[k] != null && v.length > SNAPSHOT_CAPS[k]) next = v.slice(0, SNAPSHOT_CAPS[k])
      const clean = stripCredentials(next, secrets, depth + 1)
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

/** Files attached to something other than the game (pictograms, logos, hack
 *  art) — what exists, without URLs. */
function extraMediaInventory(medias: unknown): SsExtraMedia[] {
  const out: SsExtraMedia[] = []
  for (const m of arr(medias)) {
    const parent = str(m.parent)
    const type = str(m.type)
    if (!parent || parent === 'jeu' || !type) continue
    out.push({ parent, parent_label: str(m.subparent), type, region: str(m.region)?.toLowerCase() ?? null, format: str(m.format)?.toLowerCase() ?? null, size: num(m.size) })
  }
  return out.slice(0, 200)
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

/** Their controles/couleurs arrive as "0", a string, or a list of objects. */
function looseText(v: unknown): string | null {
  if (Array.isArray(v)) {
    const parts = v.map(e => (e && typeof e === 'object' ? str((e as Rec).text) ?? str((e as Rec).controle) ?? str((e as Rec).hexa) : str(e))).filter((x): x is string => !!x)
    return parts.length ? parts.join(', ') : null
  }
  const s = str(v)
  return s && s !== '0' ? s : null
}

function tipsOf(list: unknown, languages: string[]): { lang: string; title: string | null; text: string }[] {
  const all = arr(list).map(t => ({ lang: String(t.langue ?? '').toLowerCase(), title: str(t.titre), text: str(t.description) ?? str(t.text) ?? '' }))
    .filter(t => t.text)
  const rank = (l: string) => { const i = languages.indexOf(l); return i < 0 ? languages.length : i }
  return all.sort((a, b) => rank(a.lang) - rank(b.lang)).slice(0, 40)
}

function hacksOf(list: unknown): SsHack[] {
  return arr(list).slice(0, 50).map(h => ({
    id: str(h.id), name: str(h.name) ?? str(h.nom), author: str(h.developpeur), status: str(h.status),
    version: str(h.version), synopses: localizedList(h.synopsis, 'langue'),
  }))
}

function actionsOf(list: unknown, languages: string[]): string[] {
  return arr(list).slice(0, 50)
    .map(a => pickPreferred(localizedList(a.controle, 'langue'), languages)?.text ?? null)
    .filter((x): x is string => !!x)
}

/**
 * "Sonic The Hedgehog (USA, Europe) (Rev 1) [!].md" → "USA, Europe · Rev 1 · !":
 * the dump's own tags, the honest name of this version.
 */
function romTags(filename: string | null | undefined): string | null {
  if (!filename) return null
  const tags = [...filename.replace(/\.[A-Za-z0-9]{1,5}$/, '').matchAll(/[([]([^)\]]+)[)\]]/g)].map(m => m[1].trim()).filter(Boolean)
  return tags.length ? tags.join(' · ') : null
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
  // The user's own region order decides the title too; `ss` (their canonical
  // name) is one entry in that order, not a hard prefix.
  const title = pickPreferred(names, opts.regions)?.text ?? null
  const description = pickPreferred(synopses, opts.languages)?.text ?? null

  return {
    jeu_id: String(jeu.id ?? ''),
    rom_id: str(jeu.romid),
    system: { id: num((jeu.systeme as Rec | undefined)?.id), name: str(jeu.systeme) },
    publisher_id: str((jeu.editeur as Rec | undefined)?.id),
    developer_id: str((jeu.developpeur as Rec | undefined)?.id),
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
      version_title: rom ? romTags(rom.filename) : null,
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
    controls: looseText(jeu.controles),
    colours: looseText(jeu.couleurs),
    tips: tipsOf(jeu.tips, opts.languages),
    hacks: hacksOf(jeu.hacks),
    actions: actionsOf(jeu.actions, opts.languages),
    flags: candidateFlags(jeu, rom),
    media: mediaInventory(jeu.medias),
    extra_media: extraMediaInventory(jeu.medias),
    media_sig: null,
    media_exp: null,
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

type SsTextKind = 'not_found' | 'no_media' | 'unchanged' | 'login' | 'quota' | 'ko_quota' | 'closed' | 'busy' | 'bad_request' | 'other'

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
  if (status === 431 || /non reconnu|roms? inconnu/.test(b)) return 'ko_quota'
  if (status === 430 || /quota/.test(b)) return 'quota'
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
  ko_quota: 'Too many unrecognised lookups today (their separate allowance for misses); it resets at midnight CET.',
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
// account's daily allowance. The signature binds ONE game on ONE system until
// an expiry, and only a few fixed widths are served — so a leaked link fetches
// that game's own media, a handful of variants, for a week at most.
// Signatures are minted on demand by screenscraper-sync (owner only) and never
// stored, so rotating the signing key breaks nothing permanently.


const PROXY_PATH = '/functions/v1/screenscraper-media'

/** The exact bytes that get signed. Versioned so the scheme can change. */
const sigPayload = (jeuId: string, systemId: number | string, exp: number) => `ssm2|${jeuId}|${systemId}|${exp}`

interface ProxyRef { jeuId: string; systemId: number; sig: string; exp: number }

/** The only widths served. Few distinct URLs per file keep both the browser
 *  cache and ScreenScraper's allowance intact. */
const PROXY_WIDTHS = [120, 200, 360, 640, 1280] as const
/** The smallest served width at least as large as asked (or the largest). */
function snapWidth(w: number | null | undefined): number | null {
  if (w == null || !Number.isFinite(w) || w <= 0) return null
  return PROXY_WIDTHS.find(x => x >= w) ?? PROXY_WIDTHS[PROXY_WIDTHS.length - 1]
}

const WEEK = 7 * 24 * 3600
/** A signature's expiry: the end of NEXT week (unix seconds). The same value
 *  all week long, so proxy URLs — and the browser's cache of them — stay
 *  stable, while no link outlives two weeks. */
const mediaExpiry = (nowMs: number) => (Math.floor(nowMs / 1000 / WEEK) + 2) * WEEK
/** Longest validity a request may claim — refuses a forged far-future expiry. */
const MAX_EXPIRY_AHEAD = 2 * WEEK + 60

interface ProxyRequest {
  jeuId: string
  systemId: number
  ep: MediaEndpoint
  token: string
  /** maxwidth / outputformat — images only. */
  width: number | null
  format: 'png' | 'jpg' | null
  sig: string
  exp: number
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
  const x = q.get('x') ?? ''
  if (!/^\d{1,10}$/.test(j)) return { error: 'bad game id' }
  if (!/^\d{9,11}$/.test(x)) return { error: 'bad expiry' }
  if (!/^\d{1,6}$/.test(s)) return { error: 'bad system id' }
  if (!EP.includes(ep)) return { error: 'bad endpoint' }
  if (!MEDIA_TOKEN.test(token)) return { error: 'bad media token' }
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(sig)) return { error: 'bad signature' }
  let width: number | null = null
  if (w != null && w !== '') {
    const n = Number(w)
    if (!(PROXY_WIDTHS as readonly number[]).includes(n)) return { error: 'bad width' }
    width = n
  }
  const format = f === 'png' || f === 'jpg' ? f : null
  if (f != null && f !== '' && !format) return { error: 'bad format' }
  return { jeuId: j, systemId: Number(s), ep, token, width: ep === 'img' ? width : null, format: ep === 'img' ? format : null, sig, exp: Number(x) }
}

/** The query string for one file. Order is fixed so equal requests are equal
 *  URLs — which is what lets the browser cache them. */
function proxyQuery(ref: ProxyRef, entry: Pick<SsMediaEntry, 'ep' | 'token'>, opts: { width?: number | null; format?: 'png' | 'jpg' | null } = {}): string {
  const p = new URLSearchParams()
  p.set('j', ref.jeuId)
  p.set('s', String(ref.systemId))
  if (entry.ep !== 'img') p.set('e', entry.ep)
  p.set('m', entry.token)
  const w = entry.ep === 'img' ? snapWidth(opts.width) : null
  if (w) p.set('w', String(w))
  if (entry.ep === 'img' && opts.format) p.set('f', opts.format)
  p.set('x', String(ref.exp))
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

/**
 * Where a stored copy lives: under our own game id, with a per-upload stamp,
 * so a re-scrape never overwrites bytes an undo may point back at (a reused
 * path would serve the new picture under the restored URL).
 */
const storedPath = (gameId: string, type: string, stamp: string, ext: string) => `${gameId}/${type}-${stamp}.${ext}`

/** Is this a stored ScreenScraper copy of THIS game — the only kind of object
 *  undo or cleanup may ever delete? */
function isScrapeCopyOf(gameId: string, path: string): boolean {
  if (!/^[0-9a-f-]{36}$/i.test(gameId)) return false
  return path.startsWith(`${gameId}/`) && /^[0-9a-f-]{36}\/[A-Za-z0-9-]{1,60}\.(png|jpg|jpeg|webp|gif)$/i.test(path)
}

/** Image types that may be served or stored — never SVG (script) or HTML. */
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
/** The content types the proxy passes through; anything else (their plain-text
 *  errors included) is not a file. */
function allowedContentType(ep: MediaEndpoint, contentType: string): boolean {
  const t = contentType.toLowerCase().split(';')[0].trim()
  if (ep === 'img') return IMAGE_TYPES.includes(t)
  if (ep === 'video') return t === 'video/mp4' || t === 'video/webm' || t === 'application/octet-stream'
  return t === 'application/pdf' || t === 'application/octet-stream'
}
/** The file extension for a stored image of this content type. */
function imageExtension(contentType: string): 'png' | 'jpg' | 'webp' | 'gif' | null {
  const t = contentType.toLowerCase().split(';')[0].trim()
  return t === 'image/png' ? 'png' : t === 'image/jpeg' ? 'jpg' : t === 'image/webp' ? 'webp' : t === 'image/gif' ? 'gif' : null
}

/**
 * A redirect target that may be fetched: https, on a screenscraper.fr host.
 * Their credentials sit in the query string, so following a Location to an
 * arbitrary host (or plain http) would hand them over.
 */
function safeRedirect(base: string, location: string | null): string | null {
  if (!location) return null
  let u: URL
  try { u = new URL(location, base) } catch { return null }
  if (u.protocol !== 'https:') return null
  const host = u.hostname.toLowerCase()
  return host === 'screenscraper.fr' || host.endsWith('.screenscraper.fr') ? u.toString() : null
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
 * HMAC-SHA256 over `sigPayload`. The secret is SCREENSCRAPER_MEDIA_KEY when
 * set, else the service-role key (injected into every function, so the two
 * functions agree with no setup) — hashed with a label first so the signing
 * key is never the secret itself. 32 characters (192 bits).
 */
async function signMedia(secret: string, jeuId: string, systemId: number | string, exp: number): Promise<string> {
  const enc = new TextEncoder()
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`screenscraper-media-v2:${secret}`))
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(sigPayload(jeuId, systemId, exp)))
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
const PLATFORM_FIELDS = ['release_date', 'region', 'rating', 'wheel', 'version_title', 'rom_status'] as const
const ALL_FIELDS: SsField[] = [...GAME_FIELDS, ...PLATFORM_FIELDS]

const FIELD_LABEL: Record<SsField, string> = {
  title: 'Title', description: 'Description', release_year: 'Release year',
  publisher: 'Publisher', developer: 'Developer', genres: 'Genres', modes: 'Modes',
  players: 'Players', age_rating: 'Age rating', series_name: 'Series',
  cover: 'Cover', screenshot: 'Screenshot', fanart: 'Fan art',
  release_date: 'Release date (this version)', region: 'Region (this ROM)', rating: 'ScreenScraper score',
  wheel: 'Logo', version_title: 'Version (this ROM)', rom_status: 'ROM verified',
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
  wheel: { table: 'game_platforms', column: 'wheel_url' },
  version_title: { table: 'game_platforms', column: 'version_title' },
  rom_status: { table: 'game_platforms', column: 'rom_status' },
}

/** Media field → the media type that supplies it. */
const FIELD_MEDIA: Partial<Record<SsField, string>> = { cover: 'box-2D', screenshot: 'ss', fanart: 'fanart', wheel: 'wheel-hd' }

/** Media type → the ES-DE asset category that already holds the same picture.
 *  A type whose picture the handheld has already uploaded is not copied again
 *  by default (it would spend the budget on a duplicate). */
const ESDE_CATEGORY: Record<string, string> = {
  'box-2D': 'covers', 'box-3D': '3dboxes', ss: 'screenshots', sstitle: 'titlescreens', fanart: 'fanart',
  'box-2D-back': 'backcovers', 'wheel-hd': 'marquees', 'support-2D': 'physicalmedia',
}

// ─── Preferences ─────────────────────────────────────────────────────────────

/** Every field fills gaps and never overwrites — the promise the old scraper
 *  made. Replacing is always an explicit choice, per field or per game. */
function defaultPrefs(): SsPrefs {
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
const EXACT_BASES: MatchBasis[] = ['hash', 'filename', 'serial', 'id']

/** "./roms/Sonic (USA).zip" → "sonic (usa)": the comparable part of a ROM name
 *  (their list may name the .zip or the file inside it). */
function romStem(name: string | null | undefined): string | null {
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
function verifyFilenameMatch(
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
function verifyHashMatch(
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
function decideMediaModes(
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

/** One upstream fetch; a redirect is followed once, by hand, and only to an
 *  https screenscraper.fr host. Throws a fixed message on any failure. */
/** A fetch whose deadline covers the wait for the RESPONSE HEADERS only — a
 *  signal left on the request would also cut the streamed body off, so a
 *  manual or video longer than the timeout stopped mid-file. */
async function headersWithin(url: string, init: RequestInit): Promise<Response> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try { return await fetch(url, { ...init, signal: ctl.signal }) } finally { clearTimeout(timer) }
}

async function fetchUpstream(url: string, range: string | null): Promise<Response> {
  const headers: Record<string, string> = { 'User-Agent': SOFTNAME }
  if (range) headers.Range = range
  const opts = { redirect: 'manual' as const, headers }
  let res = await headersWithin(url, opts)
  if (res.status >= 300 && res.status < 400) {
    const target = safeRedirect(url, res.headers.get('location'))
    await res.body?.cancel()
    if (!target) return new Response(null, { status: 502 })
    res = await headersWithin(target, opts)
    if (res.status >= 300 && res.status < 400) { await res.body?.cancel(); return new Response(null, { status: 502 }) }
  }
  return res
}

const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  // GET only: a HEAD would still cost a full upstream request.
  if (req.method !== 'GET') return text(405, 'Method Not Allowed')
  if (!DEVID || !DEVPASSWORD || !MEDIA_KEY) return text(503, 'not configured')

  const parsed = parseProxyQuery(new URL(req.url).searchParams)
  if ('error' in parsed) return text(400, parsed.error)
  const nowSec = Math.floor(Date.now() / 1000)
  if (parsed.exp < nowSec) return text(403, 'link expired', { 'Cache-Control': 'no-store' })
  if (parsed.exp > nowSec + MAX_EXPIRY_AHEAD) return text(403, 'bad expiry')

  const expected = await signMedia(MEDIA_KEY, parsed.jeuId, parsed.systemId, parsed.exp)
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
    // Same signed parameters, same bytes — cache until the link expires.
    headers.set('Cache-Control', `public, max-age=${Math.max(60, parsed.exp - nowSec)}, immutable`)
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin')
    headers.set('X-Content-Type-Options', 'nosniff')
    // Images and videos can run nothing: sandboxed. A manual is a PDF, and
    // browser PDF viewers refuse to render under a sandbox CSP — the type
    // allow-list and nosniff are its guard (and it is on this function's own
    // origin, never the app's).
    if (parsed.ep !== 'manual') headers.set('Content-Security-Policy', "default-src 'none'; sandbox")
    headers.set('Content-Disposition', 'inline')
    return new Response(res.body, { status: res.status, headers })
  }

  const kind = got.kind
  if (kind === 'no_media' || kind === 'not_found') return text(404, 'no such media', { 'Cache-Control': 'public, max-age=86400' })
  if (kind === 'busy' || kind === 'closed') return text(503, 'screenscraper busy', { 'Retry-After': '20' })
  if (kind === 'quota') return text(503, 'daily quota used', { 'Retry-After': '3600' })
  if (kind === 'login') return text(502, 'upstream login failed')
  return text(502, 'upstream error')
})
