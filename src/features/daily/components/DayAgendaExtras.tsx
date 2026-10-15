import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { endOfWeek, startOfWeek } from 'date-fns'
import { useTasksByWeek } from '../../todo/hooks/useTodos'
import { ToDoItem } from '../../todo/components/ToDoItem'
import { isOpenTask } from '../../todo/taskRules'
import { useOpenWishes } from '../../wishes/hooks/useWishes'
import { wishPeriodLabel } from '../../wishes/wishRules'
import { ToneDot, Truncate, cx } from '../../../shared/ui'
import type { Task } from '../../todo/types'

// The two extras of Daily's day list, both moved here from the old Tasks pane
// (DayView) when the day became one list (15.10.2026).

// Resurfacing row for wishes whose reminder period is open RIGHT NOW — the one
// thing that keeps a July-written "go to the hytte this winter" from being
// invisible until the user goes looking for it in December.
//
// Why HERE and nowhere else: the day band stacks WeekStrip → the day list, so
// on a phone this row sits right under the day's header, while the glance
// board (TodaySummary) sits below the whole band and DayQuickRail only exists
// on wide pages (DAY_BOARD steps 3–4) — neither is a phone surface. Do not
// "tidy" this into either of them. It leads the Anytime part of the list.
//
// Deliberately quieter than the "N open" pill in the header: a wish is a
// nudge, the day's plan is the work.
export function OpenWishesRow() {
  const { data: wishes = [] } = useOpenWishes()
  if (wishes.length === 0) return null

  const labels = [...new Set(wishes.map(wishPeriodLabel).filter((l): l is string => !!l))]
  // Several periods can be open at once (a season plus a hand-picked range), so
  // name the first and admit to the rest instead of silently showing one.
  const lead = labels.length === 0 ? 'Open now'
    : labels.length === 1 ? labels[0]
    : `${labels[0]} +${labels.length - 1} more`

  return (
    <Link
      to="/wishes"
      className="flex min-h-[44px] items-center gap-2 rounded-row border border-line bg-surface-2 px-3 text-body text-fg-2 transition-colors duration-150 hover:bg-surface-hover"
    >
      <ToneDot tone="highlight" />
      <Truncate>{lead}</Truncate>
      <span className="text-fg-faint" aria-hidden>·</span>
      <span className="shrink-0 tabular-nums text-fg-muted">
        {wishes.length} {wishes.length === 1 ? 'thing' : 'things'}
      </span>
      <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-fg-faint" aria-hidden />
    </Link>
  )
}

/** Open tasks with no date read in this week (folded; from the old WeekWidget column). */
export function UndatedThisWeek() {
  const [open, setOpen] = useState(false)
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
  const { data: weekTasks = [] } = useTasksByWeek(weekStart, endOfWeek(weekStart, { weekStartsOn: 1 }))
  const floating = weekTasks.filter((t): t is Task => !t.due_date && isOpenTask(t))
  if (floating.length === 0) return null
  return (
    <div className="border-t border-line pt-1">
      <button
        type="button"
        onClick={() => setOpen(s => !s)}
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-center justify-between rounded-row px-1 text-left"
      >
        <span className="section-label">This week — no date</span>
        <span className="flex items-center gap-1 text-meta tabular-nums text-fg-muted">
          {floating.length}
          <ChevronDown className={cx('h-4 w-4 transition-transform duration-150', open && 'rotate-180')} aria-hidden />
        </span>
      </button>
      {open && (
        <div className="mt-1">
          {floating.slice(0, 6).map(t => <ToDoItem key={t.id} task={t} />)}
          {floating.length > 6 && <p className="mt-1 px-1 text-meta text-fg-muted">+{floating.length - 6} more</p>}
        </div>
      )}
    </div>
  )
}
