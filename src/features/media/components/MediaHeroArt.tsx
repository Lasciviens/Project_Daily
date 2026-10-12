import { HERO } from '../../../shared/ui'

// Media's header art (THEME.md §6.5): a film strip with a play mark in its
// lit frame, a clapperboard on the faded left. It replaced the rotating TMDB
// backdrops (owner, 30.09.2026: "a general media image that is steady").

const A = HERO.accent
const M = HERO.muted
const H = HERO.hole
const FRAMES = [246, 336, 426, 516]

export function MediaHeroArt() {
  return (
    <>
      {/* Clapperboard */}
      <rect x="96" y="66" width="104" height="60" rx="4" className={M} />
      <path d="M108 84 h80 M108 98 h56 M108 112 h68" className={HERO.holeLine} strokeWidth="4" opacity="0.5" />
      <g transform="rotate(-14 96 62)">
        <rect x="96" y="48" width="104" height="16" rx="2" className={A} />
        <path d="M114 48 l-10 16 M138 48 l-10 16 M162 48 l-10 16 M186 48 l-10 16" className={HERO.holeLine} strokeWidth="6" opacity="0.6" />
      </g>

      {/* Film strip */}
      <g transform="rotate(-6 440 70)">
        <rect x="230" y="26" width="424" height="88" rx="8" className={M} />
        <path d="M240 36 H650 M240 104 H650" className={HERO.holeLine} strokeWidth="9" strokeDasharray="14 16" opacity="0.7" />
        {FRAMES.map(x => (
          <rect key={x} x={x} y="48" width="80" height="44" rx="4" className={x === 426 ? A : H} opacity={x === 426 ? 1 : 0.55} />
        ))}
        <path d="M456 58 L482 70 L456 82 Z" className={H} />
      </g>
    </>
  )
}
