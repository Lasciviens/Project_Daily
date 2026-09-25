import { Fragment, type ReactNode } from 'react'
import { MenuItem } from '@headlessui/react'
import { useNavigate } from 'react-router-dom'
import { usePsnProfile, usePsnStatus } from '../../hooks/usePlayStation'
import { useSteamProfile } from '../../hooks/useSteam'
import { psnLine, steamLine, type TgConnLine } from './tgConnections'

// PlayStation + Steam status under the profile (owner request 2026-09-25).
// Status and renewing only: first-time connect and disconnect stay in
// Developer → Connections, the one home for integrations (CLAUDE.md).
// Mount it only while its menu or sheet is open — these hooks fetch on mount,
// and the page itself never needs them.

function Row({ name, line, action }: { name: string; line: TgConnLine; action?: ReactNode }) {
  return (
    <div className="tg-conn-row" data-tone={line.tone}>
      <span className="tg-conn-dot" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[13px] font-semibold text-[var(--tg-text)]">{name}</span>
          <span className="tg-conn-text text-[12.5px] font-medium">{line.text}</span>
        </div>
        {line.detail && <p className="mt-0.5 text-[12px] leading-snug text-[var(--tg-muted)] [overflow-wrap:anywhere]">{line.detail}</p>}
        {action && <div className="mt-1.5 flex flex-wrap gap-1.5">{action}</div>}
      </div>
    </div>
  )
}

export function TgConnections({ inMenu = false, onRenewPsn }: { inMenu?: boolean; onRenewPsn: () => void }) {
  const navigate = useNavigate()
  const status = usePsnStatus()
  const profile = usePsnProfile(!!status.data?.connected)
  const steam = useSteamProfile()
  const psn = psnLine(status, profile)
  const st = steamLine(steam)

  const wrap = (key: string, node: ReactNode) => (inMenu ? <MenuItem key={key}>{node}</MenuItem> : <Fragment key={key}>{node}</Fragment>)
  const setup = (key: string) => wrap(key, (
    <button type="button" className="tg-conn-btn" onClick={() => navigate('/developer?tab=connections')}>
      Open Connections
    </button>
  ))

  const psnAction = psn.canRenew
    ? wrap('psn-renew', (
      <button type="button" className={`tg-conn-btn ${psn.tone === 'ok' ? '' : 'is-primary'}`} onClick={onRenewPsn}>
        {psn.tone === 'bad' ? 'Paste a fresh token' : 'Renew token'}
      </button>
    ))
    : psn.needsSetup ? setup('psn-setup') : undefined

  return (
    <div className="flex flex-col gap-1">
      <Row name="PlayStation" line={psn} action={psnAction} />
      <Row name="Steam" line={st} action={st.needsSetup ? setup('steam-setup') : undefined} />
    </div>
  )
}
