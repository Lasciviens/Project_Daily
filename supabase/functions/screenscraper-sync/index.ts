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
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>

const API = 'https://api.screenscraper.fr/api2'
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

/** Runs tasks at the account's real thread limit, never above it. */
async function inThreads<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += THREADS) {
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

        // Candidates: explicit ids, else games still missing what we can fill.
        let q = admin.from('games').select('*').eq('user_id', userId).limit(limit)
        if (Array.isArray(body.game_ids) && body.game_ids.length > 0) {
          q = q.in('id', body.game_ids.slice(0, MAX_BATCH).map(String))
        } else {
          q = q.is('description', null)
        }
        const { data: games, error: gErr } = await q
        if (gErr) return fail(`games read: ${gErr.message}`, 500)
        if (!games || games.length === 0) return json({ status: 'ok', done: true, processed: 0, message: 'Nothing left to scrape.' })

        const { data: platforms, error: pErr } = await admin
          .from('game_platforms').select('*').eq('user_id', userId)
          .in('game_id', games.map(g => g.id))
        if (pErr) return fail(`platforms read: ${pErr.message}`, 500)

        const { data: systems, error: sErr } = await admin
          .from('screenscraper_systems').select('id, retropie_names').not('retropie_names', 'is', null)
        if (sErr) return fail(`systems read: ${sErr.message}`, 500)
        // One entry per alias, so an ES-DE "megadrive" folder resolves just as
        // an ES-DE "genesis" one does.
        const systemId = new Map<string, number>()
        for (const s of systems ?? []) {
          for (const alias of (s.retropie_names ?? []) as string[]) {
            systemId.set(String(alias).toLowerCase(), Number(s.id))
          }
        }
        if (systemId.size === 0) {
          return json({ status: 'needs_systems', message: 'Run action "refresh_systems" first — no ScreenScraper system ids are known yet.' }, 200)
        }

        const platformFor = new Map<string, AnyRecord>()
        for (const p of platforms ?? []) if (!platformFor.has(p.game_id)) platformFor.set(p.game_id, p)

        const results = await inThreads(games, async (game: AnyRecord) => {
          const plat = platformFor.get(game.id)
          const romnom = romNameFromPath(plat?.esde_path)
          const sysId = plat?.esde_system ? systemId.get(String(plat.esde_system).toLowerCase()) : undefined
          if (!romnom || !sysId) {
            return { id: game.id, title: game.title, outcome: 'unmatchable', reason: !romnom ? 'no rom filename' : `no ScreenScraper id for system "${plat?.esde_system}"` }
          }

          const r = await callApi('jeuInfos.php', { systemeid: sysId, romtype: 'rom', romnom })
          // A 404 is a normal answer: this ROM is not in their database.
          if (!r.ok && r.notFound) {
            if (!dryRun) await admin.from('games').update({ needs_review: true }).eq('id', game.id).eq('user_id', userId)
            return { id: game.id, title: game.title, outcome: 'no_match' }
          }
          if (!r.ok) return { id: game.id, title: game.title, outcome: 'error', reason: r.message }

          const jeu = r.data?.response?.jeu
          if (!jeu) return { id: game.id, title: game.title, outcome: 'error', reason: 'response carried no jeu' }

          const mapped = mapJeuToGame(jeu)
          const patch = fillOnlyMissing(game, mapped)
          const rating100 = scoreToRating100(jeu.note)

          const media: AnyRecord = {}
          if (wantMedia && !dryRun) {
            for (const role of ['cover', 'screenshot', 'fanart'] as MediaRole[]) {
              const column = role === 'cover' ? 'primary_cover_url' : role === 'screenshot' ? 'screenshot_url' : 'fanart_url'
              if (game[column]) continue
              const pick = pickMedia(jeu.medias, role)
              if (!pick) continue
              const storedUrl = await mirrorMedia(game.id, role, pick)
              // Only a Storage URL is ever assigned here — never pick.url.
              if (storedUrl) media[column] = storedUrl
            }
          }

          if (dryRun) {
            return { id: game.id, title: game.title, outcome: 'matched', dry_run: true,
                     would_fill: Object.keys(patch), matched_title: mapped.title, rating100 }
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
          return { id: game.id, title: game.title, outcome: 'matched',
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
