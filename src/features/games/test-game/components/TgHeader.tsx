import type { TgHeaderConfig } from '../tgTypes'
import { PlatformWordmark, SectionGlyph } from './platformArt'

// Idle status tabs: faint pills in dark mode, plain text in light (the
// design's two variants) — `--tg-tab-idle-bg` from testGame.css when defined.
const IDLE_TAB = 'bg-[var(--tg-tab-idle-bg,color-mix(in_srgb,var(--tg-panel)_55%,transparent))]'

/** The main column's heading: logo, title, count line and the tab pills. */
export function TgHeader({ config }: { config: TgHeaderConfig }) {
  const { title, subtitle, logo, platformKey, tabs, activeTab, onTab } = config
  const isPlatform = logo === 'platform' && !!platformKey

  return (
    <header className="shrink-0 pb-1.5 pt-3">
      <div className={`flex min-h-[44px] items-center ${isPlatform ? 'gap-5' : 'gap-3.5'}`}>
        {isPlatform ? (
          <div className="flex h-11 min-w-[110px] max-w-[170px] shrink-0 items-center">
            <PlatformWordmark platformKey={platformKey} />
          </div>
        ) : (
          <SectionGlyph logo={logo} />
        )}
        <div className="min-w-0">
          <h1 className="truncate text-[24px] font-semibold leading-7 tracking-[-0.01em] text-[var(--tg-text)]">{title}</h1>
          <p className="mt-0.5 truncate text-[11px] leading-4 text-[var(--tg-muted)]">{subtitle}</p>
        </div>
      </div>

      {tabs.length > 0 && (
        <div role="group" aria-label={`${title} filter`} className="tg-scroll-x -m-1 mt-2 flex gap-2.5 p-1">
          {tabs.map(t => {
            const active = t.key === activeTab
            return (
              <button
                key={t.key}
                type="button"
                aria-pressed={active}
                disabled={!onTab}
                onClick={() => onTab?.(t.key)}
                className={`tg-tab shrink-0 ${active ? 'is-active' : IDLE_TAB}`}
              >
                {t.label}
                {t.count != null && (
                  <span className="tg-tab-count inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-[color-mix(in_srgb,currentColor_12%,transparent)] px-1.5">
                    {t.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </header>
  )
}
