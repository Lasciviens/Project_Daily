import { useState } from 'react'
import { systemMeta } from '../systemMeta'
import type { Game } from '../types'

// Cover, rating and platform pieces shared by the Games components that keep
// the app's palette (GameDetailModal, NeedsReviewTab).
//
// `CoverBackdrop` is the "give them a background" piece: the same cover URL,
// blurred and dimmed behind the card body, so a card picks up the artwork's own
// colour instead of sitting on flat cream. It reuses the already-cached image —
// no second request — and simply renders nothing when a game has no cover.

export function CoverImg({ url, title, className = '' }: {
  url?: string | null
  title: string
  className?: string
}) {
  const [err, setErr] = useState(false)
  if (url && !err) {
    return (
      <img
        src={url} alt={title} onError={() => setErr(true)}
        // Four attributes that cost nothing and change everything on a long
        // grid: only fetch what is near the viewport, decode off the main
        // thread, and — Safari 27 — let the browser work out the real display
        // width itself instead of downloading a full-size cover for a 120px
        // card. `async` decoding is what stops a scroll stuttering on the
        // frame an image happens to arrive.
        loading="lazy" decoding="async" sizes="auto"
        className={`w-full h-full object-cover ${className}`} />
    )
  }
  return (
    <div className={`w-full h-full flex items-center justify-center bg-gradient-to-br from-ink-100 to-ink-200 text-2xl ${className}`}>🎮</div>
  )
}

export function CoverBackdrop({ url, className = '' }: { url?: string | null; className?: string }) {
  if (!url) return null
  return (
    <div aria-hidden
      className={`hidden sm:block absolute inset-0 bg-cover bg-center scale-125 blur-2xl opacity-25 dark:opacity-30 pointer-events-none ${className}`}
      style={{ backgroundImage: `url(${url})` }} />
  )
}


export function RatingBadge({ rating, size = 'md' }: { rating: number | null; size?: 'sm' | 'md' }) {
  if (rating == null) return null
  return (
    <span className={`font-bold rounded-md bg-black/80 text-accent-300 shadow-sm leading-none ${
      size === 'sm' ? 'text-[9px] px-1 py-0.5' : 'text-[11px] px-1.5 py-1'
    }`}>★{rating}</span>
  )
}

/** The platform the game is primarily on, plus a "+N" when it has more. */
export function SystemChip({ game, size = 'md' }: { game: Game; size?: 'sm' | 'md' }) {
  const systems = [...new Set(game.platforms.map(p => p.system))]
  if (!systems.length) return null
  const primary = game.platforms.find(p => p.is_primary_variant)?.system ?? systems[0]
  const meta = systemMeta(primary)
  const extra = systems.length - 1
  return (
    <span className={`inline-flex items-center gap-1 font-bold rounded-md shadow-sm leading-none ${meta.chip} ${
      size === 'sm' ? 'text-[9px] px-1 py-0.5' : 'text-[10px] px-1.5 py-1'
    }`}>
      {meta.label}{extra > 0 && <span className="opacity-75 font-semibold">+{extra}</span>}
    </span>
  )
}
