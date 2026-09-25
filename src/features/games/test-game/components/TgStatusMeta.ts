import { Check, Clock3, EyeOff, Heart, X, type LucideIcon } from 'lucide-react'
import { STATUS_TEXT, formatStars, starsFromRating, type TgGame, type TgStatusFilter } from '../testGameModel'

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
 * A card's accessible name: everything the card shows (title, status,
 * rating), not the title alone — the same wording on shelf, grid and phone.
 */
export function gameCardLabel(game: TgGame): string {
  const stars = starsFromRating(game.rating)
  return `${game.title}, ${statusLabel(game.play_status)}${stars != null ? `, rated ${formatStars(stars)} of 5` : ''}`
}
