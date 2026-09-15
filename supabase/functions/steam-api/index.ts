// steam-api — proxies the Steam Web API so the personal API key stays
// server-side (STEAM_API_KEY + STEAM_ID64 in Vault, never in the client).
// Single-user app (same pattern as HEVY_USER_ID) — no per-caller scoping
// needed, `verify_jwt` stays ON (the platform validates the browser JWT
// before this function runs; the function itself never needs the user id).
//
// api.steampowered.com sends no CORS headers — confirmed via community
// reports (github.com/xDimGG/node-steamapi#27) — so this proxy is mandatory,
// not a convenience. Endpoint shapes below are Valve's own documented Web
// API (partner.steamgames.com/doc/webapi_overview), not speculative.
//
// If STEAM_API_KEY/STEAM_ID64 aren't set yet, every action returns
// { error: 'not_configured' } rather than throwing — safe to deploy before
// the secrets exist, same convention as food-search's missing-key fallback.

const STEAM = 'https://api.steampowered.com'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

type Action = 'profile' | 'owned_games' | 'recent_games' | 'achievements' | 'level_badges'

async function steamGet(path: string, params: Record<string, string>) {
  const url = `${STEAM}${path}?${new URLSearchParams(params).toString()}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`steam ${r.status}`)
  return r.json()
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const apiKey = Deno.env.get('STEAM_API_KEY')
  const steamId = Deno.env.get('STEAM_ID64')
  if (!apiKey || !steamId) return json({ error: 'not_configured' })

  let body: { action?: Action; appid?: number } = {}
  try { body = await req.json() } catch { /* empty */ }
  const { action, appid } = body

  try {
    switch (action) {
      case 'profile': {
        const r = await steamGet('/ISteamUser/GetPlayerSummaries/v2/', { key: apiKey, steamids: steamId })
        const player = r?.response?.players?.[0] ?? null
        return json({ player })
      }
      case 'owned_games': {
        const r = await steamGet('/IPlayerService/GetOwnedGames/v1/', {
          key: apiKey, steamid: steamId, include_appinfo: '1', include_played_free_games: '1',
        })
        const games = r?.response?.games ?? []
        return json({ games, count: r?.response?.game_count ?? games.length })
      }
      case 'recent_games': {
        const r = await steamGet('/IPlayerService/GetRecentlyPlayedGames/v1/', { key: apiKey, steamid: steamId })
        return json({ games: r?.response?.games ?? [] })
      }
      case 'achievements': {
        if (!appid) return json({ error: 'appid required' }, 400)
        const [achRes, schemaRes] = await Promise.all([
          steamGet('/ISteamUserStats/GetPlayerAchievements/v1/', { key: apiKey, steamid: steamId, appid: String(appid) })
            .catch(() => null),
          steamGet('/ISteamUserStats/GetSchemaForGame/v2/', { key: apiKey, appid: String(appid) })
            .catch(() => null),
        ])
        if (!achRes?.playerstats?.success) {
          return json({ achievements: [], note: achRes?.playerstats?.error ?? 'unavailable (private profile or no stats for this game)' })
        }
        const schemaByName = new Map<string, { displayName: string; description?: string; icon?: string; icongray?: string }>()
        for (const a of schemaRes?.game?.availableGameStats?.achievements ?? []) {
          schemaByName.set(a.name, { displayName: a.displayName, description: a.description, icon: a.icon, icongray: a.icongray })
        }
        const achievements = (achRes.playerstats.achievements ?? []).map((a: { apiname: string; achieved: number; unlocktime: number }) => ({
          apiname: a.apiname,
          achieved: !!a.achieved,
          unlocktime: a.unlocktime || null,
          ...(schemaByName.get(a.apiname) ?? {}),
        }))
        return json({ achievements })
      }
      case 'level_badges': {
        const [levelRes, badgesRes] = await Promise.all([
          steamGet('/IPlayerService/GetSteamLevel/v1/', { key: apiKey, steamid: steamId }).catch(() => null),
          steamGet('/IPlayerService/GetBadges/v1/', { key: apiKey, steamid: steamId }).catch(() => null),
        ])
        return json({
          level: levelRes?.response?.player_level ?? null,
          badges: badgesRes?.response?.badges ?? [],
          xp: badgesRes?.response?.player_xp ?? null,
        })
      }
      default:
        return json({ error: 'unknown action' }, 400)
    }
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 502)
  }
})
