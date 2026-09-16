// esde-sync — the RP6 Android handheld pushes its EmulationStation-DE library
// here. DELIBERATELY ITS OWN FUNCTION, not an action on phone-gateway: that
// gateway is the iPhone's entry point (Shortcuts / Scriptable) and carries the
// iPhone's own device secret. A different physical device, with a different
// secret and a different lifecycle, gets its own door — revoking one must
// never revoke the other.
//
// Authenticates by a static, revocable device secret (x-esde-secret ===
// ESDE_SYNC_SECRET), acts as the single user (HEVY_USER_ID) SERVER-SIDE via
// the service-role key. Deploy with "Enforce JWT Verification" OFF — the
// secret is not a Supabase JWT, same pattern as hevy-sync /
// health-export-webhook. The service-role key NEVER leaves the server.
// Self-contained (no _shared imports), per this repo's deploy convention.
//
// Payload contract, what the device must not send, and the per-field mapping:
// docs/games/screenscraper-integration.md §10. Keyed by migration 093's
// partial unique index on (user_id, esde_system, esde_path).
//
// ⚠ The pure field/timestamp/roll-up logic below is HAND-MIRRORED from
// src/features/games/api/esdeImportRules.ts, which is where it is actually
// verified (scripts/verify-esde-import-rules.cjs, 59 assertions). A Deno
// function cannot import from src/, hence two copies — the same arrangement
// googleTasksOutboxRules.ts already uses for the Google Tasks outbox.
// **Change one, change the other**, and re-run the verify script.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-esde-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const MAX_BATCH = 150
const SOURCE = 'esde'

// ─── Time ────────────────────────────────────────────────────────────────────
// ES-DE writes local wall-clock time with no offset, so resolving it needs the
// device's zone and a DST-safe conversion — never a hardcoded offset. Same
// two-pass technique phone-gateway's import_body_composition uses: guess the
// instant assuming UTC, read what wall-clock time that instant maps to in the
// target zone, correct by the difference, repeat once (the offset at the
// corrected instant can differ from the offset at the guess on either side of
// a transition). Hand-duplicated here because edge functions are deliberately
// self-contained in this repo; keep both copies in step.
function zonedWallTimeToUtcMs(y: number, mo: number, d: number, h: number, mi: number, se: number, timeZone: string): number {
  const offsetMsAt = (utcMs: number): number => {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    const parts: AnyRecord = {}
    for (const p of dtf.formatToParts(new Date(utcMs))) if (p.type !== 'literal') parts[p.type] = p.value
    let hour = Number(parts.hour); if (hour === 24) hour = 0
    const asIfUTC = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, Number(parts.minute), Number(parts.second))
    return asIfUTC - utcMs
  }
  const guessUtc = Date.UTC(y, mo - 1, d, h, mi, se)
  const utc1 = guessUtc - offsetMsAt(guessUtc)
  return guessUtc - offsetMsAt(utc1)
}

function isValidTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}

type Naive = { y: number; mo: number; d: number; h: number; mi: number; se: number }

// "YYYYMMDDTHHMMSS". ES-DE's own "no value" is a string of zeros, which Date
// would happily read as year 0 — treated as absent instead.
function parseEsdeTimestamp(raw: unknown): Naive | null {
  if (typeof raw !== 'string') return null
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(raw.trim())
  if (!m) return null
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number)
  if (y < 1970 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return null
  return { y, mo, d, h, mi, se }
}

const esdeIso = (raw: unknown, tz: string): string | null => {
  const p = parseEsdeTimestamp(raw)
  return p ? new Date(zonedWallTimeToUtcMs(p.y, p.mo, p.d, p.h, p.mi, p.se, tz)).toISOString() : null
}

const esdeDate = (raw: unknown): string | null => {
  const p = parseEsdeTimestamp(raw)
  if (!p) return null
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(p.y, 4)}-${pad(p.mo)}-${pad(p.d)}`
}

// ─── Field readers ───────────────────────────────────────────────────────────
// Absent and zero are different facts (§10): a missing <playcount> means ES-DE
// wrote nothing, not that the game was launched zero times.
const esdeInt = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}
const esdeText = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}
const isTrue = (v: unknown): boolean => v === true || v === 'true'

/** Mirrors gameStats.ts::AUTO_PLAYING_SECONDS — a Deno function cannot import
 *  from src/, so this is a hand-kept copy. Change both. */
const AUTO_PLAYING_SECONDS = 30 * 60

// ES-DE's <rating> is a 0-1 decimal; game_platforms.rating is 0-100 and CHECKed
// to that range, so a malformed value is dropped rather than clamped into a
// number nobody measured.
const esdeRating = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 1) return null
  return Math.round(n * 1000) / 10
}

type Entry = { system: string; path: string; name: string; raw: AnyRecord }

// The batch-local identity of an ES-DE entry. JSON, not a delimiter-joined
// string: a ROM path is arbitrary user text and any separator picked by hand
// is one filename away from colliding.
const keyOf = (system: string, path: string) => JSON.stringify([system, path])

/**
 * Validates the WHOLE batch before anything is written, so a rejected batch
 * that is fixed and re-sent cannot double-apply. Errors are keyed by the
 * entry's index in `games`.
 */
function validateBatch(body: AnyRecord): { ok: true; entries: Entry[]; tz: string } | { ok: false; errors: AnyRecord } {
  const tz = esdeText(body.timezone) ?? 'Europe/Oslo'
  if (!isValidTimeZone(tz)) return { ok: false, errors: { timezone: `Unknown IANA time zone "${tz}"` } }

  const list = body.games
  if (!Array.isArray(list) || list.length === 0) return { ok: false, errors: { games: 'games must be a non-empty array' } }
  if (list.length > MAX_BATCH) return { ok: false, errors: { games: `Batch too large (${list.length} > ${MAX_BATCH})` } }

  const errors: AnyRecord = {}
  const entries: Entry[] = []
  const seen = new Set<string>()
  list.forEach((g: AnyRecord, i: number) => {
    const system = esdeText(g?.system), path = esdeText(g?.path), name = esdeText(g?.name)
    if (!system) { errors[i] = 'system is required'; return }
    if (!path) { errors[i] = 'path is required'; return }
    if (!name) { errors[i] = 'name is required'; return }
    // A key repeated inside one batch would make the batch's outcome depend on
    // statement order — reject it rather than silently last-wins.
    const key = keyOf(system, path)
    if (seen.has(key)) { errors[i] = `duplicate (system, path) within this batch: ${system} ${path}`; return }
    seen.add(key)
    entries.push({ system, path, name, raw: g })
  })

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, entries, tz }
}

/**
 * Metadata, written on CREATE ONLY — see the handler's own note on why an
 * update never touches it.
 *
 * `games.rating` is deliberately absent: that is the USER's own 0-10 score and
 * nothing external ever writes it (doc §7). ES-DE's rating goes to
 * game_platforms.rating, on that column's own 0-100 scale.
 */
function gameMetadata(e: Entry): AnyRecord {
  const g = e.raw
  const genre = esdeText(g.genre)
  const released = parseEsdeTimestamp(g.releasedate)
  return {
    title: e.name,
    description: esdeText(g.desc),
    developer: esdeText(g.developer),
    publisher: esdeText(g.publisher),
    players: esdeText(g.players),
    // ES-DE packs every genre into ONE comma-separated string (doc §9).
    genres: genre ? genre.split(',').map(x => x.trim()).filter(Boolean) : null,
    release_year: released ? released.y : null,
    external_source: SOURCE,
  }
}

function platformStats(e: Entry, tz: string, now: string): AnyRecord {
  return {
    esde_playcount: esdeInt(e.raw.playcount),
    esde_playtime_seconds: esdeInt(e.raw.playtime),
    esde_last_played: esdeIso(e.raw.lastplayed, tz),
    synced_at: now,
  }
}

/**
 * The roll-up that 089's `games.esde_*` columns hold: sum play counts and
 * seconds across a game's variants, take the latest last_played. Summing is
 * the only rule that cannot silently discard a real play session. Stays null
 * when no variant reported anything — "never launched" is not the same claim
 * as "ES-DE recorded 0 launches", and only the second would be a fact.
 */
function rollUp(rows: AnyRecord[]): AnyRecord {
  let count: number | null = null, seconds: number | null = null, last: string | null = null
  for (const r of rows) {
    if (r.esde_playcount != null) count = (count ?? 0) + Number(r.esde_playcount)
    if (r.esde_playtime_seconds != null) seconds = (seconds ?? 0) + Number(r.esde_playtime_seconds)
    if (r.esde_last_played && (!last || r.esde_last_played > last)) last = r.esde_last_played
  }
  return { esde_playcount: count, esde_playtime_seconds: seconds, esde_last_played: last }
}

/** Bounded concurrency — 150 at once would open 150 sockets. */
async function inChunks<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ status: 'error', error: 'Method Not Allowed' }, 405)

  const secret = Deno.env.get('ESDE_SYNC_SECRET')
  const given = req.headers.get('x-esde-secret')
  if (!secret || given !== secret) return json({ status: 'error', error: 'Unauthorized' }, 401)
  const userId = Deno.env.get('HEVY_USER_ID')
  if (!userId) return json({ status: 'error', error: 'Server not configured (HEVY_USER_ID)' }, 503)

  const body = await req.json().catch(() => ({})) as AnyRecord
  const action = String(body.action ?? 'import_esde_games')
  if (action !== 'import_esde_games') {
    return json({ status: 'error', error: `Unknown action "${action}" (only import_esde_games)` }, 400)
  }

  try {
    const parsed = validateBatch(body)
    if (!parsed.ok) return json({ status: 'validation_error', errors: parsed.errors }, 400)
    const { entries, tz } = parsed
    const now = new Date().toISOString()

    // `hidden` is ES-DE's own "don't show me this" flag — no reason to import
    // a row the user already hid on the device.
    const kept = entries.filter(e => !isTrue(e.raw.hidden))
    const skipped = entries.length - kept.length
    if (kept.length === 0) {
      return json({ status: 'ok', batch: esdeInt(body.batch), received: entries.length, created: 0, updated: 0, skipped, flagged: 0 })
    }

    // Bound lookup URLs: 150 long Switch paths can exceed the REST API's
    // 16 KB URL limit. Finish every lookup before starting any writes.
    const byKey = new Map<string, AnyRecord>()
    for (let offset = 0; offset < kept.length; offset += 20) {
      const chunk = kept.slice(offset, offset + 20)
      const { data: existingRows, error: selErr } = await supabase
        .from('game_platforms')
        .select('id, game_id, esde_system, esde_path')
        .eq('user_id', userId)
        .in('esde_path', chunk.map(e => e.path))
      if (selErr) return json({ status: 'server_error', error: `existing variants lookup: ${selErr.message}` }, 500)
      for (const r of existingRows ?? []) byKey.set(keyOf(r.esde_system, r.esde_path), r)
    }

    const newOnes = kept.filter(e => !byKey.has(keyOf(e.system, e.path)))
    const updates = kept.filter(e => byKey.has(keyOf(e.system, e.path)))

    // ── Create: one games row + one game_platforms row per entry. Ids are
    //    generated here rather than read back, so nothing depends on a
    //    multi-row insert returning in insertion order. ──
    if (newOnes.length > 0) {
      const gameRows: AnyRecord[] = []
      const platformRows: AnyRecord[] = []
      for (const e of newOnes) {
        const gameId = crypto.randomUUID()
        const stats = platformStats(e, tz, now)
        const broken = isTrue(e.raw.broken)
        gameRows.push({
          id: gameId, user_id: userId,
          ...gameMetadata(e),
          // A brand-new game has exactly one variant, so its roll-up IS this entry.
          esde_playcount: stats.esde_playcount,
          esde_playtime_seconds: stats.esde_playtime_seconds,
          esde_last_played: stats.esde_last_played,
          synced_at: now,
          needs_review: broken,
        })
        platformRows.push({
          user_id: userId, game_id: gameId,
          // The display value starts as the device's folder name and is the
          // user's to rename from then on; esde_system is what the key uses.
          system: e.system, esde_system: e.system, esde_path: e.path,
          // A brand-new game has exactly one variant, so that variant IS the
          // primary one. Leaving this false (the column default) is what left
          // the whole imported library with no primary variant, which the UI
          // reads as "which system is this game on?" having no answer and
          // Needs Review flags on its own. Only ever true on the create path:
          // an existing game's chosen primary is never touched by a re-push.
          is_primary_variant: true,
          rating: esdeRating(e.raw.rating),
          release_date: esdeDate(e.raw.releasedate),
          external_source: SOURCE,
          needs_review: broken,
          ...stats,
        })
      }
      const { error: gErr } = await supabase.from('games').insert(gameRows)
      if (gErr) return json({ status: 'server_error', error: `games insert: ${gErr.message}` }, 500)
      const { error: pErr } = await supabase.from('game_platforms').insert(platformRows)
      // The games rows are already in. Report that plainly rather than
      // implying nothing was written — a re-sent batch finds them by key and
      // takes the update path, so the retry stays safe either way.
      if (pErr) return json({ status: 'server_error', error: `game_platforms insert: ${pErr.message}`, games_written: gameRows.length }, 500)
    }

    // ── Update: play statistics ONLY. ──
    // ES-DE owns play stats; the user owns their library. Re-writing
    // title/description/genres on every push would silently undo their own
    // curation — the same shape as the Hevy body-measurement overwrite
    // incident. Metadata is a create-time fact here; ScreenScraper is the
    // provider that fills gaps later.
    let failure: string | null = null
    await inChunks(updates, 10, async (e) => {
      const row = byKey.get(keyOf(e.system, e.path))!
      const patch: AnyRecord = platformStats(e, tz, now)
      if (isTrue(e.raw.broken)) patch.needs_review = true
      const { error } = await supabase.from('game_platforms').update(patch).eq('id', row.id).eq('user_id', userId)
      if (error && !failure) failure = `game_platforms update: ${error.message}`
    })
    if (failure) return json({ status: 'server_error', error: failure }, 500)

    // ── Roll up onto games, only where there is something to roll up. A
    //    single-variant game's roll-up is the row just written, so the 1125
    //    games measured in doc §9 cost nothing extra here. ──
    const updatedGameIds = [...new Set(updates.map(e => byKey.get(keyOf(e.system, e.path))!.game_id as string))]
    if (updatedGameIds.length > 0) {
      const { data: variants, error: vErr } = await supabase
        .from('game_platforms')
        .select('game_id, esde_playcount, esde_playtime_seconds, esde_last_played')
        .eq('user_id', userId)
        .in('game_id', updatedGameIds)
      if (vErr) return json({ status: 'server_error', error: `roll-up read: ${vErr.message}` }, 500)

      // Current statuses, so a game with real hours behind it can stop being a
      // backlog entry — and so nothing else is ever touched (see below).
      const { data: statusRows } = await supabase
        .from('games').select('id, play_status').eq('user_id', userId).in('id', updatedGameIds)
      const statusById = new Map((statusRows ?? []).map((r: AnyRecord) => [String(r.id), String(r.play_status)]))

      const grouped = new Map<string, AnyRecord[]>()
      for (const v of variants ?? []) {
        const arr = grouped.get(v.game_id) ?? []
        arr.push(v); grouped.set(v.game_id, arr)
      }
      await inChunks([...grouped.entries()], 10, async ([gameId, rows]) => {
        const stats = rollUp(rows)
        // Half an hour of recorded play means it is not sitting in a backlog,
        // whatever nobody got round to setting. ONLY from 'backlog', which is
        // the default nothing chose: 'completed', 'dropped' and 'wishlist' are
        // statements the user made, and a sync must never argue with one — in
        // particular this can never un-complete a game someone replays.
        // Thirty minutes, not the first launch, because booting a ROM to check
        // it runs is the most common thing that happens in a retro library.
        const promote = statusById.get(gameId) === 'backlog'
          && (stats.esde_playtime_seconds ?? 0) >= AUTO_PLAYING_SECONDS
        const { error } = await supabase.from('games')
          .update({ ...stats, synced_at: now, ...(promote ? { play_status: 'playing' } : {}) })
          .eq('id', gameId).eq('user_id', userId)
        if (error && !failure) failure = `games roll-up: ${error.message}`
      })
      if (failure) return json({ status: 'server_error', error: failure }, 500)
    }

    return json({
      status: 'ok',
      batch: esdeInt(body.batch),
      received: entries.length,
      created: newOnes.length,
      updated: updates.length,
      skipped,
      flagged: kept.filter(e => isTrue(e.raw.broken)).length,
    })
  } catch (e) {
    return json({ status: 'server_error', error: (e as Error).message }, 500)
  }
})
