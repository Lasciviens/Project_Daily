import { HERO } from '../../../shared/ui'

// Developer's header art (THEME.md §6.5): code brackets beside a terminal
// window with a prompt and a cursor; a branch graph fades out on the left.

const A = HERO.accent
const M = HERO.muted
const H = HERO.hole

export function DeveloperHeroArt() {
  return (
    <>
      {/* Branch graph, fading out */}
      <path d="M70 26 V114 M70 56 C70 78 130 70 130 92 V114" fill="none" className={HERO.mutedLine} strokeWidth="4" />
      <circle cx="70" cy="26" r="8" className={A} />
      <circle cx="70" cy="114" r="8" className={M} />
      <circle cx="130" cy="114" r="8" className={A} />

      {/* </> */}
      <path d="M282 40 L252 70 L282 100 M320 40 L350 70 L320 100" fill="none" className={HERO.accentLine} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M310 32 L292 108" className={HERO.mutedLine} strokeWidth="7" strokeLinecap="round" />

      {/* Terminal */}
      <rect x="372" y="20" width="240" height="104" rx="8" className={M} />
      <circle cx="388" cy="32" r="4" className={A} />
      <circle cx="402" cy="32" r="4" className={H} opacity="0.7" />
      <circle cx="416" cy="32" r="4" className={H} opacity="0.7" />
      <rect x="380" y="42" width="224" height="74" rx="4" className={H} opacity="0.6" />
      <path d="M392 54 l7 6 l-7 6 M392 92 l7 6 l-7 6" fill="none" className={HERO.accentLine} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M408 60 h64 M392 73 h96 M404 85 h58 M500 60 h40" className={HERO.mutedLine} strokeWidth="4" strokeLinecap="round" />
      <rect x="408" y="92" width="10" height="13" rx="1" className={A} />
    </>
  )
}
