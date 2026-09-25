import { supabase } from '../../../integrations/supabase/client'

// ─────────────────────────────────────────────────────────────────────────────
//  PlayStation Network — proxied through the `psn-api` edge function. Sony
//  has no official API; this is the community npsso-cookie flow (see
//  CLAUDE.md's Games Feature Detail research note). Tokens live server-side
//  in `psn_tokens` (migration 091) — the client never sees them, only a
//  derived connection status.
//
//  TWO ID SYSTEMS: `titleId` (CUSA…/PPSA…, a store SKU) is what playtime and
//  purchase data are keyed by; `npCommunicationId` (NPWR…) is what every
//  trophy call is keyed by. They do not interchange and Sony's bridge takes
//  at most 5 ids per request — hence `fetchPsnTitleMap` is called for ONE
//  game when its modal opens, never across a whole library.
// ─────────────────────────────────────────────────────────────────────────────

export interface PsnStatus {
  connected: boolean
  connectedAt: string | null
  /** The ACCESS token's expiry (~1h). Refreshed automatically — not something
   *  a user can act on; `npssoExpiresAt` is the date that matters to them. */
  expiresAt: string | null
  /** When the npsso cookie itself expires (~60d). Null on a bare-token paste
   *  or a row predating migration 101 — unknown, never "expired". */
  npssoExpiresAt?: string | null
}

export interface PsnProfile {
  onlineId?: string
  aboutMe?: string
  avatars?: { size: string; url: string }[]
  isPlus?: boolean
  isOfficiallyVerified?: boolean
}

export interface PsnTrophySummary {
  trophyLevel: number | string
  progress: number
  tier: number
  earnedTrophies: { bronze: number; silver: number; gold: number; platinum: number }
}

export interface PsnTrophyTitle {
  npCommunicationId: string
  npServiceName?: string
  trophyTitleName: string
  trophyTitleIconUrl: string
  trophyTitlePlatform: string
  hasTrophyGroups: boolean
  progress: number
  definedTrophies: { bronze: number; silver: number; gold: number; platinum: number }
  earnedTrophies: { bronze: number; silver: number; gold: number; platinum: number }
  lastUpdatedDateTime: string
}

export interface PsnPlayedGame {
  titleId: string
  name: string
  localizedName?: string
  imageUrl?: string
  /** ps4_game | ps5_native_game | pspc_game | unknown */
  category?: string
  /** Sony is inconsistent here ("none", "none_purchased", "none(purchased)", "ps_plus"). */
  service?: string
  playCount?: number
  firstPlayedDateTime?: string
  lastPlayedDateTime?: string
  /** ISO 8601 duration, e.g. "PT228H56M33S". Use `parsePlayDurationMinutes`. */
  playDuration?: string
  concept?: { id?: number; genres?: string; name?: string }
  media?: { screenshotUrl?: string }
}

export interface PsnPurchasedGame {
  titleId: string
  name: string
  platform?: string
  /** "NONE" = bought outright · "PS_PLUS" = came with the subscription. */
  membership?: string
  isActive?: boolean
  isDownloadable?: boolean
  isPreOrder?: boolean
  image?: { url?: string }
}

export interface PsnTrophy {
  trophyId: number
  trophyName: string
  trophyDetail: string
  trophyType: 'bronze' | 'silver' | 'gold' | 'platinum'
  trophyIconUrl: string
  trophyHidden: boolean
  trophyGroupId: string
  trophyRewardName: string | null
  earned: boolean
  earnedDateTime: string | null
  /** % of all players who earned it — already parsed to a number here. */
  earnedRate: number | null
  /** 0 Ultra Rare · 1 Very Rare · 2 Rare · 3 Common */
  rarity: number | null
  progress: string | null
  progressRate: number | null
}

export interface PsnTrophyGroup {
  trophyGroupId: string
  trophyGroupName: string
  trophyGroupIconUrl: string | null
  definedTrophies: { bronze: number; silver: number; gold: number; platinum: number } | null
  earnedTrophies: { bronze: number; silver: number; gold: number; platinum: number } | null
  progress: number
  lastUpdatedDateTime: string | null
}

/** Sony's session died and only a fresh npsso restores it — a normal,
 *  expected state (Sony's reCAPTCHA blocks a scripted npsso mint, so the
 *  human re-pastes one every month or two), NOT an application failure. It
 *  gets its own class so the UI can show a reconnect panel instead of an
 *  error box, let alone crash. */
export class PsnReauthRequired extends Error {
  readonly sonyMessage?: string
  constructor(sonyMessage?: string) {
    super(sonyMessage ?? 'PlayStation session expired')
    this.name = 'PsnReauthRequired'
    this.sonyMessage = sonyMessage
  }
}

export function isPsnReauthRequired(e: unknown): e is PsnReauthRequired {
  return e instanceof PsnReauthRequired
}

async function invoke<T>(action: string, extra?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('psn-api', { body: { action, ...extra } })
  if (error) throw error
  if (data?.error === 'reauth_required') throw new PsnReauthRequired(data.sonyMessage)
  if (data?.error) throw new Error(data.error)
  return data as T
}

/**
 * PSN reports playtime as an ISO 8601 duration ("PT228H56M33S") — the only
 * playtime figure the whole API exposes, and a cumulative lifetime total
 * (there are no per-session records anywhere in PSN).
 */
export function parsePlayDurationMinutes(iso?: string): number {
  if (!iso) return 0
  const m = /^P(?:([\d.]+)D)?T?(?:([\d.]+)H)?(?:([\d.]+)M)?(?:([\d.]+)S)?$/.exec(iso)
  if (!m) return 0
  const [, d, h, min, s] = m
  return Math.round(
    (parseFloat(d || '0') * 1440) + (parseFloat(h || '0') * 60) +
    parseFloat(min || '0') + (parseFloat(s || '0') / 60),
  )
}

export async function fetchPsnStatus(): Promise<PsnStatus> {
  return invoke('status')
}

export async function connectPsn(npsso: string): Promise<{ connected: true; expiresAt: string; npssoExpiresAt: string | null }> {
  return invoke('connect', { npsso })
}

export async function disconnectPsn(): Promise<void> {
  await invoke('disconnect')
}

export async function fetchPsnProfile(): Promise<{
  profile: PsnProfile | null
  summary: PsnTrophySummary | null
  region: { code: string; name: string } | null
}> {
  return invoke('profile')
}

/** Trophy-set list (NPWR ids) — the trophy view's own source. */
export async function fetchPsnTitles(): Promise<PsnTrophyTitle[]> {
  const r = await invoke<{ titles: PsnTrophyTitle[] }>('games')
  return r.titles
}

/** The playtime library — the primary Steam-equivalent view. */
export async function fetchPsnPlayedGames(): Promise<PsnPlayedGame[]> {
  const r = await invoke<{ titles: PsnPlayedGame[] }>('played_games')
  return r.titles
}

/** Purchase/PS Plus provenance. Degrades to [] with a note if Sony's
 *  GraphQL hash has rotated — never fails the tab. */
export async function fetchPsnPurchasedGames(): Promise<{ games: PsnPurchasedGame[]; note?: string }> {
  return invoke('purchased_games')
}

/** Bridge a store SKU to its trophy set. At most 5 ids per call (Sony's cap). */
export async function fetchPsnTitleMap(npTitleIds: string[]): Promise<{
  titles: { npTitleId: string; trophyTitles?: PsnTrophyTitle[] }[]
}> {
  return invoke('title_map', { npTitleIds })
}

export async function fetchPsnTitleTrophies(npCommunicationId: string, npServiceName?: string): Promise<{
  trophies: PsnTrophy[]; rarestTrophies: unknown[]; lastUpdatedDateTime: string | null
}> {
  return invoke('title_trophies', { npCommunicationId, npServiceName })
}

export async function fetchPsnTrophyGroups(npCommunicationId: string, npServiceName?: string): Promise<{
  groups: PsnTrophyGroup[]; progress: number | null
}> {
  return invoke('trophy_groups', { npCommunicationId, npServiceName })
}
