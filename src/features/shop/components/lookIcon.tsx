import {
  ArrowLeftRight, BadgeAlert, CalendarClock, Hourglass, ListChecks, PackageCheck, RotateCcw, ShieldAlert, Tag, Target, TrendingDown, type LucideIcon,
} from 'lucide-react'
import { cx } from '../../../shared/ui'
import type { Look, LookKind } from '../shopSuggestions'

const ICON: Record<LookKind, LucideIcon> = {
  return_closing: RotateCcw, cheaper_returnable: TrendingDown, at_target: Target, lowest_seen: TrendingDown, back_in_stock: PackageCheck,
  fake_before: BadgeAlert, deal_day: CalendarClock, complaint_ending: ShieldAlert, old_value: Tag, old_wish: Hourglass, tidy_up: ListChecks,
  price_match: ArrowLeftRight,
}

/** A Needs-a-look kind's icon on its tone (its rows, the record's nudge): the icon and the words say it, never the colour alone. */
export function LookIcon({ look, small = false }: { look: Pick<Look, 'kind' | 'tone'>; small?: boolean }) {
  const Icon = ICON[look.kind]
  return (
    <span data-tone={look.tone} className={cx('tone-soft grid shrink-0 place-items-center rounded-full', small ? 'h-6 w-6' : 'mt-0.5 h-7 w-7')}>
      <Icon aria-hidden className={cx('tone-text', small ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
    </span>
  )
}
