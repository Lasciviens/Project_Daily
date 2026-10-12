import { HERO } from '../../../shared/ui'

// Wishes' header art (THEME.md §6.5): snowy mountains with a cabin at their
// foot, pines and a map pin — places to go; a dashed route winds in from the
// faded left.

const A = HERO.accent
const M = HERO.muted
const H = HERO.hole

const STAR = 'l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3 l8 -3 z'

export function WishesHeroArt() {
  return (
    <>
      {/* The route, fading out */}
      <path d="M24 116 C84 84 124 132 184 98 S248 44 300 62" fill="none" className={HERO.mutedLine} strokeWidth="4" strokeDasharray="8 8" strokeLinecap="round" />
      <path d="M18 110 l12 12 M30 110 l-12 12" className={HERO.accentLine} strokeWidth="4" strokeLinecap="round" />
      <path d={`M352 20 ${STAR}`} className={M} />
      <path d={`M486 10 ${STAR}`} className={M} opacity="0.8" />

      {/* Pines */}
      <path d="M282 126 l16 -40 l16 40 Z" className={A} />
      <path d="M306 126 l12 -30 l12 30 Z" className={M} />

      {/* Mountains with snow */}
      <path d="M328 126 L430 30 L532 126 Z" className={M} />
      <path d="M430 30 L452 51 L441 47 L430 56 L419 47 L408 51 Z" className={H} opacity="0.6" />
      <path d="M452 126 L542 50 L632 126 Z" className={A} />
      <path d="M542 50 L560 65 L550 62 L542 69 L534 62 L524 65 Z" className={H} opacity="0.6" />

      {/* Cabin */}
      <rect x="420" y="88" width="6" height="12" rx="1" className={A} />
      <rect x="384" y="104" width="44" height="22" rx="1" className={H} opacity="0.7" />
      <path d="M378 106 L406 86 L434 106 Z" className={A} />
      <rect x="400" y="112" width="12" height="14" rx="1" className={A} />

      {/* Map pin */}
      <path d="M604 58 C594 46 588 38 588 30 a16 16 0 0 1 32 0 C620 38 614 46 604 58 Z" className={A} />
      <circle cx="604" cy="30" r="6" className={H} opacity="0.8" />

      {/* Ground */}
      <rect x="230" y="126" width="410" height="5" rx="2.5" className={M} />
    </>
  )
}
