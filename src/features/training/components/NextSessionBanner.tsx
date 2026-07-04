import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, addDays, parseISO, differenceInCalendarDays } from 'date-fns'
import { useTrainingBlocks } from '../../daily/hooks/useSchedule'
import { supabase } from '../../../integrations/supabase/client'
import { UnifiedPlanModal } from '../../../shared/components/plan-modal'
import type { TimeBlock } from '../../daily/types'
import type { Task } from '../../todo/types'

// Local YYYY-MM-DD (no UTC shift)
function ymd(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

function relativeDay(dateStr: string): string {
  const days = differenceInCalendarDays(parseISO(dateStr), new Date())
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days < 7)   return format(parseISO(dateStr), 'EEEE')          // e.g. Friday
  return format(parseISO(dateStr), 'EEE d MMM')                      // e.g. Mon 14 Jul
}

/**
 * Compact banner showing the next planned training session — the soonest
 * future `time_blocks` row with category='training'. Hidden when none planned.
 * Always clickable: opens the linked task (source_type='task' blocks) or, for
 * a plain time-block-only session, edits that block directly via
 * UnifiedPlanModal's timeBlock prop.
 */
export function NextSessionBanner() {
  const [editOpen, setEditOpen] = useState(false)
  const today = ymd(new Date())
  const to    = ymd(addDays(new Date(), 30))
  const { data: blocks = [] } = useTrainingBlocks(today, to)

  const nowHHMM = format(new Date(), 'HH:mm')
  const upcoming = blocks
    .filter((b: TimeBlock) => b.date > today || (b.date === today && (b.start_time ?? '99:99') >= nowHHMM))
    .sort((a, b) => (a.date + (a.start_time ?? '')).localeCompare(b.date + (b.start_time ?? '')))

  const next = upcoming[0]
  const isTaskLinked = next?.source_type === 'task' && !!next.source_id

  const { data: task } = useQuery({
    queryKey: ['tasks', 'byId', next?.source_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('tasks').select('*').eq('id', next!.source_id!).single()
      if (error) throw error
      return data as Task
    },
    enabled: isTaskLinked,
    staleTime: 60_000,
  })

  if (!next) return null

  const time = next.start_time ? next.start_time.slice(0, 5) : null

  return (
    <>
      <button
        type="button"
        onClick={() => setEditOpen(true)}
        title="Edit this session"
        className="w-full flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 mb-4 text-left transition-colors duration-150 hover:bg-blue-100 cursor-pointer"
      >
        <span className="text-xl flex-shrink-0">🏋️</span>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-500">Next session</p>
          <p className="text-sm font-semibold text-ink-900 truncate">{next.title}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-sm font-bold text-blue-700">{relativeDay(next.date)}</p>
          {time && <p className="text-xs text-ink-500">{time}</p>}
        </div>
      </button>

      <UnifiedPlanModal
        open={editOpen && (isTaskLinked ? !!task : true)}
        onClose={() => setEditOpen(false)}
        config={{ tabs: ['task', 'schedule'], heading: 'Edit Session' }}
        task={isTaskLinked ? task : undefined}
        timeBlock={!isTaskLinked ? next : undefined}
      />
    </>
  )
}
