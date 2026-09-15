import { supabase } from '../../../integrations/supabase/client'

// ─────────────────────────────────────────────────────────────────────────────
//  PlayStation Network — proxied through the `psn-api` edge function. Sony
//  has no official API; this is the community npsso-cookie flow (see
//  CLAUDE.md's Games Feature Detail research note). Tokens live server-side
//  in `psn_tokens` (migration 091) — the client never sees them, only a
//  derived connection status.
// ─────────────────────────────────────────────────────────────────────────────

export interface PsnStatus {
  connected: boolean
  connectedAt: string | null
  expiresAt: string | null
}

export interface PsnTrophyTitle {
  npCommunicationId: string
  trophyTitleName: string
  trophyTitleIconUrl: string
  trophyTitlePlatform: string
  progress: number
  earnedTrophies: { bronze: number; silver: number; gold: number; platinum: number }
  lastUpdatedDateTime: string
}

async function invoke<T>(action: string, extra?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('psn-api', { body: { action, ...extra } })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data as T
}

export async function fetchPsnStatus(): Promise<PsnStatus> {
  return invoke('status')
}

export async function connectPsn(npsso: string): Promise<{ connected: true; expiresAt: string }> {
  return invoke('connect', { npsso })
}

export async function disconnectPsn(): Promise<void> {
  await invoke('disconnect')
}

export async function fetchPsnProfile(): Promise<{ profile: unknown; presence: unknown }> {
  return invoke('profile')
}

export async function fetchPsnTitles(): Promise<PsnTrophyTitle[]> {
  const r = await invoke<{ titles: PsnTrophyTitle[] }>('games')
  return r.titles
}
