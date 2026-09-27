import { CalendarDays, Plus } from 'lucide-react'
import { Button, Card, CardHeader } from '../../../../shared/ui'
import { useEntityModal } from '../../../../shared/modals'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import type { ScheduleBlock } from '../../../daily/types'
import { SourceNote } from './SourceNote'

// Mon-first week; days_of_week uses 0 = Sunday.
const WEEK: { dow: number; label: string }[] = [
  { dow: 1, label: 'Mon' }, { dow: 2, label: 'Tue' }, { dow: 3, label: 'Wed' }, { dow: 4, label: 'Thu' },
  { dow: 5, label: 'Fri' }, { dow: 6, label: 'Sat' }, { dow: 0, label: 'Sun' },
]

/** The recurring training plan by weekday, the weekly target, and how often
 *  that means each routine runs (it scales the planned volume below). */
export function WeeklyScheduleCard({ templates, targetDays, routineCount, passes }: {
  templates: ScheduleBlock[]
  targetDays: number | null
  routineCount: number
  passes: number
}) {
  const modal = useEntityModal()
  const weekdays = new Set(templates.flatMap(t => t.days_of_week))
  return (
    <Card className="max-w-2xl">
      <CardHeader
        icon={<CalendarDays />}
        title="Weekly schedule"
        subtitle={targetDays ? `Target ${targetDays} training ${targetDays === 1 ? 'day' : 'days'} a week` : 'No weekly target set (Coach → Profile)'}
        action={
          <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => modal.open({ kind: 'schedule-block', config: { heading: 'Weekly training session' }, defaults: { title: 'Training', category: 'training', recurrence: 'weekly' } })}>
            Add
          </Button>
        }
      />
      <div className="grid grid-cols-7 gap-1">
        {WEEK.map(d => {
          const items = templates.filter(t => t.days_of_week.includes(d.dow)).sort((a, b) => a.start_time.localeCompare(b.start_time))
          return (
            <div key={d.dow} className={`flex min-h-[64px] flex-col gap-1 rounded-row border p-1.5 ${weekdays.has(d.dow) ? 'border-accent-200 bg-accent-50' : 'border-line bg-surface'}`}>
              <span className="text-micro font-semibold uppercase text-fg-muted">{d.label}</span>
              {items.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => modal.open({ kind: 'schedule-block', id: t.id, config: { heading: 'Edit recurring session' } })}
                  className="min-h-[44px] truncate rounded-control text-left text-meta font-medium text-fg hover:underline"
                  title={`${t.title} · ${t.start_time.slice(0, 5)}`}
                >
                  <span className="block truncate">{t.title}</span>
                  <span className="block text-micro font-normal tabular-nums normal-case text-fg-muted">{t.start_time.slice(0, 5)}</span>
                </button>
              ))}
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex flex-col gap-1 border-t border-line pt-3">
        <p className="flex items-center gap-1.5 text-meta text-fg-muted">
          {routineCount > 0
            ? `${routineCount} ${routineCount === 1 ? 'routine' : 'routines'} over ${targetDays ?? (weekdays.size || 'an unknown number of')} days → each runs about ${passes}× a week.`
            : 'Pick your current program to see how often each routine runs.'}
          <InfoBubble>
            The planned weekly volume below multiplies each routine&apos;s sets by how often it runs: your weekly training-days
            target (or the weekdays your recurring training blocks cover) divided by the number of routines. For muscle growth,
            how you split a week matters little once weekly volume is equal; for strength, a second weekly exposure per lift
            helps most.
            <span className="mt-1.5 block"><SourceNote ids={['schoenfeld2019', 'pelland2025']} /></span>
          </InfoBubble>
        </p>
      </div>
    </Card>
  )
}
