import { HERO } from '../../../shared/ui'

// Projects' header art (THEME.md §6.5): a board of three columns of cards on
// blueprint paper; timeline bars fade out on the left.

const A = HERO.accent
const M = HERO.muted

const GRID = [
  ...Array.from({ length: 20 }, (_, i) => `M${16 + i * 32} 0 V140`),
  ...Array.from({ length: 5 }, (_, i) => `M0 ${14 + i * 28} H640`),
].join(' ')

// Column x, then each card: y, height, accent?, opacity
const COLUMNS: [number, [number, number, boolean, number][]][] = [
  [330, [[34, 26, false, 1], [66, 34, true, 0.85], [106, 22, false, 0.7]]],
  [434, [[34, 38, true, 1], [78, 26, false, 1]]],
  [538, [[34, 26, false, 0.85], [66, 26, false, 0.7]]],
]
// A line of "text" on each card.
const CARD_LINES = COLUMNS.flatMap(([x, cards]) => cards.map(([y]) => `M${x + 10} ${y + 10} h${44}`)).join(' ')

export function ProjectsHeroArt() {
  return (
    <>
      <path d={GRID} className={HERO.mutedLine} strokeWidth="1" opacity="0.35" />

      {/* Timeline bars, fading out */}
      <rect x="60" y="30" width="120" height="10" rx="5" className={A} />
      <rect x="110" y="52" width="140" height="10" rx="5" className={M} />
      <rect x="150" y="74" width="110" height="10" rx="5" className={A} opacity="0.8" />
      <rect x="200" y="96" width="90" height="10" rx="5" className={M} />
      <path d="M296 110 l8 -8 l8 8 l-8 8 z" className={A} />

      {/* The board */}
      {COLUMNS.map(([x, cards]) => (
        <g key={x}>
          <rect x={x} y="16" width="46" height="9" rx="4.5" className={M} />
          {cards.map(([y, h, accent, opacity]) => (
            <rect key={y} x={x} y={y} width="92" height={h} rx="5" className={accent ? A : M} opacity={opacity} />
          ))}
        </g>
      ))}
      <path d={CARD_LINES} className={HERO.holeLine} strokeWidth="4" strokeLinecap="round" opacity="0.6" />
      <circle cx="616" cy="47" r="8" className={A} />
      <path d="M612 47 l3 3 l5 -6" fill="none" className={HERO.holeLine} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  )
}
