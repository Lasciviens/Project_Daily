// steam-api — proxies the Steam Web API so the personal API key stays
// server-side (STEAM_API_KEY + STEAM_ID64 in Vault, never in the client).
// Single-user app (same pattern as HEVY_USER_ID) — no per-caller scoping
// needed for the Steam calls themselves, `verify_jwt` stays ON (the
// platform validates the browser JWT before this function runs).
//
// api.steampowered.com sends no CORS headers — confirmed via community
// reports (github.com/xDimGG/node-steamapi#27) — so this proxy is mandatory,
// not a convenience. Endpoint shapes below are Valve's own documented Web
// API (partner.steamgames.com/doc/webapi_overview), except the two
// `store.steampowered.com` ones (app_details, app_reviews) which are
// community-documented and undocumented by Valve — flagged at their call
// sites.
//
// If STEAM_API_KEY/STEAM_ID64 aren't set yet, every action returns
// { error: 'not_configured' } rather than throwing — safe to deploy before
// the secrets exist, same convention as food-search's missing-key fallback.
//
// STORE METADATA IS CACHED IN THE DB (migration 092's `steam_apps`), unlike
// every other call here which is a pure passthrough. The reason is a hard
// constraint, not a preference: `appdetails` is rate-limited to roughly 200
// requests / 5 minutes per IP and returns ~36 KB per app, so a 400-game
// library cannot be enriched live on every page load. The service-role
// client below exists ONLY for that cache — no user data is ever written.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const STEAM = 'https://api.steampowered.com'
const STORE = 'https://store.steampowered.com'

// A store page changes rarely; a review score moves daily. Two TTLs.
const DETAILS_TTL_MS = 14 * 24 * 60 * 60 * 1000
const REVIEWS_TTL_MS = 24 * 60 * 60 * 1000
// Rate-limit budget guard: never fetch more than this many uncached apps in
// one request, however many the client asked for. The response reports what
// is still missing so the client can come back for the rest.
const MAX_STORE_FETCHES_PER_CALL = 20

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

type Action =
  | 'profile' | 'owned_games' | 'achievements' | 'level_badges'
  | 'app_details' | 'app_reviews' | 'current_players'

// deno-lint-ignore no-explicit-any
type AnyRec = Record<string, any>

async function steamGet(path: string, params: Record<string, string>) {
  const r = await fetch(`${STEAM}${path}?${new URLSearchParams(params).toString()}`)
  if (!r.ok) throw new Error(`steam ${r.status}`)
  return r.json()
}

function db() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

// ─── Store metadata (cached) ────────────────────────────────────────────
// `appdetails` returns { "<appid>": { success, data } }. `success:false` is
// a real, common answer (delisted or region-blocked app) — cache a row for
// it anyway so we don't retry a dead appid on every page load.
async function fetchAppDetails(appid: number, cc: string): Promise<AnyRec | null> {
  const url = `${STORE}/api/appdetails?appids=${appid}&cc=${encodeURIComponent(cc)}&l=english`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`appdetails ${r.status}`)
  const body = await r.json()
  const entry = body?.[String(appid)]
  return entry?.success ? (entry.data ?? null) : null
}

async function fetchAppReviews(appid: number): Promise<AnyRec | null> {
  // `filter` is deliberately left at its default (relevance): with
  // `recent`/`updated` Steam drops the aggregate totals from query_summary
  // and returns only num_reviews, which is the one thing we don't want.
  const url = `${STORE}/appreviews/${appid}?json=1&num_per_page=0&language=all&purchase_type=all`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`appreviews ${r.status}`)
  const body = await r.json()
  return body?.query_summary ?? null
}

function detailsRow(appid: number, data: AnyRec | null) {
  return {
    appid,
    name: data?.name ?? null,
    type: data?.type ?? null,
    genres: Array.isArray(data?.genres) ? data.genres.map((g: AnyRec) => g.description).filter(Boolean) : null,
    metacritic_score: data?.metacritic?.score ?? null,
    is_free: data?.is_free ?? null,
    details: data,                       // null for a delisted app — cached as a tombstone
    details_fetched_at: new Date().toISOString(),
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const apiKey = Deno.env.get('STEAM_API_KEY')
  const steamId = Deno.env.get('STEAM_ID64')

  let body: { action?: Action; appid?: number; appids?: number[]; cc?: string } = {}
  try { body = await req.json() } catch { /* empty */ }
  const { action, appid } = body

  // The two store endpoints are public — they work without a Steam API key,
  // so they must stay reachable even before the Vault secrets are set.
  const needsKey = action !== 'app_details' && action !== 'app_reviews' && action !== 'current_players'
  if (needsKey && (!apiKey || !steamId)) return json({ error: 'not_configured' })

  try {
    switch (action) {
      case 'profile': {
        const r = await steamGet('/ISteamUser/GetPlayerSummaries/v2/', { key: apiKey!, steamids: steamId! })
        return json({ player: r?.response?.players?.[0] ?? null })
      }

      case 'owned_games': {
        // include_extended_appinfo adds has_dlc/has_workshop/sort_as/
        // content_descriptorids — free, same request.
        const r = await steamGet('/IPlayerService/GetOwnedGames/v1/', {
          key: apiKey!, steamid: steamId!,
          include_appinfo: '1', include_played_free_games: '1', include_extended_appinfo: '1',
        })
        const games = r?.response?.games ?? []
        return json({ games, count: r?.response?.game_count ?? games.length })
      }

      // NOTE: no `recent_games` action. GetRecentlyPlayedGames is a strict
      // subset of GetOwnedGames (same fields plus a count) and the client
      // derives its "last 2 weeks" strip from `playtime_2weeks`, which the
      // owned-games payload already carries — one fewer round trip.

      case 'achievements': {
        if (!appid) return json({ error: 'appid required' }, 400)
        // Without `l` Steam returns only apiname/achieved/unlocktime — no
        // display name or description. The schema call supplies the icons
        // and the real total; the global-percentage call (no key needed)
        // supplies rarity. All three join on the achievement's own key.
        const [achRes, schemaRes, globalRes] = await Promise.all([
          steamGet('/ISteamUserStats/GetPlayerAchievements/v1/', {
            key: apiKey!, steamid: steamId!, appid: String(appid), l: 'english',
          }).catch(() => null),
          steamGet('/ISteamUserStats/GetSchemaForGame/v2/', {
            key: apiKey!, appid: String(appid), l: 'english',
          }).catch(() => null),
          steamGet('/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/', {
            gameid: String(appid),
          }).catch(() => null),
        ])

        if (!achRes?.playerstats?.success) {
          return json({
            achievements: [],
            note: achRes?.playerstats?.error ?? 'unavailable (private profile or no achievements for this game)',
          })
        }

        const schema = new Map<string, AnyRec>()
        for (const a of schemaRes?.game?.availableGameStats?.achievements ?? []) schema.set(a.name, a)
        const rarity = new Map<string, number>()
        for (const a of globalRes?.achievementpercentages?.achievements ?? []) {
          rarity.set(a.name, typeof a.percent === 'string' ? parseFloat(a.percent) : a.percent)
        }

        const achievements = (achRes.playerstats.achievements ?? []).map((a: AnyRec) => {
          const s = schema.get(a.apiname)
          return {
            apiname: a.apiname,
            achieved: !!a.achieved,
            unlocktime: a.unlocktime || null,
            displayName: s?.displayName ?? a.name ?? a.apiname,
            description: s?.description ?? a.description ?? '',
            icon: s?.icon ?? null,
            icongray: s?.icongray ?? null,
            hidden: !!s?.hidden,
            globalPercent: rarity.get(a.apiname) ?? null,
          }
        })
        return json({ achievements, total: achievements.length })
      }

      case 'level_badges': {
        const [levelRes, badgesRes] = await Promise.all([
          steamGet('/IPlayerService/GetSteamLevel/v1/', { key: apiKey!, steamid: steamId! }).catch(() => null),
          steamGet('/IPlayerService/GetBadges/v1/', { key: apiKey!, steamid: steamId! }).catch(() => null),
        ])
        return json({
          level: levelRes?.response?.player_level ?? null,
          badges: badgesRes?.response?.badges ?? [],
          xp: badgesRes?.response?.player_xp ?? null,
          xpToNextLevel: badgesRes?.response?.player_xp_needed_to_level_up ?? null,
        })
      }

      // ── Store metadata, cached in `steam_apps` (migration 092) ────────
      case 'app_details': {
        const ids = [...new Set((body.appids ?? (appid ? [appid] : [])).filter(n => Number.isFinite(n)))]
        if (!ids.length) return json({ apps: [], missing: [] })
        const cc = body.cc || 'no'
        const supabase = db()

        const { data: cached, error } = await supabase
          .from('steam_apps').select('*').in('appid', ids)
        // A missing table (migration 092 not applied) must not take the
        // whole tab down — fall through to a live fetch with no caching.
        const cacheOk = !error
        const byId = new Map<number, AnyRec>()
        for (const row of cached ?? []) byId.set(row.appid, row)

        const cutoff = Date.now() - DETAILS_TTL_MS
        const stale = ids.filter(id => {
          const row = byId.get(id)
          if (!row) return true
          const at = row.details_fetched_at ? Date.parse(row.details_fetched_at) : 0
          return at < cutoff
        })

        const toFetch = stale.slice(0, MAX_STORE_FETCHES_PER_CALL)
        // Ids we could not resolve this call. `missing` MUST carry both the
        // over-the-cap remainder AND anything whose live fetch failed — an
        // appid that is silently absent from both `apps` and `missing` is
        // indistinguishable from a delisted game on the client, which would
        // report a transient rate limit as a permanent store removal.
        const failed: number[] = []
        for (const id of toFetch) {
          try {
            const data = await fetchAppDetails(id, cc)
            const row = detailsRow(id, data)
            byId.set(id, { ...(byId.get(id) ?? {}), ...row })
            if (cacheOk) await supabase.from('steam_apps').upsert(row, { onConflict: 'appid' })
          } catch {
            // Rate limit or a transient store error — report the appid in
            // `missing` so the client can retry rather than caching a lie.
            // A stale cached row is still better than nothing, so only count
            // it as missing when we have no row for it at all.
            if (!byId.has(id)) failed.push(id)
          }
        }

        return json({
          apps: ids.map(id => byId.get(id)).filter(Boolean),
          missing: [...stale.slice(MAX_STORE_FETCHES_PER_CALL), ...failed],
          cached: cacheOk,
        })
      }

      case 'app_reviews': {
        if (!appid) return json({ error: 'appid required' }, 400)
        const supabase = db()
        const { data: row, error } = await supabase
          .from('steam_apps').select('*').eq('appid', appid).maybeSingle()
        const cacheOk = !error

        const at = row?.reviews_fetched_at ? Date.parse(row.reviews_fetched_at) : 0
        if (row && at > Date.now() - REVIEWS_TTL_MS) {
          return json({ reviews: {
            review_score: row.review_score,
            review_score_desc: row.review_score_desc,
            total_positive: row.review_total_positive,
            total_negative: row.review_total_negative,
            total_reviews: row.review_total,
          } })
        }

        const summary = await fetchAppReviews(appid)
        if (!summary) return json({ reviews: null })
        if (cacheOk) {
          await supabase.from('steam_apps').upsert({
            appid,
            review_score: summary.review_score ?? null,
            review_score_desc: summary.review_score_desc ?? null,
            review_total_positive: summary.total_positive ?? null,
            review_total_negative: summary.total_negative ?? null,
            review_total: summary.total_reviews ?? null,
            reviews_fetched_at: new Date().toISOString(),
          }, { onConflict: 'appid' })
        }
        return json({ reviews: summary })
      }

      case 'current_players': {
        // Deliberately NOT cached and never called automatically — the UI
        // asks for this on an explicit tap in the detail modal.
        if (!appid) return json({ error: 'appid required' }, 400)
        const r = await steamGet('/ISteamUserStats/GetNumberOfCurrentPlayers/v1/', { appid: String(appid) })
        return json({ playerCount: r?.response?.result === 1 ? (r.response.player_count ?? null) : null })
      }

      default:
        return json({ error: 'unknown action' }, 400)
    }
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 502)
  }
})
