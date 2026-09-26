import { useRef, type KeyboardEvent } from 'react'
import { TGA_TABS, type TgaTab } from './tgAnalyticsModel'

/**
 * Overview · Play · Collection · Data health — one 44px segmented strip,
 * the full width on a phone and content-sized from a tablet up. A real tab
 * list: Left/Right (and Home/End) move between tabs, and only the open one is
 * a tab stop.
 */
export function TgAnalyticsTabs({ tab, onTab, panelId }: { tab: TgaTab; onTab: (t: TgaTab) => void; panelId: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = TGA_TABS.findIndex(t => t.key === tab)
    const last = TGA_TABS.length - 1
    const next = e.key === 'ArrowRight' ? (i + 1) % TGA_TABS.length
      : e.key === 'ArrowLeft' ? (i + last) % TGA_TABS.length
      : e.key === 'Home' ? 0 : e.key === 'End' ? last : -1
    if (next < 0) return
    e.preventDefault()
    onTab(TGA_TABS[next].key)
    refs.current[next]?.focus()
  }

  return (
    <div
      role="tablist" aria-label="Analytics views" onKeyDown={onKeyDown}
      className="grid w-full grid-cols-4 gap-1 rounded-[12px] border border-[var(--tg-border)] bg-[var(--tg-panel-2)] p-1 @[34rem]:inline-grid @[34rem]:w-auto @[34rem]:self-start"
    >
      {TGA_TABS.map((t, i) => {
        const active = t.key === tab
        return (
          <button
            key={t.key}
            ref={el => { refs.current[i] = el }}
            type="button" role="tab" id={`tga-tab-${t.key}`} aria-selected={active} aria-controls={panelId}
            tabIndex={active ? 0 : -1}
            onClick={() => onTab(t.key)}
            className={`min-h-[40px] min-w-0 truncate rounded-[9px] px-2 text-[13px] font-semibold transition-colors [@media(pointer:coarse)]:min-h-[44px] @[34rem]:px-4 ${
              active
                ? 'bg-[var(--tg-panel)] text-[var(--tg-text)] shadow-[0_1px_2px_rgba(15,23,42,0.12),inset_0_0_0_1px_var(--tg-border)]'
                : 'text-[var(--tg-muted)] [@media(hover:hover)]:hover:text-[var(--tg-text)]'
            }`}
          >
            {t.short ? (
              <>
                <span className="@[34rem]:hidden" aria-hidden>{t.short}</span>
                <span className="hidden @[34rem]:inline">{t.label}</span>
                <span className="sr-only @[34rem]:hidden">{t.label}</span>
              </>
            ) : t.label}
          </button>
        )
      })}
    </div>
  )
}
