// The profile facts the connection checks already return, as short chips
// (TgConnections). Pure and type-only, so scripts/verify-test-game-model.cjs
// can load it without the Supabase client.

import type { PsnProfile, PsnTrophySummary } from '../../api/psnApi'
import type { SteamPlayer } from '../../api/steamApi'

const STEAM_STATE = ['Offline', 'Online', 'Busy', 'Away', 'Snooze', 'Looking to trade', 'Looking to play']

/**
 * The profile facts the status calls already return — trophy level, PS Plus,
 * earned trophies; Steam's presence, current game and account age. Shown as
 * small chips; nothing here costs a request of its own.
 */
export function psnFacts(data: { profile?: PsnProfile | null; summary?: PsnTrophySummary | null } | undefined): string[] {
  const out: string[] = []
  const s = data?.summary
  if (s?.trophyLevel != null && s.trophyLevel !== '') out.push(`Trophy level ${s.trophyLevel}`)
  if (data?.profile?.isPlus) out.push('PlayStation Plus')
  const e = s?.earnedTrophies
  if (e) {
    const parts = ([['platinum', e.platinum], ['gold', e.gold], ['silver', e.silver], ['bronze', e.bronze]] as const)
      .filter(([, n]) => Number.isFinite(n) && n > 0)
      .map(([name, n]) => `${n.toLocaleString('en-GB')} ${name}`)
    if (parts.length) out.push(parts.join(' · '))
  }
  return out
}

export function steamFacts(p: SteamPlayer | null | undefined): string[] {
  if (!p) return []
  const out: string[] = []
  if (p.gameextrainfo) out.push(`Playing ${p.gameextrainfo} now`)
  else if (Number.isInteger(p.personastate) && STEAM_STATE[p.personastate]) out.push(STEAM_STATE[p.personastate])
  if (p.timecreated) out.push(`Member since ${new Date(p.timecreated * 1000).getFullYear()}`)
  return out
}
