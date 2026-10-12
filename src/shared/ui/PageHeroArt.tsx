import type { ReactNode, Ref } from 'react'
import { cx } from './cx'
import { HERO_ART_VIEWBOX, type HeroArtPlace } from './heroArtRules'
import { useHeroArt } from './useHeroArt'

// Header art (THEME.md §6.5): the shared layer and band. The canvas, the
// colour classes and the placement rule are in heroArtRules.ts, the
// measuring in useHeroArt.ts.

/**
 * The art layer: absolute, behind content, clipped to the host's rounded
 * corners. The host is `relative isolate` and its content `relative z-10`
 * (PageHeroBand does both). `place` puts the art in a free stretch of the
 * host (whatever reaches past the stretch's left fades out over 3rem);
 * `behind` = it sits behind the controls and texts, so it is drawn faint
 * enough that the faintest text (fg-muted) keeps 4.5:1 with every accent —
 * 0.04 on white, 0.14 on the dark surface (scripts/verify-hero-art.cjs
 * works it out from the tokens). `layerRef` is useHeroArt's.
 */
export function PageHeroArt({ children, place, behind = false, layerRef }: {
  children: ReactNode
  place?: HeroArtPlace
  behind?: boolean
  layerRef?: Ref<HTMLDivElement>
}) {
  const cut = place != null && place.left > 0
  return (
    <div ref={layerRef} aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-[inherit]">
      <div
        className={cx('absolute inset-0 overflow-hidden', cut && '[mask-image:linear-gradient(to_right,transparent,black_3rem)]')}
        style={place ? { left: place.left, right: place.right } : undefined}
      >
        <svg
          viewBox={HERO_ART_VIEWBOX}
          preserveAspectRatio="xMaxYMid meet"
          focusable="false"
          className={cx(
            'absolute right-0 top-0 h-full max-h-[6.5rem] w-auto [mask-image:linear-gradient(to_right,transparent,black_40%)]',
            behind ? 'opacity-[0.04] dark:opacity-[0.14]' : 'opacity-[0.22] dark:opacity-[0.26]',
          )}
        >
          {children}
        </svg>
      </div>
    </div>
  )
}

/**
 * A page's top band: one card holding the page's own controls with the art
 * behind them. PageHeader renders it when given `art`. The art sits in the
 * free space nearest the band's right edge (left of a button or a switcher
 * there); when the controls fill the band — a phone — it sits behind them,
 * faint, the way it always did on Media's search card.
 */
export function PageHeroBand({ art, children, className }: { art: ReactNode; children?: ReactNode; className?: string }) {
  const { layerRef, contentRef, place, behind } = useHeroArt()
  return (
    <div className={cx('card relative isolate flex min-h-[4.5rem] flex-col justify-center p-3 sm:min-h-[5.5rem]', className)}>
      <PageHeroArt layerRef={layerRef} place={place} behind={behind}>{art}</PageHeroArt>
      <div ref={contentRef} className="relative z-10 min-w-0">{children}</div>
    </div>
  )
}
