import { localDayOf } from '../../shared/utils/dateUtils'
import { formatDate } from '../../shared/utils/dateFormat'
import { labelsOf, cleanLabels } from './taskLabels'
import { isTrainingTask, sectionForDay } from './taskRules'
import type { Task, UpdateTaskInput } from './types'

// "Needs a decision": open tasks the owner keeps seeing and never settles.
// Plain rules, no AI. It only ADDS a list — no existing query or list changes
// (NEVER_HIDES). Two kinds:
//   · stuck — still open a week or more after its due day. Missed repeat days
//     are closed by the database and never carried over (docs/features/tasks.md),
//     so no "rolled over N times" counter exists; the days past due is the
//     honest stand-in (a task nobody moved is one nobody decided about).
//   · undated — no date at all for 30+ days since it was made.
// A task parked under the label "Someday" is a decision already made and
// leaves the list; so do waiting tasks (waiting on someone), training
// sessions, a repeat's day and a project's undated tasks (a project's
// backlog is undated by design).

export const STUCK_DAYS = 7
export const UNDATED_DAYS = 30
export const SOMEDAY_LABEL = 'Someday'

export type DecisionKind = 'stuck' | 'undated'
export interface DecisionRow { task: Task; kind: DecisionKind; days: number; text: string }

/** Whole days from `day` to `today` (yyyy-MM-dd both). */
function daysBetween(day: string, today: string): number {
  const p = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) }
  return Math.round((p(today) - p(day)) / 86400000)
}

const plural = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`

export function isSomeday(task: Pick<Task, 'labels'>): boolean {
  return labelsOf(task).some(l => l.toLowerCase() === SOMEDAY_LABEL.toLowerCase())
}

/** The tasks that need a decision, the longest-waiting first. */
export function needsDecision(tasks: readonly Task[], today: string): DecisionRow[] {
  const rows: DecisionRow[] = []
  for (const task of tasks) {
    if (task.status !== 'open' && task.status !== 'in_progress') continue
    if (isTrainingTask(task) || task.schedule_block_id || isSomeday(task)) continue
    if (task.due_date) {
      const late = daysBetween(task.due_date, today)
      if (late >= STUCK_DAYS) rows.push({ task, kind: 'stuck', days: late, text: `Due ${formatDate(task.due_date)} · ${plural(late)} late` })
    } else if (!task.start_date && !task.project_id) {
      const made = localDayOf(task.created_at)
      const age = made ? daysBetween(made, today) : 0
      if (age >= UNDATED_DAYS) rows.push({ task, kind: 'undated', days: age, text: `No date for ${plural(age)}` })
    }
  }
  return rows.sort((a, b) => b.days - a.days || a.task.id.localeCompare(b.task.id))
}

/** Pick a day: the task's date and the section that follows it (the one rule every writer uses). */
export function pickDayPatch(day: string, today: string): UpdateTaskInput {
  return { due_date: day, section: sectionForDay(day, today) }
}

/**
 * Someday: the label added (never twice, never past the label limits) and the
 * date taken off, filed in Backlog — it is a decision that it is not for any
 * day, so it must not keep nagging as late or undated (Undo writes all three back).
 */
export function somedayPatch(task: Pick<Task, 'labels'>): UpdateTaskInput {
  return { labels: cleanLabels([...labelsOf(task), SOMEDAY_LABEL]), due_date: null, section: 'backlog' }
}

/** What an Undo writes back for a patch: the fields it touched, as they were. */
export function reversePatch(task: Task, patch: UpdateTaskInput): UpdateTaskInput {
  const back: Record<string, unknown> = {}
  for (const k of Object.keys(patch) as (keyof Task)[]) back[k] = k === 'labels' ? labelsOf(task) : task[k] ?? null
  return back as UpdateTaskInput
}
