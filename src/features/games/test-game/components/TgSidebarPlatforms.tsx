import { useTestGameStore } from '../testGameStore'
import { ALL_PLATFORMS, OTHER_PLATFORMS, platformInfo, type PlatformCount } from '../testGameModel'
import { PlatformIcon } from './platformArt'
import { TgSidebarItem } from './TgSidebarItem'

/** Two systems can share a short name ("Arcade" for MAME and FinalBurn Neo). */
function labelsFor(platforms: PlatformCount[]): Map<string, string> {
  const seen = new Map<string, number>()
  for (const p of platforms) seen.set(p.info.short, (seen.get(p.info.short) ?? 0) + 1)
  return new Map(platforms.map(p => [p.key, (seen.get(p.info.short) ?? 0) > 1 ? p.info.name : p.info.short]))
}

const iconClass = (active: boolean) => `tg-nav-icon ${active ? 'text-[var(--tg-accent)] !opacity-100' : ''}`

/** The sidebar's PLATFORMS block: the biggest platforms, then one "Others" row. */
export function TgSidebarPlatforms({ platforms, others }: { platforms: PlatformCount[]; others: PlatformCount[] }) {
  const section = useTestGameStore(s => s.section)
  const platform = useTestGameStore(s => s.platform)
  const setPlatform = useTestGameStore(s => s.setPlatform)

  if (platforms.length === 0 && others.length === 0) return null

  const inLibrary = section === 'library'
  const labels = labelsFor(platforms)
  const toggle = (key: string) => setPlatform(inLibrary && platform === key ? ALL_PLATFORMS : key)
  const allActive = inLibrary && platform === ALL_PLATFORMS
  const othersActive = inLibrary && platform === OTHER_PLATFORMS
  const othersCount = others.reduce((n, o) => n + o.count, 0)

  return (
    <div className="mt-5">
      <div className="mb-1.5 flex items-center pl-3">
        <span className="tg-section-label">Platforms</span>
        <button
          type="button"
          aria-pressed={allActive}
          onClick={() => setPlatform(ALL_PLATFORMS)}
          className={`ml-auto inline-flex min-h-6 items-center rounded-md px-2 text-[11px] font-semibold transition-colors [@media(pointer:coarse)]:min-h-[44px] ${
            allActive ? 'text-[var(--tg-accent)]' : 'text-[var(--tg-muted)] hover:text-[var(--tg-text)]'
          }`}
        >
          All
        </button>
      </div>

      <div className="flex flex-col gap-px">
        {platforms.map(p => {
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
        {others.length > 0 && (
          <TgSidebarItem
            icon={<PlatformIcon family="other" className={iconClass(othersActive)} />}
            label={platformInfo(OTHER_PLATFORMS).short}
            count={othersCount}
            active={othersActive}
            pressed={othersActive}
            title={others.map(o => `${o.info.name} (${o.count})`).join(', ')}
            onClick={() => toggle(OTHER_PLATFORMS)}
          />
        )}
      </div>
    </div>
  )
}
