import { HERO } from '../../../shared/ui'

// Food's header art (THEME.md §6.5): a plate with a salad between a fork and
// a knife, a herb sprig; a bowl and a cup fade out on the left.

const A = HERO.accent
const M = HERO.muted
const H = HERO.hole

/** A pointed leaf `len` long, centred on (x, y), turned `deg`, with its midrib. */
function Leaf({ x, y, len, deg, className, opacity }: { x: number; y: number; len: number; deg: number; className: string; opacity?: number }) {
  const h = len / 2, w = len * 0.32
  return (
    <g transform={`translate(${x} ${y}) rotate(${deg})`} opacity={opacity}>
      <path d={`M${-h} 0 C${-h / 2} ${-w} ${h / 2} ${-w} ${h} 0 C${h / 2} ${w} ${-h / 2} ${w} ${-h} 0 Z`} className={className} />
      <path d={`M${-h + 3} 0 H${h - 4}`} className={HERO.holeLine} strokeWidth="1.5" opacity="0.6" />
    </g>
  )
}

export function FoodHeroArt() {
  return (
    <>
      {/* Cup and steaming bowl, fading out */}
      <rect x="150" y="84" width="40" height="42" rx="6" className={M} />
      <path d="M190 94 a10 10 0 0 1 0 20" fill="none" className={HERO.mutedLine} strokeWidth="5" />
      <rect x="236" y="86" width="88" height="7" rx="3.5" className={M} />
      <path d="M240 93 h80 a40 33 0 0 1 -80 0 z" className={A} />
      <path d="M262 78 c-6 -8 6 -14 0 -24 M282 78 c-6 -8 6 -14 0 -24 M302 78 c-6 -8 6 -14 0 -24"
        fill="none" className={HERO.mutedLine} strokeWidth="3" strokeLinecap="round" />

      {/* Fork */}
      <path d="M384 22 v24 M392 22 v24 M400 22 v24" className={HERO.mutedLine} strokeWidth="4" strokeLinecap="round" />
      <path d="M381 44 h22 v6 a11 11 0 0 1 -22 0 z" className={M} />
      <rect x="389" y="56" width="6" height="70" rx="3" className={M} />

      {/* Plate and salad */}
      <circle cx="466" cy="74" r="52" className={M} />
      <circle cx="466" cy="74" r="40" className={H} opacity="0.55" />
      <Leaf x={452} y={64} len={34} deg={-35} className={A} />
      <Leaf x={481} y={83} len={30} deg={30} className={A} opacity={0.85} />
      <Leaf x={457} y={91} len={26} deg={-10} className={A} opacity={0.7} />
      <circle cx="477" cy="60" r="7" className={M} />
      <circle cx="444" cy="82" r="5" className={M} opacity="0.8" />

      {/* Knife */}
      <path d="M540 20 c11 8 13 32 10 54 h-10 z" className={M} />
      <rect x="540" y="72" width="10" height="54" rx="4" className={A} />

      {/* Herb sprig */}
      <path d="M598 126 C596 98 602 72 614 46" fill="none" className={HERO.accentLine} strokeWidth="3" strokeLinecap="round" />
      <Leaf x={588} y={104} len={24} deg={-35} className={A} />
      <Leaf x={612} y={90} len={24} deg={30} className={A} />
      <Leaf x={597} y={74} len={22} deg={-40} className={A} opacity={0.85} />
      <Leaf x={619} y={58} len={22} deg={30} className={A} opacity={0.85} />
    </>
  )
}
