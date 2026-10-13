import type { ReactNode } from 'react'

// A glance tile's corner art (THEME.md §6.5; owner, 13.10.2026: "add
// background image on their corner"): a small still drawing of the tile's
// subject in its top-right corner, in the band above the tile's first line —
// right of the label, behind the chevron — so it never sits under text and
// adds no height. The page header art's colours and its free-space dimming;
// the motifs are in glanceMotifs.tsx (scripts/verify-glance-art.cjs).

/** The motif canvas, drawn at half size: 192 × 88 → at most 6rem × 2.75rem. */
const GLANCE_ART_VIEWBOX = '0 0 192 88'

/**
 * The art layer. Its host is `relative isolate` (GlanceCarousel's card), so
 * `-z-10` puts it above the card's background and under everything in it.
 * The band is as tall as the tile's padding + header (2.75rem; the first line
 * starts at 2.875rem) and at most a third of the tile wide, so it stays right
 * of the longest label on the narrowest tile; on a narrow tile the canvas
 * keeps its right side (the subject) and loses the quiet left, which fades.
 */
export function GlanceArt({ children }: { children: ReactNode }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[inherit]">
      <svg
        viewBox={GLANCE_ART_VIEWBOX}
        preserveAspectRatio="xMaxYMid slice"
        focusable="false"
        className="absolute right-0 top-0 h-11 w-[min(6rem,34%)] opacity-[0.22] [mask-image:linear-gradient(to_right,transparent,black_40%)] dark:opacity-[0.26]"
      >
        {children}
      </svg>
    </div>
  )
}
