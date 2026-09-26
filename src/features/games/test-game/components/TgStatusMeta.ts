import { Check, Clock3, EyeOff, Heart, X, type LucideIcon } from 'lucide-react'
import { STATUS_TEXT, effectiveStatus, formatStars, starsFromRating, type TgGame, type TgStatusFilter } from '../testGameModel'

// Non-component helpers for TgStatusIcon and the game cards (a .tsx file may
// export only components).

/** White glyph drawn on the status badge; statuses without one get a dot. */
export const STATUS_GLYPH: Partial<Record<string, { icon: LucideIcon; filled?: boolean }>> = {
  completed: { icon: Check },
  backlog:   { icon: Clock3 },
  wishlist:  { icon: Heart, filled: true },
  dropped:   { icon: X },
  hidden:    { icon: EyeOff },
}

export function statusLabel(status: string | null | undefined): string {
  if (!status) return 'No status'
  return STATUS_TEXT[status as TgStatusFilter] ?? status
}

/**
 * The status a card shows. A hidden row says so — explicitly hidden, or a
 * Steam/PlayStation app hidden automatically (whose stored status would read
 * like progress) — and no status at all reads as Backlog, as every count does.
 */
export function cardStatus(game: TgGame): { status: string; label: string } {
  if (game.hidden) return { status: 'hidden', label: game.play_status === 'hidden' ? 'Hidden' : 'Hidden · not a game' }
  const s = effectiveStatus(game)
  return { status: s, label: statusLabel(s) }
}

/**
 * A card's accessible name: everything the card shows (title, status,
 * rating), not the title alone — the same wording on shelf, grid and phone.
 */
export function gameCardLabel(game: TgGame): string {
  const stars = starsFromRating(game.rating)
  return `${game.title}, ${cardStatus(game).label}${stars != null ? `, rated ${formatStars(stars)} of 5` : ''}`
}
