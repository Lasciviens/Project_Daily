import { HERO } from '../../../shared/ui'

// Football's header art (THEME.md §6.5): a pitch seen from above, a ball's
// curved path into the right-hand goal; fixture bars fade out on the left.

const A = HERO.accent
const M = HERO.muted

// The pitch: outline, halfway line, centre circle, both boxes and goals.
const PITCH = [
  'M300 14 H628 V126 H300 Z',
  'M464 14 V126',
  'M300 44 H336 V96 H300', 'M300 58 H314 V82 H300',
  'M628 44 H592 V96 H628', 'M628 58 H614 V82 H628',
].join(' ')

export function FootballHeroArt() {
  return (
    <>
      {/* Fixture bars, fading out */}
      <rect x="60" y="34" width="110" height="10" rx="5" className={M} opacity="0.7" />
      <rect x="104" y="56" width="150" height="10" rx="5" className={A} />
      <rect x="140" y="78" width="120" height="10" rx="5" className={M} />
      <rect x="190" y="100" width="80" height="10" rx="5" className={A} opacity="0.8" />

      <path d={PITCH} fill="none" className={HERO.mutedLine} strokeWidth="2" opacity="0.6" />
      <circle cx="464" cy="70" r="20" fill="none" className={HERO.mutedLine} strokeWidth="2" opacity="0.6" />
      <circle cx="464" cy="70" r="2.5" className={M} />
      <rect x="628" y="60" width="6" height="20" rx="1.5" className={A} />

      {/* The ball's path */}
      <path d="M402 108 Q520 8 622 66" fill="none" className={HERO.accentLine} strokeWidth="2.5" strokeDasharray="2 7" strokeLinecap="round" />
      <circle cx="402" cy="108" r="11" className={A} />
      <path d="M402 101 l6 4 l-2 7 h-8 l-2 -7 z" className={HERO.hole} />
    </>
  )
}
