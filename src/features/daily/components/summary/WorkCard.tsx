import { useState } from 'react'
import { Link } from 'react-router-dom'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { useWorkTasksForDay } from '../../hooks/useDailyHub'
import { useToggleTask, useCreateTask } from '../../../todo/hooks/useTodos'
import type { Task } from '../../../todo/types'

// 💼 Today's work at a glance: due/overdue work-domain tasks, checkable and
// quick-addable here — the full board stays on /work.
export function WorkCard({ date }: { date: string }) {
  const { data: tasks = [] } = useWorkTasksForDay(date)
  const toggle = useToggleTask()
  const create = useCreateTask()
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')

  const open = tasks.filter((t: Task) => t.status !== 'done').slice(0, 5)
  const doneToday = tasks.filter((t: Task) => t.status === 'done' && t.due_date === date).length
  const isPastDue = (t: Task) => t.due_date != null && t.due_date < todayStr()

  function save() {
    const title = text.trim()
    if (!title || create.isPending) return // guard: a held/repeated Enter must not create duplicates
    create.mutate(
      { title, domain: 'work', section: 'today', priority: 'medium', due_date: date },
      { onSuccess: () => { setText(''); setAdding(false) } },
    )
  }

  return (
    <div className="rounded-2xl border border-ink-200 bg-cream-50 p-4 flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink-800 flex items-center gap-1.5">
          💼 Work
          {doneToday > 0 && <span className="text-[10px] font-semibold text-green-600">{doneToday} done ✓</span>}
        </h3>
        <Link to="/work" className="text-[11px] text-accent-600 hover:text-accent-700 min-h-[28px] px-1.5 flex items-center">
          Board →
        </Link>
      </div>

      {open.length === 0 ? (
        <p className="text-xs text-ink-400 py-1">No open work tasks for this day ✓</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {open.map((t: Task) => (
            <li key={t.id} className="flex items-center gap-2">
              <button
                onClick={() => toggle.mutate({ id: t.id, isDone: t.status === 'done' })}
                title="Mark done"
                className="w-4 h-4 rounded-full border-2 border-ink-300 hover:border-green-500 hover:bg-green-100 transition-colors shrink-0"
              />
              <p className="text-xs font-medium text-ink-800 truncate flex-1 leading-snug">
                {t.title}
                {isPastDue(t) && <span className="ml-1.5 text-[9px] text-red-500 font-semibold">overdue</span>}
              </p>
              {t.priority === 'high' && <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />}
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <input
          autoFocus value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setAdding(false) }}
          onBlur={() => { if (!text.trim()) setAdding(false) }}
          placeholder="New work task…"
          className="px-2 py-1.5 rounded-lg border border-accent-300 bg-cream-50 text-xs focus:outline-none focus:ring-1 focus:ring-accent-400 min-h-[32px]"
        />
      ) : (
        <button onClick={() => setAdding(true)} className="text-xs text-ink-300 hover:text-accent-600 text-left transition-colors min-h-[24px]">
          + add work task
        </button>
      )}
    </div>
  )
}
