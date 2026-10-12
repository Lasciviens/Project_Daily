import { HERO } from '../../../shared/ui'

// Training's header art (THEME.md §6.5): a loaded barbell on a rack, a
// dumbbell and a kettlebell on the floor; weight plates and a water bottle
// fade out on the left.

const A = HERO.accent
const M = HERO.muted
const H = HERO.hole

export function TrainingHeroArt() {
  return (
    <>
      {/* Floor */}
      <rect x="0" y="126" width="640" height="5" rx="2.5" className={M} />

      {/* Plates and a bottle, fading out */}
      <circle cx="110" cy="94" r="32" className={M} />
      <circle cx="110" cy="94" r="7" className={H} opacity="0.6" />
      <circle cx="152" cy="104" r="22" className={A} />
      <circle cx="152" cy="104" r="5" className={H} opacity="0.6" />
      <rect x="188" y="78" width="16" height="48" rx="5" className={A} opacity="0.8" />
      <rect x="191" y="70" width="10" height="10" rx="2" className={M} />

      {/* Dumbbell */}
      <rect x="232" y="112" width="56" height="5" rx="2" className={M} />
      <rect x="220" y="102" width="14" height="24" rx="3" className={A} />
      <rect x="286" y="102" width="14" height="24" rx="3" className={A} />

      {/* Rack */}
      <rect x="378" y="28" width="8" height="98" rx="2" className={M} opacity="0.8" />
      <rect x="524" y="28" width="8" height="98" rx="2" className={M} opacity="0.8" />
      <rect x="378" y="66" width="16" height="6" rx="2" className={M} />
      <rect x="516" y="66" width="16" height="6" rx="2" className={M} />

      {/* Barbell */}
      <rect x="290" y="60" width="330" height="6" rx="3" className={M} />
      <rect x="322" y="26" width="16" height="74" rx="4" className={A} />
      <rect x="340" y="36" width="12" height="54" rx="3" className={M} />
      <rect x="354" y="54" width="8" height="18" rx="2" className={M} />
      <rect x="572" y="26" width="16" height="74" rx="4" className={A} />
      <rect x="558" y="36" width="12" height="54" rx="3" className={M} />
      <rect x="548" y="54" width="8" height="18" rx="2" className={M} />

      {/* Kettlebell */}
      <path d="M605 100 v-8 a11 11 0 0 1 22 0 v8" fill="none" className={HERO.accentLine} strokeWidth="5" />
      <circle cx="616" cy="110" r="16" className={A} />
    </>
  )
}
