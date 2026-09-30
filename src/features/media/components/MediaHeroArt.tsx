// A still, drawn film-strip motif behind the search + library card. It
// replaced the rotating TMDB backdrops (owner, 30.09.2026: "a general media
// image that is steady"): no network, no timers, the same in both themes.
const HOLES = Array.from({ length: 9 }, (_, i) => i)

export function MediaHeroArt() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-[inherit] text-accent-500">
      <svg
        viewBox="0 0 360 200"
        className="absolute -right-10 -top-6 h-48 w-auto rotate-[-8deg] opacity-[0.07] dark:opacity-[0.10] sm:h-48"
        fill="none"
      >
        {/* Film strip */}
        <rect x="10" y="40" width="340" height="110" rx="8" fill="currentColor" />
        {HOLES.map(i => (
          <g key={i}>
            <rect x={22 + i * 37} y="48" width="18" height="12" rx="2" className="fill-surface" />
            <rect x={22 + i * 37} y="130" width="18" height="12" rx="2" className="fill-surface" />
          </g>
        ))}
        {[0, 1, 2].map(i => (
          <rect key={i} x={24 + i * 111} y="68" width="98" height="54" rx="4" className="fill-surface" opacity="0.55" />
        ))}
        {/* Play mark in the middle frame */}
        <path d="M170 80 L196 95 L170 110 Z" fill="currentColor" />
      </svg>
    </div>
  )
}
