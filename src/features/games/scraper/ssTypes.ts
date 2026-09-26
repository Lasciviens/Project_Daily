// The contract between the browser and the `screenscraper-sync` /
// `screenscraper-media` edge functions. Type-only and import-free: it is
// copied verbatim into both functions by scripts/sync-screenscraper-shared.mjs.

/** Game-level fields (the `games` row) and the primary variant's own fields
 *  (`game_platforms`), in the order the review lists them. */
export type SsGameField =
  | 'title' | 'description' | 'release_year' | 'publisher' | 'developer'
  | 'genres' | 'modes' | 'players' | 'age_rating' | 'series_name'
  | 'cover' | 'screenshot' | 'fanart'
export type SsPlatformField = 'release_date' | 'region' | 'rating' | 'wheel' | 'version_title' | 'rom_status'
export type SsField = SsGameField | SsPlatformField

/** fill = only when empty · replace = overwrite what is there · skip = never */
export type FieldPolicy = 'fill' | 'replace' | 'skip'

/** How a search result was found. `hash` and a VERIFIED `filename` (their
 *  answer names the same dump) are ROM identity; `filename_guess` is their
 *  best guess for a filename they do not know (a renamed or hacked ROM);
 *  `previous` is the id this game was matched to before; `id` an id typed in;
 *  `name` a text search (weak). */
export type MatchBasis = 'hash' | 'filename' | 'filename_guess' | 'serial' | 'id' | 'previous' | 'name'

/** Which ScreenScraper media endpoint a file comes from. */
export type MediaEndpoint = 'img' | 'video' | 'manual'

/** One file ScreenScraper has for a game — everything but its URL, which
 *  carries the developer and member credentials and never leaves the server. */
export interface SsMediaEntry {
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

export interface SsLocalized { key: string; text: string }

export interface SsRomInfo {
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
export interface SsExtraMedia { parent: string; parent_label: string | null; type: string; region: string | null; format: string | null; size: number | null }

export interface SsHack { id: string | null; name: string | null; author: string | null; status: string | null; version: string | null; synopses: SsLocalized[] }

/** A normalized search result. Carries values, never a media URL. */
export interface SsCandidate {
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

export interface SsRomQuery {
  filename?: string | null
  size?: number | null
  crc?: string | null
  md5?: string | null
  sha1?: string | null
  serial?: string | null
}

export interface SsQueryOutcome {
  kind: MatchBasis
  status: 'ok' | 'no_match' | 'skipped' | 'error'
  count: number
  message?: string
}

/** A media type the user wants on apply, and how. */
export interface SsMediaChoice { type: string; token?: string | null; mode: 'store' | 'on_demand' }

/** Saved per user (screenscraper_prefs.prefs) and sent with every apply. */
export interface SsPrefs {
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
