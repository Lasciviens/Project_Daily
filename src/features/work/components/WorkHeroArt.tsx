import { HERO } from '../../../shared/ui'

// Work's header art (THEME.md §6.5): a desk with a laptop showing a chart,
// a stack of papers, a mug and a plant; a desk lamp fades out on the left.

const A = HERO.accent
const M = HERO.muted
const H = HERO.hole

export function WorkHeroArt() {
  return (
    <>
      {/* Desk */}
      <rect x="200" y="112" width="440" height="7" rx="3" className={M} />
      <rect x="226" y="119" width="7" height="21" className={M} />
      <rect x="610" y="119" width="7" height="21" className={M} />

      {/* Lamp, fading out */}
      <rect x="216" y="106" width="36" height="6" rx="2" className={M} />
      <path d="M234 106 L252 70 L222 46" fill="none" className={HERO.mutedLine} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M200 52 L226 30 L238 52 Z" className={A} transform="rotate(-20 222 46)" />

      {/* Papers */}
      <rect x="294" y="104" width="62" height="8" rx="2" className={M} />
      <rect x="300" y="96" width="56" height="8" rx="2" className={A} opacity="0.85" />
      <rect x="292" y="88" width="60" height="8" rx="2" className={M} opacity="0.8" />

      {/* Laptop with a chart */}
      <rect x="392" y="32" width="116" height="74" rx="6" className={M} />
      <rect x="400" y="40" width="100" height="58" rx="2" className={H} opacity="0.6" />
      <path d="M410 50 h40" className={HERO.mutedLine} strokeWidth="3" strokeLinecap="round" />
      <rect x="412" y="78" width="10" height="14" rx="1" className={A} />
      <rect x="428" y="68" width="10" height="24" rx="1" className={A} />
      <rect x="444" y="58" width="10" height="34" rx="1" className={A} />
      <rect x="460" y="72" width="10" height="20" rx="1" className={A} opacity="0.8" />
      <path d="M380 106 h140 l6 6 h-152 z" className={A} />

      {/* Mug */}
      <rect x="546" y="82" width="30" height="30" rx="5" className={A} />
      <path d="M576 88 a9 9 0 0 1 0 18" fill="none" className={HERO.accentLine} strokeWidth="5" />
      <path d="M555 74 c-4 -6 4 -10 0 -16 M567 74 c-4 -6 4 -10 0 -16" fill="none" className={HERO.mutedLine} strokeWidth="3" strokeLinecap="round" />

      {/* Plant */}
      <ellipse cx="616" cy="72" rx="6" ry="15" className={M} />
      <ellipse cx="605" cy="80" rx="5" ry="13" className={M} transform="rotate(-35 605 80)" />
      <ellipse cx="627" cy="80" rx="5" ry="13" className={M} transform="rotate(35 627 80)" />
      <path d="M602 112 l4 -22 h20 l4 22 z" className={A} />
    </>
  )
}
