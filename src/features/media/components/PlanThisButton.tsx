import { useState, useRef, useEffect } from 'react'
import { format, addDays } from 'date-fns'
import { useCreateTask } from '../../todo/hooks/useTodos'

interface Props {
  entryId: string
  sourceType: 'movie' | 'tv_series'
  title: string
  currentSeason?: number
  currentEpisode?: number
}

const today    = () => new Date()
const tomorrow = () => addDays(new Date(), 1)

function dateToSection(date: Date): string {
  const todayStr    = format(new Date(), 'yyyy-MM-dd')
  const tomorrowStr = format(addDays(new Date(), 1), 'yyyy-MM-dd')
  const dateStr     = format(date, 'yyyy-MM-dd')
  if (dateStr === todayStr)    return 'today'
  if (dateStr === tomorrowStr) return 'tomorrow'
  return 'this_week'
}

export function PlanThisButton({ entryId, sourceType, title, currentSeason, currentEpisode }: Props) {
  const [open, setOpen]           = useState(false)
  const [success, setSuccess]     = useState(false)
  const [customDate, setCustomDate] = useState('')
  const popoverRef                = useRef<HTMLDivElement>(null)
  const createTask                = useCreateTask()

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function buildTitle() {
    if (sourceType === 'tv_series' && currentSeason !== undefined && currentEpisode !== undefined) {
      return `Watch: ${title} S${currentSeason}E${currentEpisode + 1}`
    }
    return `Watch: ${title}`
  }

  async function plan(date: Date) {
    const dateStr = format(date, 'yyyy-MM-dd')
    await createTask.mutateAsync({
      title:       buildTitle(),
      domain:      'media',
      section:     dateToSection(date) as 'today' | 'tomorrow' | 'this_week',
      priority:    'medium',
      due_date:    dateStr,
      source_type: sourceType,
      source_id:   entryId,
    })
    setOpen(false)
    setSuccess(true)
    setTimeout(() => setSuccess(false), 2000)
  }

  async function planCustom() {
    if (!customDate) return
    await plan(new Date(customDate + 'T12:00:00'))
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`text-[11px] font-medium px-2 py-1 rounded transition-colors duration-150 ${
          success
            ? 'bg-green-100 text-green-700'
            : 'bg-accent-100 text-accent-700 hover:bg-accent-200'
        }`}
      >
        {success ? '✓ Planned' : '📅 Plan'}
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute z-30 bottom-8 left-0 card p-3 w-44 shadow-lg"
        >
          <p className="text-[10px] text-ink-400 uppercase font-semibold tracking-wider mb-2">
            Plan for…
          </p>
          <div className="flex flex-col gap-1">
            <button
              onClick={() => plan(today())}
              className="text-xs text-left px-2 py-1.5 rounded hover:bg-cream-100 text-ink-700 transition-colors duration-150"
            >
              Today
            </button>
            <button
              onClick={() => plan(tomorrow())}
              className="text-xs text-left px-2 py-1.5 rounded hover:bg-cream-100 text-ink-700 transition-colors duration-150"
            >
              Tomorrow
            </button>
            <button
              onClick={() => plan(addDays(new Date(), 3))}
              className="text-xs text-left px-2 py-1.5 rounded hover:bg-cream-100 text-ink-700 transition-colors duration-150"
            >
              This week
            </button>
          </div>
          <div className="mt-2 pt-2 border-t border-ink-100">
            <input
              type="date"
              value={customDate}
              onChange={e => setCustomDate(e.target.value)}
              className="input text-xs py-1 px-2 w-full"
            />
            {customDate && (
              <button
                onClick={planCustom}
                disabled={createTask.isPending}
                className="btn-primary w-full mt-2 text-xs py-1"
              >
                {createTask.isPending ? '…' : 'Set date'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
