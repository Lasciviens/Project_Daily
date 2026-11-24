import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, RefreshCw } from 'lucide-react'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button, Skeleton } from '../../../shared/ui'
import { toast } from '../../../app/store'
import { todayStr } from '../../../shared/utils/dateUtils'
import { formatDateRange } from '../../../shared/utils/dateFormat'
import { isClosedTask, isOpenTask, isOverdueOn } from '../../todo/taskRules'
import type { Task } from '../../todo/types'
import { useWeeklyGoals, useWorkNote } from '../hooks/useWork'
import { useWriteWeek } from '../../ai/claude/hooks/useAiFeatures'
import { costNote, weekBounds, weekInput, type WeekRules } from '../../ai/claude/featureRules'

// The task rules the week reads: all of them are taskRules' own (closed, open, overdue), never a test of this sheet's.
const RULES: WeekRules = {
  isClosed: t => isClosedTask(t as Task),
  isOpen: t => isOpenTask(t as Task),
  isOverdue: (t, today) => isOverdueOn(t as Task, today),
}

/**
 * "Write my week": a short status text for a manager or a team, built from this week's closed Work tasks, the Work
 * tasks still open (the overdue ones marked), the weekly goals and the notes. Code finds and counts them
 * (`weekInput`); the model only writes the sentences. The text is shown for editing with a Copy button — never saved.
 * "Write again" is a second paid call and keeps the text it replaces for Undo. With nothing to write about, no AI is asked.
 */
export default function WeekSheet({ tasks, onClose }: { tasks: Task[]; onClose: () => void }) {
  const today = todayStr()
  const { start, end } = weekBounds(today)
  const { data: goals = [], isLoading: goalsLoading } = useWeeklyGoals(start)
  const { data: note, isLoading: noteLoading } = useWorkNote()
  const write = useWriteWeek()
  const input = useMemo(() => weekInput(tasks, goals, note?.content, today, RULES), [tasks, goals, note, today])
  const nothing = input.closed.length === 0 && input.open.length === 0 && input.goals.length === 0 && !input.notes
  const [text, setText] = useState('')
  const [cost, setCost] = useState<number | null>(null)
  // The text a "Write again" replaced, for Undo (the owner's edits in it included).
  const [replaced, setReplaced] = useState<string | null>(null)
  const started = useRef(false)
  const loading = goalsLoading || noteLoading

  function run(again: boolean) {
    const before = text
    write.mutate(input as unknown as Record<string, unknown>, {
      onSuccess: r => { setText(r.text); setCost(r.costUsd); setReplaced(again && before.trim() ? before : null) },
    })
  }
  // Once, when the goals and the note have loaded (a second run is the "Write again" button).
  useEffect(() => {
    if (loading || started.current || nothing) return
    started.current = true
    write.mutate(input as unknown as Record<string, unknown>, { onSuccess: r => { setText(r.text); setCost(r.costUsd) } })
  }, [loading, nothing, write, input])

  async function copy() {
    try { await navigator.clipboard.writeText(text); toast.success('Copied') } catch { toast.error('Copy failed — select the text and copy it by hand') }
  }

  const facts = `${input.closed.length} closed · ${input.open_total} open${input.overdue_total ? ` (${input.overdue_total} overdue)` : ''} · ${input.goals.filter(g => g.done).length} of ${input.goals.length} goals`
  return (
    <ModalShell onClose={onClose} title="Write my week" subtitle={`${formatDateRange(new Date(`${start}T00:00:00`), new Date(`${end}T00:00:00`))} · ${facts}`} size="md" compact
      footer={
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" icon={<RefreshCw />} onClick={() => run(true)} disabled={loading || nothing || write.isPending} title="Write again — a second AI call: the text you have now is kept for Undo">Write again</Button>
          <Button size="sm" variant="ghost" onClick={onClose} className="ml-auto">Close</Button>
          <Button size="sm" variant="primary" icon={<Copy />} onClick={() => void copy()} disabled={!text.trim()}>Copy</Button>
        </div>
      }>
      {nothing && !loading ? (
        <p className="text-body text-fg-muted">Nothing to write about yet: no Work tasks, goals or notes this week.</p>
      ) : (write.isPending && !text) || loading ? (
        <div className="flex flex-col gap-2" aria-busy="true"><Skeleton className="h-4" /><Skeleton className="h-4 w-11/12" /><Skeleton className="h-4 w-4/5" /><Skeleton className="h-4 w-2/3" /></div>
      ) : write.isError && !text ? (
        <Button size="sm" onClick={() => run(false)}>Try again</Button>
      ) : (
        <div className="flex flex-col gap-1.5">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={9} maxLength={1500} aria-label="The week's status text" className="input w-full resize-y py-2" aria-busy={write.isPending || undefined} />
          <p className="text-meta text-fg-muted">
            Written by AI{costNote(cost) ? ` (${costNote(cost)})` : ''} from your closed and open tasks, goals and notes — read it before you send it. Not saved.
            {replaced !== null && <> <button type="button" className="font-semibold text-accent-600 hover:underline" onClick={() => { setText(replaced); setReplaced(null) }} title="Undo the rewrite">Undo</button></>}
          </p>
        </div>
      )}
    </ModalShell>
  )
}
