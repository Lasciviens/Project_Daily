import { HERO } from '../../../shared/ui'

// Personal's header art (THEME.md §6.5): a planner — a month page with a few
// days marked and today circled, a checklist, a clock; sticky notes fade
// out on the left.

const A = HERO.accent
const M = HERO.muted
const H = HERO.hole

// The month grid: 7 × 4 cells, 20 × 15.5, from (382, 58).
const GRID = 'M402 58v62 M422 58v62 M442 58v62 M462 58v62 M482 58v62 M502 58v62 M382 73.5h140 M382 89h140 M382 104.5h140'

export function DailyHeroArt() {
  return (
    <>
      {/* Sticky notes, fading out */}
      <rect x="120" y="58" width="54" height="54" rx="4" className={A} opacity="0.8" transform="rotate(-8 147 85)" />
      <rect x="170" y="70" width="50" height="50" rx="4" className={M} transform="rotate(6 195 95)" />
      <path d="M132 76 h28 M132 88 h22 M180 86 h28 M180 98 h20" className={HERO.holeLine} strokeWidth="4" opacity="0.5" />

      {/* Checklist */}
      <rect x="262" y="40" width="84" height="84" rx="6" className={M} opacity="0.9" />
      <rect x="272" y="50" width="11" height="11" rx="2" className={H} opacity="0.65" />
      <rect x="272" y="68" width="11" height="11" rx="2" className={H} opacity="0.65" />
      <rect x="272" y="86" width="11" height="11" rx="2" className={H} opacity="0.65" />
      <rect x="272" y="104" width="11" height="11" rx="2" className={H} opacity="0.65" />
      <path d="M290 55.5 h44 M290 73.5 h36 M290 91.5 h44 M290 109.5 h30" className={HERO.holeLine} strokeWidth="4" strokeLinecap="round" opacity="0.55" />
      <path d="M274 55 l3 3 l5 -6 M274 73 l3 3 l5 -6" fill="none" className={HERO.accentLine} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

      {/* The month page */}
      <rect x="372" y="28" width="160" height="100" rx="8" className={M} />
      <path d="M380 28 h144 a8 8 0 0 1 8 8 v16 h-160 v-16 a8 8 0 0 1 8 -8 z" className={A} />
      <rect x="396" y="16" width="8" height="22" rx="4" className={M} />
      <rect x="500" y="16" width="8" height="22" rx="4" className={M} />
      <rect x="382" y="58" width="140" height="62" rx="4" className={H} opacity="0.6" />
      <path d={GRID} className={HERO.mutedLine} strokeWidth="2" />
      <rect x="405" y="61" width="14" height="10" rx="2" className={A} />
      <rect x="485" y="76.5" width="14" height="10" rx="2" className={A} />
      <rect x="425" y="107.5" width="14" height="10" rx="2" className={A} opacity="0.8" />
      <circle cx="472" cy="96.75" r="8" fill="none" className={HERO.accentLine} strokeWidth="3" />

      {/* Clock */}
      <circle cx="584" cy="78" r="30" className={A} />
      <circle cx="584" cy="78" r="23" className={H} opacity="0.6" />
      <path d="M584 59v5 M603 78h-5 M584 97v-5 M565 78h5" className={HERO.mutedLine} strokeWidth="3" strokeLinecap="round" />
      <path d="M584 78 V64 M584 78 L595 85" className={HERO.mutedLine} strokeWidth="4" strokeLinecap="round" />
    </>
  )
}
