import { HERO } from '../../../shared/ui'

// Books' header art (THEME.md §6.5): a shelf of book spines, one leaning,
// a bookend and an e-reader; a pile of books fades out on the left.

const A = HERO.accent
const M = HERO.muted
const H = HERO.hole
const SHELF = 126

// x, width, height, accent?, opacity
const SPINES: [number, number, number, boolean, number][] = [
  [296, 20, 76, true, 1], [318, 16, 92, false, 1], [336, 24, 70, true, 0.85], [362, 18, 98, false, 1],
  [382, 22, 82, true, 1], [406, 14, 64, false, 0.8], [470, 26, 88, true, 1], [498, 18, 72, false, 1],
  [518, 22, 94, true, 0.9], [542, 16, 80, false, 1],
]
// Two bands across each spine, near its top and its foot.
const BANDS = SPINES.map(([x, w, h]) => `M${x + 3} ${SHELF - h + 12} h${w - 6} M${x + 3} ${SHELF - 14} h${w - 6}`).join(' ')

export function BooksHeroArt() {
  return (
    <>
      {/* A pile of books, fading out */}
      <rect x="140" y="110" width="104" height="16" rx="2" className={M} />
      <rect x="150" y="94" width="88" height="16" rx="2" className={A} />
      <rect x="136" y="78" width="98" height="16" rx="2" className={M} opacity="0.8" />
      <path d="M150 118 h80 M164 102 h60 M148 86 h72" className={HERO.holeLine} strokeWidth="3" opacity="0.5" />

      {/* Shelf and spines */}
      <rect x="220" y={SHELF} width="420" height="6" rx="2" className={M} />
      {SPINES.map(([x, w, h, accent, opacity]) => (
        <rect key={x} x={x} y={SHELF - h} width={w} height={h} rx="2" className={accent ? A : M} opacity={opacity} />
      ))}
      <rect x="434" y={SHELF - 76} width="18" height="76" rx="2" className={M} transform={`rotate(-20 452 ${SHELF})`} />
      <path d={BANDS} className={HERO.holeLine} strokeWidth="3" opacity="0.5" />

      {/* Bookend */}
      <path d="M562 126 V70 a6 6 0 0 1 6 -6 h4 V126 Z" className={A} />

      {/* E-reader */}
      <rect x="590" y="44" width="42" height="82" rx="6" className={M} />
      <rect x="596" y="51" width="30" height="62" rx="2" className={H} opacity="0.6" />
      <path d="M600 60 h22 M600 68 h22 M600 76 h22 M600 84 h14" className={HERO.mutedLine} strokeWidth="2" />
    </>
  )
}
