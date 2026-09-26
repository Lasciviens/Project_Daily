import type { ReactNode } from 'react'
import { ImageOff, Search, Wand2 } from 'lucide-react'
import type { MatchBasis, SsCandidate, SsMediaEntry } from '../../../scraper/ssTypes'
import { SsImage } from '../../../scraper/SsImage'
import { ssMediaUrl } from '../../../scraper/ssApi'
import { pickMediaEntry } from '../../../scraper/ssRules'
import { mediaInfo } from '../../../scraper/ssMediaCatalog'
import { BASIS_LABEL } from './tgScrapeModel'

// Small building blocks shared by the Scrape page's pieces.

export function TgScrapeCard({ title, aside, children, className = '' }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`tg-panel p-4 ${className}`}>
      {(title || aside) && (
        <div className="mb-3 flex min-h-[28px] items-center justify-between gap-3">
          {title && <h2 className="tg-section-label">{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  )
}

/** A compact segmented choice. Options can be disabled with a reason. */
export function TgSegmented<T extends string>({ value, options, onChange, label, size = 'md' }: {
  value: T
  options: { value: T; label: string; disabled?: boolean; hint?: string }[]
  onChange: (v: T) => void
  label: string
  size?: 'sm' | 'md'
}) {
  const h = size === 'sm' ? 'min-h-[32px] px-2.5 text-[12px] [@media(pointer:coarse)]:min-h-[40px]' : 'min-h-[36px] px-3 text-[13px] [@media(pointer:coarse)]:min-h-[44px]'
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 self-start justify-self-start rounded-[10px] border border-[var(--tg-border)] bg-[var(--tg-panel-2)] p-0.5">
      {options.map(o => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={o.disabled}
            title={o.hint}
            onClick={() => onChange(o.value)}
            className={`${h} rounded-[8px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              on ? 'bg-[var(--tg-accent)] text-[var(--tg-on-accent)]' : 'text-[var(--tg-text-2)] [@media(hover:hover)]:hover:bg-[var(--tg-hover)]'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

const BASIS_TONE: Record<MatchBasis, string> = {
  hash: 'bg-[var(--tg-green-soft)] text-[var(--tg-green)]',
  filename: 'bg-[var(--tg-green-soft)] text-[var(--tg-green)]',
  serial: 'bg-[var(--tg-green-soft)] text-[var(--tg-green)]',
  id: 'bg-[var(--tg-blue-soft)] text-[var(--tg-blue)]',
  previous: 'bg-[var(--tg-blue-soft)] text-[var(--tg-blue)]',
  filename_guess: 'bg-[var(--tg-grey-soft)] text-[var(--tg-text-2)]',
  name: 'bg-[var(--tg-grey-soft)] text-[var(--tg-text-2)]',
}

/** How a result was found: ROM identity reads green (strong), a name grey (weak). */
export function TgBasisBadges({ basis }: { basis: MatchBasis[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {basis.map(b => (
        <span key={b} className={`inline-flex h-[20px] items-center rounded-md px-1.5 text-[10.5px] font-semibold uppercase tracking-[0.04em] ${BASIS_TONE[b]}`}>
          {BASIS_LABEL[b]}
        </span>
      ))}
    </span>
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
          className={`inline-flex h-[20px] items-center rounded-md px-1.5 text-[10.5px] font-semibold ${
            f === 'best dump' ? 'bg-[var(--tg-green-soft)] text-[var(--tg-green)]' : 'bg-[var(--tg-red-soft)] text-[var(--tg-red)]'
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
  candidate: Pick<SsCandidate, 'jeu_id' | 'system' | 'media_sig'>
  entry: SsMediaEntry | null
  width: number
  className?: string
  imgClassName?: string
  alt?: string
}) {
  const src = entry ? ssMediaUrl({ jeuId: candidate.jeu_id, systemId: candidate.system.id, sig: candidate.media_sig }, entry, { width, format: mediaInfo(entry.type).alpha ? 'png' : 'jpg' }) : null
  return (
    <SsImage
      src={src}
      proxied
      alt={alt}
      className={className}
      imgClassName={imgClassName}
      fallback={
        <span className="absolute inset-0 grid place-items-center rounded-[inherit] bg-[var(--tg-panel-2)] text-[var(--tg-faint)]">
          <ImageOff className="h-5 w-5" strokeWidth={1.6} aria-hidden />
        </span>
      }
    />
  )
}

/** A candidate's box front (else 3D box, else screenshot) as a small cover. */
export function TgCandidateCover({ candidate, regions, width = 160, className = '' }: {
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
    ? 'Pick a game on the left, then search. You can search without one too — you just cannot save.'
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
