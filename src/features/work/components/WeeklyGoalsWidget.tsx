import { useState, useRef, useEffect } from 'react'
import { toast } from '../../../app/store'
import {
  useWeeklyGoals,
  useCreateWeeklyGoal,
  useToggleWeeklyGoal,
  useDeleteWeeklyGoal,
} from '../hooks/useWork'

function getMondayOfWeek(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  return d.toISOString().split('T')[0]
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

// bare = no own header label — rendered inside WorkSidebar's RailSection
export default function WeeklyGoalsWidget({ bare }: { bare?: boolean } = {}) {
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

  async function handleCreate() {
    const title = newTitle.trim()
    if (!title) { setShowAdd(false); return }
    setNewTitle('')
    setShowAdd(false)
    try {
      await createGoal.mutateAsync({ weekStart, title })
    } catch (err) {
      toast.error((err as Error).message ?? 'Failed to add goal')
    }
  }

  async function handleToggle(id: string, done: boolean) {
    try {
      await toggleGoal.mutateAsync({ id, done: !done })
    } catch (err) {
      toast.error((err as Error).message ?? 'Failed to update goal')
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteGoal.mutateAsync(id)
    } catch (err) {
      toast.error((err as Error).message ?? 'Failed to delete goal')
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        {!bare && (
          <span className="text-[10px] font-semibold tracking-widest uppercase text-ink-400">
            This Week
          </span>
        )}
        <span className="text-xs text-ink-400 ml-auto">{formatWeekRange(weekStart)}</span>
      </div>

      {/* Goal list */}
      <ul className="flex flex-col gap-0.5">
        {goals.map(goal => (
          <li
            key={goal.id}
            className="group flex items-center gap-2 rounded-lg px-1 hover:bg-cream-50 transition"
          >
            <label className="flex items-center gap-2 flex-1 min-h-[44px] cursor-pointer">
              <input
                type="checkbox"
                checked={goal.done}
                onChange={() => handleToggle(goal.id, goal.done)}
                className="w-4 h-4 rounded border-ink-300 accent-accent-600 cursor-pointer flex-shrink-0"
              />
              <span
                className={`text-sm flex-1 ${
                  goal.done ? 'line-through text-ink-300' : 'text-ink-800'
                }`}
              >
                {goal.title}
              </span>
            </label>
            <button
              onClick={() => handleDelete(goal.id)}
              aria-label="Delete goal"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center text-ink-300 hover:text-ink-600 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition text-base leading-none"
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      {/* Add input */}
      {showAdd ? (
        <div className="flex items-center gap-2 mt-1">
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
            className="flex-1 min-h-[44px] bg-cream-50 rounded-xl px-3 text-sm text-ink-900 placeholder:text-ink-300 outline-none focus:ring-1 focus:ring-ink-200 transition"
          />
        </div>
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          className="min-h-[44px] text-left text-sm text-ink-400 hover:text-ink-600 transition px-1"
        >
          + Add goal
        </button>
      )}
    </div>
  )
}
