import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { format, startOfWeek, addDays, addWeeks, getISOWeek, parseISO } from 'date-fns'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { CardHeader, IconButton, cx } from '../../../shared/ui'
import { formatWeekdayDate } from '../../../shared/utils/dateFormat'
import { usePrefetchWeek } from '../hooks/usePrefetchWeek'
import { DayAgenda } from '../../daily/components/DayAgenda'
import { useSaveItem } from '../../items/useItems'
import { parseQuickAdd } from '../../items/quickAdd'
import { itemFromQuickAdd } from '../../items/sheetRules'
import { ReadAsLine } from '../../items/components/ReadAsLine'
import { useCalendarStore } from '../../../app/store'
import { todayStr } from '../../../shared/utils/dateUtils'

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

/** The week of the picked day, with ‹ › to step weeks (back on this week: today). */
function WeekHeader({ day, onDay }: { day: string; onDay: (day: string) => void }) {
  const today = todayStr()
  const thisMonday = startOfWeek(new Date(), { weekStartsOn: 1 })
  const monday = startOfWeek(parseISO(day), { weekStartsOn: 1 })
  // The shown week is read ahead, so a picked day shows at once.
  usePrefetchWeek(format(monday, 'yyyy-MM-dd'))
  function changeWeek(delta: number) {
    const next = addWeeks(monday, delta)
    onDay(format(next, 'yyyy-MM-dd') === format(thisMonday, 'yyyy-MM-dd') ? today : format(next, 'yyyy-MM-dd'))
  }
  return (
    <div className="px-4 pt-3 sm:px-5">
      <CardHeader
        variant="label"
        title={`Week ${getISOWeek(monday)}`}
        action={<Link to={day === today ? '/daily' : `/daily?date=${day}`} className="inline-flex min-h-[44px] items-center gap-0.5 px-1 text-meta font-semibold text-accent-600">Open Daily <ChevronRight aria-hidden className="h-3.5 w-3.5" /></Link>}
        className="-mt-2 mb-1"
      />
      <WeekStrip monday={monday} selected={day} onSelect={onDay} onWeek={changeWeek} />
    </div>
  )
}

/**
 * Quick add for the picked day: reads "Gym 17:30 1h every Mon Wed Fri" like the Add sheet's title (quickAdd.ts),
 * says what it read and saves through the one item save.
 */
function HomeQuickAdd({ day }: { day: string }) {
  const save = useSaveItem()
  const googleConnected = !!useCalendarStore(s => s.accessToken)
  const [title, setTitle] = useState('')
  const [keepText, setKeepText] = useState(false)
  const parse = keepText ? null : parseQuickAdd(title, day)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const input = itemFromQuickAdd(title, parse, day, googleConnected)
    if (!input) return
    setTitle('')
    setKeepText(false)
    // The hook says the result (and any error); the new row appears via invalidation.
    save.mutate(input)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1.5 border-t border-line px-4 pb-4 pt-3 sm:px-5 sm:pb-5">
      <div className="flex items-center gap-2">
        <input
          value={title}
          onChange={e => { setTitle(e.target.value); if (!e.target.value.trim()) setKeepText(false) }}
          placeholder={day === todayStr() ? 'Add for today — e.g. Gym 17:30' : 'Add for this day — e.g. Gym 17:30'}
          aria-label="New item"
          autoComplete="off"
          className="input min-w-0 flex-1"
        />
        <IconButton type="submit" label="Add" bordered disabled={!(parse ? parse.title : title).trim() || save.isPending}>
          <Plus />
        </IconButton>
      </div>
      {parse && <ReadAsLine parse={parse} start={day} onKeepText={() => setKeepText(true)} />}
    </form>
  )
}

/**
 * Home's day, ONE card (owner, 31.10.2026, option 1): the week strip, then the picked day as ONE list — Daily's own
 * (a task with its slot, a repeat's day and a training session are each one row with their tick, daily/dayItems.ts) —
 * then the quick add, the card's one Add. Home used to show the day twice: a week card with "Next up" and "Later
 * today", and a separate tasks card.
 */
export function HomeDayCard({ day, onDay }: { day: string; onDay: (day: string) => void }) {
  return (
    <div className="card flex h-full flex-col">
      <WeekHeader day={day} onDay={onDay} />
      <DayAgenda date={parseISO(day)} bare addButton={false} />
      <div className="mt-auto"><HomeQuickAdd day={day} /></div>
    </div>
  )
}
