import { useState, useRef, useEffect } from 'react'
import { format, addDays, isToday, isTomorrow } from 'date-fns'
import { useCreateTask } from '../../todo/hooks/useTodos'

interface Props {
  entryId: string
  sourceType: 'movie' | 'tv_series'
  title: string
  currentSeason?: number
  currentEpisode?: number
  releaseDate?: string | null
}

function dateToSection(date: Date): 'today' | 'tomorrow' | 'this_week' {
  if (isToday(date))    return 'today'
  if (isTomorrow(date)) return 'tomorrow'
  return 'this_week'
}

function labelForDate(date: Date): string {
  if (isToday(date))    return `Today · ${format(date, 'd MMM')}`
  if (isTomorrow(date)) return `Tomorrow · ${format(date, 'd MMM')}`
  return format(date, 'd MMM yyyy')
}

export function PlanThisButton({
  entryId, sourceType, title, currentSeason, currentEpisode, releaseDate,
}: Props) {
  const [open, setOpen]         = useState(false)
  const [plannedFor, setPlannedFor] = useState<string | null>(null)
  const [customDate, setCustomDate] = useState('')
  const [planning, setPlanning] = useState<string | null>(null) // which date is loading
  const popoverRef              = useRef<HTMLDivElement>(null)
  const createTask              = useCreateTask()

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
    const key = format(date, 'yyyy-MM-dd')
    setPlanning(key)
    try {
      await createTask.mutateAsync({
        title:       buildTitle(),
        domain:      'media',
        section:     dateToSection(date),
        priority:    'medium',
        due_date:    key,
        source_type: sourceType,
        source_id:   entryId,
      })
      setPlannedFor(labelForDate(date))
      setTimeout(() => {
        setOpen(false)
        setPlannedFor(null)
      }, 1200)
    } finally {
      setPlanning(null)
    }
  }

  const quickDates = [
    new Date(),
    addDays(new Date(), 1),
    addDays(new Date(), 3),
  ]

  const releaseOption = releaseDate
    ? (() => { const d = new Date(releaseDate + 'T12:00:00'); return d > new Date() ? d : null })()
    : null

  const isSuccessShowing = !!plannedFor

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`text-[11px] font-medium px-2 py-1 rounded transition-colors duration-150 ${
          isSuccessShowing
            ? 'bg-green-100 text-green-700'
            : 'bg-accent-100 text-accent-700 hover:bg-accent-200'
        }`}
      >
        {isSuccessShowing ? '✓ Planned' : '📅 Plan'}
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute z-30 bottom-8 left-0 card p-3 w-52 shadow-lg"
        >
          {plannedFor ? (
            <div className="flex items-center gap-2 py-1">
              <span className="text-green-500 text-base">✓</span>
              <span className="text-sm font-medium text-ink-800">Added for {plannedFor}</span>
            </div>
          ) : (
            <>
              <p className="text-[10px] text-ink-400 uppercase font-semibold tracking-wider mb-2">
                Plan for…
              </p>
              <div className="flex flex-col gap-0.5">
                {quickDates.map(d => {
                  const key     = format(d, 'yyyy-MM-dd')
                  const loading = planning === key
                  return (
                    <button
                      key={key}
                      onClick={() => plan(d)}
                      disabled={!!planning}
                      className="text-xs text-left px-2 py-1.5 rounded hover:bg-cream-100 text-ink-700 transition-colors duration-150 disabled:opacity-50 flex items-center justify-between"
                    >
                      <span>{labelForDate(d)}</span>
                      {loading && <span className="text-accent-500 text-[10px]">…</span>}
                    </button>
                  )
                })}

                {releaseOption && (
                  <>
                    <div className="border-t border-ink-100 my-1" />
                    <button
                      onClick={() => plan(releaseOption)}
                      disabled={!!planning}
                      className="text-xs text-left px-2 py-1.5 rounded hover:bg-cream-100 text-accent-600 transition-colors duration-150 disabled:opacity-50 flex items-center justify-between"
                    >
                      <span>Release · {format(releaseOption, 'd MMM yyyy')}</span>
                      {planning === format(releaseOption, 'yyyy-MM-dd') && (
                        <span className="text-accent-500 text-[10px]">…</span>
                      )}
                    </button>
                  </>
                )}
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
                    onClick={() => plan(new Date(customDate + 'T12:00:00'))}
                    disabled={!!planning}
                    className="btn-primary w-full mt-2 text-xs py-1 disabled:opacity-50"
                  >
                    {planning ? '…' : `Set · ${format(new Date(customDate + 'T12:00:00'), 'd MMM yyyy')}`}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
