import { useState } from 'react'
import { TIER_COLOR } from '../gamesMeta'
import { systemMeta } from '../systemMeta'
import { formatPlaytimeShort } from '../gameStats'
import type { Game } from '../types'

// Shared anatomy for every cover-led game card (Grid, Compact, Poster).
//
// The three used to hand-build their own badges, so the same fact sat in a
// different corner on each view — the rating was bottom-left on Grid and inside
// the hover panel on Poster, and the platform appeared on neither. One kit, one
// placement rule:
//
//   top-left  = tier          top-right = my rating
//   bottom    = platform + flags, over the cover's own gradient
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
    return <img src={url} alt={title} onError={() => setErr(true)}
      className={`w-full h-full object-cover ${className}`} />
  }
  return (
    <div className={`w-full h-full flex items-center justify-center bg-gradient-to-br from-ink-100 to-ink-200 text-2xl ${className}`}>🎮</div>
  )
}

export function CoverBackdrop({ url, className = '' }: { url?: string | null; className?: string }) {
  if (!url) return null
  return (
    <div aria-hidden
      className={`absolute inset-0 bg-cover bg-center scale-125 blur-2xl opacity-25 dark:opacity-30 pointer-events-none ${className}`}
      style={{ backgroundImage: `url(${url})` }} />
  )
}

export function TierBadge({ tier, size = 'md' }: { tier: string | null; size?: 'sm' | 'md' }) {
  if (!tier) return null
  const cls = TIER_COLOR[tier] ?? 'bg-ink-200 text-ink-700'
  return (
    <span className={`font-bold rounded-md shadow-sm leading-none ${cls} ${
      size === 'sm' ? 'text-[9px] px-1 py-0.5' : 'text-[11px] px-1.5 py-1'
    }`}>{tier}</span>
  )
}

export function RatingBadge({ rating, size = 'md' }: { rating: number | null; size?: 'sm' | 'md' }) {
  if (rating == null) return null
  return (
    <span className={`font-bold rounded-md bg-black/70 text-accent-300 backdrop-blur-sm shadow-sm leading-none ${
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
    <span className={`inline-flex items-center gap-1 font-bold rounded-md backdrop-blur-sm shadow-sm leading-none ${meta.chip} ${
      size === 'sm' ? 'text-[9px] px-1 py-0.5' : 'text-[10px] px-1.5 py-1'
    }`}>
      {meta.label}{extra > 0 && <span className="opacity-75 font-semibold">+{extra}</span>}
    </span>
  )
}

/** Iconic / co-op / needs-review markers, in that fixed order. */
export function FlagBadges({ game, size = 'md' }: { game: Game; size?: 'sm' | 'md' }) {
  const sm = size === 'sm'
  return (
    <>
      {game.is_iconic && <span className={sm ? 'text-[10px] leading-none drop-shadow' : 'text-xs leading-none drop-shadow'} title="Iconic">⭐</span>}
      {game.is_coop && <span className={`font-bold bg-cyan-500 text-white rounded-md leading-none ${sm ? 'text-[9px] px-1 py-0.5' : 'text-[10px] px-1.5 py-1'}`} title="Co-op">2P</span>}
      {game.needs_review && <span className={sm ? 'text-[10px] leading-none drop-shadow' : 'text-xs leading-none drop-shadow'} title="Needs review">🔎</span>}
    </>
  )
}

/**
 * Recorded play time, from ES-DE. Renders nothing at all when there is none —
 * a library where most rows have never been launched should not be covered in
 * "0h" chips claiming otherwise.
 */
export function PlaytimeBadge({ game, size = 'md' }: { game: Game; size?: 'sm' | 'md' }) {
  const t = formatPlaytimeShort(game.esde_playtime_seconds)
  if (!t) return null
  return (
    <span className={`font-bold rounded-md bg-black/70 text-white/90 backdrop-blur-sm shadow-sm leading-none ${
      size === 'sm' ? 'text-[9px] px-1 py-0.5' : 'text-[10px] px-1.5 py-1'
    }`} title={`${game.esde_playcount ?? 0} sessions recorded by ES-DE`}>⏱{t}</span>
  )
}
