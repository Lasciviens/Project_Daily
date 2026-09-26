import { Info, LoaderCircle, RotateCw, TriangleAlert } from 'lucide-react'
import { TGA_LIBRARIES, TGA_WINDOWS, type TgaLibrary, type TgaWindow } from './tgAnalyticsModel'
import { TGA_IDLE_TAB, fmtInt } from './tgAnalyticsFormat'
import { TgDropdown } from './TgDropdown'

interface Props {
  period: TgaWindow
  onPeriod: (w: TgaWindow) => void
  library: TgaLibrary
  onLibrary: (l: TgaLibrary) => void
  /** Visible games per library; a library with none is not offered. */
  libraryCounts: Record<TgaLibrary, number>
  caption: string
  providersLoading: boolean
  providerError: boolean
  onRetryProviders: () => void
  /** The page's phone layout (a landscape phone too): always the two dropdowns — six pills filled its short screen. */
  compact?: boolean
}

const COUNT = 'tg-tab-count inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-[color-mix(in_srgb,currentColor_12%,transparent)] px-1.5'

/**
 * One row above everything it scopes: the time window, then the library.
 * Pills from a comfortable width; on a phone the same two choices collapse
 * into two dropdowns side by side instead of four wrapping rows of pills.
 */
export function TgAnalyticsControls(p: Props) {
  const libs = TGA_LIBRARIES.filter(l => l.key === 'all' || p.libraryCounts[l.key] > 0)
  const showLibs = libs.length > 2
  const libLabel = (key: TgaLibrary) => (key === 'all' ? 'All libraries' : TGA_LIBRARIES.find(l => l.key === key)?.label ?? key)

  return (
    <div className="flex flex-col gap-3">
      <div className={`hidden flex-wrap items-center gap-x-5 gap-y-2.5 ${p.compact ? '' : '@[34rem]:flex'}`}>
        <div role="group" aria-label="Time period" className="flex flex-wrap gap-2">
          {TGA_WINDOWS.map(w => (
            <button
              key={w.key} type="button" aria-pressed={p.period === w.key} onClick={() => p.onPeriod(w.key)}
              className={`tg-tab ${p.period === w.key ? 'is-active' : TGA_IDLE_TAB}`}
            >
              {w.label}
            </button>
          ))}
        </div>
        {showLibs && (
          <div role="group" aria-label="Library" className="flex flex-wrap items-center gap-2">
            <span aria-hidden className="mr-3 hidden h-6 w-px bg-[var(--tg-border-strong)] @[60rem]:block" />
            {libs.map(l => (
              <button
                key={l.key} type="button" aria-pressed={p.library === l.key} onClick={() => p.onLibrary(l.key)}
                className={`tg-tab ${p.library === l.key ? 'is-active' : TGA_IDLE_TAB}`}
              >
                {l.label}
                <span className={COUNT}>{fmtInt(p.libraryCounts[l.key])}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={`flex gap-2.5 ${p.compact ? '' : '@[34rem]:hidden'}`}>
        <TgDropdown
          value={p.period} onChange={p.onPeriod} ariaLabel="Time period" fullWidth className="flex-1"
          buttonLabel={TGA_WINDOWS.find(w => w.key === p.period)?.label ?? ''}
          options={TGA_WINDOWS.map(w => ({ value: w.key, label: w.label }))}
        />
        {showLibs && (
          <TgDropdown
            value={p.library} onChange={p.onLibrary} ariaLabel="Library" fullWidth align="end" className="flex-1"
            buttonLabel={libLabel(p.library)}
            options={libs.map(l => ({ value: l.key, label: libLabel(l.key), count: p.libraryCounts[l.key] }))}
          />
        )}
      </div>

      <p className="flex items-start gap-2 text-[12px] leading-relaxed text-[var(--tg-muted)]">
        <Info size={14} strokeWidth={2} aria-hidden className="mt-[3px] shrink-0" />
        <span>{p.caption}</span>
      </p>

      {p.providersLoading && !p.providerError && (
        <p role="status" className="flex items-center gap-2 text-[12px] text-[var(--tg-muted)]">
          <LoaderCircle size={14} strokeWidth={2.2} aria-hidden className="shrink-0 animate-spin text-[var(--tg-accent)]" />
          Steam and PlayStation are still loading — their games join these numbers when they arrive.
        </p>
      )}
      {p.providerError && (
        <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-[color-mix(in_srgb,var(--tg-red)_28%,transparent)] bg-[var(--tg-red-soft)] py-1 pl-3 pr-1 text-[12.5px] text-[var(--tg-text)]">
          <TriangleAlert size={15} strokeWidth={2} aria-hidden className="shrink-0 text-[var(--tg-red)]" />
          <span className="min-w-0 flex-1">Steam or PlayStation didn’t load, so their games are missing from these numbers.</span>
          <button type="button" onClick={p.onRetryProviders} className="tg-btn gap-1.5 px-3 text-[13px] text-[var(--tg-text)] [@media(hover:hover)]:hover:bg-[var(--tg-hover)]">
            <RotateCw size={14} strokeWidth={2} aria-hidden />Try again
          </button>
        </div>
      )}
    </div>
  )
}
