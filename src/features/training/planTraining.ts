import { entityModal } from '../../shared/modals'
import { formatWeekdayDate } from '../../shared/utils/dateFormat'
import { todayStr } from '../../shared/utils/dateUtils'
import { fetchOpenTrainingSessionTasks } from '../todo/api/tasksApi'
import { planRequest } from '../items/planThis'
import type { HevyRoutine } from './types.hevy'

// Training's part of THE Plan helper (items/usePlanThis): a routine still open from before today asks first whether
// to move that one (owner: never a second plan beside a missed one). The request itself is items/planThis's —
// every "Plan it / Plan again" in the app comes through usePlanThis.

/** Plan a Hevy routine (or a session without one) as a one-off training block with its task. When the logged Hevy
 *  workout carries that routine id, the sync closes the task. */
export async function planRoutine(routine: Pick<HevyRoutine, 'id' | 'title'> | null, opts: { date?: string; onSaved?: () => void } = {}) {
  const today = todayStr()
  let open = null
  if (routine) {
    try {
      open = (await fetchOpenTrainingSessionTasks())
        .filter(t => t.hevy_routine_id === routine.id && t.due_date && t.due_date < today)
        .sort((a, b) => (b.due_date ?? '').localeCompare(a.due_date ?? ''))[0] ?? null
    } catch { /* the check guards; it never blocks planning */ }
  }
  if (routine && open?.due_date) {
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
  entityModal.open(planRequest({ kind: 'training', routine: routine ? { id: routine.id, title: routine.title } : null, date: opts.date, onSaved: opts.onSaved }, today))
}
