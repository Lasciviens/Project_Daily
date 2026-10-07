import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { format, startOfWeek, addDays, addWeeks, getISOWeek, parseISO } from 'date-fns'
import { formatWeekdayDate } from '../../../shared/utils/dateFormat'
import { CalendarClock, ChevronLeft, ChevronRight, Dumbbell } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals'
import { Card, CardHeader, IconButton, Skeleton, Truncate, cx } from '../../../shared/ui'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useTodayOverview, type NextUpItem } from '../hooks/useTodayOverview'

const LATER_ROWS = 3

const hourLabel = (h: number) => {
  const total = Math.round(h * 60)
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Opens a schedule item the way Daily's agenda does: a training block opens
 *  as the session (its exercises and targets — changing the plan is behind
 *  that popup's ⋯); anything else opens its editor, and a one-off block
 *  routes to its task when linked. */
function useOpenScheduleItem() {
  const modal = useEntityModal()
  return (item: Pick<NextUpItem, 'kind' | 'id' | 'category' | 'planDate'>) => {
    if (item.kind === 'calendar') return
    if (item.category === 'training' && item.planDate) {
      modal.open({ kind: 'training-session', plan: { kind: item.kind, id: item.id, date: item.planDate } })
      return
    }
    // Same headings as Daily's agenda, so one block reads the same everywhere.
    if (item.kind === 'block') modal.open({ kind: 'time-block', id: item.id, config: { heading: 'Edit block' } })
    else modal.open({ kind: 'schedule-block', id: item.id, config: { heading: 'Edit recurring block' } })
  }
}

/**
 * The week, Monday first. A day is picked in place (the card below shows it);
 * the chevrons beside Monday and Sunday step a week back or forward. Nothing
 * here leaves Home — "Open Daily" in the header does that.
 */
function WeekStrip({ monday, selected, onSelect, onWeek }: {
  monday: Date
  selected: string
  onSelect: (date: string) => void
  onWeek: (delta: number) => void
}) {
  const today = todayStr()
  return (
    <div className="flex items-center gap-0.5">
      <IconButton label="Previous week" onClick={() => onWeek(-1)} className="shrink-0 text-fg-faint hover:text-fg-2"><ChevronLeft /></IconButton>
      <nav aria-label="Week" className="grid min-w-0 flex-1 grid-cols-7 gap-1">
        {Array.from({ length: 7 }, (_, i) => addDays(monday, i)).map(day => {
          const date = format(day, 'yyyy-MM-dd')
          const isToday = date === today
          const isSelected = date === selected
          return (
            <button
              key={date}
              type="button"
              onClick={() => onSelect(date)}
              aria-pressed={isSelected}
              aria-current={isToday ? 'date' : undefined}
              aria-label={formatWeekdayDate(day, 'long')}
              className={cx(
                'flex min-h-[48px] flex-col items-center justify-center rounded-control transition-colors duration-100',
                isToday ? 'bg-accent-500 text-on-accent' : date < today ? 'text-fg-faint hover:bg-surface-hover' : 'text-fg-2 hover:bg-surface-hover',
                isSelected && !isToday && 'bg-accent-50 text-accent-700 ring-1 ring-inset ring-accent-500/40',
                isSelected && isToday && 'ring-2 ring-accent-500/30 ring-offset-1 ring-offset-surface',
              )}
            >
              <span className={cx('text-micro font-semibold uppercase', !isToday && !isSelected && 'text-fg-muted')}>{format(day, 'EEEEE')}</span>
              <span className="text-body font-semibold tabular-nums">{format(day, 'd')}</span>
            </button>
          )
        })}
      </nav>
      <IconButton label="Next week" onClick={() => onWeek(1)} className="shrink-0 text-fg-faint hover:text-fg-2"><ChevronRight /></IconButton>
    </div>
  )
}

interface NowTileProps {
  label: string
  icon: ReactNode
  title?: string
  meta?: string
  tone?: 'info'
  emptyText: string
  onOpen?: () => void
}

function NowTile({ label, icon, title, meta, tone, emptyText, onOpen }: NowTileProps) {
  const body = (
    <>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="text-accent-600 [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span>
        <Truncate className="section-label flex-1">{label}</Truncate>
        {onOpen && <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-faint" />}
      </span>
      {title ? (
        <>
          <Truncate className="mt-1 text-ui font-semibold text-fg">{title}</Truncate>
          {meta && <span data-tone={tone} className="block min-w-0"><Truncate className={cx('text-meta tabular-nums', tone ? 'tone-text font-medium' : 'text-fg-muted')}>{meta}</Truncate></span>}
        </>
      ) : (
        <span className="mt-1 block text-body text-fg-muted">{emptyText}</span>
      )}
    </>
  )
  const cls = 'flex min-h-[72px] min-w-0 flex-col rounded-row bg-surface-2 p-3 text-left'
  // Nothing to open stays put: an empty tile never navigates away from Home.
  return onOpen
    ? <button type="button" onClick={onOpen} className={cx(cls, 'transition-colors duration-100 hover:bg-surface-hover')}>{body}</button>
    : <div className={cls}>{body}</div>
}

/**
 * Home's "now / next" band: the week (a day can be picked in place, other
 * weeks reached with the chevrons), that day's schedule — one-off blocks,
 * recurring templates and calendar events, in-progress first on today — and
 * the training planned on that same day. Everything opens in a popup; only
 * "Open Daily" leaves Home. Counts and ordering come from useTodayOverview.
 */
export function HomeHero() {
  const today = todayStr()
  const [selected, setSelected] = useState(today)
  const [weekOffset, setWeekOffset] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const monday = addWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), weekOffset)
  const isToday = selected === today
  const dayName = format(parseISO(selected), 'EEEE')

  const overview = useTodayOverview(selected)
  const openItem = useOpenScheduleItem()
  // A training session opens as the session (its exercises and targets);
  // changing the plan is behind the popup's ⋯.
  const modal = useEntityModal()
  const { nextUp, upcoming } = overview
  // Only a session on the picked day — tomorrow's training is not today's job.
  const onDay = (t: typeof overview.nextTraining) => (t && t.date === selected ? t : null)
  const dayTraining = onDay(overview.nextTraining)
  // When that training IS "Next up", the second tile shows the day's next
  // session instead of the same one again.
  const nextIsTraining = !!(nextUp && dayTraining && nextUp.kind === dayTraining.kind
    && nextUp.id === dayTraining.id && (nextUp.planDate ?? dayTraining.date) === dayTraining.date)
  const training = nextIsTraining ? onDay(overview.trainingAfterNext) : dayTraining
  const later = showAll ? upcoming.slice(1) : upcoming.slice(1, 1 + LATER_ROWS)

  function pick(date: string) {
    setSelected(date)
    setShowAll(false)
  }
  function changeWeek(delta: number) {
    const next = weekOffset + delta
    setWeekOffset(next)
    // Back on this week → today; another week → its Monday.
    pick(next === 0 ? today : format(addWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), next), 'yyyy-MM-dd'))
  }

  return (
    <Card>
      <CardHeader
        variant="label"
        title={`Week ${getISOWeek(monday)}`}
        action={<Link to={isToday ? '/daily' : `/daily?date=${selected}`} className="inline-flex min-h-[44px] items-center gap-0.5 px-1 text-meta font-semibold text-accent-600">Open Daily <ChevronRight aria-hidden className="h-3.5 w-3.5" /></Link>}
        className="-mt-2 mb-1"
      />
      <WeekStrip monday={monday} selected={selected} onSelect={pick} onWeek={changeWeek} />

      <div className="mt-3 grid grid-cols-2 gap-2">
        {overview.isLoading ? (
          <>
            <Skeleton className="h-[72px] w-full" rounded="rounded-row" />
            <Skeleton className="h-[72px] w-full" rounded="rounded-row" />
          </>
        ) : (
          <>
            <NowTile
              label={isToday ? (nextUp?.inProgress ? 'Now' : 'Next up') : `First on ${dayName}`}
              icon={<CalendarClock />}
              title={nextUp?.title}
              meta={nextUp ? (nextUp.inProgress ? `Until ${hourLabel(nextUp.endHour)}` : nextUp.startLabel) : undefined}
              tone={nextUp?.inProgress ? 'info' : undefined}
              emptyText={isToday ? 'Nothing left today' : 'Nothing planned'}
              onOpen={nextUp && nextUp.kind !== 'calendar' ? () => openItem(nextUp) : undefined}
            />
            <NowTile
              label={nextIsTraining ? 'Training after' : 'Training'}
              icon={<Dumbbell />}
              title={training?.title}
              meta={training?.startTime ?? undefined}
              emptyText={nextIsTraining ? 'No other session' : isToday ? 'None today' : `None on ${dayName}`}
              onOpen={training ? () => modal.open({ kind: 'training-session', plan: { kind: training.kind, id: training.id, date: training.date } }) : undefined}
            />
          </>
        )}
      </div>

      {later.length > 0 && (
        <ul className="mt-3 border-t border-line pt-2" aria-label={isToday ? 'Later today' : `Later on ${dayName}`}>
          {later.map(item => (
            <li key={`${item.kind}-${item.id}`}>
              <button
                type="button"
                onClick={() => openItem(item)}
                disabled={item.kind === 'calendar'}
                className="row row-interactive -mx-3 w-[calc(100%+1.5rem)] text-left disabled:cursor-default"
              >
                <span className="w-11 shrink-0 text-meta tabular-nums text-fg-muted">{item.startLabel}</span>
                <Truncate className="flex-1 text-body text-fg-2">{item.title}</Truncate>
              </button>
            </li>
          ))}
          {!showAll && upcoming.length > 1 + LATER_ROWS && (
            <li>
              {/* Shows the rest here; Home never jumps to Daily on its own. */}
              <button type="button" onClick={() => setShowAll(true)} className="inline-flex min-h-[44px] items-center text-meta font-semibold text-accent-600">
                {upcoming.length - 1 - LATER_ROWS} more {isToday ? 'today' : `on ${dayName}`}
              </button>
            </li>
          )}
        </ul>
      )}
    </Card>
  )
}
