import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { format, startOfWeek, addDays, getISOWeek, differenceInCalendarDays, parseISO } from 'date-fns'
import { CalendarClock, ChevronRight, Dumbbell } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals'
import { Card, CardHeader, Skeleton, cx } from '../../../shared/ui'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useTodayOverview, type NextUpItem, type NextTrainingItem } from '../hooks/useTodayOverview'

const LATER_ROWS = 3

const hourLabel = (h: number) => {
  const total = Math.round(h * 60)
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function relativeDay(dateStr: string): string {
  const days = differenceInCalendarDays(parseISO(dateStr), new Date())
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days < 7) return format(parseISO(dateStr), 'EEEE')
  return format(parseISO(dateStr), 'd MMM')
}

/** Opens a schedule item's editor: one-off blocks route to their task when linked. */
function useOpenScheduleItem() {
  const modal = useEntityModal()
  return (item: { kind: NextUpItem['kind'] | NextTrainingItem['kind']; id: string }) => {
    // Same headings as Daily's agenda, so one block reads the same everywhere.
    if (item.kind === 'block') modal.open({ kind: 'time-block', id: item.id, config: { heading: 'Edit block' } })
    else if (item.kind === 'recurring') modal.open({ kind: 'schedule-block', id: item.id, config: { heading: 'Edit recurring block' } })
  }
}

function WeekStrip() {
  const today = todayStr()
  const monday = startOfWeek(new Date(), { weekStartsOn: 1 })
  return (
    <nav aria-label="This week" className="grid grid-cols-7 gap-1">
      {Array.from({ length: 7 }, (_, i) => addDays(monday, i)).map(day => {
        const date = format(day, 'yyyy-MM-dd')
        const isToday = date === today
        return (
          <Link
            key={date}
            to={`/daily?date=${date}`}
            aria-current={isToday ? 'date' : undefined}
            aria-label={format(day, 'EEEE d MMMM')}
            className={cx(
              'flex min-h-[48px] flex-col items-center justify-center rounded-control transition-colors duration-100',
              isToday ? 'bg-accent-500 text-on-accent' : date < today ? 'text-fg-faint hover:bg-surface-hover' : 'text-fg-2 hover:bg-surface-hover',
            )}
          >
            <span className={cx('text-micro font-semibold uppercase', !isToday && 'text-fg-muted')}>{format(day, 'EEEEE')}</span>
            <span className="text-body font-semibold tabular-nums">{format(day, 'd')}</span>
          </Link>
        )
      })}
    </nav>
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
  to?: string
}

function NowTile({ label, icon, title, meta, tone, emptyText, onOpen, to }: NowTileProps) {
  const body = (
    <>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="text-accent-600 [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span>
        <span className="section-label flex-1 truncate">{label}</span>
        <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-faint" />
      </span>
      {title ? (
        <>
          <span className="mt-1 block truncate text-ui font-semibold text-fg">{title}</span>
          {meta && <span data-tone={tone} className={cx('block truncate text-meta tabular-nums', tone ? 'tone-text font-medium' : 'text-fg-muted')}>{meta}</span>}
        </>
      ) : (
        <span className="mt-1 block text-body text-fg-muted">{emptyText}</span>
      )}
    </>
  )
  const cls = 'flex min-h-[72px] min-w-0 flex-col rounded-row bg-surface-2 p-3 text-left transition-colors duration-100 hover:bg-surface-hover'
  return onOpen
    ? <button type="button" onClick={onOpen} className={cls}>{body}</button>
    : <Link to={to ?? '/daily'} className={cls}>{body}</Link>
}

/**
 * Home's "now / next" band: the week, what's next on today's schedule (one-off
 * blocks, recurring templates and calendar events, in-progress first) and the
 * next training session. Counts and ordering come from useTodayOverview.
 */
export function HomeHero() {
  const overview = useTodayOverview()
  const openItem = useOpenScheduleItem()
  const { nextUp, nextTraining, upcoming } = overview
  const later = upcoming.slice(1, 1 + LATER_ROWS)

  return (
    <Card>
      <CardHeader
        variant="label"
        title={`Week ${getISOWeek(new Date())}`}
        action={<Link to="/daily" className="inline-flex min-h-[44px] items-center gap-0.5 px-1 text-meta font-semibold text-accent-600">Open Daily <ChevronRight aria-hidden className="h-3.5 w-3.5" /></Link>}
        className="-mt-2 mb-1"
      />
      <WeekStrip />

      <div className="mt-3 grid grid-cols-2 gap-2">
        {overview.isLoading ? (
          <>
            <Skeleton className="h-[72px] w-full" rounded="rounded-row" />
            <Skeleton className="h-[72px] w-full" rounded="rounded-row" />
          </>
        ) : (
          <>
            <NowTile
              label={nextUp?.inProgress ? 'Now' : 'Next up'}
              icon={<CalendarClock />}
              title={nextUp?.title}
              meta={nextUp ? (nextUp.inProgress ? `Until ${hourLabel(nextUp.endHour)}` : nextUp.startLabel) : undefined}
              tone={nextUp?.inProgress ? 'info' : undefined}
              emptyText="Nothing left today"
              onOpen={nextUp && nextUp.kind !== 'calendar' ? () => openItem(nextUp) : undefined}
            />
            <NowTile
              label="Training"
              icon={<Dumbbell />}
              title={nextTraining?.title}
              meta={nextTraining ? `${relativeDay(nextTraining.date)}${nextTraining.startTime ? ` · ${nextTraining.startTime}` : ''}` : undefined}
              emptyText="None planned"
              onOpen={nextTraining ? () => openItem(nextTraining) : undefined}
              to="/training"
            />
          </>
        )}
      </div>

      {later.length > 0 && (
        <ul className="mt-3 border-t border-line pt-2" aria-label="Later today">
          {later.map(item => (
            <li key={`${item.kind}-${item.id}`}>
              <button
                type="button"
                onClick={() => openItem(item)}
                disabled={item.kind === 'calendar'}
                className="row row-interactive -mx-3 w-[calc(100%+1.5rem)] text-left disabled:cursor-default"
              >
                <span className="w-11 shrink-0 text-meta tabular-nums text-fg-muted">{item.startLabel}</span>
                <span className="min-w-0 flex-1 truncate text-body text-fg-2">{item.title}</span>
              </button>
            </li>
          ))}
          {upcoming.length > 1 + LATER_ROWS && (
            <li>
              <Link to="/daily" className="inline-flex min-h-[44px] items-center text-meta font-semibold text-accent-600">
                {upcoming.length - 1 - LATER_ROWS} more today
              </Link>
            </li>
          )}
        </ul>
      )}
    </Card>
  )
}
