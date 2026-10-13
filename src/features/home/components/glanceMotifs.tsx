import { HERO } from '../../../shared/ui'

// The glance tiles' corner art (GlanceArt.tsx): one motif per tile on the
// 192 × 88 canvas, the subject in its right half (a narrow tile shows only
// that), something quieter on the left, which fades out. Colours only
// through HERO, like the page header art.

const A = HERO.accent
const M = HERO.muted
const H = HERO.hole

/** Weather: a sun behind a cloud; a small rain cloud fades out on the left. */
export function WeatherGlanceArt() {
  return (
    <>
      <rect x="22" y="36" width="46" height="14" rx="7" className={M} opacity="0.8" />
      <circle cx="37" cy="36" r="9" className={M} opacity="0.8" />
      <circle cx="53" cy="32" r="12" className={M} opacity="0.8" />
      <path d="M33 58 l-3 9 M47 58 l-3 9 M61 58 l-3 9" className={HERO.accentLine} strokeWidth="3" strokeLinecap="round" />

      <circle cx="146" cy="34" r="17" className={A} />
      <path d="M146 8 v-5 M168 18 l4 -4 M176 38 h5 M124 18 l-4 -4 M120 38 h-5" className={HERO.accentLine} strokeWidth="3.5" strokeLinecap="round" />
      <rect x="96" y="54" width="74" height="22" rx="11" className={M} />
      <circle cx="117" cy="54" r="14" className={M} />
      <circle cx="139" cy="50" r="17" className={M} />
    </>
  )
}

/** Money: a banknote and a stack of coins; two loose coins fade out on the left. */
export function MoneyGlanceArt() {
  return (
    <>
      <circle cx="34" cy="62" r="11" className={M} opacity="0.8" />
      <circle cx="60" cy="68" r="8" className={A} opacity="0.8" />

      <rect x="86" y="26" width="64" height="38" rx="5" className={M} />
      <rect x="92" y="32" width="52" height="26" rx="3" fill="none" className={HERO.holeLine} strokeWidth="2" opacity="0.45" />
      <circle cx="118" cy="45" r="8" className={H} opacity="0.55" />

      {[72, 63, 54, 45].map(y => (
        <rect key={y} x="140" y={y} width="38" height="10" rx="5" className={A} />
      ))}
      <path d="M144 72 h30 M144 63 h30 M144 54 h30" className={HERO.holeLine} strokeWidth="1.5" opacity="0.5" />
    </>
  )
}

/** Training: a dumbbell; a kettlebell fades out on the left. */
export function TrainingGlanceArt() {
  return (
    <>
      <path d="M40 54 v-6 a10 10 0 0 1 20 0 v6" fill="none" className={HERO.mutedLine} strokeWidth="4" />
      <circle cx="50" cy="66" r="14" className={M} />

      <rect x="104" y="47" width="64" height="7" rx="3" className={M} />
      <rect x="109" y="37" width="8" height="27" rx="3" className={M} />
      <rect x="155" y="37" width="8" height="27" rx="3" className={M} />
      <rect x="94" y="30" width="13" height="41" rx="4" className={A} />
      <rect x="165" y="30" width="13" height="41" rx="4" className={A} />
    </>
  )
}

/** Watched: a TV with a play mark; a film reel fades out on the left. */
export function WatchedGlanceArt() {
  return (
    <>
      <circle cx="44" cy="54" r="20" className={M} opacity="0.85" />
      {[[44, 43], [54.5, 50.5], [50.5, 63], [37.5, 63], [33.5, 50.5]].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="4" className={H} opacity="0.55" />
      ))}

      <path d="M122 22 l-10 -12 M146 22 l10 -12" className={HERO.mutedLine} strokeWidth="3" strokeLinecap="round" />
      <rect x="96" y="22" width="76" height="50" rx="7" className={M} />
      <rect x="102" y="28" width="64" height="38" rx="3" className={A} />
      <path d="M128 37 L144 47 L128 57 Z" className={H} opacity="0.8" />
      <rect x="122" y="74" width="24" height="6" rx="3" className={M} />
    </>
  )
}

/** Books: an open book; standing books fade out on the left. */
export function BooksGlanceArt() {
  return (
    <>
      <rect x="28" y="34" width="14" height="46" rx="2" className={M} opacity="0.85" />
      <rect x="44" y="42" width="12" height="38" rx="2" className={A} opacity="0.8" />
      <rect x="58" y="30" width="15" height="50" rx="2" className={M} transform="rotate(12 73 80)" />

      <path d="M136 34 C124 26 108 26 94 30 V74 C108 70 124 70 136 78 Z" className={A} />
      <path d="M136 34 C148 26 164 26 178 30 V74 C164 70 148 70 136 78 Z" className={M} />
      <path d="M102 41 c10 -3 20 -3 28 2 M102 51 c10 -3 20 -3 28 2 M102 61 c10 -3 20 -3 28 2 M142 43 c8 -5 18 -5 28 -2 M142 53 c8 -5 18 -5 28 -2 M142 63 c8 -5 18 -5 28 -2"
        fill="none" className={HERO.holeLine} strokeWidth="2.5" opacity="0.5" />
    </>
  )
}

/** Games: a controller; an arcade stick fades out on the left. */
export function GamesGlanceArt() {
  return (
    <>
      <rect x="28" y="62" width="40" height="16" rx="4" className={M} opacity="0.85" />
      <rect x="45" y="40" width="5" height="24" rx="2" className={M} />
      <circle cx="47.5" cy="38" r="8" className={A} opacity="0.85" />

      <path d="M112 32 H156 C170 32 178 46 180 62 C182 76 170 82 162 72 L154 62 H114 L106 72 C98 82 86 76 88 62 C90 46 98 32 112 32 Z" className={A} />
      <path d="M103 47 h14 M110 40 v14" className={HERO.holeLine} strokeWidth="4" strokeLinecap="round" />
      <circle cx="154" cy="44" r="3.5" className={H} />
      <circle cx="162" cy="51" r="3.5" className={H} />
    </>
  )
}
