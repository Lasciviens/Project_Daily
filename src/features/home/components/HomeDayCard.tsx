import { useState, type FormEvent } from 'react'
import { parseISO } from 'date-fns'
import { Plus } from 'lucide-react'
import { IconButton } from '../../../shared/ui'
import { DayAgenda } from '../../daily/components/DayAgenda'
import { useSaveItem } from '../../items/useItems'
import { parseQuickAdd } from '../../items/quickAdd'
import { itemFromQuickAdd } from '../../items/sheetRules'
import { ReadAsLine } from '../../items/components/ReadAsLine'
import { useCalendarStore } from '../../../app/store'
import { todayStr } from '../../../shared/utils/dateUtils'

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
          placeholder={day === todayStr() ? 'Add for today — e.g. Gym 17:30 1h' : 'Add for this day — e.g. Gym 17:30 1h'}
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
 * The picked day as ONE list on Home, the same as Daily's (owner, 31.10.2026, option 1): a task with its slot, a
 * repeat's day and a training session are each one row with their tick (daily/dayItems.ts) — Home used to show the
 * day twice, in the week card and in a separate tasks card. The day is the week strip's pick.
 */
export function HomeDayCard({ day }: { day: string }) {
  return (
    <div className="card flex flex-col">
      <DayAgenda date={parseISO(day)} bare />
      <HomeQuickAdd day={day} />
    </div>
  )
}
