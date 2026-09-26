import { useState, useRef, useEffect } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '../../../shared/ui'
import {
  useWeeklyGoals,
  useCreateWeeklyGoal,
  useToggleWeeklyGoal,
  useDeleteWeeklyGoal,
} from '../hooks/useWork'

// Local calendar date, not UTC — toISOString() shifts to UTC and can land on
// the wrong day near midnight (e.g. Norway UTC+1/+2), making "this week"
// resolve to the wrong Monday for an hour or two after midnight.
function getMondayOfWeek(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatWeekRange(mondayStr: string): string {
  const monday = new Date(mondayStr + 'T00:00:00')
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric' })
  const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'short' })
  const startDay = dayFmt.format(monday)
  const endDay = dayFmt.format(sunday)
  const endMonth = monthFmt.format(sunday)
  // If same month show "16–22 Jun", else "30 Jun – 6 Jul"
  if (monday.getMonth() === sunday.getMonth()) {
    return `${startDay}–${endDay} ${endMonth}`
  }
  return `${startDay} ${monthFmt.format(monday)} – ${endDay} ${endMonth}`
}

// Rendered inside WorkSidebar's rail card (no chrome of its own).
export default function WeeklyGoalsWidget() {
  const weekStart = getMondayOfWeek(new Date())
  const { data: goals = [] } = useWeeklyGoals(weekStart)
  const createGoal = useCreateWeeklyGoal()
  const toggleGoal = useToggleWeeklyGoal()
  const deleteGoal = useDeleteWeeklyGoal()

  const [showAdd, setShowAdd] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (showAdd) inputRef.current?.focus()
  }, [showAdd])

  function handleCreate() {
    const title = newTitle.trim()
    setNewTitle('')
    setShowAdd(false)
    if (title) createGoal.mutate({ weekStart, title })
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="self-end text-meta tabular-nums text-fg-muted">{formatWeekRange(weekStart)}</span>

      <ul className="flex flex-col">
        {goals.map(goal => (
          <li key={goal.id} className="group flex items-center gap-1 rounded-row pl-1 transition-colors [@media(hover:hover)]:hover:bg-surface-hover">
            <label className="flex min-h-[44px] flex-1 cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={goal.done}
                onChange={() => toggleGoal.mutate({ id: goal.id, done: !goal.done })}
                className="h-4 w-4 shrink-0 cursor-pointer rounded accent-accent-500"
              />
              <span className={goal.done ? 'flex-1 text-body text-fg-faint line-through' : 'flex-1 text-body text-fg'}>
                {goal.title}
              </span>
            </label>
            <button
              type="button"
              onClick={() => deleteGoal.mutate(goal.id)}
              aria-label={`Delete goal ${goal.title}`}
              className="grid min-h-[44px] min-w-[44px] place-items-center rounded-control text-fg-faint transition-opacity focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:hover:text-danger"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>

      {showAdd ? (
        <input
          ref={inputRef}
          type="text"
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') handleCreate()
            if (e.key === 'Escape') { setShowAdd(false); setNewTitle('') }
          }}
          onBlur={handleCreate}
          placeholder="New goal…"
          aria-label="New goal"
          className="input mt-1"
        />
      ) : (
        <Button variant="ghost" size="sm" icon={<Plus />} onClick={() => setShowAdd(true)} className="self-start">Add goal</Button>
      )}
    </div>
  )
}
