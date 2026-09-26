// screenscraper-sync — search ScreenScraper, then save exactly what the user
// chose from a result: fields, artwork, and their full record.
//
// Rewritten from scratch (2026-09-25), then hardened after an adversarial
// review. Browser-JWT auth (verify_jwt ON), and OWNER ONLY: the ScreenScraper
// account, its daily allowance and its premium membership belong to one
// person (HEVY_USER_ID, the single-user id every server path uses). The pure
// logic — normalization, search planning, field policies, media decisions,
// credential stripping, media signing — lives in src/features/games/scraper/
// and is GENERATED into the `<ss-shared>` region below by
// scripts/sync-screenscraper-shared.mjs. Edit it there.
//
// ── Actions ─────────────────────────────────────────────────────────────────
//  status          account, quota, library counts, storage usage
//  storage         storage usage + budget (no ScreenScraper request)
//  refresh_systems cache their system list (ES-DE folder → numeric id)
//  search          name and/or ROM (filename, size, CRC/MD5/SHA1, serial)
//                  and/or ScreenScraper id — all at once, merged
//  candidate       one entry in full, with its complete record
//  sign            fresh media-proxy signatures for games already saved
//  apply           write one chosen entry to one game, as chosen
//  find_batch      best match for up to 10 games (no writes)
//  apply_batch     apply with the saved defaults, up to 5 games
//  undo            take an apply run back (the latest one per game)
//  cleanup         delete ScreenScraper copies nothing points at any more
//
// ── Security, all load-bearing ─────────────────────────────────────────────
//  1. No ScreenScraper URL is ever returned, logged or stored: every URL they
//     send carries devid/devpassword/ssid/sspassword (media, hack downloads,
//     `header.commandRequested`). Payloads leave only through
//     `stripCredentials`; media is copied into Storage here or streamed by the
//     signed `screenscraper-media` proxy.
//  2. Every error string is scrubbed — failures land in app_error_logs, which
//     ai-proxy can read.
//  3. A redirect is followed at most once, by hand, and only to an https
//     screenscraper.fr host (their credentials sit in the query string).
//  4. The journal is written only here (migration 104 made it read-only for
//     the browser), and undo restores only columns an apply can write and
//     deletes only this game's own stored copies.
//
// ── Storage wall ────────────────────────────────────────────────────────────
// The Free plan's 1 GB is a hard wall: over quota the project is eventually
// locked (402 on every request — tasks, food, training, not only Games).
// Nothing is copied without reading the bucket size first (game_media_usage,
// migration 104) and staying under min(saved budget, 950 MB). The budget is
// always the SAVED one — a request cannot raise it. An image that would cross
// it is kept online instead, and the result says so.
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
/** No copy is ever stored past this, whatever the saved budget says. */
const HARD_CAP_MB = 950
/** Below this many requests (or failed-lookup allowance) left today, nothing
 *  starts: the handheld's own ES-DE scraping spends from the same account. */
const QUOTA_FLOOR = 300
const KO_FLOOR = 50
/** Concurrent ScreenScraper requests from one invocation. The account grants 7
 *  threads; the proxy and the handheld need some of them too. */
const PARALLEL = 3
const FIND_MAX = 10
const APPLY_BATCH_MAX = 5
const API_TIMEOUT_MS = 20_000
const MEDIA_TIMEOUT_MS = 30_000
/** Wall clock is 150 s on the Free plan; stop starting new games well before. */
const BATCH_DEADLINE_MS = 95_000

const DEVID = Deno.env.get('SCREENSCRAPER_DEVID') ?? ''
const DEVPASSWORD = Deno.env.get('SCREENSCRAPER_DEVPASSWORD') ?? ''
const SSID = Deno.env.get('SCREENSCRAPER_SSID') ?? ''
const SSPASSWORD = Deno.env.get('SCREENSCRAPER_SSPASSWORD') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const MEDIA_KEY = Deno.env.get('SCREENSCRAPER_MEDIA_KEY') || SERVICE_KEY
const OWNER = Deno.env.get('HEVY_USER_ID') ?? ''
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

const scrub = (t: string) => scrubSecrets(t, SECRETS)
const fail = (message: string, status = 500, extra: Rec = {}) => json({ status: 'error', error: scrub(message), ...extra }, status)
const now = () => new Date().toISOString()

// ─── ScreenScraper calls ─────────────────────────────────────────────────────

let issued = 0
let lastUser: { used: number; max: number; koUsed: number; koMax: number } | null = null

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

/** One fetch; a redirect is followed once, by hand, to an https
 *  screenscraper.fr host only. Throws a FIXED message — never the URL. */
async function fetchSafely(url: string, timeoutMs: number): Promise<Response> {
  const opts = { redirect: 'manual' as const, headers: { 'User-Agent': SOFTNAME }, signal: AbortSignal.timeout(timeoutMs) }
  let res: Response
  try { res = await fetch(url, opts) } catch { throw new Error('ScreenScraper did not answer in time') }
  if (res.status >= 300 && res.status < 400) {
    const target = safeRedirect(url, res.headers.get('location'))
    await res.body?.cancel()
    if (!target) throw new Error('ScreenScraper redirected somewhere unexpected')
    try { res = await fetch(target, opts) } catch { throw new Error('ScreenScraper did not answer in time') }
    if (res.status >= 300 && res.status < 400) { await res.body?.cancel(); throw new Error('ScreenScraper redirected twice') }
  }
  return res
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
 * status. A 404 is a normal answer ("not in their database"). "Busy" (thread
 * or per-minute limit) is retried once after a pause.
 */
async function callApi(endpoint: string, params: Record<string, string>): Promise<ApiResult> {
  for (let attempt = 0; ; attempt++) {
    issued++
    let res: Response
    try {
      res = await fetchSafely(apiUrl(endpoint, params), API_TIMEOUT_MS)
    } catch (e) {
      return { ok: false, kind: 'other', status: 0, message: scrub((e as Error).message) }
    }
    const body = await res.text().catch(() => '')
    const data = body.trimStart().startsWith('{') ? parseLenient(body) : null
    if (res.ok && data) {
      const u = data?.response?.ssuser
      if (u && u.maxrequestsperday != null) {
        lastUser = {
          used: Number(u.requeststoday ?? 0), max: Number(u.maxrequestsperday ?? 0),
          koUsed: Number(u.requestskotoday ?? 0), koMax: Number(u.maxrequestskoperday ?? 0),
        }
      }
      return { ok: true, data }
    }
    const kind = classifyText(res.status, body)
    if (kind === 'busy' && attempt === 0) { await new Promise(r => setTimeout(r, 1500)); continue }
    return { ok: false, kind, status: res.status, message: TEXT_MESSAGE[kind] }
  }
}

/** Runs tasks a few at a time — never more than this function's share of the
 *  account's threads. */
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

async function readQuota(): Promise<{ used: number; max: number; koUsed: number; koMax: number; threads: number; level: string } | { error: string }> {
  const r = await callApi('ssuserInfos.php', {})
  if (!r.ok) return { error: r.message }
  const u = r.data?.response?.ssuser ?? {}
  return {
    used: Number(u.requeststoday ?? 0), max: Number(u.maxrequestsperday ?? 0),
    koUsed: Number(u.requestskotoday ?? 0), koMax: Number(u.maxrequestskoperday ?? 0),
    threads: Number(u.maxthreads ?? 1), level: String(u.niveau ?? '0'),
  }
}
const remaining = () => (lastUser ? Math.max(0, lastUser.max - lastUser.used) : null)

/** Refuses to start when today's allowance (or the separate allowance for
 *  failed lookups) is nearly gone — the handheld needs it too. */
async function quotaRefusal(): Promise<Response | null> {
  const q = await readQuota()
  if ('error' in q) return null // their status call failing is no reason to refuse; the real call will say
  const left = q.max - q.used
  const koLeft = q.koMax > 0 ? q.koMax - q.koUsed : Infinity
  if (left < QUOTA_FLOOR || koLeft < KO_FLOOR) {
    return json({
      status: 'quota_exhausted', remaining_today: Math.max(0, left),
      message: left < QUOTA_FLOOR
        ? `Only ${Math.max(0, left)} ScreenScraper requests left today — keeping the last ${QUOTA_FLOOR} for the handheld.`
        : `Only ${koLeft} failed lookups left today (their separate allowance for misses) — try again after midnight CET.`,
    })
  }
  return null
}

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

/** Downloads one image, resized by ScreenScraper itself (`maxwidth`,
 *  `outputformat`) — no CPU spent here. Only png/jpeg/webp/gif are accepted. */
async function downloadImage(url: string, width: number | null, format: 'png' | 'jpg'): Promise<{ bytes: Uint8Array; type: string; ext: string } | { error: string }> {
  issued++
  const u = new URL(url)
  if (width) u.searchParams.set('maxwidth', String(width))
  u.searchParams.set('outputformat', format)
  try {
    const res = await fetchSafely(u.toString(), MEDIA_TIMEOUT_MS)
    const ct = res.headers.get('content-type') ?? ''
    const ext = imageExtension(ct)
    if (!res.ok || !ext) {
      const body = await res.text().catch(() => '')
      return { error: TEXT_MESSAGE[classifyText(res.status, body)] }
    }
    return { bytes: new Uint8Array(await res.arrayBuffer()), type: ct.split(';')[0].trim(), ext }
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

/** Storage path of a public Storage URL in our bucket, or null. */
function pathOfUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null
  const marker = `/object/public/${BUCKET}/`
  const i = url.indexOf(marker)
  if (i < 0) return null
  return decodeURIComponent(url.slice(i + marker.length).split('?')[0])
}

async function removePaths(paths: string[]): Promise<number> {
  let removed = 0
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100)
    const { error } = await admin.storage.from(BUCKET).remove(chunk)
    if (!error) removed += chunk.length
  }
  return removed
}

// ─── Journal ─────────────────────────────────────────────────────────────────

function isMissingColumn(e: unknown): boolean {
  const x = e as { code?: string; message?: string } | null
  return x?.code === '42703' || x?.code === 'PGRST204' || /column .* does not exist/i.test(x?.message ?? '')
}
function isMissingTable(e: unknown): boolean {
  const x = e as { code?: string; message?: string } | null
  return x?.code === '42P01' || x?.code === 'PGRST205' || /Could not find the table/i.test(x?.message ?? '')
}
const jsonEqual = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const nonEmpty = (o: unknown) => !!o && typeof o === 'object' && Object.keys(o as Rec).length > 0

/** Inserts a journal row and returns its id. Before migration 104 the prior
 *  values and released paths ride inside written_values (never compared). */
async function journalInsert(userId: string, row: Rec): Promise<string | null> {
  let { data, error } = await admin.from('scrape_decisions').insert({ user_id: userId, ...row }).select('id').maybeSingle()
  if (error && isMissingColumn(error)) {
    const { prior_values, replaced_paths, ...rest } = row
    ;({ data, error } = await admin.from('scrape_decisions').insert({
      user_id: userId, ...rest,
      written_values: { ...(rest.written_values ?? {}), __prior: prior_values ?? {}, __replaced: replaced_paths ?? [] },
    }).select('id').maybeSingle())
  }
  if (error) { console.log(`scrape_decisions insert skipped (${(error as Rec).code ?? 'unknown'})`); return null }
  return data?.id ?? null
}
/** Like journalInsert, but tells a missing journal (no undo possible, fine
 *  before migration 097) from a real refusal (the save must not go ahead). */
async function journalInsertChecked(userId: string, row: Rec): Promise<{ id: string | null; failed: string | null }> {
  let { data, error } = await admin.from('scrape_decisions').insert({ user_id: userId, ...row }).select('id').maybeSingle()
  if (error && isMissingColumn(error)) {
    const { prior_values, replaced_paths, ...rest } = row
    ;({ data, error } = await admin.from('scrape_decisions').insert({
      user_id: userId, ...rest,
      written_values: { ...(rest.written_values ?? {}), __prior: prior_values ?? {}, __replaced: replaced_paths ?? [] },
    }).select('id').maybeSingle())
  }
  if (error) return isMissingTable(error) ? { id: null, failed: null } : { id: null, failed: String((error as Rec).code ?? 'journal error') }
  return { id: data?.id ?? null, failed: null }
}
const priorOf = (row: Rec): Rec => nonEmpty(row.prior_values) ? row.prior_values : (row.written_values?.__prior ?? {})
const replacedOf = (row: Rec): string[] => (Array.isArray(row.replaced_paths) && row.replaced_paths.length) ? row.replaced_paths : (row.written_values?.__replaced ?? [])

/** The journal row an 'undone' row reverted (its id; older rows only say the run). */
const undidOf = (r: Rec): string | null => {
  const v = r.written_values && typeof r.written_values === 'object' ? (r.written_values as Rec).undid : null
  return typeof v === 'string' && v ? v : null
}

/**
 * Per game, the apply that can still be undone: ONLY the newest one, and only
 * while it has not been undone. An older apply never becomes undoable again —
 * the copies its "before" pointed at were deleted when the next one landed.
 * `rows` holds every applied/undone row of the games concerned, any order.
 */
function undoableByGame(rows: Rec[]): Map<string, Rec> {
  const byGame = new Map<string, Rec[]>()
  for (const r of rows) {
    const g = String(r.game_id)
    const list = byGame.get(g) ?? []
    list.push(r)
    byGame.set(g, list)
  }
  const out = new Map<string, Rec>()
  for (const [g, list] of byGame) {
    const applied = list.filter(r => r.decision === 'applied')
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    const newest = applied[0]
    if (!newest) continue
    const undone = list.some(r => r.decision === 'undone' && (undidOf(r)
      ? undidOf(r) === String(newest.id)
      : String(r.run_id) === String(newest.run_id) && String(r.created_at) >= String(newest.created_at)))
    if (!undone) out.set(g, newest)
  }
  return out
}

/** The latest apply of a game, if it can still be undone (see undoableByGame). */
async function latestApplied(userId: string, gameId: string): Promise<Rec | null> {
  const { data, error } = await admin.from('scrape_decisions').select('*')
    .eq('user_id', userId).eq('game_id', gameId).in('decision', ['applied', 'undone'])
    .order('created_at', { ascending: false }).limit(50)
  if (error) return null
  return undoableByGame(data ?? []).get(gameId) ?? null
}

// Columns an apply can write — undo restores these and nothing else.
const GAME_COLS = new Set([
  ...ALL_FIELDS.filter(f => FIELD_COLUMN[f].table === 'games').map(f => FIELD_COLUMN[f].column),
  'media', 'provider_data', 'ss_jeu_id', 'ss_scraped_at', 'external_ref', 'external_source',
])
const PLATFORM_COLS = new Set(ALL_FIELDS.filter(f => FIELD_COLUMN[f].table === 'game_platforms').map(f => FIELD_COLUMN[f].column))
const JSON_NOT_NULL = new Set(['media', 'provider_data'])

async function loadGame(userId: string, gameId: string): Promise<{ game: Rec | null; platform: Rec | null; error?: string }> {
  const { data: game, error } = await admin.from('games').select('*').eq('user_id', userId).eq('id', gameId).maybeSingle()
  if (error) return { game: null, platform: null, error: scrub(error.message) }
  if (!game) return { game: null, platform: null }
  const { data: plats } = await admin.from('game_platforms').select('*').eq('user_id', userId).eq('game_id', gameId)
  const platform = (plats ?? []).find((p: Rec) => p.is_primary_variant) ?? (plats ?? [])[0] ?? null
  return { game, platform }
}

/** Every stored-copy path a game row (and its variant) still points at. */
function referencedPaths(game: Rec | null, platform: Rec | null): Set<string> {
  const out = new Set<string>()
  const add = (u: unknown) => { const p = pathOfUrl(u); if (p) out.add(p) }
  if (game) {
    add(game.primary_cover_url); add(game.screenshot_url); add(game.fanart_url)
    for (const v of Object.values((game.media ?? {}) as Rec)) add(v)
    for (const v of Object.values((game.provider_data?.saved ?? {}) as Rec)) add(v)
  }
  if (platform) { add(platform.wheel_url); add(platform.cover_url); add(platform.box_url) }
  return out
}

/** Stored-copy paths the game's own columns (not provider_data) show. */
function referencedColumnPaths(game: Rec | null, platform: Rec | null): string[] {
  const out: string[] = []
  const add = (u: unknown) => { const p = pathOfUrl(u); if (p) out.push(p) }
  if (game) {
    add(game.primary_cover_url); add(game.screenshot_url); add(game.fanart_url)
    for (const v of Object.values((game.media ?? {}) as Rec)) add(v)
  }
  if (platform) { add(platform.wheel_url); add(platform.cover_url); add(platform.box_url) }
  return out
}

/**
 * On a re-match: every column still showing one of THIS game's ScreenScraper
 * copies (an earlier apply of the wrong entry) is cleared, and those copies
 * plus the old entry's saved ones are returned for release.
 */
function scrubCopies(gameId: string, game: Rec, platform: Rec | null): { games: Rec; platform: Rec; paths: string[] } {
  const games: Rec = {}
  const plat: Rec = {}
  const paths = new Set<string>()
  const mine = (u: unknown) => { const p = pathOfUrl(u); return p && isScrapeCopyOf(gameId, p) ? p : null }
  for (const col of ['primary_cover_url', 'screenshot_url', 'fanart_url']) {
    const p = mine(game[col])
    if (p) { games[col] = null; paths.add(p) }
  }
  const media = { ...((game.media ?? {}) as Rec) }
  let mediaChanged = false
  for (const [k, v] of Object.entries(media)) {
    const p = mine(v)
    if (p) { delete media[k]; paths.add(p); mediaChanged = true }
  }
  if (mediaChanged) games.media = media
  for (const v of Object.values((game.provider_data?.saved ?? {}) as Rec)) { const p = mine(v); if (p) paths.add(p) }
  if (platform) {
    for (const col of ['wheel_url', 'cover_url', 'box_url']) {
      const p = mine(platform[col])
      if (p) { plat[col] = null; paths.add(p) }
    }
  }
  return { games, platform: plat, paths: [...paths] }
}

/**
 * Puts a game back the way one journaled apply found it: every written column
 * whose live value is still what was written gets its prior value back (a
 * later edit is the user's and is kept), the heavy record of that apply is
 * removed, and the copies it stored are deleted once nothing points at them.
 */
async function revertApplied(userId: string, row: Rec): Promise<{ reverted: boolean; kept: string[]; reason?: string }> {
  const gameId = String(row.game_id)
  const { game: live, platform } = await loadGame(userId, gameId)
  if (!live) return { reverted: false, kept: [], reason: 'game no longer exists' }
  const written = (row.written_values ?? {}) as Rec
  const prior = priorOf(row)
  const hasPrior = nonEmpty(prior)
  const gamePatch: Rec = {}
  const platPatch: Rec = {}
  const kept: string[] = []
  for (const key of (row.fields_written ?? []) as string[]) {
    const isPlat = key.startsWith('platform.')
    const col = isPlat ? key.slice(9) : key
    if (!(isPlat ? PLATFORM_COLS : GAME_COLS).has(col)) continue
    const liveRow = isPlat ? platform : live
    if (!liveRow) continue
    const same = col === 'provider_data'
      ? (liveRow.provider_data?.jeu_id ?? null) === (written.provider_data?.jeu_id ?? null) && (liveRow.provider_data?.fetched_at ?? null) === (written.provider_data?.fetched_at ?? null)
      : jsonEqual(liveRow[col], written[key])
    if (!same) { kept.push(col); continue }
    // Before migration 104 there are no prior values: the old apply only ever
    // filled empty fields, so empty is the inverse — but never NULL into a
    // NOT NULL jsonb column.
    let restore = hasPrior ? (prior[key] ?? null) : null
    if (restore === null && JSON_NOT_NULL.has(col)) restore = {}
    ;(isPlat ? platPatch : gamePatch)[col] = restore
  }
  if (live.needs_review === false && row.prior_needs_review === true) gamePatch.needs_review = true
  if (!Object.keys(gamePatch).length && !Object.keys(platPatch).length) {
    return { reverted: false, kept, reason: 'everything has been edited since — nothing to revert' }
  }
  if (Object.keys(gamePatch).length) {
    let { error } = await admin.from('games').update(gamePatch).eq('id', gameId).eq('user_id', userId)
    if (error && isMissingColumn(error)) {
      delete gamePatch.ss_jeu_id; delete gamePatch.ss_scraped_at
      ;({ error } = await admin.from('games').update(gamePatch).eq('id', gameId).eq('user_id', userId))
    }
    if (error) return { reverted: false, kept, reason: scrub(error.message) }
  }
  if (platform && Object.keys(platPatch).length) {
    await admin.from('game_platforms').update(platPatch).eq('id', platform.id).eq('user_id', userId)
  }
  const stamp = written.provider_data?.fetched_at
  if (stamp) await admin.from('game_scrape_records').delete().eq('game_id', gameId).eq('user_id', userId).eq('fetched_at', stamp)

  const after = await loadGame(userId, gameId)
  const refs = referencedPaths(after.game, after.platform)
  const removable = ((row.storage_paths ?? []) as string[]).filter(p => isScrapeCopyOf(gameId, p) && !refs.has(p))
  if (removable.length) await removePaths(removable)
  await journalInsert(userId, {
    game_id: gameId, run_id: row.run_id, decision: 'undone', jeu_id: row.jeu_id, matched_title: row.matched_title,
    system_used: row.system_used, fields_written: [...Object.keys(gamePatch), ...Object.keys(platPatch).map(k => `platform.${k}`)],
    // Which apply this reverted — "undone" is per row, not per run (a run can
    // hold two applies of one game).
    written_values: { undid: String(row.id) }, storage_paths: removable, prior_needs_review: row.prior_needs_review,
  })
  return { reverted: true, kept }
}

/**
 * Undoes one run — or, with `gameIds`, only those games' applies in it (a
 * game's own "Undo last scrape" must never undo the rest of the batch it was
 * saved in). Returns the games actually reverted.
 */
async function undoRun(userId: string, runId: string, gameIds: string[] | null): Promise<Rec> {
  let q = admin.from('scrape_decisions').select('*')
    .eq('user_id', userId).eq('run_id', runId).eq('decision', 'applied')
  if (gameIds?.length) q = q.in('game_id', gameIds)
  const { data: rows, error } = await q
  if (error) {
    if (isMissingTable(error)) return { status: 'no_journal', message: 'Migration 097 is not applied, so there is no record of what to undo.' }
    throw new Error(`journal read: ${error.message}`)
  }
  let reverted = 0
  const revertedIds: string[] = []
  const skipped: Rec[] = []
  const done = new Set<string>()
  for (const row of rows ?? []) {
    const gid = String(row.game_id)
    if (done.has(gid)) continue
    // Only the newest apply of a game can be undone: an older one's "before"
    // is no longer the state underneath.
    const latest = await latestApplied(userId, gid)
    if (!latest || String(latest.run_id) !== runId) {
      done.add(gid)
      skipped.push({ game_id: row.game_id, reason: latest ? 'a newer scrape of this game exists — undo that first' : 'already undone' })
      continue
    }
    if (String(latest.id) !== String(row.id)) continue // an older apply of this game in the same run
    done.add(gid)
    const r = await revertApplied(userId, row)
    if (r.reverted) { reverted++; revertedIds.push(gid) }
    if (r.reason) skipped.push({ game_id: row.game_id, reason: r.reason })
    else if (r.kept.length) skipped.push({ game_id: row.game_id, reason: `kept your own edits to ${r.kept.join(', ')}` })
  }
  return { status: 'ok', reverted, reverted_ids: revertedIds, skipped }
}

// ─── Search ──────────────────────────────────────────────────────────────────

async function signed(c: SsCandidate): Promise<SsCandidate> {
  if (c.system.id == null || !MEDIA_KEY) return c
  const exp = mediaExpiry(Date.now())
  return { ...c, media_sig: await signMedia(MEDIA_KEY, c.jeu_id, c.system.id, exp), media_exp: exp }
}

/** A filename lookup's answer is ROM identity only when it names the same
 *  file; otherwise it is their guess, and says so. */
function withVerifiedBasis(c: SsCandidate, kind: MatchBasis, rom: SsRomQuery | null, systemId: number | null): SsCandidate {
  if (kind !== 'filename' && kind !== 'hash') return c
  // A hash answer is exact only when its ROM carries a hash we asked for —
  // otherwise it was ScreenScraper's filename guess, and is checked as one.
  if (kind === 'hash' && verifyHashMatch({ crc: rom?.crc, md5: rom?.md5, sha1: rom?.sha1 }, c)) return c
  const ok = verifyFilenameMatch({ filename: rom?.filename, systemId, size: rom?.size ?? null, crc: rom?.crc ?? null }, c)
  return ok ? { ...c, matched_by: ['filename'] } : { ...c, matched_by: ['filename_guess'] }
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
    // A prefilled id is "the previous match", not proof — label it so.
    const kind: MatchBasis = q.kind === 'id' && body.previous_id === true ? 'previous' : q.kind
    const r = await callApi(q.endpoint, q.params)
    if (!r.ok) {
      outcomes.push({ kind, status: r.kind === 'not_found' ? 'no_match' : 'error', count: 0, message: r.kind === 'not_found' ? undefined : r.message })
      return { kind, items: [] as SsCandidate[] }
    }
    const list = q.endpoint === 'jeuRecherche.php'
      ? (Array.isArray(r.data?.response?.jeux) ? r.data.response.jeux : [])
      : [r.data?.response?.jeu]
    const items = list.filter(isRealJeu).map((j: Rec) => withVerifiedBasis(toCandidate(j, [kind], opts), q.kind, rom, sys?.id ?? null))
    const effective = items[0]?.matched_by[0] ?? kind
    outcomes.push({ kind: effective, status: items.length ? 'ok' : 'no_match', count: items.length })
    return { kind: effective, items }
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
  /** Explicit per-type choices from the review, or null = the saved defaults. */
  media: SsMediaChoice[] | null
  prefs: SsPrefs
  budgetMb: number
  runId: string
  basis: MatchBasis[]
  overrides: { titleRegion?: string | null; descriptionLang?: string | null } | null
}

const PLATFORM_KEY = (c: string) => `platform.${c}`

/** A stored copy's likely size, for the budget reservation. */
function estimateBytes(entry: SsMediaEntry, scale: number): number {
  const typical = ({ fanart: 140_000, 'box-texture': 180_000, 'wheel-hd': 20_000, wheel: 20_000 } as Rec)[entry.type] ?? 70_000
  const scaled = typical * (scale === 0 ? 4 : scale * scale)
  return entry.size ? Math.min(entry.size, scaled) : scaled
}

async function applyOne(userId: string, input: ApplyInput): Promise<Rec> {
  let { game, platform, error: loadErr } = await loadGame(userId, input.gameId)
  if (loadErr) return { game_id: input.gameId, outcome: 'error', reason: loadErr }
  if (!game) return { game_id: input.gameId, outcome: 'error', reason: 'game not found' }

  let prevRow = await latestApplied(userId, input.gameId)
  const prevJeu = game.provider_data?.v === 2 ? String(game.provider_data.jeu_id ?? '') : String(game.ss_jeu_id ?? '')
  const rematch = !!prevJeu && prevJeu !== input.jeuId

  const systems = await loadSystems()
  const sys = resolveSystem(systems, input.system)

  // Fetch the chosen entry. With ROM identity, ask by ROM first so the answer
  // carries the `rom` block for THIS dump — and check it really is this dump.
  let jeu: Rec | null = null
  let romVerified = false
  let hashVerified = false
  const romPlan = input.rom
    ? planSearch({ rom: input.rom, systemId: sys?.id ?? null, useName: false }).queries.find(q => q.kind === 'hash' || q.kind === 'filename')
    : null
  if (romPlan) {
    const r = await callApi(romPlan.endpoint, romPlan.params)
    if (r.ok && String(r.data?.response?.jeu?.id ?? '') === input.jeuId) {
      jeu = r.data.response.jeu as Rec
      const answered = { rom: romInfo(jeu.rom), system: { id: Number(jeu.systeme?.id ?? NaN) || null, name: null } }
      // Exact only when the returned dump carries a hash we asked for (an
      // unknown hash is answered with a filename guess).
      if (romPlan.kind === 'hash') hashVerified = verifyHashMatch({ crc: input.rom?.crc, md5: input.rom?.md5, sha1: input.rom?.sha1 }, answered)
      if (!hashVerified) romVerified = verifyFilenameMatch(
        { filename: input.rom?.filename, systemId: sys?.id ?? null, size: input.rom?.size ?? null, crc: input.rom?.crc ?? null },
        answered,
      )
    }
  }
  if (!jeu) {
    const r = await callApi('jeuInfos.php', { gameid: input.jeuId })
    if (!r.ok) return { game_id: input.gameId, outcome: r.kind === 'not_found' ? 'no_match' : 'error', reason: r.message }
    jeu = r.data?.response?.jeu ?? null
  }
  if (!jeu || String(jeu.id) !== input.jeuId) {
    return { game_id: input.gameId, outcome: 'stale', reason: 'ScreenScraper answered with a different entry than the one chosen — search again.' }
  }

  // Re-matching to a DIFFERENT entry — only now that the new one is in hand,
  // so a failed lookup never throws the old match away: undo the previous
  // match (where still untouched), then treat every column still holding one
  // of this game's copies as empty, so none of the wrong game's art survives
  // even when it was applied more than once.
  const replaced: string[] = []
  if (rematch) {
    if (prevRow && String(prevRow.jeu_id ?? '') === prevJeu) await revertApplied(userId, prevRow)
    prevRow = null
    ;({ game, platform } = await loadGame(userId, input.gameId))
    if (!game) return { game_id: input.gameId, outcome: 'error', reason: 'game not found' }
    const scrub = scrubCopies(input.gameId, game, platform)
    if (Object.keys(scrub.games).length) await admin.from('games').update(scrub.games).eq('id', input.gameId).eq('user_id', userId)
    if (platform && Object.keys(scrub.platform).length) await admin.from('game_platforms').update(scrub.platform).eq('id', platform.id).eq('user_id', userId)
    game = { ...game, ...scrub.games }
    if (platform) platform = { ...platform, ...scrub.platform }
    // The old entry's copies are no longer anyone's: gone once this apply is
    // no longer undoable (the replaced-path rule), never orphaned.
    replaced.push(...scrub.paths)
  }
  const opts = { regions: input.prefs.regions, languages: input.prefs.languages }
  let cand = withOverrides(await signed(toCandidate(jeu, input.basis, opts, SNAPSHOT_CAPS.roms)), input.overrides)
  const verified = hashVerified || romVerified
  if (!verified) {
    // Without proof of which dump this is, dump-specific values would describe
    // somebody else's copy.
    cand = { ...cand, rom: null, values: { ...cand.values, region: null, version_title: null, release_date: releaseDateFor(cand.dates, [], opts.regions) } }
  }
  const urls = urlsByToken(jeu)

  // ── Which copies are worth storing ── (a copy the game will not use spends
  // the budget for nothing)
  const values: Partial<Record<SsField, unknown>> = { ...cand.values, rom_status: hashVerified ? 'verified' : null }
  const has = (t: string) => cand.media.some(m => m.type === t)
  const esdeCategories = [...new Set(Object.values((platform?.esde_assets ?? {}) as Rec).map((a: Rec) => String(a?.category ?? '')))]
  // "Fill" means an empty field. An image column can be empty while the
  // handheld already shows that picture (ES-DE's own screenshot or fan art):
  // that is not empty to the owner, and filling it would replace what the
  // detail shows. Replace still writes.
  const fields: Partial<Record<SsField, FieldPolicy>> = { ...input.fields }
  for (const [f, t] of Object.entries(FIELD_MEDIA)) {
    const { table, column } = FIELD_COLUMN[f as SsField]
    const current = (table === 'games' ? game : platform)?.[column]
    const cat = ESDE_CATEGORY[t as string]
    if (fields[f as SsField] === 'fill' && isEmptyValue(current) && cat && esdeCategories.includes(cat)) fields[f as SsField] = 'skip'
  }
  const pre = planPatch({ games: game, platform }, {
    ...values, ...Object.fromEntries(Object.entries(FIELD_MEDIA).map(([f, t]) => [f, has(t as string) ? '__image__' : null])),
  }, fields)
  const fieldWrites = Object.fromEntries(Object.keys(FIELD_MEDIA).map(f => [f, pre.written.includes(f as SsField)]))
  const explicit = Array.isArray(input.media)
  const choices: SsMediaChoice[] = explicit
    ? input.media!
    : [...new Set(cand.media.map(m => m.type))]
        .map(t => ({ type: t, mode: mediaModeFor(input.prefs, t) }))
        .filter((c): c is SsMediaChoice => c.mode === 'store' || c.mode === 'on_demand')
  const modes = decideMediaModes(choices, { explicit, fieldWrites, esdeCategories })

  // ── Media ──
  const prev = game.provider_data?.v === 2 && String(game.provider_data.jeu_id ?? '') === cand.jeu_id ? (game.provider_data as Rec) : null
  const saved: Rec = prev?.saved && typeof prev.saved === 'object' ? { ...prev.saved } : {}
  const linked: Record<string, string> = prev?.linked && !Array.isArray(prev.linked) && typeof prev.linked === 'object' ? { ...prev.linked } : {}
  const release = (type: string) => { const p = pathOfUrl(saved[type]); if (p) replaced.push(p); delete saved[type] }
  // A copy a column of this game still shows is never released (it would be
  // deleted from under the cover it is).
  const inUse = new Set([...referencedColumnPaths(game, platform)])
  const releaseUnused = (type: string) => { const p = pathOfUrl(saved[type]); if (!p || !inUse.has(p)) release(type) }
  const mediaResults: Rec[] = []
  const paths: string[] = []
  const wantsStore = Object.values(modes).includes('store')
  const usage = wantsStore ? await bucketBytes() : null
  const budget = Math.min(input.budgetMb, HARD_CAP_MB) * 1024 * 1024
  const left = remaining()
  const lowQuota = left != null && left < QUOTA_FLOOR
  let reserved = 0
  let storedBytes = 0
  const stamp = Date.now().toString(36)

  await inParallel(choices, async (choice) => {
    const entry = (choice.token ? cand.media.find(m => m.token === choice.token && m.type === choice.type) : null)
      ?? pickMediaEntry(cand.media, choice.type, input.prefs.regions)
    if (!entry) { mediaResults.push({ type: choice.type, mode: choice.mode, ok: false, reason: 'not available' }); return }
    const mode = modes[choice.type] ?? 'on_demand'
    const keepOnline = (reason?: string) => {
      if (saved[entry.type]) releaseUnused(entry.type)
      linked[entry.type] = entry.token
      mediaResults.push({ type: entry.type, mode: 'on_demand', ok: true, token: entry.token, ...(reason ? { reason } : {}) })
    }
    // A new copy cannot be made (quota, unknown usage, budget): a copy this
    // game already has for the type stays — it is paid for and counted.
    const refuseNew = (why: string) => {
      if (saved[entry.type]) {
        mediaResults.push({ type: entry.type, mode: 'store', ok: true, token: entry.token, reason: `kept your existing copy: ${why}` })
        return
      }
      keepOnline(`kept online instead of copied: ${why}`)
    }
    if (mode === 'on_demand' || !canStore(entry.type)) {
      keepOnline(choice.mode === 'store' && mode === 'on_demand' ? 'kept online: the game would not use this copy' : undefined)
      return
    }
    const estimate = estimateBytes(entry, input.prefs.imageScale)
    const refuse = lowQuota ? 'quota nearly used up today'
      : !usage ? 'storage usage unknown (apply migration 104)'
      : usage.total + reserved + estimate > budget ? 'over your storage budget' : null
    if (refuse) { refuseNew(refuse); return }
    reserved += estimate // reserve before downloading, so parallel copies cannot all pass on one stale total
    const url = urls.get(entry.token)
    if (!url) { reserved -= estimate; mediaResults.push({ type: entry.type, mode: 'store', ok: false, reason: 'no file' }); return }
    const got = await downloadImage(url, storeWidth(input.prefs, entry.type), outputFormatFor(entry.type, entry.size))
    if ('error' in got) { reserved -= estimate; mediaResults.push({ type: entry.type, mode: 'store', ok: false, reason: got.error }); return }
    reserved += got.bytes.byteLength - estimate
    if (usage!.total + reserved > budget) {
      reserved -= got.bytes.byteLength
      refuseNew('over your storage budget')
      return
    }
    const path = storedPath(input.gameId, entry.type, stamp, got.ext)
    const { error } = await admin.storage.from(BUCKET).upload(path, got.bytes, { contentType: got.type, upsert: true, cacheControl: '31536000' })
    if (error) { reserved -= got.bytes.byteLength; mediaResults.push({ type: entry.type, mode: 'store', ok: false, reason: scrub(error.message) }); return }
    if (saved[entry.type]) release(entry.type)
    saved[entry.type] = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
    delete linked[entry.type]
    paths.push(path)
    storedBytes += got.bytes.byteLength
    mediaResults.push({ type: entry.type, mode: 'store', ok: true, bytes: got.bytes.byteLength, token: entry.token })
  })
  // A type no longer chosen at all (set to Skip) keeps no copy and no link.
  const chosenTypes = new Set(choices.map(c => c.type))
  for (const t of Object.keys(saved)) if (!chosenTypes.has(t)) releaseUnused(t)
  for (const t of Object.keys(linked)) if (!chosenTypes.has(t)) delete linked[t]

  // ── Fields ── Image columns only ever take a STORED copy (a proxied cover
  // in the grid would be a ScreenScraper request per card), and only one the
  // user wants stored for this game.
  for (const [field, type] of Object.entries(FIELD_MEDIA)) {
    values[field as SsField] = modes[type as string] === 'store' && saved[type as string] ? saved[type as string] : null
  }
  const plan = planPatch({ games: game, platform }, values, fields)

  // games.media holds only what the library list reads, and only stored
  // copies — a key still pointing at one of this game's old copies goes.
  const listMedia: Rec = { ...(game.media ?? {}) }
  for (const t of LIST_MEDIA_TYPES) {
    const p = pathOfUrl(listMedia[t])
    if (saved[t]) listMedia[t] = saved[t]
    else if (p && isScrapeCopyOf(input.gameId, p)) delete listMedia[t]
  }

  const fetchedAt = now()
  const providerData = {
    v: 2, source: 'screenscraper', fetched_at: fetchedAt, run_id: input.runId,
    jeu_id: cand.jeu_id, rom_id: cand.rom_id, system_id: cand.system.id, system_name: cand.system.name,
    matched_by: input.basis, verified_rom: verified, saved, linked, media_count: cand.media.length,
  }
  const gamePatch: Rec = {
    ...plan.games, media: listMedia, provider_data: providerData,
    // Not synced_at: that is the SOURCE's stamp (ES-DE, Steam, PlayStation),
    // which Analytics reads as "last heard from the handheld". ss_scraped_at
    // records the scrape.
    ss_jeu_id: cand.jeu_id, ss_scraped_at: fetchedAt, needs_review: false,
  }
  const platPatch: Rec = platform ? { ...plan.platform } : {}

  // Journal FIRST, with what each column held before. provider_data is
  // journaled as a fingerprint (its full value is rebuilt, not diffed), and
  // its prior value without any heavy record a pre-rewrite row still carried.
  const written: Rec = {}
  const priorAll: Rec = {}
  for (const [k, v] of Object.entries(gamePatch)) {
    if (k === 'needs_review') continue
    written[k] = k === 'provider_data' ? { v: 2, jeu_id: cand.jeu_id, fetched_at: fetchedAt } : v
    let p = game[k] ?? null
    if (k === 'provider_data' && p && typeof p === 'object') {
      const { summary: _s, jeu: _j, ...small } = p as Rec
      p = small
    }
    priorAll[k] = p
  }
  for (const [k, v] of Object.entries(platPatch)) {
    written[PLATFORM_KEY(k)] = v
    priorAll[PLATFORM_KEY(k)] = platform?.[k] ?? null
  }
  const journal = await journalInsertChecked(userId, {
    game_id: input.gameId, run_id: input.runId, decision: 'applied', jeu_id: cand.jeu_id,
    matched_title: cand.values.title ?? null, system_used: cand.system.name,
    fields_written: Object.keys(written), written_values: written, prior_values: priorAll,
    storage_paths: paths, replaced_paths: replaced, prior_needs_review: game.needs_review === true,
  })
  // Nothing is written that could not be undone (a journal that exists but
  // refused the row); before migration 097 there is no journal at all.
  if (journal.failed) {
    if (paths.length) await removePaths(paths)
    return { game_id: input.gameId, outcome: 'error', reason: `could not record the save for undo (${journal.failed}) — nothing was written` }
  }
  const journalId = journal.id

  let { error: uErr } = await admin.from('games').update(gamePatch).eq('id', input.gameId).eq('user_id', userId)
  if (uErr && isMissingColumn(uErr)) {
    delete gamePatch.ss_jeu_id; delete gamePatch.ss_scraped_at
    ;({ error: uErr } = await admin.from('games').update(gamePatch).eq('id', input.gameId).eq('user_id', userId))
  }
  if (uErr) {
    if (journalId) await admin.from('scrape_decisions').delete().eq('id', journalId)
    if (paths.length) await removePaths(paths)
    return { game_id: input.gameId, outcome: 'error', reason: scrub(uErr.message) }
  }
  if (platform && Object.keys(platPatch).length) {
    const { error } = await admin.from('game_platforms').update(platPatch).eq('id', platform.id).eq('user_id', userId)
    if (error) {
      mediaResults.push({ type: 'platform', ok: false, reason: scrub(error.message) })
      // The journal must not claim what was not written (undo would compare
      // against values that never landed).
      if (journalId) {
        const keep = Object.keys(written).filter(k => !k.startsWith('platform.'))
        await admin.from('scrape_decisions').update({
          fields_written: keep,
          written_values: Object.fromEntries(keep.map(k => [k, written[k]])),
        }).eq('id', journalId)
      }
    }
  }

  // The heavy record — one row per game, never journaled or audited.
  const summary = stripCredentials({ ...cand, media_sig: undefined, media_exp: undefined }, SECRETS)
  const raw = input.prefs.snapshot ? stripCredentials({ ...jeu, medias: undefined }, SECRETS) : null
  const { error: recErr } = await admin.from('game_scrape_records').upsert(
    { game_id: input.gameId, user_id: userId, provider: 'screenscraper', jeu_id: cand.jeu_id, fetched_at: fetchedAt, summary, raw },
    { onConflict: 'game_id' },
  )
  if (recErr && isMissingTable(recErr)) {
    // Before migration 104: the record rides on provider_data, as it used to.
    await admin.from('games').update({ provider_data: { ...providerData, summary, ...(raw ? { jeu: raw } : {}) } })
      .eq('id', input.gameId).eq('user_id', userId)
  }

  // Copies the PREVIOUS apply released were kept only so that apply could be
  // undone; it no longer can be (only the latest one can), so they go now.
  if (prevRow) {
    const after = await loadGame(userId, input.gameId)
    const refs = referencedPaths(after.game, after.platform)
    const stale = replacedOf(prevRow).filter(p => isScrapeCopyOf(input.gameId, p) && !refs.has(p))
    if (stale.length) await removePaths(stale)
  }

  return {
    game_id: input.gameId, outcome: 'applied', matched_title: cand.values.title ?? null, verified_rom: verified,
    written: plan.written, skipped: plan.skipped, media: mediaResults, bytes_stored: storedBytes,
    remaining_today: remaining(),
  }
}

// ─── Batch find ──────────────────────────────────────────────────────────────

/** "Sonic The Hedgehog (USA, Europe) [!]" → "Sonic The Hedgehog" — what a name search wants. */
const searchTitle = (t: string) => t.replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/\s+/g, ' ').trim()

async function findBatch(userId: string, gameIds: string[], prefs: SsPrefs): Promise<Rec[]> {
  let games: Rec[] | null
  const first = await admin.from('games').select('id, title, ss_jeu_id').eq('user_id', userId).in('id', gameIds)
  games = first.data
  if (first.error && isMissingColumn(first.error)) games = (await admin.from('games').select('id, title').eq('user_id', userId).in('id', gameIds)).data
  const { data: plats } = await admin.from('game_platforms').select('game_id, esde_path, esde_system, is_primary_variant').eq('user_id', userId).in('game_id', gameIds)
  const systems = await loadSystems()
  const opts = { regions: prefs.regions, languages: prefs.languages }
  const runId = crypto.randomUUID()
  return inParallel(games ?? [], async (g: Rec) => {
    const mine = (plats ?? []).filter((p: Rec) => p.game_id === g.id)
    const p = mine.find((x: Rec) => x.is_primary_variant) ?? mine[0]
    const sys = resolveSystem(systems, p?.esde_system)
    const file = romFileName(p?.esde_path)

    // Known id first (a game matched before): exact, one request.
    if (g.ss_jeu_id && /^\d+$/.test(String(g.ss_jeu_id))) {
      const r = await callApi('jeuInfos.php', { gameid: String(g.ss_jeu_id) })
      if (r.ok && isRealJeu(r.data?.response?.jeu)) {
        const c = toCandidate(r.data.response.jeu, ['previous'], opts, 0)
        // Trusted (and pre-ticked) only on the game's own console; a previous
        // match filed under another system falls through to a real lookup.
        if (!sys || c.system.id == null || c.system.id === sys.id) {
          return { game_id: g.id, outcome: 'match', basis: 'previous', rom_filename: file, system: sys, candidate: await signed(c) }
        }
      }
    }
    const plan = planSearch({ name: searchTitle(String(g.title ?? '')), systemId: sys?.id ?? null, rom: file ? { filename: file } : null })
    const byFile = plan.queries.find(x => x.kind === 'filename')
    const byName = plan.queries.find(x => x.kind === 'name')
    if (!byFile && !byName) {
      await journalInsert(userId, { game_id: g.id, run_id: runId, decision: 'unmatchable', system_used: sys?.name ?? p?.esde_system ?? null })
      return { game_id: g.id, outcome: 'unmatchable', reason: plan.notes[0]?.message ?? 'nothing to search with' }
    }
    let lastError: string | null = null
    if (byFile) {
      const r = await callApi(byFile.endpoint, byFile.params)
      if (r.ok && isRealJeu(r.data?.response?.jeu)) {
        const c = withVerifiedBasis(toCandidate(r.data.response.jeu, ['filename'], opts, 0), 'filename', { filename: file }, sys?.id ?? null)
        return { game_id: g.id, outcome: 'match', basis: c.matched_by[0], rom_filename: file, system: sys, candidate: await signed(c) }
      }
      if (!r.ok && r.kind !== 'not_found') lastError = r.message
    }
    // Their filename lookup did not know it: fall back to the title, as the
    // one-game search does. A name match is never pre-ticked.
    if (byName) {
      const r = await callApi(byName.endpoint, byName.params)
      const jeu = r.ok ? (r.data?.response?.jeux ?? []).find(isRealJeu) : null
      if (jeu) return { game_id: g.id, outcome: 'match', basis: 'name', rom_filename: file, system: sys, candidate: await signed(toCandidate(jeu, ['name'], opts, 0)) }
      if (!r.ok && r.kind !== 'not_found') lastError = r.message
    }
    if (lastError) return { game_id: g.id, outcome: 'error', reason: lastError }
    await journalInsert(userId, { game_id: g.id, run_id: runId, decision: 'no_match', system_used: sys?.name ?? null })
    return { game_id: g.id, outcome: 'no_match', basis: byFile ? 'filename' : 'name' }
  })
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

/**
 * Deletes ScreenScraper copies no game points at any more (earlier scrapes,
 * the old scraper's review previews, copies of deleted games) — except those
 * the latest apply of a game still needs for its undo.
 */
async function cleanup(userId: string, dryRun: boolean): Promise<Rec> {
  // Everything is read in pages (PostgREST caps a response at 1,000 rows) and
  // EVERY read is checked: a failed read aborts before anything is deleted —
  // this path deletes, so it fails closed.
  const pages = async <T>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> => {
    const out: T[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await read(from, from + 999)
      if (error) throw new Error(`cleanup read failed: ${scrub((error as Rec).message ?? 'unknown error')}`)
      out.push(...(data ?? []))
      if (!data || data.length < 1000) return out
    }
  }
  let objects: Rec[]
  try {
    objects = await pages<Rec>((from, to) => admin.rpc('game_media_scrape_objects').range(from, to))
  } catch {
    return { status: 'error', error: 'Storage listing needs migration 104.' }
  }
  try {
    const refs = new Set<string>()
    const gameIds = new Set<string>()
    const games = await pages<Rec>((from, to) => admin.from('games').select('id, primary_cover_url, screenshot_url, fanart_url, media, provider_data')
      .eq('user_id', userId).order('id').range(from, to))
    for (const g of games) { gameIds.add(String(g.id)); for (const p of referencedPaths(g, null)) refs.add(p) }
    const plats = await pages<Rec>((from, to) => admin.from('game_platforms').select('wheel_url, cover_url, box_url')
      .eq('user_id', userId).order('id').range(from, to))
    for (const p of plats) for (const x of referencedPaths(null, p)) refs.add(x)
    // What each game's undoable apply still needs for its undo — and every
    // copy a save made in the last hour (it may still be writing its game).
    const journal = await pages<Rec>((from, to) => admin.from('scrape_decisions')
      .select('id, game_id, run_id, decision, replaced_paths, storage_paths, written_values, created_at')
      .eq('user_id', userId).in('decision', ['applied', 'undone']).order('created_at', { ascending: false }).order('id').range(from, to))
    for (const row of undoableByGame(journal).values()) for (const p of replacedOf(row)) refs.add(p)
    const recent = Date.now() - 60 * 60_000
    for (const r of journal) {
      if (r.decision === 'applied' && Date.parse(String(r.created_at)) > recent) for (const p of (r.storage_paths ?? []) as string[]) refs.add(p)
    }
    // Another user's objects are never touched: only this user's games, the
    // shared review quarantine, and folders of games that no longer exist.
    const folders = [...new Set(objects.map(o => String(o.name).split('/')[0]))].filter(x => /^[0-9a-f-]{36}$/i.test(x))
    const existing = new Set<string>()
    for (let i = 0; i < folders.length; i += 200) {
      const { data, error } = await admin.from('games').select('id').in('id', folders.slice(i, i + 200))
      if (error) throw new Error(`cleanup read failed: ${scrub(error.message)}`)
      for (const g of data ?? []) existing.add(String(g.id))
    }
    const young = Date.now() - 30 * 60_000 // uploaded but perhaps not yet written to its game
    const orphans = objects.filter(o => {
      const name = String(o.name)
      if (refs.has(name)) return false
      if (o.created_at && Date.parse(String(o.created_at)) > young) return false
      if (name.startsWith('pending/')) return true
      const gid = name.split('/')[0]
      return (gameIds.has(gid) || !existing.has(gid)) && isScrapeCopyOf(gid, name)
    })
    const bytes = orphans.reduce((s, o) => s + Number(o.bytes ?? 0), 0)
    if (dryRun) return { status: 'ok', dry_run: true, files: orphans.length, bytes }
    const removed = await removePaths(orphans.map(o => String(o.name)))
    return { status: 'ok', files: removed, bytes, ...(removed < orphans.length ? { error: `${orphans.length - removed} could not be deleted` } : {}) }
  } catch (e) {
    return { status: 'error', error: (e as Error).message }
  }
}

// ─── Handler ─────────────────────────────────────────────────────────────────

async function savedPrefs(userId: string): Promise<SsPrefs> {
  const { data } = await admin.from('screenscraper_prefs').select('prefs').eq('user_id', userId).maybeSingle()
  return normalizePrefs(data?.prefs)
}
/** Request prefs may shape THIS save (e.g. the full-record switch) — but never
 *  the storage budget, which always comes from the saved row. */
async function loadPrefs(userId: string, override: unknown): Promise<{ prefs: SsPrefs; budgetMb: number }> {
  const saved = await savedPrefs(userId)
  const prefs = override && typeof override === 'object' ? normalizePrefs(override) : saved
  return { prefs, budgetMb: saved.budgetMb }
}

function explicitChoices(raw: unknown): SsMediaChoice[] | null {
  if (!Array.isArray(raw)) return null
  return raw.filter((m: Rec) => m && typeof m.type === 'string' && /^[A-Za-z0-9-]{1,40}$/.test(m.type) && (m.mode === 'store' || m.mode === 'on_demand'))
    .map((m: Rec) => ({ type: m.type, token: typeof m.token === 'string' && MEDIA_TOKEN.test(m.token) ? m.token : null, mode: m.mode }))
    .slice(0, 80)
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

const BASES: MatchBasis[] = ['hash', 'filename', 'filename_guess', 'serial', 'id', 'previous', 'name']
const basisOf = (raw: unknown): MatchBasis[] => (Array.isArray(raw) ? raw.filter((b): b is MatchBasis => BASES.includes(b)) : [])
const UUID = /^[0-9a-f-]{36}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return fail('Method Not Allowed', 405)
  if (!DEVID || !DEVPASSWORD) return json({ status: 'not_configured', error: 'SCREENSCRAPER_DEVID / SCREENSCRAPER_DEVPASSWORD are not set' })

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  if (userErr || !userData?.user) return fail('Unauthorized', 401)
  const userId = userData.user.id
  // One ScreenScraper account, one person: its allowance, premium and signing
  // are the owner's alone.
  // Fails CLOSED: without HEVY_USER_ID nobody is the owner.
  if (!OWNER) return fail('ScreenScraper is not set up: HEVY_USER_ID is missing from the function secrets.', 403)
  if (userId !== OWNER) return fail('ScreenScraper is set up for the owner account only.', 403)
  issued = 0
  lastUser = null

  const body = await req.json().catch(() => ({})) as Rec
  const action = String(body.action ?? 'status')

  try {
    switch (action) {
      case 'status': {
        const games = () => admin.from('games').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('library', 'retro')
        const [quota, usage, saved, all, scrapedRes, noCover, noDesc, systems] = await Promise.all([
          readQuota(), bucketBytes(), savedPrefs(userId),
          games(),
          games().not('ss_jeu_id', 'is', null),
          games().is('primary_cover_url', null),
          games().is('description', null),
          admin.from('screenscraper_systems').select('id', { count: 'exact', head: true }),
        ])
        return json({
          status: 'ok',
          account: 'error' in quota ? null : { level: quota.level, premium: quota.level !== '0', threads: quota.threads, used: quota.used, max: quota.max, ko_used: quota.koUsed, ko_max: quota.koMax },
          account_error: 'error' in quota ? quota.error : undefined,
          remaining_today: 'error' in quota ? null : Math.max(0, quota.max - quota.used),
          storage: usage ? { ...usage, budget_mb: Math.min(saved.budgetMb, HARD_CAP_MB), hard_cap_mb: HARD_CAP_MB } : null,
          library: { retro: all.count ?? 0, scraped: scrapedRes.error ? null : scrapedRes.count ?? 0, missing_cover: noCover.count ?? 0, missing_description: noDesc.count ?? 0 },
          systems_known: systems.count ?? 0,
        })
      }

      case 'storage': {
        const [usage, saved] = await Promise.all([bucketBytes(), savedPrefs(userId)])
        return json({ status: 'ok', storage: usage ? { ...usage, budget_mb: Math.min(saved.budgetMb, HARD_CAP_MB), hard_cap_mb: HARD_CAP_MB } : null })
      }

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
                   retropie_names: aliases.length ? [...new Set(aliases)] : null, company: s.compagnie ?? null, fetched_at: now() }
        }).filter((x: Rec) => Number.isFinite(x.id))
        const { error } = await admin.from('screenscraper_systems').upsert(rows, { onConflict: 'id' })
        if (error) return fail(`systems upsert: ${error.message}`)
        return json({ status: 'ok', systems: rows.length })
      }

      case 'search': {
        const refused = await quotaRefusal()
        if (refused) return refused
        const { prefs } = await loadPrefs(userId, null)
        const out = await runSearch(body, prefs)
        return json({ status: 'ok', ...out, requests: issued, remaining_today: remaining() })
      }

      case 'candidate': {
        const jeuId = String(body.jeu_id ?? '')
        if (!/^\d{1,10}$/.test(jeuId)) return fail('candidate needs a numeric jeu_id', 400)
        const refused = await quotaRefusal()
        if (refused) return refused
        const { prefs } = await loadPrefs(userId, null)
        const r = await callApi('jeuInfos.php', { gameid: jeuId })
        if (!r.ok) return json({ status: r.kind === 'not_found' ? 'not_found' : 'error', error: r.message })
        const jeu = r.data?.response?.jeu
        if (!isRealJeu(jeu)) return json({ status: 'not_found', error: TEXT_MESSAGE.not_found })
        const candidate = await signed(toCandidate(jeu, basisOf(body.matched_by), { regions: prefs.regions, languages: prefs.languages }, SNAPSHOT_CAPS.roms))
        return json({ status: 'ok', candidate, record: stripCredentials({ ...jeu, medias: undefined }, SECRETS), remaining_today: remaining() })
      }

      case 'sign': {
        // Fresh signatures for the detail gallery of games already saved —
        // signatures are never stored, so rotating the key breaks nothing.
        const items = Array.isArray(body.items) ? body.items.slice(0, 60) : []
        const exp = mediaExpiry(Date.now())
        const signatures = await Promise.all(items
          .filter((i: Rec) => /^\d{1,10}$/.test(String(i?.jeu_id ?? '')) && /^\d{1,6}$/.test(String(i?.system_id ?? '')))
          .map(async (i: Rec) => ({ jeu_id: String(i.jeu_id), system_id: Number(i.system_id), sig: await signMedia(MEDIA_KEY, String(i.jeu_id), Number(i.system_id), exp), exp })))
        return json({ status: 'ok', signatures })
      }

      case 'apply': {
        const gameId = String(body.game_id ?? '')
        const jeuId = String(body.jeu_id ?? '')
        if (!UUID.test(gameId) || !/^\d{1,10}$/.test(jeuId)) return fail('apply needs game_id and a numeric jeu_id', 400)
        const refused = await quotaRefusal()
        if (refused) return refused
        const { prefs, budgetMb } = await loadPrefs(userId, body.prefs)
        const runId = typeof body.run_id === 'string' && UUID.test(body.run_id) ? body.run_id : crypto.randomUUID()
        const result = await applyOne(userId, {
          gameId, jeuId, system: body.system, rom: body.rom && typeof body.rom === 'object' ? body.rom : null,
          fields: fieldPolicies(body.fields, prefs), media: explicitChoices(body.media), prefs, budgetMb, runId,
          basis: basisOf(body.matched_by), overrides: overridesOf(body.overrides),
        })
        return json({ status: 'ok', run_id: runId, result, requests: issued })
      }

      case 'find_batch': {
        const ids = Array.isArray(body.game_ids) ? body.game_ids.map(String).filter((x: string) => UUID.test(x)).slice(0, FIND_MAX) : []
        if (!ids.length) return fail('find_batch needs game_ids', 400)
        const refused = await quotaRefusal()
        if (refused) return refused
        const { prefs } = await loadPrefs(userId, null)
        const results = await findBatch(userId, ids, prefs)
        return json({ status: 'ok', results, requests: issued, remaining_today: remaining() })
      }

      case 'apply_batch': {
        const items = Array.isArray(body.items) ? body.items.slice(0, APPLY_BATCH_MAX) : []
        if (!items.length) return fail('apply_batch needs items', 400)
        const refused = await quotaRefusal()
        if (refused) return refused
        const { prefs, budgetMb } = await loadPrefs(userId, null)
        const runId = typeof body.run_id === 'string' && UUID.test(body.run_id) ? body.run_id : crypto.randomUUID()
        const started = Date.now()
        const results: Rec[] = []
        const notStarted: string[] = []
        // One game at a time: each already downloads its images in parallel.
        for (const it of items as Rec[]) {
          const gameId = String(it.game_id ?? '')
          if (Date.now() - started > BATCH_DEADLINE_MS) { notStarted.push(gameId); continue }
          const jeuId = String(it.jeu_id ?? '')
          if (!UUID.test(gameId) || !/^\d{1,10}$/.test(jeuId)) { results.push({ game_id: gameId, outcome: 'error', reason: 'bad ids' }); continue }
          results.push(await applyOne(userId, {
            gameId, jeuId, system: it.system ?? null,
            rom: it.rom_filename ? { filename: String(it.rom_filename) } : null,
            fields: fieldPolicies(null, prefs), media: null, prefs, budgetMb, runId, basis: basisOf(it.matched_by), overrides: null,
          }))
        }
        return json({ status: 'ok', run_id: runId, results, not_started: notStarted, requests: issued, remaining_today: remaining() })
      }

      case 'undo': {
        const runId = String(body.run_id ?? '')
        if (!UUID.test(runId)) return fail('undo needs a run_id', 400)
        const gameIds = Array.isArray(body.game_ids) ? body.game_ids.map(String).filter((x: string) => UUID.test(x)).slice(0, 500) : null
        return json(await undoRun(userId, runId, gameIds && gameIds.length ? gameIds : null))
      }

      case 'cleanup':
        return json(await cleanup(userId, body.dry_run === true))

      default:
        return fail(`Unknown action "${action}"`, 400)
    }
  } catch (e) {
    return fail((e as Error).message)
  }
})
