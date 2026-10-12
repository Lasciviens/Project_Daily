import { HERO } from '../../../shared/ui'

// Home's art (THEME.md §6.5): a house under the sun with a tree and a
// cloud, a small town fading out on the left. It sits behind the top of the
// daily brief, the page's first card.

const A = HERO.accent
const M = HERO.muted
const H = HERO.hole

export function HomeHeroArt() {
  return (
    <>
      {/* Ground (it stops short of the right edge, under the brief's headline box) */}
      <rect x="0" y="126" width="600" height="5" rx="2.5" className={M} />

      {/* The town, fading out */}
      <rect x="24" y="64" width="34" height="62" rx="3" className={M} />
      <rect x="64" y="40" width="30" height="86" rx="3" className={A} />
      <rect x="100" y="78" width="42" height="48" rx="3" className={M} />
      <rect x="148" y="54" width="28" height="72" rx="3" className={M} opacity="0.8" />
      <rect x="182" y="88" width="46" height="38" rx="3" className={A} />
      <path d="M71 52 h16 M71 66 h16 M71 80 h16 M71 94 h16 M31 76 h20 M31 90 h20 M107 90 h28 M107 104 h28 M155 66 h14 M155 80 h14 M155 94 h14 M189 100 h32"
        className={HERO.holeLine} strokeWidth="4" opacity="0.5" />

      {/* A small tree */}
      <circle cx="300" cy="90" r="18" className={M} />
      <rect x="297" y="100" width="6" height="26" rx="2" className={M} />

      {/* The house: chimney, roof, walls, door, windows */}
      <rect x="466" y="40" width="14" height="28" rx="2" className={M} />
      <rect x="366" y="78" width="128" height="48" rx="2" className={M} />
      <path d="M352 82 L430 30 L508 82 Z" className={A} />
      <circle cx="430" cy="62" r="8" className={H} opacity="0.55" />
      <rect x="419" y="94" width="22" height="32" rx="3" className={H} opacity="0.6" />
      <rect x="378" y="90" width="28" height="20" rx="3" className={H} opacity="0.55" />
      <rect x="454" y="90" width="28" height="20" rx="3" className={H} opacity="0.55" />
      <path d="M392 90 v20 M378 100 h28 M468 90 v20 M454 100 h28" className={HERO.mutedLine} strokeWidth="2.5" />

      {/* A tree beside it */}
      <rect x="540" y="98" width="7" height="28" rx="2" className={M} />
      <circle cx="528" cy="100" r="13" className={A} opacity="0.85" />
      <circle cx="544" cy="86" r="20" className={A} />

      {/* Cloud and sun */}
      <rect x="494" y="40" width="54" height="12" rx="6" className={M} opacity="0.7" />
      <circle cx="508" cy="40" r="10" className={M} opacity="0.7" />
      <circle cx="526" cy="34" r="14" className={M} opacity="0.7" />
      <circle cx="590" cy="38" r="17" className={A} />
      <path d="M615 38h8 M608 56l6 6 M590 63v8 M572 56l-6 6 M565 38h-8 M572 20l-6 -6 M590 13v-8 M608 20l6 -6"
        className={HERO.accentLine} strokeWidth="4" strokeLinecap="round" />
    </>
  )
}
