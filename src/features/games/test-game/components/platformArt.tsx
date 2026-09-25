import {
  Archive, ChartColumn, CircleCheckBig, Gamepad2, Heart, LibraryBig, Shapes, SlidersHorizontal, SquarePlay,
  type LucideIcon,
} from 'lucide-react'
import { platformInfo, type PlatformFamily } from '../testGameModel'
import type { TgHeaderLogo } from '../tgTypes'
import {
  PLATFORM_GLYPHS, PS_LINE_LAST, PS_LINE_P, PS_LINE_S, textWordmark, wordmarkSizeClass,
} from './platformArtData'

/** A recognisable glyph per platform family, drawn in currentColor. */
export function PlatformIcon({ family, className }: { family: PlatformFamily; className?: string }) {
  const parts = PLATFORM_GLYPHS[family] ?? PLATFORM_GLYPHS.other
  return (
    <svg
      viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2.2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}
    >
      {parts.map((p, i) => {
        if ('f' in p) {
          const k = p.s ?? 1
          const shift = Math.round((12 - 12 * k) * 1000) / 1000
          return (
            <path
              key={i} d={p.f} fill="currentColor" stroke="none"
              transform={k === 1 ? undefined : `matrix(${k} 0 0 ${k} ${shift} ${shift})`}
            />
          )
        }
        if ('d' in p) return <path key={i} d={p.d} />
        if ('c' in p) return <circle key={i} cx={p.c[0]} cy={p.c[1]} r={p.c[2]} />
        const [x, y, width, height, rx] = p.r
        return <rect key={i} x={x} y={y} width={width} height={height} rx={rx} />
      })}
    </svg>
  )
}

/**
 * The header logo. The PlayStation family gets the design's thin geometric
 * line mark ("PS2"); every other platform a heavy, letter-spaced text mark
 * tinted by its brand colour — mixed with the text token so it stays readable
 * in both themes whatever the brand hex is.
 */
export function PlatformWordmark({ platformKey, className = '' }: { platformKey: string; className?: string }) {
  const info = platformInfo(platformKey)
  const last = PS_LINE_LAST[info.key]
  if (last) {
    return (
      <svg
        viewBox="0 0 105 20" width={124} height={24} fill="none" stroke="currentColor" strokeWidth={1.9}
        strokeLinecap="butt" strokeLinejoin="miter" role="img" aria-label={info.name}
        className={`text-[var(--tg-nav-active-text)] ${className}`}
      >
        <path d={PS_LINE_P} />
        <path d={PS_LINE_S} />
        <path d={last} />
      </svg>
    )
  }

  const mark = textWordmark(info.key, info.short)
  return (
    <span role="img" aria-label={info.name} className={`inline-flex flex-col justify-center leading-none ${className}`}>
      {mark.prefix && (
        <span aria-hidden className="mb-1 text-[9px] font-semibold uppercase tracking-[0.28em] text-[var(--tg-muted)]">
          {mark.prefix}
        </span>
      )}
      <span
        aria-hidden
        className={`whitespace-nowrap font-black ${wordmarkSizeClass(mark.main)}`}
        style={{ color: `color-mix(in srgb, ${info.brand} 45%, var(--tg-text))` }}
      >
        {mark.main}
        {mark.suffix && <span className="ml-1 font-light">{mark.suffix}</span>}
      </span>
    </span>
  )
}

const SECTION_ICONS: Record<TgHeaderLogo, LucideIcon> = {
  platform: Gamepad2,
  all: LibraryBig,
  others: Shapes,
  queue: SquarePlay,
  wishlist: Heart,
  completed: CircleCheckBig,
  backlog: Archive,
  analytics: ChartColumn,
  advanced: SlidersHorizontal,
}

/** The header glyph for views that are not a single platform. */
export function SectionGlyph({ logo, className = '' }: { logo: TgHeaderLogo; className?: string }) {
  const Icon = SECTION_ICONS[logo] ?? Gamepad2
  return (
    <span
      aria-hidden
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--tg-border)] bg-[var(--tg-panel-2)] text-[var(--tg-accent)] ${className}`}
    >
      <Icon className="h-5 w-5" strokeWidth={1.9} />
    </span>
  )
}

/**
 * The sidebar's solid "Game Library" gamepad. Its two buttons mix the accent
 * with the sidebar colour: deep blue on the light pad in dark mode, pale blue
 * on the dark pad in light mode — the design's two variants from one token.
 */
export function GameLibraryMark({ className }: { className?: string }) {
  const eye = { fill: 'color-mix(in srgb, var(--tg-accent) 58%, var(--tg-sidebar))' }
  return (
    <svg viewBox="0 0 24 24" width={26} height={26} aria-hidden className={className}>
      <path
        fill="currentColor"
        d="M6.9 5h10.2c2.3 0 4.2 1.6 4.7 3.8l1.3 6.3c.4 2.3-1.3 4.4-3.6 4.4-1.2 0-2.3-.6-3-1.5L15 16.2H9l-1.5 1.8c-.7.9-1.8 1.5-3 1.5-2.3 0-4-2.1-3.6-4.4l1.3-6.3C2.7 6.6 4.6 5 6.9 5Z"
      />
      <circle cx={8.2} cy={10.6} r={1.95} style={eye} />
      <circle cx={15.8} cy={10.6} r={1.95} style={eye} />
    </svg>
  )
}
