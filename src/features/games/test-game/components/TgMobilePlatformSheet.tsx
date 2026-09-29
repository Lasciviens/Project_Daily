import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { ALL_PLATFORMS, platformLabels, type PlatformGroup } from '../testGameModel'
import { PlatformIcon } from './platformArt'
import { TgMobileSheet } from './TgMobileSheet'
import { Truncate } from '../../../../shared/ui/Truncate'

const ROW = 'flex w-full min-h-[48px] items-center gap-3 rounded-xl px-3 text-left text-[15px] font-medium transition-colors'
// Press state, not hover: on touch :hover sticks to the row under the finger.
const IDLE = 'text-[var(--tg-text)] active:bg-[var(--tg-hover)] [@media(hover:hover)]:hover:bg-[var(--tg-hover)]'
const ACTIVE = 'bg-[var(--tg-nav-active-bg)] font-semibold text-[var(--tg-nav-active-text)]'

function Row({ label, count, active, icon, onPick }: { label: string; count: number; active: boolean; icon: ReactNode; onPick: () => void }) {
  return (
    <button type="button" onClick={onPick} aria-pressed={active} className={`${ROW} ${active ? ACTIVE : IDLE}`}>
      {icon}
      <Truncate className="flex-1">{label}</Truncate>
      <span className={`text-[13px] font-medium tabular-nums ${active ? '' : 'text-[var(--tg-muted)]'}`}>{count.toLocaleString('en-GB')}</span>
      <Check aria-hidden size={17} strokeWidth={2.2} className={`shrink-0 ${active ? '' : 'invisible'}`} />
    </button>
  )
}

/** The phone's platform picker: every platform, grouped by maker, one tap to pick. */
export function TgMobilePlatformSheet({ open, onClose, groups, current, onPick }: {
  open: boolean
  onClose: () => void
  groups: PlatformGroup[]
  /** The shelf shown now (after the stale-platform fallback). */
  current: string
  onPick: (key: string) => void
}) {
  const labels = platformLabels(groups.flatMap(g => g.platforms))
  const total = groups.reduce((n, g) => n + g.total, 0)
  const pick = (key: string) => { onPick(key); onClose() }
  return (
    <TgMobileSheet open={open} onClose={onClose} title="Platforms">
      <Row
        label="All platforms" count={total} active={current === ALL_PLATFORMS} onPick={() => pick(ALL_PLATFORMS)}
        icon={<PlatformIcon family="other" className="h-5 w-5 shrink-0" />}
      />
      {groups.map(g => (
        <section key={g.maker} aria-label={g.label} className="mt-3">
          <h3 className="tg-section-label mb-1 flex items-baseline pl-3 pr-[41px]">
            {g.label}
            <span className="ml-auto font-medium normal-case tracking-normal tabular-nums">{g.total.toLocaleString('en-GB')}</span>
          </h3>
          <div className="flex flex-col gap-0.5">
            {g.platforms.map(p => (
              <Row
                key={p.key} label={labels.get(p.key) ?? p.info.short} count={p.count} active={current === p.key}
                onPick={() => pick(p.key)}
                icon={<PlatformIcon family={p.info.family} className="h-5 w-5 shrink-0" />}
              />
            ))}
          </div>
        </section>
      ))}
    </TgMobileSheet>
  )
}
