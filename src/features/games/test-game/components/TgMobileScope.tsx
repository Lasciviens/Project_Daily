import { useTestGameStore } from '../testGameStore'
import {
  ALL_PLATFORMS, OTHER_PLATFORMS, STATUS_SECTIONS, platformInfo, splitPlatforms,
  type PlatformCount,
} from '../testGameModel'
import type { TgHeaderConfig } from '../tgTypes'
import { TgDropdown, type TgOption } from './TgDropdown'

/**
 * Left side of the phone's second row: what the grid below is scoped to.
 * Library → the design's "PS2 ▾" platform pill. Wishlist/Completed/Backlog →
 * the section name plus its platform scope. Queue/Analytics/Advanced → the
 * section title, nothing to pick.
 */
export function TgMobileScope({ platforms, header }: { platforms: PlatformCount[]; header: TgHeaderConfig }) {
  const section = useTestGameStore(s => s.section)
  const platform = useTestGameStore(s => s.platform)
  const setPlatform = useTestGameStore(s => s.setPlatform)

  if (section === 'library') {
    // The shell's effective platform: a persisted platform with no games left
    // falls back to All there, and the pill must say what the grid shows.
    const current = header.platformKey ?? platform
    const total = platforms.reduce((n, p) => n + p.count, 0)
    const options: TgOption<string>[] = [
      { value: ALL_PLATFORMS, label: 'All platforms', count: total },
      ...platforms.map(p => ({ value: p.key, label: p.info.short, count: p.count })),
    ]
    // "Others" only exists as a desktop sidebar row; the phone lists every
    // platform by name, but a persisted Others choice must stay visible here.
    if (current === OTHER_PLATFORMS) {
      const others = splitPlatforms(platforms, 8).others.reduce((n, p) => n + p.count, 0)
      options.push({ value: OTHER_PLATFORMS, label: 'Others', count: others })
    }
    return (
      <TgDropdown
        value={current}
        options={options}
        onChange={setPlatform}
        buttonLabel={platformInfo(current).short}
        ariaLabel="Platform"
        align="start"
        // The design's platform pill reads larger and bolder than the desktop filter pills.
        className="!text-[15px] !font-semibold"
      />
    )
  }

  if (STATUS_SECTIONS[section]) {
    const value = header.activeTab ?? ALL_PLATFORMS
    const active = header.tabs.find(t => t.key === value)
    return (
      <div className="flex min-w-0 items-center gap-2.5">
        <h2 className="truncate text-[16px] font-bold">{header.title}</h2>
        {header.tabs.length > 0 && (
          <TgDropdown
            value={value}
            options={header.tabs.map(t => ({ value: t.key, label: t.label, count: t.count }))}
            onChange={(k: string) => header.onTab?.(k)}
            buttonLabel={active?.label ?? 'All'}
            ariaLabel={`${header.title} platform`}
            align="start"
          />
        )}
      </div>
    )
  }

  return (
    <div className="min-w-0">
      <h2 className="truncate text-[16px] font-bold leading-tight">{header.title}</h2>
      <p className="tg-muted truncate text-[12px]">{header.subtitle}</p>
    </div>
  )
}
