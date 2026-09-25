// psn-api — proxies the PlayStation Network via the community-maintained
// `psn-api` npm package (github.com/achievements-app/psn-api). Sony has NO
// official public API for this (see the Games Feature Detail research note
// in CLAUDE.md) — this is reverse-engineered and can break without notice.
//
// UNVERIFIED AGAINST A REAL ACCOUNT — this session has no PSN credentials
// to test against. Every remote call is wrapped defensively; if the
// library's exact return shape has drifted from what's read below, expect
// clear errors surfaced to the client rather than a silent wrong answer,
// but this genuinely needs a live pass with a real npsso once deployed.
//
// Auth model (npsso → access/refresh tokens): the user pastes an npsso
// obtained from a real browser login (my.playstation.com → the ssocookie
// endpoint) into the app once; this function exchanges it and stores the
// resulting tokens in `psn_tokens` (migration 091), refreshing the access
// token (~1h) from the refresh token on later calls without re-touching the
// npsso (~60d) every time. Sony added a reCAPTCHA to the login flow that
// blocks a *fully scripted* npsso mint — the human still has to paste a
// fresh npsso periodically (see CLAUDE.md); nothing here works around that.
//
// `verify_jwt` stays ON — every action needs the caller's user id (to scope
// psn_tokens), resolved via `supabase.auth.getUser` on the request's own
// JWT, the same pattern `calendar-oauth` already uses. The service-role
// client is what actually reads/writes psn_tokens (RLS is defense-in-depth,
// not the access path here).
//
// TWO ID SYSTEMS, and they do not interchange: `npTitleId` (CUSA…/PPSA…)
// identifies a store SKU and is what the played/purchased-games calls use;
// `npCommunicationId` (NPWR…) identifies a trophy set and is what every
// trophy call uses. `title_map` is the ONLY bridge between them and Sony
// caps it at 5 titles per request — which is exactly why the client bridges
// ONE game lazily when its detail modal opens rather than mapping a whole
// library up front.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  exchangeNpssoForAccessCode,
  exchangeAccessCodeForAuthTokens,
  exchangeRefreshTokenForAuthTokens,
  getProfileFromAccountId,
  getUserRegion,
  getUserTitles,
  getUserPlayedGames,
  getPurchasedGames,
  getUserTrophyProfileSummary,
  getUserTrophiesForSpecificTitle,
  getTitleTrophies,
  getUserTrophiesEarnedForTitle,
  getTitleTrophyGroups,
  getUserTrophyGroupEarningsForTitle,
} from 'npm:psn-api@^2'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// Sony reports an expired/revoked session as HTTP **200** with an error
// envelope in the body:
//
//   {"error":{"referenceId":"…","code":2241164,"message":"Expired token"}}
//
// Nothing throws, so every `.catch(() => null)` below stays silent and the
// envelope is handed to the client as if it were real data. Observed live
// (2026-09-25): `profile` returned `{profile:null, summary:{error:{…}}}`,
// the web app's `summary &&` guard passed on the truthy envelope, and
// reading `summary.earnedTrophies.platinum` crashed the whole tab into its
// ErrorBoundary -- "Cannot read properties of undefined (reading
// 'platinum')" instead of "your PlayStation session expired".
//
// This is the single most common PSN failure by design: Sony's reCAPTCHA
// blocks a scripted npsso mint, so the human MUST re-paste one periodically.
// The one predictable failure mode has to be a clear message, not a crash.
function sonyError(v: unknown): { code?: number; message?: string } | null {
  const e = (v as AnyRec)?.error
  if (!e || typeof e !== 'object') return null
  if (typeof e.message !== 'string' && typeof e.code !== 'number') return null
  return { code: e.code, message: e.message }
}

// Sony's auth-family codes are not documented anywhere stable, so this keys
// on the message text as well and errs toward "re-authenticate": telling the
// user to reconnect when the real fault was something else costs one paste;
// the opposite silently hands broken data to the UI.
const REAUTH_RE = /expired|invalid.*token|unauthor|not.*authenticated|access denied/i
function isReauth(err: { code?: number; message?: string }): boolean {
  return REAUTH_RE.test(err.message ?? '') || err.code === 2241164
}

type Action =
  | 'connect' | 'status' | 'disconnect' | 'profile'
  | 'games' | 'played_games' | 'purchased_games'
  | 'title_map' | 'title_trophies' | 'trophy_groups'

// deno-lint-ignore no-explicit-any
type AnyRec = Record<string, any>

// Sony's own hard caps, not ours: played-games pages at 200, the
// npTitleId→npCommunicationId bridge at 5 per request (a 6th 400s).
const PLAYED_PAGE = 200
const PLAYED_MAX_PAGES = 4
// getPurchasedGames is the one call whose page size is NOT documented: the
// library defaults to 24 and Sony publishes no maximum, so a large `size`
// is a guess that would fail the WHOLE call (and silently cost every PS Plus
// badge) if rejected. Stay close to the known-good default and page more
// times instead — same ~800-title ceiling, no guessed limit.
const PURCHASED_PAGE = 50
const PURCHASED_MAX_PAGES = 16
const TITLE_MAP_CHUNK = 5

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const authHeader = req.headers.get('authorization')
  if (!authHeader) return json({ error: 'Missing authorization header' }, 401)

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  if (authError || !user) return json({ error: 'Invalid token' }, 401)
  const userId = user.id

  let body: {
    action?: Action; npsso?: string
    npTitleIds?: string[]; npCommunicationId?: string; npServiceName?: string
  } = {}
  try { body = await req.json() } catch { /* empty */ }
  const { action } = body

  try {
    if (action === 'connect') {
      if (!body.npsso?.trim()) return json({ error: 'npsso required' }, 400)
      const accessCode = await exchangeNpssoForAccessCode(body.npsso.trim())
      const authorization = await exchangeAccessCodeForAuthTokens(accessCode)
      const expiresAt = new Date(Date.now() + (authorization.expiresIn ?? 3600) * 1000).toISOString()
      const { error } = await supabase.from('psn_tokens').upsert({
        user_id: userId,
        npsso: body.npsso.trim(),
        access_token: authorization.accessToken,
        refresh_token: authorization.refreshToken,
        access_token_expires_at: expiresAt,
        connected_at: new Date().toISOString(),
      })
      if (error) throw error
      return json({ connected: true, expiresAt })
    }

    if (action === 'disconnect') {
      const { error } = await supabase.from('psn_tokens').delete().eq('user_id', userId)
      if (error) throw error
      return json({ connected: false })
    }

    const { data: row } = await supabase.from('psn_tokens')
      .select('access_token, refresh_token, access_token_expires_at, connected_at')
      .eq('user_id', userId).maybeSingle()

    if (action === 'status') {
      return json({
        connected: !!row,
        connectedAt: row?.connected_at ?? null,
        expiresAt: row?.access_token_expires_at ?? null,
      })
    }

    if (!row) return json({ error: 'not_connected' }, 400)

    // Refresh the access token if it's expired or about to be (5min margin).
    let accessToken = row.access_token as string
    const expiresAt = row.access_token_expires_at ? new Date(row.access_token_expires_at as string).getTime() : 0
    if (!accessToken || expiresAt - Date.now() < 5 * 60 * 1000) {
      const refreshed = await exchangeRefreshTokenForAuthTokens(row.refresh_token as string)
      accessToken = refreshed.accessToken
      await supabase.from('psn_tokens').update({
        access_token: refreshed.accessToken,
        refresh_token: refreshed.refreshToken ?? row.refresh_token,
        access_token_expires_at: new Date(Date.now() + (refreshed.expiresIn ?? 3600) * 1000).toISOString(),
      }).eq('user_id', userId)
    }

    const auth = { accessToken }

    switch (action) {
      case 'profile': {
        // Trophy summary rides along: it is one cheap call and it supplies
        // the header's headline stat (level / platinum count), so splitting
        // it into its own round trip would buy nothing.
        const [profile, summary] = await Promise.all([
          getProfileFromAccountId(auth, 'me').catch(() => null),
          getUserTrophyProfileSummary(auth, 'me').catch(() => null),
        ])
        // Region needs the LEGACY profile endpoint (it decodes the region
        // out of that response's npId), so it is best-effort and never
        // allowed to fail the whole profile call.
        // Either payload can carry Sony's 200-with-error envelope (see
        // sonyError above). Profile is the tab's gate, so an expired session
        // must surface HERE as a typed signal rather than as data.
        const sErr = sonyError(summary) ?? sonyError(profile)
        if (sErr && isReauth(sErr)) {
          return json({ error: 'reauth_required', sonyMessage: sErr.message ?? 'Session expired' })
        }
        let region = null
        const onlineId = (profile as AnyRec)?.onlineId
        if (onlineId) region = await getUserRegion(auth, onlineId).catch(() => null)
        return json({
          // Never hand an error envelope on as if it were data.
          profile: sonyError(profile) ? null : profile,
          summary: sonyError(summary) ? null : summary,
          region,
        })
      }

      // The trophy-set list (NPWR ids). Distinct from `played_games` below,
      // which is the store-SKU list carrying real playtime.
      case 'games': {
        const titles = await getUserTitles(auth, 'me')
        const e = sonyError(titles)
        if (e && isReauth(e)) return json({ error: 'reauth_required', sonyMessage: e.message ?? 'Session expired' })
        return json({ titles: (titles as AnyRec)?.trophyTitles ?? [] })
      }

      case 'played_games': {
        // The richest call in the library: real playtime (ISO 8601 duration),
        // play count, first/last played, platform category.
        const titles: AnyRec[] = []
        for (let page = 0; page < PLAYED_MAX_PAGES; page++) {
          const res = await getUserPlayedGames(auth, 'me', { limit: PLAYED_PAGE, offset: page * PLAYED_PAGE })
          const e = sonyError(res)
          if (e && isReauth(e)) return json({ error: 'reauth_required', sonyMessage: e.message ?? 'Session expired' })
          const batch = (res as AnyRec)?.titles ?? []
          titles.push(...batch)
          if (batch.length < PLAYED_PAGE) break
        }
        return json({ titles })
      }

      case 'purchased_games': {
        // The ONLY source of "did this come from PS Plus" and of games that
        // were bought but never launched (which played_games can't see).
        // Fragile: a Sony-side GraphQL persisted-query hash change breaks
        // this one call, so it degrades to an empty list rather than taking
        // the tab down with it.
        const games: AnyRec[] = []
        try {
          for (let page = 0; page < PURCHASED_MAX_PAGES; page++) {
            const res = await getPurchasedGames(auth, { size: PURCHASED_PAGE, start: page * PURCHASED_PAGE })
            const batch = (res as AnyRec)?.data?.purchasedTitlesRetrieve?.games ?? []
            games.push(...batch)
            if (batch.length < PURCHASED_PAGE) break
          }
        } catch (e) {
          // A later page failing shouldn't discard the pages that worked —
          // partial PS Plus provenance beats none, as long as we say so.
          const note = `unavailable: ${String((e as Error).message ?? e)}`
          return json(games.length ? { games, note: `partial — ${note}` } : { games: [], note })
        }
        return json({ games })
      }

      case 'title_map': {
        // npTitleId (store SKU) → npCommunicationId (trophy set). Sony caps
        // this at 5 ids per request, so chunk. The client calls this for ONE
        // game when its modal opens — never for a whole library.
        const ids = (body.npTitleIds ?? []).filter(Boolean)
        if (!ids.length) return json({ titles: [] })
        const out: AnyRec[] = []
        for (let i = 0; i < ids.length; i += TITLE_MAP_CHUNK) {
          const chunk = ids.slice(i, i + TITLE_MAP_CHUNK)
          const res = await getUserTrophiesForSpecificTitle(auth, 'me', { npTitleIds: chunk.join(',') })
          out.push(...((res as AnyRec)?.titles ?? []))
        }
        return json({ titles: out })
      }

      case 'title_trophies': {
        // Two calls joined on trophyId: the title's own definitions (names,
        // icons, hidden flag — no rarity on this endpoint) and the user's
        // earned state (dates, rarity %, PS5 partial progress). Neither is
        // useful alone.
        const npc = body.npCommunicationId
        if (!npc) return json({ error: 'npCommunicationId required' }, 400)
        const opts = body.npServiceName ? { npServiceName: body.npServiceName } : undefined

        const [definedRes, earnedRes] = await Promise.all([
          getTitleTrophies(auth, npc, 'all', opts as AnyRec),
          getUserTrophiesEarnedForTitle(auth, 'me', npc, 'all', opts as AnyRec).catch(() => null),
        ])

        const earned = new Map<number, AnyRec>()
        for (const t of (earnedRes as AnyRec)?.trophies ?? []) earned.set(t.trophyId, t)

        const trophies = ((definedRes as AnyRec)?.trophies ?? []).map((d: AnyRec) => {
          const e = earned.get(d.trophyId)
          return {
            trophyId: d.trophyId,
            trophyName: d.trophyName,
            trophyDetail: d.trophyDetail,
            trophyType: d.trophyType,
            trophyIconUrl: d.trophyIconUrl,
            trophyHidden: !!d.trophyHidden,
            trophyGroupId: d.trophyGroupId,
            trophyRewardName: d.trophyRewardName ?? null,
            earned: !!e?.earned,
            earnedDateTime: e?.earnedDateTime ?? null,
            // A string percentage in Sony's own response — parse once here
            // so the client never has to guess the type.
            earnedRate: e?.trophyEarnedRate != null ? parseFloat(e.trophyEarnedRate) : null,
            rarity: e?.trophyRare ?? null,   // 0 UltraRare 1 VeryRare 2 Rare 3 Common
            // Present on partially-completed PS5 progress trophies. Real in
            // the response but absent from psn-api's own TypeScript types.
            progress: e?.progress ?? null,
            progressRate: e?.progressRate ?? null,
          }
        })

        return json({
          trophies,
          rarestTrophies: (earnedRes as AnyRec)?.rarestTrophies ?? [],
          lastUpdatedDateTime: (earnedRes as AnyRec)?.lastUpdatedDateTime ?? null,
        })
      }

      case 'trophy_groups': {
        // Base game vs each DLC pack, with the user's progress per group.
        const npc = body.npCommunicationId
        if (!npc) return json({ error: 'npCommunicationId required' }, 400)
        const opts = body.npServiceName ? { npServiceName: body.npServiceName } : undefined

        const [definedRes, earnedRes] = await Promise.all([
          getTitleTrophyGroups(auth, npc, opts as AnyRec),
          getUserTrophyGroupEarningsForTitle(auth, 'me', npc, opts as AnyRec).catch(() => null),
        ])

        const earned = new Map<string, AnyRec>()
        for (const g of (earnedRes as AnyRec)?.trophyGroups ?? []) earned.set(g.trophyGroupId, g)

        const groups = ((definedRes as AnyRec)?.trophyGroups ?? []).map((g: AnyRec) => {
          const e = earned.get(g.trophyGroupId)
          return {
            trophyGroupId: g.trophyGroupId,
            trophyGroupName: g.trophyGroupName,
            trophyGroupIconUrl: g.trophyGroupIconUrl ?? null,
            definedTrophies: g.definedTrophies ?? null,
            earnedTrophies: e?.earnedTrophies ?? null,
            progress: e?.progress ?? 0,
            // Sony omits this entirely on a group with nothing earned, even
            // though psn-api types it as required.
            lastUpdatedDateTime: e?.lastUpdatedDateTime ?? null,
          }
        })

        return json({ groups, progress: (earnedRes as AnyRec)?.progress ?? null })
      }

      default:
        return json({ error: 'unknown action' }, 400)
    }
  } catch (e) {
    // Sony reports a dead session TWO ways, and the envelope check above only
    // covers one of them. `profile` and `games` get the 200-with-error body;
    // `played_games` (a GraphQL call) instead THROWS -- observed live:
    // `getUserPlayedGames` rejected with "expired jwt token" while `profile`
    // on the very same session returned the envelope. That throw fell through
    // to this catch and left the client with a bare 502, which Supabase's
    // client surfaces only as "Edge Function returned a non-2xx status code"
    // -- the body never reaches the caller, so the real reason was invisible.
    //
    // Classify it with the SAME predicate rather than a second list, and
    // answer 200 so the reason survives the round trip.
    const msg = String((e as Error).message ?? e)
    if (isReauth({ message: msg })) {
      return json({ error: 'reauth_required', sonyMessage: msg })
    }
    return json({ error: msg }, 502)
  }
})
