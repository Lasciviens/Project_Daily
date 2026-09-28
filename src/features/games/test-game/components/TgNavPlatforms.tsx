import { useTestGameStore } from '../testGameStore'
import { ALL_PLATFORMS, platformLabels, type PlatformGroup } from '../testGameModel'
import { PlatformIcon } from './platformArt'
import { TgSidebarItem } from './TgSidebarItem'

// Bold glyphs as the design draws them: near-white in dark mode and
// near-black in light, the accent when active.
const iconClass = (active: boolean) => `tg-nav-icon ${active ? 'text-[var(--tg-accent)]' : 'text-[var(--tg-text)]'}`

/**
 * The panel's PLATFORMS block: every platform, grouped by maker (nothing is
 * folded into an "Others" row — each system is a shelf of its own).
 */
export function TgNavPlatforms({ groups }: { groups: PlatformGroup[] }) {
  const section = useTestGameStore(s => s.section)
  const platform = useTestGameStore(s => s.platform)
  const setPlatform = useTestGameStore(s => s.setPlatform)

  if (groups.length === 0) return null

  const inLibrary = section === 'library'
  // Across every group, so a shared short name ("Arcade", "SNES") is spelled out.
  const labels = platformLabels(groups.flatMap(g => g.platforms))
  const toggle = (key: string) => setPlatform(inLibrary && platform === key ? ALL_PLATFORMS : key)
  const allActive = inLibrary && platform === ALL_PLATFORMS

  return (
    <div className="mt-5">
      <div className="mb-1 flex items-center pl-3">
        <span className="tg-section-label">Platforms</span>
        <button
          type="button"
          aria-pressed={allActive}
          onClick={() => setPlatform(ALL_PLATFORMS)}
          className={`ml-auto inline-flex min-h-6 items-center justify-center rounded-md px-2 text-[11px] font-semibold transition-colors [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:min-w-[44px] ${
            allActive ? 'text-[var(--tg-accent)]' : 'text-[var(--tg-muted)] [@media(hover:hover)]:hover:text-[var(--tg-text)]'
          }`}
        >
          All
        </button>
      </div>

      {groups.map(g => (
        <section key={g.maker} aria-label={g.label} className="mt-2 first-of-type:mt-0">
          <h3 className="flex items-baseline gap-1.5 pb-0.5 pl-3 pr-2 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--tg-faint)]">
            <span className="truncate">{g.label}</span>
            <span className="ml-auto font-medium tabular-nums">{g.total.toLocaleString('en-GB')}</span>
          </h3>
          <div className="flex flex-col gap-px">
            {g.platforms.map(p => {
              const active = inLibrary && platform === p.key
              return (
                <TgSidebarItem
                  key={p.key}
                  icon={<PlatformIcon family={p.info.family} className={iconClass(active)} />}
                  label={labels.get(p.key) ?? p.info.short}
                  count={p.count}
                  active={active}
                  pressed={active}
                  title={`${p.info.name} · ${p.count} game${p.count === 1 ? '' : 's'}`}
                  onClick={() => toggle(p.key)}
                />
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
