// A still, drawn shop shelf behind Shop's header (owner, 08.10.2026: "a
// background picture, not fully bright"): boxes, a bag, a receipt, a price
// tag. Drawn in the theme's own colours, dimmed, and faded out on the left so
// the controls stay clean — no network, no timers, the same in both themes.
// Tablet and wider only: on a phone the controls fill the panel.

const ACCENT = 'fill-accent-500'
const MUTED = 'fill-fg-muted'
const HOLE = 'fill-surface'

export function ShopHeroArt() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-[inherit] max-sm:hidden">
      <svg
        viewBox="0 0 880 140"
        preserveAspectRatio="xMaxYMid meet"
        className="absolute inset-y-0 right-0 h-full w-auto opacity-[0.3] [mask-image:linear-gradient(to_right,transparent,black_30%)] dark:opacity-[0.34]"
      >
        <Shelf x={0} />
        <Shelf x={440} swap />
      </svg>
    </div>
  )
}

/** One shelf unit (440 × 140); `swap` trades the two colours so a repeat does not look copied. */
function Shelf({ x, swap }: { x: number; swap?: boolean }) {
  const a = swap ? MUTED : ACCENT
  const m = swap ? ACCENT : MUTED
  const sa = swap ? 'stroke-fg-muted' : 'stroke-accent-500'
  const sm = swap ? 'stroke-accent-500' : 'stroke-fg-muted'
  return (
    <g transform={`translate(${x - 200} 0)`}>
          {/* Shelves */}
          <rect x="216" y="62" width="424" height="6" rx="2" className={m} />
          <rect x="216" y="126" width="424" height="6" rx="2" className={m} />

          {/* Top shelf: a taped box, a tall box, a jar, books, a box, headphones, a small box */}
          <rect x="232" y="30" width="48" height="32" rx="3" className={a} />
          <rect x="253" y="30" width="6" height="32" className={HOLE} opacity="0.5" />
          <rect x="288" y="12" width="30" height="50" rx="3" className={m} />
          <rect x="293" y="22" width="20" height="12" rx="2" className={HOLE} opacity="0.55" />
          <rect x="328" y="32" width="26" height="30" rx="7" className={a} />
          <rect x="330" y="25" width="22" height="8" rx="2" className={m} />
          <rect x="364" y="52" width="44" height="10" rx="2" className={m} />
          <rect x="368" y="42" width="38" height="10" rx="2" className={a} />
          <rect x="366" y="32" width="40" height="10" rx="2" className={m} opacity="0.8" />
          <rect x="418" y="22" width="58" height="40" rx="3" className={m} />
          <path d="M418 34 H476 M447 22 V62" className="stroke-surface" strokeWidth="5" opacity="0.5" />
          <path d="M494 54 a24 24 0 0 1 48 0" fill="none" className={sa} strokeWidth="6" strokeLinecap="round" />
          <rect x="488" y="46" width="14" height="16" rx="5" className={a} />
          <rect x="534" y="46" width="14" height="16" rx="5" className={a} />
          <rect x="560" y="38" width="36" height="24" rx="3" className={m} />

          {/* A price tag hanging from the top shelf */}
          <path d="M606 68 v8" className={sm} strokeWidth="2" />
          <path d="M596 76 h22 v20 l-11 9 l-11 -9 z" className={a} />
          <circle cx="607" cy="82" r="2.5" className={HOLE} />

          {/* Bottom shelf: a shopping bag, a gift, a receipt, stacked boxes, a game controller, a bottle, a phone box */}
          <rect x="236" y="86" width="46" height="40" rx="3" className={a} />
          <path d="M249 86 v-6 a10 10 0 0 1 20 0 v6" fill="none" className={sa} strokeWidth="4" />
          <rect x="292" y="96" width="40" height="30" rx="3" className={m} />
          <rect x="309" y="96" width="6" height="30" className={HOLE} opacity="0.55" />
          <path d="M312 96 c-10 -12 -18 -2 0 0 c10 -12 18 -2 0 0" fill="none" className={sm} strokeWidth="3" />
          <path d="M344 76 h34 v46 l-5.7 4 l-5.6 -4 l-5.7 4 l-5.7 -4 l-5.6 4 l-5.7 -4 z" className={m} opacity="0.85" />
          <path d="M350 86 h22 M350 94 h22 M350 102 h14 M350 112 h22" className="stroke-surface" strokeWidth="3" opacity="0.6" />
          <rect x="392" y="100" width="44" height="26" rx="3" className={a} />
          <rect x="398" y="80" width="32" height="20" rx="3" className={m} />
          <rect x="448" y="102" width="62" height="24" rx="12" className={m} />
          <path d="M462 110 v8 M458 114 h8" className="stroke-surface" strokeWidth="3" opacity="0.7" />
          <circle cx="492" cy="111" r="3" className={HOLE} opacity="0.7" />
          <circle cx="499" cy="117" r="3" className={HOLE} opacity="0.7" />
          <rect x="522" y="90" width="18" height="36" rx="5" className={a} />
          <rect x="527" y="80" width="8" height="12" rx="2" className={a} />
          <rect x="552" y="92" width="30" height="34" rx="3" className={m} />
          <rect x="560" y="98" width="14" height="22" rx="3" className={HOLE} opacity="0.5" />
          <rect x="594" y="108" width="38" height="18" rx="3" className={a} opacity="0.85" />
    </g>
  )
}
