// screenscraper-sync — fills the gaps ES-DE left, and mirrors artwork.
//
// Triggered by the user from the app, never on a schedule. Normal browser-JWT
// auth (verify_jwt stays ON, like steam-api/psn-api) — this is not a device,
// so it needs no device secret of its own. The caller is resolved from their
// JWT and every query is scoped to them.
//
// ── The four security measures, all load-bearing ───────────────────────────
// ScreenScraper puts `devid` and `devpassword` in the query string of EVERY
// URL it returns, including media. So:
//   1. No ScreenScraper URL is ever written to the database. The function
//      downloads the image and stores it in the `game-media` bucket; the DB
//      gets a Storage URL. A URL the browser must fetch cannot be hidden from
//      it, which is why this is mirroring rather than proxying.
//   2. Every error string is passed through `scrub()` before it is returned or
//      logged. This repo writes failures into `app_error_logs`, which ai-proxy
//      can read — an unscrubbed URL there is a credential in a table the
//      assistant queries.
//   3. Nothing logs a full request or media URL. Ever.
//   4. Redirects are not followed with credentials attached: the fetch is
//      `redirect: 'manual'` and a Location is followed once, bare.
//
// ── Premium ────────────────────────────────────────────────────────────────
// The paid membership hangs off the MEMBER account, not the dev app, so all
// four credentials are sent on every call (doc §2). That buys 6 threads,
// 100k requests/day and 17× media download speed. `requeststoday` is an
// ACCOUNT-wide counter — ES-DE's own scraping on the device spends from the
// same budget — so a run reads it first and refuses rather than assuming.
//
// ⚠ The pure mapping/scrubbing logic below is HAND-MIRRORED from
// src/features/games/api/screenscraperRules.ts, where it is verified
// (scripts/verify-screenscraper-rules.cjs, 62 assertions). A Deno function
// cannot import from src/. **Change one, change the other.**
//
// Full API findings: docs/games/screenscraper-integration.md
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  // supabase-js sends `apikey` and `x-client-info` on every invoke, so a
  // preflight that does not allow them is rejected by the browser before the
  // request is ever sent — which surfaces as "Failed to send a request to the
  // Edge Function" rather than as any status this function could return.
  // Same list as steam-api / psn-api / food-search.
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>

const API = 'https://api.screenscraper.fr/api2'
// How many search candidates reach the picker. Their search answered with 30
// for one query (doc §1); a dozen is already more than anyone reads.
const SEARCH_LIMIT = 12
const SOFTNAME = 'lascisboard'
const BUCKET = 'game-media'
// Premium reports maxthreads 6. Never above what the account actually grants.
const THREADS = 6
// A batch is small because each game can cost 1 metadata call + up to 3 image
// downloads, and the client drives the loop (the steam-api `app_details`
// pattern) rather than one invocation trying to carry 1200 games.
const MAX_BATCH = 20
// Refuse to start a run that would leave the shared daily budget under this.
const QUOTA_FLOOR = 500

const DEVID = Deno.env.get('SCREENSCRAPER_DEVID') ?? ''
const DEVPASSWORD = Deno.env.get('SCREENSCRAPER_DEVPASSWORD') ?? ''
const SSID = Deno.env.get('SCREENSCRAPER_SSID') ?? ''
const SSPASSWORD = Deno.env.get('SCREENSCRAPER_SSPASSWORD') ?? ''
const SECRETS = [DEVID, DEVPASSWORD, SSID, SSPASSWORD]

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// ─── Security: scrubbing ─────────────────────────────────────────────────────
// Mirrored from screenscraperRules.ts — see the header note.
function scrub(text: string): string {
  let out = text
  for (const s of SECRETS) {
    if (!s || s.length < 4) continue
    out = out.split(s).join('[REDACTED]')
  }
  return out.replace(/\b(devid|devpassword|ssid|sspassword)=[^&\s"']*/gi, '$1=[REDACTED]')
}
const fail = (message: string, status = 500, extra: AnyRecord = {}) =>
  json({ status: 'error', error: scrub(message), ...extra }, status)

/** Builds a request URL. Never logged, never returned, never stored. */
function apiUrl(endpoint: string, params: AnyRecord): string {
  const u = new URL(`${API}/${endpoint}`)
  u.searchParams.set('devid', DEVID)
  u.searchParams.set('devpassword', DEVPASSWORD)
  u.searchParams.set('softname', SOFTNAME)
  u.searchParams.set('output', 'json')
  // The member pair is what switches premium on — it is not optional.
  if (SSID) u.searchParams.set('ssid', SSID)
  if (SSPASSWORD) u.searchParams.set('sspassword', SSPASSWORD)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v))
  }
  return u.toString()
}

type ApiResult =
  | { ok: true; data: AnyRecord }
  | { ok: false; notFound: true }
  | { ok: false; notFound: false; status: number; message: string }

/**
 * ScreenScraper answers errors in PLAIN TEXT, not JSON (doc §4): a 404 reads
 * `Erreur : Rom/Iso/Dossier non trouvée !`. Parsing unconditionally throws
 * before the error can be looked at, so the status is checked FIRST and a 404
 * is reported as a normal outcome rather than a failure — an unmatched ROM is
 * information, not a broken run.
 */
async function callApi(endpoint: string, params: AnyRecord): Promise<ApiResult> {
  let res: Response
  try {
    res = await fetch(apiUrl(endpoint, params), { headers: { 'User-Agent': SOFTNAME } })
  } catch (e) {
    return { ok: false, notFound: false, status: 0, message: scrub((e as Error).message) }
  }
  if (res.status === 404) { await res.body?.cancel(); return { ok: false, notFound: true } }
  const body = await res.text()
  if (!res.ok) {
    return { ok: false, notFound: false, status: res.status, message: scrub(body.slice(0, 300)) }
  }
  try {
    return { ok: true, data: JSON.parse(body) }
  } catch {
    // A 200 that is not JSON is still an error — same plain-text channel.
    return { ok: false, notFound: false, status: 200, message: scrub(body.slice(0, 300)) }
  }
}

// ─── Pure mapping (mirrored from screenscraperRules.ts) ──────────────────────
type Localized = { region?: string; langue?: string; text?: string }

function pickLocalized(list: unknown, prefer: string[], key: 'region' | 'langue'): string | null {
  if (!Array.isArray(list)) return null
  const entries = list.filter((e): e is Localized => !!e && typeof e === 'object')
  for (const want of prefer) {
    const hit = entries.find(e => (e[key] ?? '').toLowerCase() === want && (e.text ?? '').trim())
    if (hit) return hit.text!.trim()
  }
  const any = entries.find(e => (e.text ?? '').trim())
  return any ? any.text!.trim() : null
}
const pickName = (noms: unknown) => pickLocalized(noms, ['ss', 'us', 'eu', 'wor'], 'region')
const pickSynopsis = (syn: unknown) => pickLocalized(syn, ['en'], 'langue')

function pickReleaseYear(dates: unknown): number | null {
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
function pickGenres(genres: unknown): string[] | null {
  if (!Array.isArray(genres)) return null
  const named = genres
    .map(g => ({
      primary: String((g as AnyRecord)?.principale ?? '') === '1',
      name: pickLocalized((g as AnyRecord)?.noms, ['en'], 'langue'),
    }))
    .filter((g): g is { primary: boolean; name: string } => !!g.name)
  if (named.length === 0) return null
  const ordered = [...named.filter(g => g.primary), ...named.filter(g => !g.primary)]
  return [...new Set(ordered.map(g => g.name))]
}
function pickModes(modes: unknown): string[] | null {
  if (!Array.isArray(modes)) return null
  const names = modes.map(m => pickLocalized((m as AnyRecord)?.noms, ['en'], 'langue')).filter((n): n is string => !!n)
  return names.length ? [...new Set(names)] : null
}
function pickAgeRating(classifications: unknown): string | null {
  if (!Array.isArray(classifications)) return null
  for (const t of ['PEGI', 'ESRB', 'CERO', 'SS']) {
    const hit = classifications.find(c => String((c as AnyRecord)?.type ?? '').toUpperCase() === t) as AnyRecord | undefined
    if (hit?.text) return `${t} ${hit.text}`.trim()
  }
  return null
}
/** `note.text` is out of TWENTY. game_platforms.rating is 0-100, so ×5. */
function scoreToRating100(note: unknown): number | null {
  const raw = (note as AnyRecord)?.text ?? note
  if (raw === null || raw === undefined || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0 || n > 20) return null
  return Math.round(n * 5 * 10) / 10
}

const MEDIA_ROLE = { cover: 'box-2D', screenshot: 'ss', fanart: 'fanart' } as const
type MediaRole = keyof typeof MEDIA_ROLE
type Media = { type?: string; url?: string; region?: string; format?: string }

function pickMedia(medias: unknown, role: MediaRole, prefer = ['wor', 'us', 'eu', 'ss', 'jp']): Media | null {
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
function mediaExtension(m: Media | null): string {
  const f = (m?.format ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return f && f.length <= 4 ? f : 'png'
}
const storagePath = (gameId: string, role: MediaRole, ext: string) => `${gameId}/${role}.${ext}`

function romNameFromPath(esdePath: string | null | undefined): string | null {
  if (typeof esdePath !== 'string') return null
  const base = esdePath.replace(/\\/g, '/').split('/')
    .filter(seg => seg && seg !== '.' && seg !== '..')
    .pop()
  const trimmed = (base ?? '').trim()
  return trimmed ? trimmed : null
}

/**
 * The flags a ScreenScraper entry carries about ITSELF.
 *
 * `notgame` and the rom block's beta/demo/proto/hack/unl markers are the
 * highest-signal single fact available for this library's actual failure mode
 * — a filename matching into a ROM-hack collection. They are in every response
 * and were being discarded.
 */
function matchFlags(jeu: AnyRecord): string[] {
  const flags: string[] = []
  if (String(jeu.notgame ?? '').toLowerCase() === 'true' || jeu.notgame === true) flags.push('not a game')
  const rom = (jeu.rom ?? {}) as AnyRecord
  for (const key of ['rombeta', 'romdemo', 'romproto', 'romtrad', 'romhack', 'romunl', 'romalt']) {
    const v = String(rom[key] ?? '').toLowerCase()
    if (v === '1' || v === 'true') flags.push(key.replace(/^rom/, ''))
  }
  const region = typeof rom.romregions === 'string' ? rom.romregions : null
  if (region) flags.push(`region ${region}`)
  return flags
}

function mapJeuToGame(jeu: AnyRecord): AnyRecord {
  const textOf = (v: unknown): string | null => {
    const t = (v as AnyRecord)?.text
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
    series_name:  Array.isArray(jeu.familles)
      ? pickLocalized((jeu.familles[0] as AnyRecord)?.noms, ['en'], 'langue')
      : null,
    external_ref: jeu.id != null ? String(jeu.id) : null,
  }
}

/** ScreenScraper fills gaps; it never overrules what is already recorded. */
function fillOnlyMissing(existing: AnyRecord, incoming: AnyRecord): AnyRecord {
  const patch: AnyRecord = {}
  for (const [k, v] of Object.entries(incoming)) {
    if (v === null || v === undefined) continue
    if (Array.isArray(v) && v.length === 0) continue
    const cur = existing[k]
    const empty = cur === null || cur === undefined || cur === '' || (Array.isArray(cur) && cur.length === 0)
    if (empty) patch[k] = v
  }
  return patch
}

// ─── Media mirroring ─────────────────────────────────────────────────────────
/**
 * Downloads one image and returns its bytes.
 *
 * `redirect: 'manual'` so the credentialed URL is never replayed to whatever a
 * Location header names; a redirect is followed ONCE, bare. No URL is logged
 * or returned on any path through this function.
 */
async function downloadMedia(url: string): Promise<{ ok: true; bytes: Uint8Array; contentType: string } | { ok: false; reason: string }> {
  try {
    let res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': SOFTNAME } })
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      await res.body?.cancel()
      if (!location) return { ok: false, reason: 'redirect without a location' }
      // Bare: no credentials travel to the redirect target.
      res = await fetch(location, { redirect: 'follow' })
    }
    if (!res.ok) { await res.body?.cancel(); return { ok: false, reason: `media http ${res.status}` } }
    const contentType = res.headers.get('content-type') ?? 'application/octet-stream'
    if (!contentType.startsWith('image/')) {
      await res.body?.cancel()
      return { ok: false, reason: `media was ${contentType}, not an image` }
    }
    return { ok: true, bytes: new Uint8Array(await res.arrayBuffer()), contentType }
  } catch (e) {
    return { ok: false, reason: scrub((e as Error).message) }
  }
}

const PENDING_PREFIX = 'pending'
const pendingPath = (gameId: string, jeuId: string, ext: string) => `${PENDING_PREFIX}/${gameId}/${jeuId}/cover.${ext}`

/**
 * Mirrors a CANDIDATE's cover into a quarantine prefix, for review only.
 *
 * Why this exists: the only signal that reliably exposes a wrong match is the
 * artwork — a Mega Drive box on a SNES game, a Japanese cover for a USA ROM, a
 * hack collection's fan art. Titles are similar by construction, since that
 * similarity is why the match happened. And the games most in need of scraping
 * are exactly the ones with no cover yet, so the review card has nothing else
 * to show.
 *
 * It does not weaken the no-credentialed-URL rule at all: the function
 * downloads the image itself and hands back a Supabase Storage URL, which is
 * what the canonical path already does. Approval promotes the object by a
 * Storage copy — no second download, no second request against ScreenScraper.
 */
async function mirrorPending(gameId: string, jeuId: string, media: Media): Promise<string | null> {
  const got = await downloadMedia(media.url!)
  if (!got.ok) return null
  const path = pendingPath(gameId, jeuId, mediaExtension(media))
  const { error } = await admin.storage.from(BUCKET).upload(path, got.bytes, {
    contentType: got.contentType, upsert: true,
  })
  if (error) return null
  return admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

/** Promotes a reviewed candidate cover to its canonical path, by copy. */
async function promotePending(gameId: string, jeuId: string, ext: string): Promise<string | null> {
  const from = pendingPath(gameId, jeuId, ext)
  const to = storagePath(gameId, 'cover', ext)
  const { error } = await admin.storage.from(BUCKET).copy(from, to)
  if (error) return null
  return admin.storage.from(BUCKET).getPublicUrl(to).data.publicUrl
}

/** Mirrors one role into the bucket and returns the PUBLIC STORAGE url. */
async function mirrorMedia(gameId: string, role: MediaRole, media: Media): Promise<string | null> {
  const got = await downloadMedia(media.url!)
  if (!got.ok) return null
  const path = storagePath(gameId, role, mediaExtension(media))
  const { error } = await admin.storage.from(BUCKET).upload(path, got.bytes, {
    contentType: got.contentType, upsert: true,
  })
  if (error) return null
  return admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

/**
 * Runs tasks at the account's real thread limit, never above it, and never
 * faster than the interval doc §2b committed to.
 *
 * That interval is described there as "a politeness contract with the service,
 * not just a technical limit" — and being blacklisted ends this feature
 * outright, so it is worth more than the seconds it costs. Six wide with a
 * wave interval keeps both promises: the concurrency the account actually
 * grants, spaced.
 */
const WAVE_INTERVAL_MS = 1200

async function inThreads<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += THREADS) {
    if (i > 0) await new Promise(r => setTimeout(r, WAVE_INTERVAL_MS))
    out.push(...await Promise.all(items.slice(i, i + THREADS).map(fn)))
  }
  return out
}

// ─── Quota ───────────────────────────────────────────────────────────────────
/**
 * `requeststoday` is ACCOUNT-wide: ES-DE scraping on the handheld spends from
 * the same allowance, so a run reads the real counter instead of assuming a
 * fresh budget (doc §2b).
 */
async function readQuota(): Promise<{ used: number; max: number; threads: number; level: string } | { error: string }> {
  const r = await callApi('ssuserInfos.php', {})
  if (!r.ok) return { error: r.notFound ? 'account not found' : r.message }
  const u = r.data?.response?.ssuser ?? {}
  return {
    used: Number(u.requeststoday ?? 0),
    max: Number(u.maxrequestsperday ?? 0),
    threads: Number(u.maxthreads ?? 1),
    level: String(u.niveau ?? '0'),
  }
}

/**
 * ES-DE folder name → ScreenScraper numeric system id.
 *
 * One entry per alias, so an ES-DE "megadrive" folder resolves just as an
 * ES-DE "genesis" one does. LOWEST id wins when several systems claim one
 * alias. Measured collisions: snes → 4 Super Nintendo | 202 "Snes - Super
 * Mario World Hacks"; genesis → 1 Megadrive | 203 "Sonic The Hedgehog 2
 * Hacks"; nes → 3 NES | 278 "Super Mario Bros. Hacks". A last-write-wins map
 * sent 604 of 1002 games to a ROM-HACK database, which is why Sonic 1 came
 * back as "Amy Rose In Sonic The Hedgehog". ScreenScraper numbered the real
 * consoles first and every variant/hack collection later, so the smallest id
 * is the actual console across every real collision.
 *
 * Mirrored from screenscraperRules.ts::buildSystemIdMap.
 */
async function loadSystemIdMap(): Promise<{ map: Map<string, { id: number; name: string }> } | { error: string }> {
  const { data, error } = await admin
    .from('screenscraper_systems').select('id, name, retropie_names').not('retropie_names', 'is', null)
  if (error) return { error: error.message }
  const map = new Map<string, { id: number; name: string }>()
  for (const s of data ?? []) {
    const id = Number(s.id)
    if (!Number.isFinite(id)) continue
    for (const alias of (s.retropie_names ?? []) as string[]) {
      const key = String(alias ?? '').trim().toLowerCase()
      if (!key) continue
      const cur = map.get(key)
      if (!cur || id < cur.id) map.set(key, { id, name: s.name ?? String(id) })
    }
  }
  return { map }
}

/**
 * Restrict a patch to the fields the caller approved.
 *
 * Field-level acceptance exists because a match is rarely all-or-nothing: the
 * cover is right and the description belongs to the sequel, or the other way
 * round. An ABSENT `fields` means "everything you found" — the common case and
 * the old behaviour; an empty ARRAY means the caller approved nothing, which is
 * a real answer and must not be read as "everything".
 */
/**
 * Writes one decision to the journal (migration 097).
 *
 * Best-effort ON PURPOSE: a missing journal must never fail a write that
 * already landed, and a pre-097 deployment has to keep working. The client
 * falls back to session-only memory when the table is absent, which is exactly
 * the behaviour that existed before this table did.
 */
async function recordDecision(userId: string, row: AnyRecord): Promise<void> {
  const { error } = await admin.from('scrape_decisions').insert({ user_id: userId, ...row })
  if (error) console.log('scrape_decisions insert skipped')
}

function narrowToFields(patch: AnyRecord, fields: unknown): AnyRecord {
  if (!Array.isArray(fields)) return patch
  const allowed = new Set(fields.map(String))
  const out: AnyRecord = {}
  for (const [k, v] of Object.entries(patch)) if (allowed.has(k)) out[k] = v
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return fail('Method Not Allowed', 405)

  if (!DEVID || !DEVPASSWORD) {
    return json({ status: 'not_configured', error: 'SCREENSCRAPER_DEVID / SCREENSCRAPER_DEVPASSWORD are not set in Vault' }, 200)
  }

  // Caller identity from their own JWT (the psn-api pattern), so every read and
  // write is scoped to the person who pressed the button.
  const authHeader = req.headers.get('Authorization') ?? ''
  const { data: userData, error: userErr } = await admin.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''))
  if (userErr || !userData?.user) return fail('Unauthorized', 401)
  const userId = userData.user.id

  const body = await req.json().catch(() => ({})) as AnyRecord
  const action = String(body.action ?? 'status')

  try {
    switch (action) {
      // ── What the credentials actually buy, and how much is left to do. ──
      case 'status': {
        const quota = await readQuota()
        if ('error' in quota) return fail(`ssuserInfos: ${quota.error}`, 502)
        const [{ count: missingMeta }, { count: missingCover }, { count: systems }] = await Promise.all([
          admin.from('games').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('description', null),
          admin.from('games').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('primary_cover_url', null),
          admin.from('screenscraper_systems').select('id', { count: 'exact', head: true }),
        ])
        return json({
          status: 'ok',
          premium: quota.level !== '0',
          account: { level: quota.level, threads: quota.threads, requests_today: quota.used, requests_max: quota.max },
          remaining_today: Math.max(0, quota.max - quota.used),
          systems_known: systems ?? 0,
          games_missing_metadata: missingMeta ?? 0,
          games_missing_cover: missingCover ?? 0,
        })
      }

      // ── One-off: learn the numeric system ids. See migration 094. ──
      case 'refresh_systems': {
        const r = await callApi('systemesListe.php', {})
        if (!r.ok) return fail(`systemesListe: ${r.notFound ? 'not found' : r.message}`, 502)
        const list = r.data?.response?.systemes
        if (!Array.isArray(list)) return fail('systemesListe returned no systeme array', 502)
        // `noms` here is a flat OBJECT of naming conventions, not the
        // {region,text} array the rest of this API uses — a different shape
        // under the same key, so it gets its own reader.
        const rows = list.map((s: AnyRecord) => {
          const noms = (s.noms ?? {}) as AnyRecord
          // `nom_retropie` is comma-separated aliases ("genesis,megadrive").
          const aliases = String(noms.nom_retropie ?? '')
            .split(',').map(a => a.trim().toLowerCase()).filter(Boolean)
          return {
            id: Number(s.id),
            name: noms.nom_eu ?? noms.nom_us ?? noms.noms_commun ?? null,
            retropie_names: aliases.length ? [...new Set(aliases)] : null,
            company: s.compagnie ?? null,
            fetched_at: new Date().toISOString(),
          }
        }).filter((r: AnyRecord) => Number.isFinite(r.id))
        const { error } = await admin.from('screenscraper_systems').upsert(rows, { onConflict: 'id' })
        if (error) return fail(`systems upsert: ${error.message}`, 500)
        return json({ status: 'ok', systems: rows.length, with_retropie_name: rows.filter((r: AnyRecord) => r.retropie_names).length })
      }

      // ── Search by name, so a wrong or missing automatic match can be
      //    corrected by hand. Verified live (doc §1): jeuRecherche.php
      //    answered 200 with 30 candidates for one query.
      //
      //    NO IMAGE URL IS EVER RETURNED. Every ScreenScraper media URL
      //    carries devid/devpassword in its query string, so a candidate's
      //    artwork cannot travel to the browser — it is only ever downloaded
      //    server-side and re-hosted, which apply_match does for the one
      //    candidate actually chosen. ──
      case 'search': {
        const query = String(body.query ?? '').trim()
        if (!query) return json({ status: 'ok', results: [], message: 'Type something to search for.' })

        const params: AnyRecord = { recherche: query }
        // Narrowing by system is optional but strongly advised: unscoped, a
        // search competes with every hack collection in their database.
        if (body.system) {
          const sysMap = await loadSystemIdMap()
          if ('error' in sysMap) return fail(`systems read: ${sysMap.error}`, 500)
          const sys = sysMap.map.get(String(body.system).trim().toLowerCase())
          if (!sys) return json({ status: 'ok', results: [], message: `No ScreenScraper id known for system "${body.system}".` })
          params.systemeid = sys.id
        }

        const r = await callApi('jeuRecherche.php', params)
        if (!r.ok && r.notFound) return json({ status: 'ok', results: [], message: 'No games matched that name.' })
        if (!r.ok) return fail(`jeuRecherche: ${r.message}`, 502)

        const jeux = r.data?.response?.jeux
        if (!Array.isArray(jeux)) return json({ status: 'ok', results: [], message: 'The search returned no game list.' })

        const results = jeux.slice(0, SEARCH_LIMIT).map((jeu: AnyRecord) => {
          const mapped = mapJeuToGame(jeu)
          return {
            jeu_id: mapped.external_ref,
            title: mapped.title,
            system: (jeu.systeme as AnyRecord | undefined)?.text ?? null,
            release_year: mapped.release_year,
            publisher: mapped.publisher,
            developer: mapped.developer,
            genres: mapped.genres,
            players: mapped.players,
            // Purely so the picker can say "this one has a cover" without ever
            // handing over the credential-bearing URL itself.
            has_cover: !!pickMedia(jeu.medias, 'cover'),
            description: mapped.description ? String(mapped.description).slice(0, 300) : null,
          }
        })
        return json({ status: 'ok', query, results })
      }

      // ── Apply ONE hand-picked search result to ONE game.
      //
      //    It re-runs the same search server-side and takes the candidate with
      //    the chosen id, rather than fetching it by id directly: jeuInfos.php
      //    has a documented `gameid` parameter but this session could not call
      //    the API to confirm it, and this repo does not ship an unverified
      //    external field (CLAUDE.md). jeuRecherche IS verified, and it returns
      //    complete game entries — that is why 30 of them weigh 2.3 MB — so the
      //    chosen entry carries everything a match needs. Cost: one extra
      //    search call per apply. ──
      case 'apply_match': {
        const gameId = String(body.game_id ?? '')
        const jeuId = String(body.jeu_id ?? '')
        const query = String(body.query ?? '').trim()
        const dryRun = body.dry_run === true
        const wantMedia = body.media !== false
        if (!gameId || !jeuId || !query) return fail('apply_match needs game_id, jeu_id and the query they came from', 400)

        const { data: game, error: gErr } = await admin
          .from('games').select('*').eq('user_id', userId).eq('id', gameId).single()
        if (gErr) return fail(`game read: ${gErr.message}`, 500)

        const params: AnyRecord = { recherche: query }
        if (body.system) {
          const sysMap = await loadSystemIdMap()
          if ('error' in sysMap) return fail(`systems read: ${sysMap.error}`, 500)
          const sys = sysMap.map.get(String(body.system).trim().toLowerCase())
          if (sys) params.systemeid = sys.id
        }
        const r = await callApi('jeuRecherche.php', params)
        if (!r.ok) return fail(`jeuRecherche: ${r.notFound ? 'no results' : r.message}`, 502)
        const jeux = r.data?.response?.jeux
        const jeu = Array.isArray(jeux) ? jeux.find((j: AnyRecord) => String(j.id) === jeuId) : null
        if (!jeu) return json({ status: 'ok', outcome: 'no_match', message: 'That result is no longer in the search response — search again and re-pick.' })

        const mapped = mapJeuToGame(jeu)
        const patch = narrowToFields(fillOnlyMissing(game, mapped), body.fields)
        if (dryRun) {
          return json({ status: 'ok', outcome: 'matched', dry_run: true,
                        matched_title: mapped.title, would_fill: Object.keys(patch) })
        }

        const media: AnyRecord = {}
        const mediaAllowed = (c: string) => !Array.isArray(body.fields) || body.fields.map(String).includes(c)
        if (wantMedia) {
          for (const role of ['cover', 'screenshot', 'fanart'] as MediaRole[]) {
            const column = role === 'cover' ? 'primary_cover_url' : role === 'screenshot' ? 'screenshot_url' : 'fanart_url'
            if (game[column] || !mediaAllowed(column)) continue
            const pick = pickMedia(jeu.medias, role)
            if (!pick) continue
            const storedUrl = await mirrorMedia(game.id, role, pick)
            // Only a Storage URL is ever assigned here — never pick.url.
            if (storedUrl) media[column] = storedUrl
          }
        }

        // A hand-picked match is also an answer to "is this row still
        // uncertain?", so it clears the review flag the automatic pass set.
        const full = { ...patch, ...media, external_source: 'screenscraper', synced_at: new Date().toISOString(), needs_review: false }
        const { error: uErr } = await admin.from('games').update(full).eq('id', gameId).eq('user_id', userId)
        if (uErr) return fail(`game update: ${scrub(uErr.message)}`, 500)

        const rating100 = scoreToRating100(jeu.note)
        const { data: plat } = await admin.from('game_platforms').select('id, rating').eq('user_id', userId).eq('game_id', gameId).limit(1)
        const first = plat?.[0]
        if (first && rating100 != null && first.rating == null) {
          await admin.from('game_platforms')
            .update({ rating: rating100, external_ref: mapped.external_ref, external_source: 'screenscraper' })
            .eq('id', first.id).eq('user_id', userId)
        }
        return json({ status: 'ok', outcome: 'matched', matched_title: mapped.title,
                      filled: Object.keys(patch), media: Object.keys(media) })
      }

      // ── Write EXACTLY what was reviewed. ──
      //
      //    The bug this replaces: the dry run and the apply were two separate
      //    jeuInfos calls, so the user approved the result of lookup A and the
      //    app wrote whatever lookup B returned. Usually identical; nothing
      //    guaranteed it, nothing checked it, and it spent two requests per
      //    approved game against an account-wide quota.
      //
      //    Here the apply carries the `jeu_id` that was reviewed. It fetches
      //    once, and if the entry that comes back is a different one it
      //    REFUSES and says so (`stale_proposal`) rather than writing something
      //    nobody saw. `fillOnlyMissing` still runs against the live row, so a
      //    field edited in another tab between review and save is still never
      //    overwritten, and the client can only ever NARROW the write.
      case 'apply_reviewed': {
        const items = Array.isArray(body.items) ? body.items.slice(0, MAX_BATCH) : []
        if (!items.length) return fail('apply_reviewed needs a non-empty items array', 400)
        const runId = typeof body.run_id === 'string' && body.run_id ? body.run_id : crypto.randomUUID()

        const gameIds = items.map((i: AnyRecord) => String(i.game_id))
        const { data: games, error: gErr } = await admin
          .from('games').select('*').eq('user_id', userId).in('id', gameIds)
        if (gErr) return fail(`games read: ${gErr.message}`, 500)
        const gameById = new Map((games ?? []).map((g: AnyRecord) => [String(g.id), g]))

        const { data: platforms } = await admin
          .from('game_platforms').select('*').eq('user_id', userId).in('game_id', gameIds)
        const platformFor = new Map<string, AnyRecord>()
        for (const p of platforms ?? []) if (!platformFor.has(p.game_id)) platformFor.set(p.game_id, p)

        const sysMap = await loadSystemIdMap()
        if ('error' in sysMap) return fail(`systems read: ${sysMap.error}`, 500)

        const results = await inThreads(items, async (item: AnyRecord) => {
          const gameId = String(item.game_id)
          const game = gameById.get(gameId)
          if (!game) return { id: gameId, outcome: 'error', reason: 'game not found' }

          const plat = platformFor.get(gameId)
          const romnom = romNameFromPath(plat?.esde_path)
          const sys = plat?.esde_system ? sysMap.map.get(String(plat.esde_system).trim().toLowerCase()) : undefined
          if (!romnom || !sys) return { id: gameId, title: game.title, outcome: 'unmatchable' }

          const r = await callApi('jeuInfos.php', { systemeid: sys.id, romtype: 'rom', romnom })
          if (!r.ok && r.notFound) return { id: gameId, title: game.title, outcome: 'no_match' }
          if (!r.ok) return { id: gameId, title: game.title, outcome: 'error', reason: r.message }

          const jeu = r.data?.response?.jeu
          if (!jeu) return { id: gameId, title: game.title, outcome: 'error', reason: 'response carried no jeu' }

          // The identity check that makes approval mean anything.
          if (item.jeu_id && String(jeu.id) !== String(item.jeu_id)) {
            return { id: gameId, title: game.title, outcome: 'stale_proposal',
                     reason: 'their database answered with a different entry than the one you reviewed — look it up again' }
          }

          const mapped = mapJeuToGame(jeu)
          const patch = narrowToFields(fillOnlyMissing(game, mapped), item.fields)

          const media: AnyRecord = {}
          const storagePaths: string[] = []
          const roles = Array.isArray(item.media_roles) ? item.media_roles.map(String) : []
          for (const role of ['cover', 'screenshot', 'fanart'] as MediaRole[]) {
            const column = role === 'cover' ? 'primary_cover_url' : role === 'screenshot' ? 'screenshot_url' : 'fanart_url'
            if (game[column] || !roles.includes(column)) continue
            const pick = pickMedia(jeu.medias, role)
            if (!pick) continue
            const ext = mediaExtension(pick)
            // A cover already mirrored for the review is PROMOTED by a Storage
            // copy — no second download, no second request against them.
            const promoted = role === 'cover' ? await promotePending(gameId, String(jeu.id), ext) : null
            const storedUrl = promoted ?? await mirrorMedia(gameId, role, pick)
            // Only a Storage URL is ever assigned here — never pick.url.
            if (storedUrl) { media[column] = storedUrl; storagePaths.push(storagePath(gameId, role, ext)) }
          }

          const full = { ...patch, ...media }
          if (Object.keys(full).length > 0) {
            const { error } = await admin.from('games')
              .update({ ...full, external_source: 'screenscraper', synced_at: new Date().toISOString() })
              .eq('id', gameId).eq('user_id', userId)
            if (error) return { id: gameId, title: game.title, outcome: 'error', reason: scrub(error.message) }
          }

          const rating100 = scoreToRating100(jeu.note)
          if (plat && rating100 != null && plat.rating == null) {
            await admin.from('game_platforms')
              .update({ rating: rating100, external_ref: mapped.external_ref, external_source: 'screenscraper' })
              .eq('id', plat.id).eq('user_id', userId)
          }

          await recordDecision(userId, {
            game_id: gameId, run_id: runId, decision: 'applied',
            jeu_id: String(jeu.id), matched_title: mapped.title, system_used: sys.name,
            fields_written: Object.keys(full), storage_paths: storagePaths,
            prior_needs_review: game.needs_review === true,
          })

          return { id: gameId, title: game.title, outcome: 'matched', matched_title: mapped.title,
                   filled: Object.keys(patch), media: Object.keys(media) }
        })

        return json({ status: 'ok', run_id: runId, results,
                      applied: results.filter((r: AnyRecord) => r.outcome === 'matched').length })
      }

      // ── Take a whole run back. ──
      //    Costs nothing against the quota: it is a local revert, not a lookup.
      case 'undo_run': {
        const runId = String(body.run_id ?? '')
        if (!runId) return fail('undo_run needs a run_id', 400)

        const { data: rows, error } = await admin.from('scrape_decisions')
          .select('*').eq('user_id', userId).eq('run_id', runId).eq('decision', 'applied')
        if (error) return json({ status: 'no_journal', message: 'Migration 097 is not applied, so there is no record of what to undo.' }, 200)
        if (!rows?.length) return json({ status: 'ok', reverted: 0, message: 'Nothing from that run is still applied.' })

        let reverted = 0
        const skipped: AnyRecord[] = []
        for (const row of rows) {
          const fields = (row.fields_written ?? []) as string[]
          if (!fields.length) continue
          // Setting a field back to NULL is the exact inverse of the write,
          // and it is safe ONLY because the write was gap-filling: whatever is
          // there now either came from this run, or was typed afterwards — and
          // the second case is checked for below rather than assumed away.
          const { data: live } = await admin.from('games')
            .select('*').eq('id', row.game_id).eq('user_id', userId).single()
          if (!live) { skipped.push({ game_id: row.game_id, reason: 'game no longer exists' }); continue }

          const patch: AnyRecord = {}
          const kept: string[] = []
          for (const f of fields) {
            // A value the user changed AFTER the scrape is theirs now.
            if (live[f] === null || live[f] === undefined) continue
            patch[f] = null
            kept.push(f)
          }
          patch.needs_review = row.prior_needs_review ?? false
          const { error: uErr } = await admin.from('games').update(patch).eq('id', row.game_id).eq('user_id', userId)
          if (uErr) { skipped.push({ game_id: row.game_id, reason: scrub(uErr.message) }); continue }

          // The mirrored files go too — an orphaned object is cheap, a wrong
          // cover still sitting in the bucket is confusing.
          const paths = (row.storage_paths ?? []) as string[]
          if (paths.length) await admin.storage.from(BUCKET).remove(paths)

          await recordDecision(userId, {
            game_id: row.game_id, run_id: runId, decision: 'undone',
            jeu_id: row.jeu_id, matched_title: row.matched_title, system_used: row.system_used,
            fields_written: kept, storage_paths: [], prior_needs_review: row.prior_needs_review,
          })
          reverted++
        }
        return json({ status: 'ok', reverted, skipped })
      }

      // ── Clean up candidate covers nobody approved. ──
      case 'sweep_pending': {
        const { data: dirs, error } = await admin.storage.from(BUCKET).list(PENDING_PREFIX, { limit: 1000 })
        if (error) return fail(`sweep list: ${scrub(error.message)}`, 500)
        let removed = 0
        for (const dir of dirs ?? []) {
          const { data: inner } = await admin.storage.from(BUCKET).list(`${PENDING_PREFIX}/${dir.name}`, { limit: 100 })
          for (const sub of inner ?? []) {
            const { data: files } = await admin.storage.from(BUCKET).list(`${PENDING_PREFIX}/${dir.name}/${sub.name}`, { limit: 100 })
            const paths = (files ?? []).map(f => `${PENDING_PREFIX}/${dir.name}/${sub.name}/${f.name}`)
            if (paths.length) { await admin.storage.from(BUCKET).remove(paths); removed += paths.length }
          }
        }
        return json({ status: 'ok', removed })
      }

      // ── The real work, one small batch per invocation. ──
      case 'scrape': {
        const limit = Math.min(MAX_BATCH, Math.max(1, Number(body.limit ?? 5)))
        const dryRun = body.dry_run === true
        const wantMedia = body.media !== false

        const quota = await readQuota()
        if ('error' in quota) return fail(`ssuserInfos: ${quota.error}`, 502)
        const remaining = quota.max - quota.used
        if (remaining < QUOTA_FLOOR) {
          return json({
            status: 'quota_exhausted',
            remaining_today: Math.max(0, remaining),
            message: `Only ${remaining} requests left of today's shared allowance; refusing to start (floor ${QUOTA_FLOOR}).`,
          }, 200)
        }

        // Candidates: explicit ids, else games still missing what we can fill,
        // optionally narrowed to a set of systems. Scoping by system is what
        // makes a 1000-game library workable: one console at a time, and the
        // results are all checkable against the same expectation.
        let scopedIds: string[] | null = null
        if (Array.isArray(body.systems) && body.systems.length > 0) {
          const wanted = body.systems.map((x: unknown) => String(x))
          const { data: scoped, error: scopeErr } = await admin
            .from('game_platforms').select('game_id').eq('user_id', userId).in('esde_system', wanted)
          if (scopeErr) return fail(`system scope read: ${scopeErr.message}`, 500)
          scopedIds = [...new Set((scoped ?? []).map((r: AnyRecord) => String(r.game_id)))]
          if (scopedIds.length === 0) {
            return json({ status: 'ok', done: true, processed: 0, message: 'No games on the selected systems.' })
          }
        }

        let games: AnyRecord[] | null = null
        let gErr: { message: string } | null = null

        if (Array.isArray(body.game_ids) && body.game_ids.length > 0) {
          const r = await admin.from('games').select('*').eq('user_id', userId)
            .in('id', body.game_ids.slice(0, MAX_BATCH).map(String)).limit(limit)
          games = r.data; gErr = r.error
        } else if (scopedIds) {
          // PostgREST's .in() list is URL-length bound (200 ids ≈ 7.4 KB is
          // safe; 1000 is a measured 400), so the scope is walked in slices
          // until `limit` unscraped games are found. Slicing to the FIRST 200
          // and stopping would report "nothing left" while later slices still
          // held work.
          const found: AnyRecord[] = []
          for (let i = 0; i < scopedIds.length && found.length < limit; i += 200) {
            const r = await admin.from('games').select('*').eq('user_id', userId)
              .in('id', scopedIds.slice(i, i + 200)).is('description', null)
              .limit(limit - found.length)
            if (r.error) { gErr = r.error; break }
            found.push(...(r.data ?? []))
          }
          games = found
        } else {
          const r = await admin.from('games').select('*').eq('user_id', userId)
            .is('description', null).limit(limit)
          games = r.data; gErr = r.error
        }
        if (gErr) return fail(`games read: ${gErr.message}`, 500)
        if (!games || games.length === 0) return json({ status: 'ok', done: true, processed: 0, message: 'Nothing left to scrape.' })

        const { data: platforms, error: pErr } = await admin
          .from('game_platforms').select('*').eq('user_id', userId)
          .in('game_id', games.map(g => g.id))
        if (pErr) return fail(`platforms read: ${pErr.message}`, 500)

        const sysMap = await loadSystemIdMap()
        if ('error' in sysMap) return fail(`systems read: ${sysMap.error}`, 500)
        const systemId = sysMap.map
        if (systemId.size === 0) {
          return json({ status: 'needs_systems', message: 'Run action "refresh_systems" first — no ScreenScraper system ids are known yet.' }, 200)
        }

        const platformFor = new Map<string, AnyRecord>()
        for (const p of platforms ?? []) if (!platformFor.has(p.game_id)) platformFor.set(p.game_id, p)

        const results = await inThreads(games, async (game: AnyRecord) => {
          const plat = platformFor.get(game.id)
          const romnom = romNameFromPath(plat?.esde_path)
          const sys = plat?.esde_system ? systemId.get(String(plat.esde_system).trim().toLowerCase()) : undefined
          if (!romnom || !sys) {
            return { id: game.id, title: game.title, outcome: 'unmatchable', reason: !romnom ? 'no rom filename' : `no ScreenScraper id for system "${plat?.esde_system}"` }
          }

          const r = await callApi('jeuInfos.php', { systemeid: sys.id, romtype: 'rom', romnom })
          // A 404 is a normal answer: this ROM is not in their database.
          if (!r.ok && r.notFound) {
            if (!dryRun) await admin.from('games').update({ needs_review: true }).eq('id', game.id).eq('user_id', userId)
            return { id: game.id, title: game.title, outcome: 'no_match', system: sys.name }
          }
          if (!r.ok) return { id: game.id, title: game.title, outcome: 'error', reason: r.message }

          const jeu = r.data?.response?.jeu
          if (!jeu) return { id: game.id, title: game.title, outcome: 'error', reason: 'response carried no jeu' }

          const mapped = mapJeuToGame(jeu)
          // `fields_by_game` lets one batch accept different fields per row —
          // the whole point of reviewing six matches side by side. A plain
          // `fields` applies to every row, and neither present means "all".
          const perGame = (body.fields_by_game as AnyRecord | undefined)?.[game.id as string]
          const allowed = Array.isArray(perGame) ? perGame : body.fields
          const patch = narrowToFields(fillOnlyMissing(game, mapped), allowed)
          const rating100 = scoreToRating100(jeu.note)

          const media: AnyRecord = {}
          const mediaAllowed = (c: string) => !Array.isArray(allowed) || allowed.map(String).includes(c)
          if (wantMedia && !dryRun) {
            for (const role of ['cover', 'screenshot', 'fanart'] as MediaRole[]) {
              const column = role === 'cover' ? 'primary_cover_url' : role === 'screenshot' ? 'screenshot_url' : 'fanart_url'
              if (game[column] || !mediaAllowed(column)) continue
              const pick = pickMedia(jeu.medias, role)
              if (!pick) continue
              const storedUrl = await mirrorMedia(game.id, role, pick)
              // Only a Storage URL is ever assigned here — never pick.url.
              if (storedUrl) media[column] = storedUrl
            }
          }

          if (dryRun) {
            // The FULL offer, deliberately not the narrowed patch: a dry run is
            // what the reviewer chooses from, so it must show everything on the
            // table rather than the result of a previous choice.
            const offer = fillOnlyMissing(game, mapped)
            // VALUES, not just names. "Would fill: description, genres" cannot
            // be approved by anyone — approving means reading the description
            // and seeing whether it is this game's or the sequel's.
            const proposed: AnyRecord = {}
            for (const [k, v] of Object.entries(offer)) {
              proposed[k] = typeof v === 'string' && v.length > 600 ? `${v.slice(0, 600)}…` : v
            }
            // Cover art mirrored into a quarantine prefix so the review can be
            // visual without a credentialed URL ever reaching the browser —
            // the same download-and-re-host rule the canonical path follows.
            // Promoted by a Storage copy on approval, swept if not.
            let pendingCover: string | null = null
            if (wantMedia && !game.primary_cover_url && body.provisional_art !== false) {
              const art = pickMedia(jeu.medias, 'cover')
              if (art) pendingCover = await mirrorPending(game.id as string, String(jeu.id ?? 'x'), art)
            }
            return {
              id: game.id, title: game.title, outcome: 'matched', dry_run: true, system: sys.name,
              jeu_id: mapped.external_ref, matched_title: mapped.title, rating100,
              would_fill: Object.keys(offer), proposed,
              rom_name: romnom, flags: matchFlags(jeu),
              pending_cover_url: pendingCover,
            }
          }

          const full = { ...patch, ...media, external_source: 'screenscraper', synced_at: new Date().toISOString() }
          if (Object.keys(full).length > 0) {
            const { error } = await admin.from('games').update(full).eq('id', game.id).eq('user_id', userId)
            if (error) return { id: game.id, title: game.title, outcome: 'error', reason: scrub(error.message) }
          }
          if (plat && rating100 != null && plat.rating == null) {
            // ScreenScraper's /20 score ×5. NEVER games.rating — that is the
            // user's own number and nothing external writes it.
            await admin.from('game_platforms').update({ rating: rating100, external_ref: mapped.external_ref, external_source: 'screenscraper' })
              .eq('id', plat.id).eq('user_id', userId)
          }
          return { id: game.id, title: game.title, outcome: 'matched', system: sys.name,
                   filled: Object.keys(patch), media: Object.keys(media), matched_title: mapped.title }
        })

        const by = (o: string) => results.filter(r => r.outcome === o).length
        return json({
          status: 'ok',
          dry_run: dryRun,
          processed: results.length,
          matched: by('matched'),
          no_match: by('no_match'),
          unmatchable: by('unmatchable'),
          errors: by('error'),
          remaining_today: Math.max(0, remaining - results.length),
          results,
        })
      }

      default:
        return fail(`Unknown action "${action}" (use status | refresh_systems | scrape)`, 400)
    }
  } catch (e) {
    return fail((e as Error).message, 500)
  }
})
