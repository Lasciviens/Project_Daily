import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { ImageOff, RotateCcw, Search, Wand2 } from 'lucide-react'
import type { MatchBasis, SsCandidate, SsMediaEntry } from '../../../scraper/ssTypes'
import { SsImage } from '../../../scraper/SsImage'
import { refOf, ssMediaUrl } from '../../../scraper/ssApi'
import { pickMediaEntry } from '../../../scraper/ssRules'
import { mediaInfo } from '../../../scraper/ssMediaCatalog'
import { EXACT_BASES } from '../../../scraper/ssPlan'
import { BASIS_LABEL } from './tgScrapeModel'

// Small building blocks shared by the Scrape page's pieces.

export function TgScrapeCard({ title, aside, children, className = '' }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`tg-panel p-4 ${className}`}>
      {(title || aside) && (
        <div className="mb-3 flex min-h-[28px] flex-wrap items-center justify-between gap-x-3 gap-y-1">
          {title && <h2 className="tg-section-label">{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  )
}

/**
 * A compact segmented choice. The selected option uses the page's soft
 * "active segment" look — only a page's one commit button is solid accent.
 * 44px tall on touch screens.
 */
export function TgSegmented<T extends string>({ value, options, onChange, label, size = 'md' }: {
  value: T
  options: { value: T; label: string; disabled?: boolean; hint?: string }[]
  onChange: (v: T) => void
  label: string
  size?: 'sm' | 'md'
}) {
  const h = size === 'sm' ? 'min-h-[32px] px-2.5 text-[12px]' : 'min-h-[36px] px-3 text-[13px]'
  const group = useRef<HTMLDivElement>(null)
  // A radio group is one Tab stop; the arrows (and Home/End) move and select,
  // skipping disabled options, as the radio pattern promises.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const enabled = options.filter(o => !o.disabled)
    if (!enabled.length) return
    const at = enabled.findIndex(o => o.value === value)
    let next: number
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (at + 1) % enabled.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (at - 1 + enabled.length) % enabled.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = enabled.length - 1
    else return
    e.preventDefault()
    const v = enabled[next].value
    onChange(v)
    group.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(v)}"]`)?.focus()
  }
  const focusable = options.some(o => o.value === value && !o.disabled) ? value : options.find(o => !o.disabled)?.value
  return (
    // Never squeezed by its neighbours (shrink-0), but never wider than its
    // box either (max-w-full): only a genuinely narrow box truncates a label.
    <div ref={group} role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className="inline-flex max-w-full shrink-0 self-start justify-self-start rounded-[10px] border border-[var(--tg-border)] bg-[var(--tg-panel-2)] p-0.5">
      {options.map(o => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            data-value={o.value}
            tabIndex={o.value === focusable ? 0 : -1}
            disabled={o.disabled}
            title={o.hint}
            onClick={() => onChange(o.value)}
            className={`${h} min-w-0 truncate rounded-[8px] font-semibold transition-colors [@media(pointer:coarse)]:min-h-[44px] disabled:cursor-not-allowed disabled:opacity-40 ${
              on
                ? 'bg-[var(--tg-seg-active-bg,var(--tg-accent-soft))] text-[var(--tg-nav-active-text,var(--tg-accent))] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--tg-accent)_35%,transparent)]'
                : 'text-[var(--tg-text-2)] [@media(hover:hover)]:hover:bg-[var(--tg-hover)]'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** An on/off switch in the page's style (no native checkbox). */
export function TgSwitch({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left"
    >
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-[var(--tg-text)]">{label}</span>
        {hint && <span className="block text-[11.5px] leading-snug tg-muted">{hint}</span>}
      </span>
      <span aria-hidden className={`relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors ${on ? 'bg-[var(--tg-accent)]' : 'bg-[var(--tg-border-strong)]'}`}>
        <span className={`absolute top-[3px] h-5 w-5 rounded-full bg-white shadow transition-[left] ${on ? 'left-[21px]' : 'left-[3px]'}`} />
      </span>
    </button>
  )
}

const EXACT_TONE = 'bg-[var(--tg-green-soft)] text-[var(--tg-green)]'
const SOFT_TONE = 'bg-[var(--tg-grey-soft)] text-[var(--tg-text-2)]'
const toneOf = (b: MatchBasis) => (EXACT_BASES.includes(b) ? EXACT_TONE : b === 'previous' ? 'bg-[var(--tg-blue-soft)] text-[var(--tg-blue)]' : SOFT_TONE)

/** How a result was found: ROM identity reads green (strong), a name or a
 *  filename guess grey (weak), the previous match blue. */
export function TgBasisBadges({ basis }: { basis: MatchBasis[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {basis.map(b => (
        <span key={b} className={`inline-flex h-[22px] items-center rounded-md px-1.5 text-[11px] font-semibold ${toneOf(b)}`}>
          {BASIS_LABEL[b]}
        </span>
      ))}
    </span>
  )
}

/** A neutral chip (system, "your system"). */
export function TgChip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' }) {
  return (
    <span className={`inline-flex h-[22px] items-center rounded-md px-1.5 text-[11px] font-semibold ${
      tone === 'good' ? EXACT_TONE : 'border border-[var(--tg-border)] bg-[var(--tg-panel)] text-[var(--tg-text-2)]'
    }`}>{children}</span>
  )
}

/** Hack, beta, prototype, not-a-game: the markers that expose a wrong match. */
export function TgFlagChips({ flags }: { flags: string[] }) {
  if (!flags.length) return null
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map(f => (
        <span
          key={f}
          className={`inline-flex h-[22px] items-center rounded-md px-1.5 text-[11px] font-semibold ${
            f === 'best dump' ? EXACT_TONE : 'bg-[var(--tg-red-soft)] text-[var(--tg-red)]'
          }`}
        >
          {f}
        </span>
      ))}
    </span>
  )
}

/** One file of a candidate through the proxy, with a drawn placeholder. */
export function TgSsMedia({ candidate, entry, width, className = '', imgClassName = 'h-full w-full object-contain', alt = '' }: {
  candidate: Pick<SsCandidate, 'jeu_id' | 'system' | 'media_sig' | 'media_exp'>
  entry: SsMediaEntry | null
  width: number
  className?: string
  imgClassName?: string
  alt?: string
}) {
  const src = entry ? ssMediaUrl(refOf(candidate), entry, { width, format: mediaInfo(entry.type).alpha ? 'png' : 'jpg' }) : null
  return (
    <SsImage
      src={src}
      proxied
      alt={alt}
      className={className}
      imgClassName={imgClassName}
      fallback={(state, retry) => state === 'loading'
        // Waiting in the queue (3 at a time) is not "no image".
        ? <span aria-label="Loading" className="tg-skeleton absolute inset-0 rounded-[inherit]" />
        : state === 'missing'
          ? (
            <span title="ScreenScraper has no such file" className="absolute inset-0 grid place-items-center rounded-[inherit] bg-[var(--tg-panel-2)] text-[var(--tg-faint)]">
              <ImageOff className="h-5 w-5" strokeWidth={1.6} aria-hidden />
            </span>
          )
          : (
            // Their servers were busy: tap to try again (a span — the tile may itself be a button).
            <span
              role="button" tabIndex={0} aria-label="Could not load — try again"
              onClick={e => { e.stopPropagation(); e.preventDefault(); retry() }}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); retry() } }}
              className="absolute inset-0 grid cursor-pointer place-items-center rounded-[inherit] bg-[var(--tg-panel-2)] text-[var(--tg-muted)]"
            >
              <RotateCcw className="h-5 w-5" strokeWidth={1.8} aria-hidden />
            </span>
          )}
    />
  )
}

/** A candidate's box front (else 3D box, else screenshot) as a small cover. */
export function TgCandidateCover({ candidate, regions, width = 200, className = '' }: {
  candidate: SsCandidate
  regions: string[]
  width?: number
  className?: string
}) {
  const entry = pickMediaEntry(candidate.media, 'box-2D', regions)
    ?? pickMediaEntry(candidate.media, 'box-3D', regions)
    ?? pickMediaEntry(candidate.media, 'ss', regions)
  return <TgSsMedia candidate={candidate} entry={entry} width={width} className={className} alt={`${candidate.values.title ?? 'Game'} cover`} />
}

export function TgScrapeEmpty({ hasTarget, hasResults }: { hasTarget: boolean; hasResults: boolean }) {
  const Icon = hasResults ? Search : Wand2
  const text = !hasTarget
    ? 'Pick a game on the left, then search. You can search without one too — you can look, just not save.'
    : hasResults ? 'Open a result to compare it with your game and choose what to save.'
    : 'Search by name, by ROM file or hash, or by ScreenScraper id.'
  return (
    <div className="tg-panel grid min-h-[260px] place-items-center p-8 text-center">
      <div className="max-w-sm">
        <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-[var(--tg-accent-soft)] text-[var(--tg-accent)]">
          <Icon className="h-6 w-6" strokeWidth={1.8} aria-hidden />
        </span>
        <p className="text-[13.5px] leading-relaxed text-[var(--tg-text-2)]">{text}</p>
      </div>
    </div>
  )
}

/** "Data and media from ScreenScraper.fr" — their media is CC BY-NC-SA. */
export function TgSsAttribution({ className = '' }: { className?: string }) {
  return (
    <p className={`text-[11px] leading-snug tg-faint ${className}`}>
      Data and media from{' '}
      <a href="https://www.screenscraper.fr" target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2">ScreenScraper.fr</a>
      {' '}(CC BY-NC-SA).
    </p>
  )
}
