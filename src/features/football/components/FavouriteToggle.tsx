import { Star } from 'lucide-react'
import { IconButton, cx } from '../../../shared/ui'
import { useSetFavourite } from '../hooks/useFootball'
import type { FootballFollow } from '../types'

/**
 * A followed team's star (owner, 26.10.2026: "favourite team(s), with the
 * favourite selected on the Football page"): the Personal page's Football card
 * shows each favourite's table place, form and next match. Several teams may
 * be favourites; a tournament can't be one. The tap shows at once; if the save
 * fails, the star goes back and the error says why. A favourite is a
 * category the owner flagged: the `highlight` tone marks it (THEME's tone
 * table — wish, favourite). `chip` (the club popup) names it beside
 * Subscribe; the Following list has the star alone.
 */
export function FavouriteToggle({ follow, chip = false }: { follow: FootballFollow; chip?: boolean }) {
  const set = useSetFavourite()
  const on = set.isPending ? (set.variables?.on ?? follow.favourite) : follow.favourite
  const label = on ? `Remove ${follow.name} from favourites` : `Make ${follow.name} a favourite`
  const toggle = () => { if (!set.isPending) set.mutate({ follow, on: !on }) }
  if (chip) {
    return (
      <button
        type="button" aria-pressed={on} aria-label={label} title={label} onClick={toggle}
        data-tone={on ? 'highlight' : undefined}
        className={cx('chip shrink-0', on && 'tone-soft tone-text border-transparent')}
      >
        <Star aria-hidden className={cx('h-3.5 w-3.5', on && 'fill-current')} />
        Favourite
      </button>
    )
  }
  return (
    <IconButton label={label} aria-pressed={on} onClick={toggle} className={cx('w-8', !on && 'text-fg-muted')}>
      <Star aria-hidden data-tone={on ? 'highlight' : undefined} className={cx(on && 'tone-text fill-current')} />
    </IconButton>
  )
}
