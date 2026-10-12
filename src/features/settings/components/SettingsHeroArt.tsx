import { HERO } from '../../../shared/ui'

// Settings' header art (THEME.md §6.5): three sliders and two meshing gears;
// two switches fade out on the left.

const A = HERO.accent
const M = HERO.muted
const H = HERO.hole

// Track y, then where its knob sits.
const SLIDERS = [[42, 390], [70, 330], [98, 432]] as const

/** A gear: `teeth` rounded teeth around a body of radius `r`, with a hole. */
function Gear({ cx, cy, r, teeth, fill }: { cx: number; cy: number; r: number; teeth: number; fill: string }) {
  const t = r * 0.42
  return (
    <g className={fill}>
      {Array.from({ length: teeth }, (_, i) => (
        <rect key={i} x={cx - t / 2} y={cy - r - t * 0.8} width={t} height={t * 1.4} rx={t * 0.2}
          transform={`rotate(${(360 / teeth) * i} ${cx} ${cy})`} />
      ))}
      <circle cx={cx} cy={cy} r={r} />
      <circle cx={cx} cy={cy} r={r * 0.36} className={H} opacity="0.6" />
    </g>
  )
}

export function SettingsHeroArt() {
  return (
    <>
      {/* Switches, fading out */}
      <rect x="140" y="44" width="56" height="28" rx="14" className={A} />
      <circle cx="182" cy="58" r="10" className={H} opacity="0.8" />
      <rect x="140" y="86" width="56" height="28" rx="14" className={M} />
      <circle cx="154" cy="100" r="10" className={H} opacity="0.8" />

      {/* Sliders */}
      {SLIDERS.map(([y, knob]) => (
        <g key={y}>
          <rect x="262" y={y - 3} width="210" height="6" rx="3" className={M} />
          <rect x="262" y={y - 3} width={knob - 262} height="6" rx="3" className={A} />
          <circle cx={knob} cy={y} r="10" className={A} />
          <circle cx={knob} cy={y} r="4" className={H} opacity="0.7" />
        </g>
      ))}

      {/* Gears */}
      <Gear cx={548} cy={64} r={36} teeth={8} fill={M} />
      <Gear cx={608} cy={112} r={17} teeth={6} fill={A} />
    </>
  )
}
