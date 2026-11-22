import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, RefreshCw, Sparkles } from 'lucide-react'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button, Skeleton } from '../../../shared/ui'
import { toast } from '../../../app/store'
import { todayStr } from '../../../shared/utils/dateUtils'
import { formatDateRange } from '../../../shared/utils/dateFormat'
import { isClosedTask } from '../../todo/taskRules'
import type { Task } from '../../todo/types'
import { useWeeklyGoals, useWorkNote } from '../hooks/useWork'
import { useWriteWeek } from '../../ai/claude/hooks/useAiFeatures'
import { weekBounds, weekInput } from '../../ai/claude/featureRules'

/**
 * "Write my week": a short status text for a manager or a team, built from this week's closed Work tasks, the weekly
 * goals and the notes. Code finds and counts them (`weekInput`); the model only writes the sentences. The text is shown
 * for editing with a Copy button — never saved. With nothing to write about, no AI is asked.
 */
function WeekSheet({ tasks, onClose }: { tasks: Task[]; onClose: () => void }) {
  const today = todayStr()
  const { start, end } = weekBounds(today)
  const { data: goals = [], isLoading: goalsLoading } = useWeeklyGoals(start)
  const { data: note, isLoading: noteLoading } = useWorkNote()
  const write = useWriteWeek()
  const input = useMemo(() => weekInput(tasks, goals, note?.content, today, status => isClosedTask({ status } as Task)), [tasks, goals, note, today])
  const nothing = input.closed.length === 0 && input.goals.length === 0 && !input.notes
  const [text, setText] = useState('')
  const started = useRef(false)
  const loading = goalsLoading || noteLoading

  function run() {
    write.mutate(input as unknown as Record<string, unknown>, { onSuccess: setText })
  }
  // Once, when the goals and the note have loaded (a second run is the "Write again" button).
  useEffect(() => {
    if (loading || started.current || nothing) return
    started.current = true
    write.mutate(input as unknown as Record<string, unknown>, { onSuccess: setText })
  }, [loading, nothing, write, input])

  async function copy() {
    try { await navigator.clipboard.writeText(text); toast.success('Copied') } catch { toast.error('Copy failed — select the text and copy it by hand') }
  }

  const facts = `${input.closed.length} closed · ${input.goals.filter(g => g.done).length} of ${input.goals.length} goals`
  return (
    <ModalShell onClose={onClose} title="Write my week" subtitle={`${formatDateRange(new Date(`${start}T00:00:00`), new Date(`${end}T00:00:00`))} · ${facts}`} size="md" compact
      footer={
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" icon={<RefreshCw />} onClick={run} disabled={loading || nothing || write.isPending}>Write again</Button>
          <Button size="sm" variant="ghost" onClick={onClose} className="ml-auto">Close</Button>
          <Button size="sm" variant="primary" icon={<Copy />} onClick={() => void copy()} disabled={!text.trim()}>Copy</Button>
        </div>
      }>
      {nothing && !loading ? (
        <p className="text-body text-fg-muted">Nothing to write about yet: no closed Work tasks, goals or notes this week.</p>
      ) : write.isPending || loading ? (
        <div className="flex flex-col gap-2" aria-busy="true"><Skeleton className="h-4" /><Skeleton className="h-4 w-11/12" /><Skeleton className="h-4 w-4/5" /><Skeleton className="h-4 w-2/3" /></div>
      ) : write.isError ? (
        <Button size="sm" onClick={run}>Try again</Button>
      ) : (
        <div className="flex flex-col gap-1.5">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={9} maxLength={1500} aria-label="The week's status text" className="input w-full resize-y py-2" />
          <p className="text-meta text-fg-muted">Written by AI from your closed tasks, goals and notes — read it before you send it. Not saved.</p>
        </div>
      )}
    </ModalShell>
  )
}

/** The button under "This week" and its sheet. */
export function WriteWeek({ tasks }: { tasks: Task[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant="ghost" icon={<Sparkles />} onClick={() => setOpen(true)} className="mt-2 -ml-2">Write my week</Button>
      {open && <WeekSheet tasks={tasks} onClose={() => setOpen(false)} />}
    </>
  )
}
