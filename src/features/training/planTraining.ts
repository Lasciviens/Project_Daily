import { entityModal } from '../../shared/modals'
import { formatWeekdayDate } from '../../shared/utils/dateFormat'
import { todayStr } from '../../shared/utils/dateUtils'
import { fetchOpenTrainingSessionTasks } from '../todo/api/tasksApi'
import type { HevyRoutine } from './types.hevy'

// The ONE "plan a training session" request, so every entry point (Routines,
// the calendar, Daily's Training card) creates the same block + task with
// the same source — the payload used to be copied per screen.

/** Plan a Hevy routine as a one-off training block with its task. When the
 *  logged Hevy workout carries that routine id, the sync closes the task.
 *  When the routine still has an open plan from before today, it asks first
 *  whether to move that one instead (owner: never a second plan beside a
 *  missed one) — every "Plan it / Plan again" in the app comes through here. */
export async function openPlanRoutine(routine: Pick<HevyRoutine, 'id' | 'title'>, opts: { date?: string; onSaved?: () => void } = {}) {
  const today = todayStr()
  let open = null
  try {
    open = (await fetchOpenTrainingSessionTasks())
      .filter(t => t.hevy_routine_id === routine.id && t.due_date && t.due_date < today)
      .sort((a, b) => (b.due_date ?? '').localeCompare(a.due_date ?? ''))[0] ?? null
  } catch { /* the check guards; it never blocks planning */ }
  if (open?.due_date) {
    const move = await entityModal.confirm({
      title: `Move the open ${routine.title}?`,
      message: `${open.title} from ${formatWeekdayDate(open.due_date)} is still open. Move it to the new day instead of planning a second one?`,
      confirmLabel: 'Move it',
      cancelLabel: 'Plan a new one',
    })
    if (move) {
      entityModal.open({
        kind: 'training-plan-move',
        plan: {
          target: { kind: 'task', taskId: open.id, blockId: null },
          info: { title: open.title, date: open.due_date, startHHMM: open.due_time?.slice(0, 5) ?? null, minutes: null, routineId: routine.id },
        },
        // The day "Plan it" was asked for, so Move puts it there (not today).
        ...(opts.date ? { toDate: opts.date } : {}),
      })
      return
    }
  }
  entityModal.open({
    kind: 'time-block',
    config: { heading: 'Plan routine' },
    defaults: { title: routine.title, category: 'training', color: 'accent', alsoCreateTask: true, ...(opts.date ? { date: opts.date } : {}) },
    source: { sourceType: 'training_session', sourceId: routine.id, taskSourceType: 'training_session' },
    onSaved: opts.onSaved ? () => opts.onSaved?.() : undefined,
  })
}

/** Plan a training session on a day without picking a routine. Still a
 *  training-session task, so a workout logged that day can close it out. */
export function openPlanSession(date: string) {
  entityModal.open({
    kind: 'time-block',
    config: { heading: 'Plan training' },
    defaults: { title: 'Training', date, category: 'training', color: 'accent', alsoCreateTask: true },
    source: { sourceType: 'training_session', taskSourceType: 'training_session' },
  })
}
