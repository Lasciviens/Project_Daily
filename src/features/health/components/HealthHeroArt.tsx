import { HERO } from '../../../shared/ui'

// Health's header art (THEME.md §6.5): a heartbeat line running into a
// heart, a plus; activity rings fade out on the left.

const A = HERO.accent
const M = HERO.muted

// Three rings: radius and the share closed.
const RINGS = [[40, 0.7], [28, 0.6], [16, 0.85]] as const

export function HealthHeroArt() {
  return (
    <>
      {/* Activity rings, fading out */}
      {RINGS.map(([r, share]) => {
        const c = 2 * Math.PI * r
        return (
          <g key={r}>
            <circle cx="150" cy="70" r={r} fill="none" className={HERO.mutedLine} strokeWidth="8" opacity="0.45" />
            <circle cx="150" cy="70" r={r} fill="none" className={HERO.accentLine} strokeWidth="8" strokeLinecap="round"
              strokeDasharray={`${c * share} ${c}`} transform="rotate(-90 150 70)" />
          </g>
        )
      })}

      {/* Heartbeat */}
      <path d="M210 84 H360 l10 -14 l10 14 h12 l8 -46 l12 82 l10 -36 h14 l10 -10 l10 10 H640"
        fill="none" className={HERO.accentLine} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />

      {/* Heart */}
      <path d="M560 74 C532 54 528 26 548 22 C556 20 560 28 560 32 C560 28 564 20 572 22 C592 26 588 54 560 74 Z" className={A} />

      {/* Plus */}
      <rect x="594" y="104" width="26" height="8" rx="2" className={M} />
      <rect x="603" y="95" width="8" height="26" rx="2" className={M} />
      <rect x="486" y="98" width="16" height="5" rx="2" className={M} opacity="0.8" />
      <rect x="491.5" y="92.5" width="5" height="16" rx="2" className={M} opacity="0.8" />
    </>
  )
}
