import { entityModal } from '../../shared/modals'
import type { HevyRoutine } from './types.hevy'

// The ONE "plan a training session" request, so every entry point (Routines,
// the calendar, Daily's Training card) creates the same block + task with
// the same source — the payload used to be copied per screen.

/** Plan a Hevy routine as a one-off training block with its task. When the
 *  logged Hevy workout carries that routine id, the sync closes the task. */
export function openPlanRoutine(routine: Pick<HevyRoutine, 'id' | 'title'>, opts: { date?: string; onSaved?: () => void } = {}) {
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
