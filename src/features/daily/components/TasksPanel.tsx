import { useMemo, type ReactNode } from 'react'
import { useAllTasks } from '../../todo/hooks/useTodos'
import { ToDoItem } from '../../todo/components/ToDoItem'
import { useNewIds } from '../../../shared/hooks/useNewIds'
import { taskGroups } from '../../todo/taskRules'
import { formatLocalDate } from '../../../shared/utils/dateUtils'
import { CheckCircle2 } from 'lucide-react'
import { Card, EmptyState, PageBoard, Skeleton, ToneDot, type Tone } from '../../../shared/ui'
import type { Task } from '../../todo/types'
import { TASKS_BOARD, TASK_SECTION_GROUPS, TASK_SECTIONS, type TaskGroup, type TaskSection } from '../dailyBoards'

// Aggregated "all my tasks" view for the Daily page (dev request "Tasks":
// tasklarımı göremiyorum artık — geçmiş/açık/ilerideki tasklarımı güzel bir UI
// ile göster). Groups every active task by due date; ToDoItem already carries
// the complete checkbox + Cancel (≠ delete) actions. One card on phones and
// narrow pages; on a wide page the groups become columns (dailyBoards.ts).

const GROUP_META: Record<TaskGroup, { title: string; tone: Tone }> = {
  overdue:  { title: 'Overdue', tone: 'danger' },
  openNow:  { title: 'Open now', tone: 'info' },
  today:    { title: 'Today', tone: 'accent' },
  upcoming: { title: 'Upcoming', tone: 'neutral' },
  noDate:   { title: 'No date', tone: 'neutral' },
  done:     { title: 'Done today', tone: 'success' },
}

/** What a column card says when all of its groups are empty. */
const EMPTY_TEXT: Record<TaskSection, string> = {
  all: '',
  now: 'Nothing overdue or due today.',
  upcoming: 'Nothing upcoming.',
  noDate: 'No undated tasks.',
  done: 'Nothing finished today.',
  later: 'Nothing upcoming, undated or done today.',
  noDateDone: 'No undated tasks, nothing done today.',
}

function Section({ title, tasks, tone, fresh }: { title: string; tasks: Task[]; tone: Tone; fresh: ReadonlySet<string> }) {
  if (tasks.length === 0) return null
  return (
    <section className="border-t border-line pt-3 first:border-t-0 first:pt-0">
      <h3 className="mb-1.5 flex items-center gap-2 px-1">
        <ToneDot tone={tone} />
        <span className="section-label">{title}</span>
        <span className="count-badge">{tasks.length}</span>
      </h3>
      <div className="flex flex-col gap-1">
        {tasks.map(t => <ToDoItem key={t.id} task={t} isNew={fresh.has(t.id)} />)}
      </div>
    </section>
  )
}

export function TasksPanel() {
  const { data: tasks = [], isLoading } = useAllTasks()
  const fresh = useNewIds(tasks.map(t => t.id), 'all', !isLoading)
  const today = formatLocalDate(new Date())

  // The groups come from the task rules every page shares (taskRules.taskGroups).
  const g = useMemo(() => taskGroups(tasks, today), [tasks, today])

  if (isLoading) {
    return (
      <Card className="flex max-w-2xl flex-col gap-1.5">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-11" rounded="rounded-row" />)}
      </Card>
    )
  }

  const empty = g.overdue.length + g.openNow.length + g.today.length
    + g.upcoming.length + g.noDate.length + g.done.length === 0
  if (empty) {
    return <EmptyState bordered className="max-w-2xl" icon={<CheckCircle2 />} title="No tasks" description="You're all caught up — new tasks show up here across every day." />
  }

  const card = (key: TaskSection, className?: string) => {
    const groups = TASK_SECTION_GROUPS[key]
    const empty = groups.every(id => g[id].length === 0)
    return (
      <Card className={className ?? 'flex flex-col gap-3'}>
        {groups.map(id => <Section key={id} title={GROUP_META[id].title} tasks={g[id]} tone={GROUP_META[id].tone} fresh={fresh} />)}
        {/* An empty column keeps the same heading row (with a 0 badge) as its
            neighbours, so the column tops line up. */}
        {empty && (
          <div>
            {groups.length === 1 && (
              <h3 className="mb-1.5 flex items-center gap-2 px-1">
                <ToneDot tone={GROUP_META[groups[0]].tone} />
                <span className="section-label">{GROUP_META[groups[0]].title}</span>
                <span className="count-badge">0</span>
              </h3>
            )}
            <p className="px-1 text-body text-fg-muted">{EMPTY_TEXT[key]}</p>
          </div>
        )}
      </Card>
    )
  }
  const sections = Object.fromEntries(TASK_SECTIONS.map(k => [k, card(k)])) as Record<TaskSection, ReactNode>
  sections.all = card('all', 'flex max-w-2xl flex-col gap-3 stagger-in')

  return <PageBoard sections={sections} layout={TASKS_BOARD} />
}
