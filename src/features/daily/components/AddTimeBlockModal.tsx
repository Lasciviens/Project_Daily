import { useState } from 'react'
import { useCreateTimeBlock, useCreateScheduleBlock } from '../hooks/useSchedule'

const DURATIONS = [
  { label: '30 min',  value: 30  },
  { label: '1 hour',  value: 60  },
  { label: '1.5 hr',  value: 90  },
  { label: '2 hours', value: 120 },
  { label: '2h 40m',  value: 160 },
  { label: '3 hours', value: 180 },
]

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface Props {
  dateStr: string
  onClose: () => void
}

export function AddTimeBlockModal({ dateStr, onClose }: Props) {
  const [tab,       setTab]       = useState<'once' | 'recurring'>('once')
  const [title,     setTitle]     = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [duration,  setDuration]  = useState(60)
  const [customMin, setCustomMin] = useState('')
  const [days,      setDays]      = useState<number[]>([1, 2, 3, 4, 5]) // Mon–Fri
  const [endTime,   setEndTime]   = useState('17:00')

  const createBlock     = useCreateTimeBlock()
  const createRecurring = useCreateScheduleBlock()

  const actualDuration = customMin ? parseInt(customMin) : duration

  async function handleSubmit() {
    if (!title.trim()) return
    if (tab === 'once') {
      await createBlock.mutateAsync({
        date:             dateStr,
        title:            title.trim(),
        start_time:       startTime ? `${startTime}:00` : null,
        duration_minutes: actualDuration,
      })
    } else {
      await createRecurring.mutateAsync({
        title:        title.trim(),
        days_of_week: days,
        start_time:   `${startTime}:00`,
        end_time:     `${endTime}:00`,
        color:        'blue',
      })
    }
    onClose()
  }

  const isPending = createBlock.isPending || createRecurring.isPending

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink-900/30">
      <div className="card w-full max-w-sm p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-ink-900">Add time block</h3>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700 text-xl leading-none">×</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 bg-cream-100 p-1 rounded-lg">
          {(['once', 'recurring'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 text-xs py-1 rounded-md font-medium transition-colors duration-150 ${
                tab === t ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500'
              }`}
            >
              {t === 'once' ? 'One-off' : 'Recurring'}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <input
            type="text"
            placeholder="Block title…"
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="input w-full text-sm"
            autoFocus
          />

          {tab === 'once' ? (
            <>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[10px] text-ink-400 uppercase tracking-wider font-semibold">Start time</label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={e => setStartTime(e.target.value)}
                    className="input w-full text-sm mt-1"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-ink-400 uppercase tracking-wider font-semibold">Duration</label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {DURATIONS.map(d => (
                    <button
                      key={d.value}
                      onClick={() => { setDuration(d.value); setCustomMin('') }}
                      className={`text-xs px-2 py-1 rounded-full border transition-colors duration-150 ${
                        duration === d.value && !customMin
                          ? 'bg-accent-500 border-accent-500 text-white'
                          : 'border-ink-200 text-ink-600 hover:border-accent-400'
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  placeholder="Custom minutes…"
                  value={customMin}
                  onChange={e => setCustomMin(e.target.value)}
                  className="input w-full text-sm mt-2"
                  min={5}
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="text-[10px] text-ink-400 uppercase tracking-wider font-semibold">Days</label>
                <div className="flex gap-1 mt-1">
                  {DAY_LABELS.map((d, i) => (
                    <button
                      key={i}
                      onClick={() => setDays(prev =>
                        prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]
                      )}
                      className={`w-8 h-8 rounded-full text-[11px] font-medium transition-colors duration-150 ${
                        days.includes(i)
                          ? 'bg-accent-500 text-white'
                          : 'bg-ink-100 text-ink-500'
                      }`}
                    >
                      {d[0]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[10px] text-ink-400 uppercase tracking-wider font-semibold">Start</label>
                  <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="input w-full text-sm mt-1" />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] text-ink-400 uppercase tracking-wider font-semibold">End</label>
                  <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className="input w-full text-sm mt-1" />
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 btn-secondary text-sm py-1.5">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || isPending}
            className="flex-1 btn-primary text-sm py-1.5 disabled:opacity-50"
          >
            {isPending ? 'Adding…' : 'Add block'}
          </button>
        </div>
      </div>
    </div>
  )
}
