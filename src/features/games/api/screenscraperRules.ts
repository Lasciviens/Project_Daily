// The pure half of the ScreenScraper sync, kept OUT of the edge function so it
// can actually be verified — the same arrangement esdeImportRules.ts uses, and
// for the same reason: a Deno function is self-contained here and cannot import
// from src/, so this module is hand-mirrored into it. **Change one, change the
// other**, and re-run scripts/verify-screenscraper-rules.cjs.
//
// Deliberately import-free (no supabase client, no React) so a plain node
// script can require it.
//
// Field mapping and the media-type list come from real responses recorded in
// docs/games/screenscraper-integration.md §5 — not guessed.

/**
 * Removes every credential value from a string.
 *
 * SECURITY-CRITICAL, and the reason it lives in a tested module rather than
 * inline in the function. ScreenScraper puts `devid`/`devpassword` in the query
 * string of every URL it hands back, so an error message that quotes a URL — or
 * a log line, or a row written to `app_error_logs`, which `ai-proxy` can read —
 * would carry the credentials with it.
 *
 * Substring replacement, not query-parameter parsing: the value has to disappear
 * wherever it appears, including inside a URL that never parsed cleanly, a
 * truncated response body, or a stack trace. Short or empty secrets are skipped
 * — replacing every "1" in a message would destroy it while protecting nothing.
 */
export function scrubSecrets(text: string, secrets: (string | undefined | null)[]): string {
  let out = text
  for (const s of secrets) {
    if (!s || s.length < 4) continue
    out = out.split(s).join('[REDACTED]')
  }
  // Belt and braces: even a secret this call was not told about is masked when
  // it appears as one of ScreenScraper's own credential parameters.
  return out.replace(/\b(devid|devpassword|ssid|sspassword)=[^&\s"']*/gi, '$1=[REDACTED]')
}

// ─── Multi-language / multi-region value pickers ─────────────────────────────

export type Localized = { region?: string; langue?: string; text?: string }

/**
 * ScreenScraper returns most human-readable values as an array of regional or
 * translated variants. Preference order first, then ANY remaining value —
 * falling back matters: `familles` (the series) frequently exists only in
 * French, and dropping it because `en` is missing would lose a real value.
 */
export function pickLocalized(list: unknown, prefer: string[], key: 'region' | 'langue'): string | null {
  if (!Array.isArray(list)) return null
  const entries = list.filter((e): e is Localized => !!e && typeof e === 'object')
  for (const want of prefer) {
    const hit = entries.find(e => (e[key] ?? '').toLowerCase() === want && (e.text ?? '').trim())
    if (hit) return hit.text!.trim()
  }
  const any = entries.find(e => (e.text ?? '').trim())
  return any ? any.text!.trim() : null
}

/** `noms[]` — `ss` is ScreenScraper's own canonical name, so it wins. */
export const pickName = (noms: unknown): string | null => pickLocalized(noms, ['ss', 'us', 'eu', 'wor'], 'region')

/** `synopsis[]` — English, else whatever exists. */
export const pickSynopsis = (syn: unknown): string | null => pickLocalized(syn, ['en'], 'langue')

/**
 * `dates[]` carries `YYYY-MM-DD` (sometimes just `YYYY`) per region. The
 * EARLIEST is the game's actual first release; a region-matched date would
 * describe this copy rather than the game.
 */
export function pickReleaseYear(dates: unknown): number | null {
  if (!Array.isArray(dates)) return null
  const years: number[] = []
  for (const d of dates) {
    const t = (d as Localized)?.text
    if (typeof t !== 'string') continue
    const m = /^(\d{4})/.exec(t.trim())
    if (!m) continue
    const y = Number(m[1])
    if (y >= 1950 && y <= 2100) years.push(y)
  }
  return years.length ? Math.min(...years) : null
}

/** Each genre is itself a localized list. `principale: "1"` marks the main one, which leads. */
export function pickGenres(genres: unknown): string[] | null {
  if (!Array.isArray(genres)) return null
  const named = genres
    .map(g => ({
      primary: String((g as { principale?: unknown })?.principale ?? '') === '1',
      name: pickLocalized((g as { noms?: unknown })?.noms, ['en'], 'langue'),
    }))
    .filter((g): g is { primary: boolean; name: string } => !!g.name)
  if (named.length === 0) return null
  const ordered = [...named.filter(g => g.primary), ...named.filter(g => !g.primary)]
  return [...new Set(ordered.map(g => g.name))]
}

export function pickModes(modes: unknown): string[] | null {
  if (!Array.isArray(modes)) return null
  const names = modes
    .map(m => pickLocalized((m as { noms?: unknown })?.noms, ['en'], 'langue'))
    .filter((n): n is string => !!n)
  return names.length ? [...new Set(names)] : null
}

/** `classifications[]` — PEGI first (this library is European), then ESRB. */
export function pickAgeRating(classifications: unknown): string | null {
  if (!Array.isArray(classifications)) return null
  const find = (type: string) =>
    classifications.find(c => String((c as { type?: unknown })?.type ?? '').toUpperCase() === type) as
      { type?: string; text?: string } | undefined
  for (const t of ['PEGI', 'ESRB', 'CERO', 'SS']) {
    const hit = find(t)
    if (hit?.text) return `${t} ${hit.text}`.trim()
  }
  return null
}

/**
 * `note.text` is out of **20** — not 10, not 100.
 * `game_platforms.rating` is 0-100, so ×5. Never `games.rating`, which is the
 * user's own score and is never written by anything external (doc §7).
 */
export function scoreToRating100(note: unknown): number | null {
  const raw = (note as { text?: unknown })?.text ?? note
  if (raw === null || raw === undefined || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0 || n > 20) return null
  return Math.round(n * 5 * 10) / 10
}

// ─── Media ───────────────────────────────────────────────────────────────────

/** Which `medias[].type` fills which column (doc §5's verified 26-type list). */
export const MEDIA_ROLE = {
  cover: 'box-2D',
  screenshot: 'ss',
  fanart: 'fanart',
} as const
export type MediaRole = keyof typeof MEDIA_ROLE

export type Media = { type?: string; url?: string; region?: string; format?: string }

/**
 * Picks one media entry for a role. Region preference only breaks ties between
 * entries of the SAME type — a wrong-region box is still the right artwork,
 * whereas a different type is different artwork.
 */
export function pickMedia(medias: unknown, role: MediaRole, prefer = ['wor', 'us', 'eu', 'ss', 'jp']): Media | null {
  if (!Array.isArray(medias)) return null
  const want = MEDIA_ROLE[role]
  const candidates = (medias as Media[]).filter(m => m?.type === want && typeof m.url === 'string' && m.url)
  if (candidates.length === 0) return null
  for (const region of prefer) {
    const hit = candidates.find(m => (m.region ?? '').toLowerCase() === region)
    if (hit) return hit
  }
  return candidates[0]
}

/** Extension for the stored object; ScreenScraper reports `format` ("png", "jpg"). */
export function mediaExtension(m: Media | null): string {
  const f = (m?.format ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return f && f.length <= 4 ? f : 'png'
}

/**
 * Where a mirrored image lives in the bucket.
 *
 * Keyed by our own game id, never by anything from ScreenScraper: the path is
 * then stable across a re-scrape, and a re-run overwrites its own object
 * instead of growing a second copy.
 */
export function storagePath(gameId: string, role: MediaRole, ext: string): string {
  return `${gameId}/${role}.${ext}`
}

// ─── Matching ────────────────────────────────────────────────────────────────

/** `./Sonic 3 (USA).md` → `Sonic 3 (USA).md` — what `romnom` wants. */
export function romNameFromPath(esdePath: string | null | undefined): string | null {
  if (typeof esdePath !== 'string') return null
  // `.` and `..` survive a plain split (`'./'` reduces to `'.'`) and are path
  // segments, not filenames — sending one as `romnom` would query for a game
  // called ".".
  const base = esdePath.replace(/\\/g, '/').split('/')
    .filter(seg => seg && seg !== '.' && seg !== '..')
    .pop()
  const trimmed = (base ?? '').trim()
  return trimmed ? trimmed : null
}

export type GameFields = {
  title: string | null
  release_year: number | null
  publisher: string | null
  developer: string | null
  description: string | null
  genres: string[] | null
  modes: string[] | null
  players: string | null
  age_rating: string | null
  series_name: string | null
  external_ref: string | null
}

/** `response.jeu` → the columns we keep. Nothing here touches media or rating. */
export function mapJeuToGame(jeu: Record<string, unknown>): GameFields {
  const textOf = (v: unknown): string | null => {
    const t = (v as { text?: unknown })?.text
    return typeof t === 'string' && t.trim() ? t.trim() : null
  }
  return {
    title:        pickName(jeu.noms),
    release_year: pickReleaseYear(jeu.dates),
    publisher:    textOf(jeu.editeur),
    developer:    textOf(jeu.developpeur),
    description:  pickSynopsis(jeu.synopsis),
    genres:       pickGenres(jeu.genres),
    modes:        pickModes(jeu.modes),
    players:      textOf(jeu.joueurs),
    age_rating:   pickAgeRating(jeu.classifications),
    // `familles` is the SERIES ("Sonic"), and is frequently French-only —
    // pickLocalized's any-language fallback is what keeps it.
    series_name:  Array.isArray(jeu.familles)
      ? pickLocalized((jeu.familles[0] as { noms?: unknown })?.noms, ['en'], 'langue')
      : null,
    external_ref: jeu.id != null ? String(jeu.id) : null,
  }
}

/**
 * Only writes a column the game does not already have.
 *
 * ScreenScraper fills gaps; it never overrules what is already recorded. The
 * ES-DE import made the same promise on its own update path, and the user may
 * have edited any of these by hand since.
 */
export function fillOnlyMissing<T extends Record<string, unknown>>(existing: T, incoming: Partial<T>): Partial<T> {
  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(incoming)) {
    if (v === null || v === undefined) continue
    if (Array.isArray(v) && v.length === 0) continue
    const cur = existing[k as keyof T]
    const empty = cur === null || cur === undefined || cur === '' || (Array.isArray(cur) && cur.length === 0)
    if (empty) patch[k] = v
  }
  return patch as Partial<T>
}

// ─── System resolution ───────────────────────────────────────────────────────

export type SystemRow = { id: number; name?: string | null; retropie_names?: string[] | null }

/**
 * Builds the ES-DE folder name → ScreenScraper `systemeid` map.
 *
 * **Several ScreenScraper systems legitimately claim the same RetroPie alias**,
 * and picking the wrong one is not a near miss — it searches a different
 * database. Real, measured collisions:
 *
 *   snes    → 4 Super Nintendo | 107 Satellaview | 108 Sufami Turbo
 *                              | 202 Snes - Super Mario World Hacks
 *   nes     → 3 NES            | 278 Nes - Super Mario Bros. Hacks
 *   genesis → 1 Megadrive      | 203 Megadrive - Sonic The Hedgehog 2 Hacks
 *   n64     → 14 Nintendo 64   | 122 Nintendo 64DD
 *   psp     → 61 PSP           | 172 Playstation minis
 *
 * A first version let the last row win and so scraped 604 of 1002 games against
 * a ROM-hack database — which is why `Sonic The Hedgehog (USA, Europe)` came
 * back as `Amy Rose In Sonic The Hedgehog` and three Contra files all came back
 * as `Contra 3`.
 *
 * The LOWEST id wins. ScreenScraper numbered the real consoles first (1
 * Megadrive, 3 NES, 4 Super Nintendo, 12 GBA, 14 N64, 57 PSX, 61 PSP) and every
 * variant, add-on and hack collection later (107, 108, 122, 172, 202, 203,
 * 278) — so "smallest id" is "the actual console" across every collision the
 * real library produces. It is a heuristic about their numbering, not a
 * guarantee, which is why `resolveSystemId` also reports WHICH system it chose
 * so a wrong pick is visible in the result rather than silent.
 */
export function buildSystemIdMap(rows: SystemRow[]): Map<string, { id: number; name: string }> {
  const map = new Map<string, { id: number; name: string }>()
  for (const row of rows) {
    const id = Number(row.id)
    if (!Number.isFinite(id)) continue
    for (const raw of row.retropie_names ?? []) {
      const alias = String(raw ?? '').trim().toLowerCase()
      if (!alias) continue
      const current = map.get(alias)
      if (!current || id < current.id) map.set(alias, { id, name: row.name ?? String(id) })
    }
  }
  return map
}

export function resolveSystemId(
  map: Map<string, { id: number; name: string }>,
  esdeSystem: string | null | undefined,
): { id: number; name: string } | null {
  if (!esdeSystem) return null
  return map.get(String(esdeSystem).trim().toLowerCase()) ?? null
}
