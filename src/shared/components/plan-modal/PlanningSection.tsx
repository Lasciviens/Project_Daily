// ─────────────────────────────────────────────────────────────────────────────
//  The item screen's Planning group — the app's own fields, under Apple's
//  headers: Priority, Area, Category (a timed or repeating item's), Labels (a
//  task's), and the Deadline (owner's point 9): a date, then optionally a time
//  and "Do it between" (the window that opens on its first day and closes on
//  the deadline — tasks.start_date, 069; a season sets both ends). An edit of
//  a task adds Waiting for and Parent (TaskRows.tsx: each its own action).
// ─────────────────────────────────────────────────────────────────────────────

import { DateCalendar } from '../DateCalendar'
import { SegmentedControl, Switch } from '../../ui'
import { formatDate } from '../../utils/dateFormat'
import { seasonWindows } from '../windowChips'
import { FieldMark } from './FieldMark'
import { ChoiceRow, Panel, Pill, Row, TapRow } from './ItemRows'
import { LabelsRow } from './LabelsRow'
import { ParentRow, WaitingRow } from './TaskRows'
import { TimeWheel } from './TimeWheel'
import { chipClass, choiceClass } from './fieldStyles'
import { CATEGORY_LABELS, displayDate, isScheduleFieldHidden, isTaskFieldHidden } from './planModal.config'
import { DOMAIN_LABEL } from '../../../features/todo/domainColors'
import { PRIORITY_LABEL } from '../../../features/todo/taskTones'
import type { TaskDomain, TaskPriority } from '../../../features/todo/types'
import type { TimeBlockCategory } from '../../../features/daily/types'
import type { PlanForm } from './planForm'
import type { PanelKey } from './TimeSection'
import type { FieldGoes, ScreenField } from './itemScreenRules'
import type { PlanModalConfig } from './planModal.types'

const PRIORITIES = (['low', 'medium', 'high'] as const).map(value => ({ value, label: PRIORITY_LABEL[value] }))
const DOMAINS = (['personal', 'work', 'media'] as const).map(value => ({ value, label: DOMAIN_LABEL[value] }))

export function PlanningSection({ form, patch, open, toggle, config, today, showCategory, showLabels, goes, taskId }: {
  form: PlanForm
  patch: (p: Partial<PlanForm>) => void
  open: PanelKey | null
  toggle: (k: PanelKey | null) => void
  config?: PlanModalConfig
  today: string
  showCategory: boolean
  showLabels: boolean
  goes: (f: ScreenField) => FieldGoes
  /** An edit of a task (not a repeat's rule): its Waiting for and Parent rows (step 3). */
  taskId?: string | null
}) {
  const hide = (f: Parameters<typeof isTaskFieldHidden>[0]) => isTaskFieldHidden(f, config)
  const own = <FieldMark goes={goes('own')} />
  return (
    <>
      {!hide('priority') && (
        <Row label="Priority" mark={own}>
          <SegmentedControl<TaskPriority> size="xs" options={PRIORITIES} value={form.priority} onChange={priority => patch({ priority })} />
        </Row>
      )}
      {!hide('domain') && (
        <Row label="Area" mark={own}>
          <SegmentedControl<TaskDomain> size="xs" options={DOMAINS} value={form.domain} onChange={domain => patch({ domain })} />
        </Row>
      )}
      {showCategory && !isScheduleFieldHidden('category', config) && (
        <>
          <TapRow label="Category" mark={own} value={CATEGORY_LABELS[form.category]} open={open === 'category'} onClick={() => toggle('category')} />
          {open === 'category' && (
            <Panel label="Category">
              {(Object.keys(CATEGORY_LABELS) as TimeBlockCategory[]).map(c => (
                <ChoiceRow key={c} label={CATEGORY_LABELS[c]} chosen={c === form.category} onClick={() => { patch({ category: c }); toggle(null) }} />
              ))}
            </Panel>
          )}
        </>
      )}
      {showLabels && <LabelsRow value={form.labels} onChange={labels => patch({ labels, labelsTouched: true })} mark={own} />}
      {!hide('dueDate') && <DeadlineRows form={form} patch={patch} open={open} toggle={toggle} config={config} today={today} goes={goes} />}
      {taskId && (
        <>
          <WaitingRow taskId={taskId} open={open} toggle={toggle} mark={own} />
          <ParentRow taskId={taskId} open={open} toggle={toggle} mark={<FieldMark goes={goes('list')} />} />
        </>
      )}
    </>
  )
}

/** Deadline → its time → Do it between. */
function DeadlineRows({ form, patch, open, toggle, config, today, goes }: {
  form: PlanForm
  patch: (p: Partial<PlanForm>) => void
  open: PanelKey | null
  toggle: (k: PanelKey | null) => void
  config?: PlanModalConfig
  today: string
  goes: (f: ScreenField) => FieldGoes
}) {
  const due = form.deadlineDate
  const showTime = !isTaskFieldHidden('dueTime', config)
  const showWindow = !isTaskFieldHidden('startDate', config)
  const windows = seasonWindows(today)
  const season = windows.find(w => w.start === form.startDate && w.end === due)
  return (
    <>
      <TapRow label="Deadline" mark={<FieldMark goes={goes('deadline')} />} open={open === 'deadline'} onClick={() => toggle('deadline')}
        value={due ? `${displayDate(due)}${form.deadlineTime ? ` · ${form.deadlineTime}` : ''}` : 'None'} />
      {open === 'deadline' && (
        <Panel label="Deadline">
          <div className="flex flex-col items-center gap-1">
            <DateCalendar compact value={due || today} selected={due ? [due] : []} onPick={deadlineDate => { patch({ deadlineDate }); toggle(null) }} />
            {due && (
              <button type="button" onClick={() => { patch({ deadlineDate: '', deadlineTime: '', startDate: '' }); toggle(null) }} className={chipClass('remove')}>
                No deadline
              </button>
            )}
          </div>
        </Panel>
      )}
      {due && showTime && (
        <Row label="Deadline time" mark={<FieldMark goes={goes('own')} />}>
          {form.deadlineTime && (
            <Pill label={`Deadline at ${form.deadlineTime} — change the time`} open={open === 'dTime'} onClick={() => toggle('dTime')}>{form.deadlineTime}</Pill>
          )}
          <Switch size="sm" label="Deadline time" on={!!form.deadlineTime}
            onChange={on => { patch({ deadlineTime: on ? '17:00' : '' }); toggle(on ? 'dTime' : null) }} />
        </Row>
      )}
      {due && showTime && form.deadlineTime && open === 'dTime' && (
        <Panel label="Deadline time">
          <TimeWheel label="Deadline" value={form.deadlineTime} onChange={deadlineTime => patch({ deadlineTime })} />
        </Panel>
      )}
      {due && showWindow && (
        <>
          <TapRow label="Do it between" mark={<FieldMark goes={goes('own')} />} open={open === 'window'} onClick={() => toggle('window')}
            value={form.startDate ? `From ${formatDate(form.startDate)}` : 'Any time before'} />
          {open === 'window' && (
            <Panel label="Do it between">
              <div className="flex flex-col items-center gap-2">
                <div className="flex flex-wrap justify-center gap-1.5">
                  {windows.map(w => (
                    <button key={w.label} type="button" aria-pressed={season?.label === w.label}
                      onClick={() => patch({ startDate: w.start, deadlineDate: w.end })} className={choiceClass(season?.label === w.label, undefined, 'sm')}>
                      {w.label}
                    </button>
                  ))}
                </div>
                <DateCalendar compact value={form.startDate || today} selected={form.startDate ? [form.startDate] : []} max={due} onPick={startDate => { patch({ startDate }); toggle(null) }} />
                <p className="text-meta text-fg-muted">The earliest day to start; the deadline stays {displayDate(due)}.</p>
                {form.startDate && (
                  <button type="button" onClick={() => { patch({ startDate: '' }); toggle(null) }} className={chipClass('remove')}>Any time before</button>
                )}
              </div>
            </Panel>
          )}
        </>
      )}
    </>
  )
}
