// What the profile menu and the phone's More sheet say about PlayStation and
// Steam. Pure: the hooks' results go in, one line of status comes out, so the
// menu and the sheet can never describe the same state differently.
//
// The rules mirror Developer → Connections (ConnectionsTab.tsx): a stored
// psn_tokens row is not proof of a working session — only the first real
// Sony call (the profile) can say "expired" — and a missing npsso expiry is
// "unknown", never "expired".

import { isPsnReauthRequired, type PsnStatus } from '../../api/psnApi'
import { npssoLifetime, npssoLifetimeLabel } from '../../api/psnTokenLifetime'
import type { SteamPlayer } from '../../api/steamApi'

export type TgConnTone = 'ok' | 'warn' | 'bad' | 'idle'

export interface TgConnLine {
  tone: TgConnTone
  text: string
  detail?: string
  /** A stored session exists, so pasting a fresh token replaces it. */
  canRenew?: boolean
  /** Nothing stored: first-time connect lives in Developer → Connections. */
  needsSetup?: boolean
}

interface QueryLike<T> { data?: T; error: unknown; isLoading: boolean; isError: boolean }

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Unknown error')

export function psnLine(
  status: QueryLike<PsnStatus>,
  profile: QueryLike<{ profile: { onlineId?: string } | null }>,
  now = Date.now(),
): TgConnLine {
  if (status.isLoading) return { tone: 'idle', text: 'Checking…' }
  if (status.isError) return { tone: 'bad', text: 'Couldn’t check the connection', detail: message(status.error) }
  if (!status.data?.connected) return { tone: 'idle', text: 'Not connected', needsSetup: true }

  if (isPsnReauthRequired(profile.error)) {
    return {
      tone: 'bad', text: 'Session expired', canRenew: true,
      detail: profile.error.sonyMessage
        ? `Sony stopped accepting the stored session (“${profile.error.sonyMessage}”).`
        : 'Sony stopped accepting the stored session.',
    }
  }

  const who = profile.data?.profile?.onlineId
  const unreachable = profile.isError ? 'Couldn’t reach PlayStation just now.' : undefined
  const life = npssoLifetime(status.data.npssoExpiresAt, now)
  const label = npssoLifetimeLabel(life)
  const detail = [who && `Signed in as ${who}`, unreachable].filter(Boolean).join(' · ') || undefined

  if (life.state === 'expired') return { tone: 'bad', text: 'PSN token expired', detail, canRenew: true }
  if (life.state === 'soon') return { tone: 'warn', text: `PSN token expires in ${label}`, detail, canRenew: true }
  if (life.state === 'ok') return { tone: unreachable ? 'warn' : 'ok', text: `PSN token expires in ${label}`, detail, canRenew: true }
  return { tone: unreachable ? 'warn' : 'ok', text: 'Connected · token expiry unknown', detail, canRenew: true }
}

export function steamLine(profile: QueryLike<SteamPlayer | null>): TgConnLine {
  if (profile.isLoading) return { tone: 'idle', text: 'Checking…' }
  if (profile.isError) {
    return message(profile.error) === 'not_configured'
      ? { tone: 'idle', text: 'Not configured', detail: 'Set up server-side (Supabase Vault).', needsSetup: true }
      : { tone: 'bad', text: 'Unavailable', detail: message(profile.error) }
  }
  if (!profile.data) return { tone: 'warn', text: 'Configured · profile not found' }
  return { tone: 'ok', text: 'Connected', detail: profile.data.personaname ? `Signed in as ${profile.data.personaname}` : undefined }
}
