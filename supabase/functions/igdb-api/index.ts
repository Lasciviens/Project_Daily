// igdb-api — IGDB (igdb.com, owned by Twitch) for game length, ratings and a
// link to each game's page. Separate from ScreenScraper on purpose: its own
// match marker (games.igdb_id) and its own columns (migration 121); it never
// writes a title, cover, description or any column another source owns.
//
// Auth to IGDB: a Twitch app's Client ID + Client Secret (Edge Function
// secrets IGDB_CLIENT_ID / IGDB_CLIENT_SECRET) are exchanged for an app access
// token (OAuth client credentials, POST id.twitch.tv/oauth2/token), kept in
// memory until it expires. Every IGDB call sends `Client-ID` + `Authorization:
// Bearer`. IGDB refuses browsers (no CORS), so this proxy is required.
// Limits (api-docs.igdb.com): 4 requests per second, 8 open at once, ≤ 500
// rows per query, ≤ 10 queries per /multiquery. Calls here run one at a time,
// at least 260 ms apart, and retry once on 429.
//
// Browser JWT (`verify_jwt` ON); the caller is resolved with auth.getUser and
// every write is scoped to that user. Without the secrets every action answers
// { error: 'not_configured' } — safe to deploy first.
//
// Actions
//   status                       → { configured }
//   match   { items ≤ 50 }       → candidates per row (Steam rows by app id first)
//   search  { query }            → candidates for one free-text search
//   apply   { items ≤ 50 }       → fetch each picked game's data and save it
//   refresh { offset }           → re-fetch ratings/lengths for ≤ 200 matched rows
//   unlink  { game_id }          → clear a row's IGDB match and data
//
// Field names are IGDB's documented v4 ones (games, game_time_to_beats,
// external_games, external_game_sources); `category` and `collection` are
// deprecated there and are not used.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const API = 'https://api.igdb.com/v4'
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// deno-lint-ignore no-explicit-any
type AnyRec = Record<string, any>

// ─── Token + rate limit ─────────────────────────────────────────────────────

let token: { value: string; expires: number } | null = null

async function appToken(force = false): Promise<string> {
  if (!force && token && token.expires > Date.now() + 60_000) return token.value
  const id = Deno.env.get('IGDB_CLIENT_ID')!, secret = Deno.env.get('IGDB_CLIENT_SECRET')!
  const q = new URLSearchParams({ client_id: id, client_secret: secret, grant_type: 'client_credentials' })
  const r = await fetch(`https://id.twitch.tv/oauth2/token?${q}`, { method: 'POST' })
  if (!r.ok) throw new Error(r.status === 400 || r.status === 403 ? 'Twitch refused the IGDB Client ID / Secret — check the two secrets.' : `Twitch token ${r.status}`)
  const b = await r.json()
  token = { value: b.access_token, expires: Date.now() + (Number(b.expires_in) || 3600) * 1000 }
  return token.value
}

let lastCall = 0
async function igdb(endpoint: string, body: string, retried = false): Promise<AnyRec[]> {
  const wait = lastCall + 260 - Date.now()
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  lastCall = Date.now()
  const r = await fetch(`${API}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Client-ID': Deno.env.get('IGDB_CLIENT_ID')!,
      Authorization: `Bearer ${await appToken()}`,
      Accept: 'application/json',
    },
    body,
  })
  if ((r.status === 429 || r.status === 401) && !retried) {
    if (r.status === 401) await appToken(true)
    else await new Promise(res => setTimeout(res, 1100))
    return igdb(endpoint, body, true)
  }
  if (!r.ok) {
    const text = (await r.text()).slice(0, 300)
    throw new Error(`IGDB ${endpoint} ${r.status}${text ? `: ${text}` : ''}`)
  }
  return await r.json()
}

/** Up to 10 named queries in one request; returns name → rows. */
async function multi(queries: { name: string; endpoint: string; body: string }[]): Promise<Map<string, AnyRec[]>> {
  const out = new Map<string, AnyRec[]>()
  for (let i = 0; i < queries.length; i += 10) {
    const part = queries.slice(i, i + 10)
    const body = part.map(q => `query ${q.endpoint} "${q.name}" {\n${q.body}\n};`).join('\n')
    const res = await igdb('multiquery', body)
    // A query whose answer isn't a list (an error inside the batch) is left
    // out, so the caller reports it as a failed lookup instead of "no match".
    for (const x of res) if (Array.isArray(x?.result)) out.set(String(x.name), x.result)
  }
  return out
}

// ─── Shapes ─────────────────────────────────────────────────────────────────

const CANDIDATE_FIELDS = 'fields name,slug,first_release_date,platforms.name,alternative_names.name,cover.image_id,game_type.type,total_rating_count;'

function toCandidate(g: AnyRec) {
  const year = g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null
  const platforms: AnyRec[] = Array.isArray(g.platforms) ? g.platforms.filter((p: unknown) => p && typeof p === 'object') : []
  return {
    id: Number(g.id),
    name: String(g.name ?? ''),
    slug: g.slug ?? null,
    year,
    platformIds: platforms.map(p => Number(p.id)).filter(Number.isFinite),
    platformNames: platforms.map(p => String(p.name ?? '')).filter(Boolean),
    altNames: Array.isArray(g.alternative_names) ? g.alternative_names.map((a: AnyRec) => String(a?.name ?? '')).filter(Boolean).slice(0, 12) : [],
    coverId: g.cover?.image_id ?? null,
    type: g.game_type?.type ?? null,
    ratingCount: Number(g.total_rating_count) || 0,
  }
}

const DETAIL_FIELDS = [
  'name', 'slug', 'url', 'first_release_date', 'summary', 'hypes',
  'rating', 'rating_count', 'aggregated_rating', 'aggregated_rating_count', 'total_rating', 'total_rating_count',
  'cover.image_id', 'game_type.type', 'genres.name', 'themes.name', 'game_modes.name', 'player_perspectives.name',
  'franchises.name', 'collections.name', 'game_engines.name', 'platforms.name',
  'involved_companies.company.name', 'involved_companies.developer', 'involved_companies.publisher',
  'similar_games.name', 'similar_games.slug', 'similar_games.cover.image_id',
].join(',')

const names = (v: unknown, max = 12): string[] =>
  Array.isArray(v) ? v.map(x => String((x as AnyRec)?.name ?? '')).filter(Boolean).slice(0, max) : []
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const int = (v: unknown) => { const n = num(v); return n == null ? null : Math.round(n) }

/** The columns migration 121 adds, from one IGDB game + its time to beat. */
function toColumns(g: AnyRec, ttb: AnyRec | undefined, now: string) {
  const companies: AnyRec[] = Array.isArray(g.involved_companies) ? g.involved_companies : []
  const company = (k: 'developer' | 'publisher') =>
    [...new Set(companies.filter(c => c?.[k]).map(c => String(c?.company?.name ?? '')).filter(Boolean))].slice(0, 6)
  const similar = Array.isArray(g.similar_games)
    ? g.similar_games.filter((s: unknown) => s && typeof s === 'object').slice(0, 10)
        .map((s: AnyRec) => ({ id: Number(s.id), name: String(s.name ?? ''), slug: s.slug ?? null, cover: s.cover?.image_id ?? null }))
    : []
  return {
    igdb_id: Number(g.id),
    igdb_slug: g.slug ?? null,
    igdb_url: typeof g.url === 'string' ? g.url : null,
    igdb_fetched_at: now,
    igdb_rating: num(g.rating),
    igdb_rating_count: int(g.rating_count),
    igdb_critic_rating: num(g.aggregated_rating),
    igdb_critic_count: int(g.aggregated_rating_count),
    igdb_total_rating: num(g.total_rating),
    igdb_total_count: int(g.total_rating_count),
    ttb_main_seconds: int(ttb?.hastily),
    ttb_extra_seconds: int(ttb?.normally),
    ttb_full_seconds: int(ttb?.completely),
    ttb_count: int(ttb?.count),
    igdb_data: {
      v: 1,
      name: g.name ?? null,
      year: g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null,
      released: g.first_release_date ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10) : null,
      type: g.game_type?.type ?? null,
      summary: typeof g.summary === 'string' ? g.summary.slice(0, 2000) : null,
      cover: g.cover?.image_id ?? null,
      hypes: int(g.hypes),
      genres: names(g.genres), themes: names(g.themes), modes: names(g.game_modes),
      perspectives: names(g.player_perspectives), franchises: names(g.franchises), collections: names(g.collections),
      engines: names(g.game_engines), platforms: names(g.platforms, 20),
      developers: company('developer'), publishers: company('publisher'),
      similar,
    },
  }
}

/** Every game in `ids` with its time to beat, in as few requests as possible. */
async function fetchDetails(ids: number[]): Promise<Map<number, ReturnType<typeof toColumns>>> {
  const out = new Map<number, ReturnType<typeof toColumns>>()
  const now = new Date().toISOString()
  for (let i = 0; i < ids.length; i += 250) {
    const part = [...new Set(ids.slice(i, i + 250))]
    const list = part.join(',')
    const res = await multi([
      { name: 'games', endpoint: 'games', body: `fields ${DETAIL_FIELDS}; where id = (${list}); limit 500;` },
      { name: 'ttb', endpoint: 'game_time_to_beats', body: `fields game_id,hastily,normally,completely,count; where game_id = (${list}); limit 500;` },
    ])
    const ttb = new Map<number, AnyRec>()
    for (const t of res.get('ttb') ?? []) ttb.set(Number(t.game_id), t)
    for (const g of res.get('games') ?? []) out.set(Number(g.id), toColumns(g, ttb.get(Number(g.id)), now))
  }
  return out
}

let steamSource: number | null = null
async function steamSourceId(): Promise<number> {
  if (steamSource != null) return steamSource
  try {
    const r = await igdb('external_game_sources', 'fields name; where name = "Steam"; limit 5;')
    steamSource = r[0]?.id != null ? Number(r[0].id) : 1
  } catch {
    // The source ids kept the values of the old `category` enum (Steam = 1).
    steamSource = 1
  }
  return steamSource
}

/** Apicalypse string literal: no quotes or backslashes, one line. */
const quoted = (s: string) => `"${s.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)}"`

// ─── Handler ────────────────────────────────────────────────────────────────

interface MatchItem { game_id: string; query: string; fallback?: string | null; steam_appid?: number | null }
interface ApplyItem { game_id: string; igdb_id: number; match: 'steam' | 'exact' | 'picked' }

const CLEAR = {
  igdb_id: null, igdb_slug: null, igdb_url: null, igdb_match: null, igdb_matched_at: null, igdb_fetched_at: null,
  igdb_rating: null, igdb_rating_count: null, igdb_critic_rating: null, igdb_critic_count: null,
  igdb_total_rating: null, igdb_total_count: null,
  ttb_main_seconds: null, ttb_extra_seconds: null, ttb_full_seconds: null, ttb_count: null, igdb_data: null,
}

const isMissingColumn = (e: AnyRec | null) => e?.code === '42703' || e?.code === 'PGRST204'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const auth = req.headers.get('authorization')
  if (!auth) return json({ error: 'Missing authorization header' }, 401)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: { user }, error: authError } = await db.auth.getUser(auth.replace('Bearer ', ''))
  if (authError || !user) return json({ error: 'Invalid token' }, 401)

  let body: AnyRec = {}
  try { body = await req.json() } catch { /* empty */ }
  const action = String(body.action ?? '')
  const configured = !!Deno.env.get('IGDB_CLIENT_ID') && !!Deno.env.get('IGDB_CLIENT_SECRET')
  if (action === 'status') return json({ configured })
  if (!configured) return json({ error: 'not_configured' })

  try {
    if (action === 'search') {
      const q = String(body.query ?? '').trim()
      if (q.length < 2) return json({ candidates: [] })
      const rows = await igdb('games', `search ${quoted(q)}; ${CANDIDATE_FIELDS} where version_parent = null; limit 20;`)
      return json({ candidates: rows.map(toCandidate) })
    }

    if (action === 'match') {
      const items: MatchItem[] = (Array.isArray(body.items) ? body.items : []).slice(0, 50)
        .filter((x: AnyRec) => typeof x?.game_id === 'string')
      // 1 · Steam rows by app id (one query for all of them).
      const steamIds = items.map(x => Number(x.steam_appid)).filter(n => Number.isInteger(n) && n > 0)
      const bySteam = new Map<string, number>()
      if (steamIds.length) {
        const src = await steamSourceId()
        const ext = await igdb('external_games',
          `fields game,uid; where external_game_source = ${src} & uid = (${steamIds.map(n => `"${n}"`).join(',')}); limit 500;`)
        for (const e of ext) if (e.game != null && e.uid != null && !bySteam.has(String(e.uid))) bySteam.set(String(e.uid), Number(e.game))
      }
      const steamGames = new Map<number, ReturnType<typeof toCandidate>>()
      if (bySteam.size) {
        const rows = await igdb('games', `${CANDIDATE_FIELDS} where id = (${[...new Set(bySteam.values())].join(',')}); limit 500;`)
        for (const g of rows) steamGames.set(Number(g.id), toCandidate(g))
      }
      // 2 · Everything else (and Steam ids IGDB doesn't know) by title — one
      // /games search per game. Not a /multiquery: IGDB answers a `search`
      // inside a multiquery with nothing (checked live 07.10.2026 — every
      // title came back unanswered while the same search alone found it).
      const results: AnyRec[] = []
      const searchOne = async (q: string) => (await igdb('games', `search ${quoted(q)}; ${CANDIDATE_FIELDS} where version_parent = null; limit 10;`)).map(toCandidate)
      for (const x of items) {
        const gid = x.steam_appid ? bySteam.get(String(x.steam_appid)) : undefined
        const steam = gid != null ? steamGames.get(gid) ?? null : null
        if (steam) { results.push({ game_id: x.game_id, steam, candidates: [steam] }); continue }
        const q = String(x.query ?? '').trim()
        if (q.length < 2) { results.push({ game_id: x.game_id, steam: null, candidates: [] }); continue }
        try {
          let rows = await searchOne(q)
          // A second, shorter search (the title before its subtitle) when the first finds nothing.
          const fb = String(x.fallback ?? '').trim()
          if (!rows.length && fb.length >= 3 && fb !== q) rows = await searchOne(fb)
          results.push({ game_id: x.game_id, steam: null, candidates: rows })
        } catch (e) {
          // A failed lookup stays a failure (try again), never "no match".
          results.push({ game_id: x.game_id, steam: null, candidates: [], error: `IGDB did not answer: ${(e as Error).message}`.slice(0, 200) })
        }
      }
      return json({ results })
    }

    if (action === 'apply') {
      const items: ApplyItem[] = (Array.isArray(body.items) ? body.items : []).slice(0, 50)
        .filter((x: AnyRec) => typeof x?.game_id === 'string' && Number.isInteger(Number(x?.igdb_id)))
      const details = await fetchDetails(items.map(x => Number(x.igdb_id)))
      const now = new Date().toISOString()
      const saved: AnyRec[] = []
      const failed: AnyRec[] = []
      for (const x of items) {
        const cols = details.get(Number(x.igdb_id))
        if (!cols) { failed.push({ game_id: x.game_id, reason: 'IGDB has no game with that id' }); continue }
        const match = ['steam', 'exact', 'picked'].includes(x.match) ? x.match : 'picked'
        const { error } = await db.from('games').update({ ...cols, igdb_match: match, igdb_matched_at: now })
          .eq('id', x.game_id).eq('user_id', user.id)
        if (error) {
          if (isMissingColumn(error)) return json({ error: 'not_migrated' })
          failed.push({ game_id: x.game_id, reason: error.message })
        } else saved.push({ game_id: x.game_id, igdb_id: cols.igdb_id, name: cols.igdb_data.name, ttb_extra_seconds: cols.ttb_extra_seconds, igdb_total_rating: cols.igdb_total_rating })
      }
      return json({ saved, failed })
    }

    if (action === 'refresh') {
      const offset = Math.max(0, Number(body.offset) || 0)
      const { data, error } = await db.from('games').select('id, igdb_id').eq('user_id', user.id)
        .not('igdb_id', 'is', null).order('id').range(offset, offset + 199)
      if (error) return json(isMissingColumn(error) ? { error: 'not_migrated' } : { error: error.message })
      const rows = data ?? []
      const details = await fetchDetails(rows.map(r => Number(r.igdb_id)))
      let updated = 0
      for (const r of rows) {
        const cols = details.get(Number(r.igdb_id))
        if (!cols) continue
        const { error: e } = await db.from('games').update(cols).eq('id', r.id).eq('user_id', user.id)
        if (!e) updated++
      }
      return json({ updated, done: rows.length < 200, next: offset + rows.length })
    }

    if (action === 'unlink') {
      const id = String(body.game_id ?? '')
      const { error } = await db.from('games').update(CLEAR).eq('id', id).eq('user_id', user.id)
      if (error) return json(isMissingColumn(error) ? { error: 'not_migrated' } : { error: error.message })
      return json({ ok: true })
    }

    return json({ error: `Unknown action ${action}` }, 400)
  } catch (e) {
    return json({ error: (e as Error).message ?? 'IGDB request failed' }, 502)
  }
})
