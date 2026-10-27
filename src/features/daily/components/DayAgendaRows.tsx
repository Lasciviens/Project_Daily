import type { ReactNode } from 'react'
import { format } from 'date-fns'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import {
  AlertTriangle, CalendarArrowUp, CalendarDays, Check, Clock3, CornerDownRight, MoreHorizontal, Pencil, Repeat,
  SkipForward, Timer, Trash2, Undo2,
} from 'lucide-react'
import { useEntityModal } from '../../../shared/modals'
import { TonePill, Truncate, cx } from '../../../shared/ui'
import { addDaysIso } from '../recurrence'
import { useDeleteTimeBlock, useUpdateTimeBlock } from '../hooks/useSchedule'
import { useRepeatDay } from '../../items/useItems'
import type { RepeatDayAction } from '../../items/itemTypes'
import { TrainingPlanMenu } from '../../training/components/session/TrainingPlanActions'
import { useTrainingPlanActions } from '../../training/hooks/useTrainingPlanActions'
import { SESSION_LABEL, SESSION_TONE, sessionActions, sessionStatus } from '../../training/plan/sessionState'
import { planFacts } from '../../training/plan/planFacts'
import type { TrainingPlanRef } from '../../training/api/trainingPlanApi'
import type { useDayPlanContext } from '../../training/hooks/usePlanContext'
import type { TaskStatus } from '../../todo/types'
import { hourLabel, repeatDayRequest, untilLabel, type DayRow } from '../dayItems'

// ─────────────────────────────────────────────────────────────────────────────
//  The rows of Daily's one day list (DayAgenda). A task row is the shared
//  ToDoItem; everything else is drawn here in the same shape — tick (or a
//  mark when there is nothing to tick) · title · pills · ⋯ — so the list reads
//  as one thing whatever table a row lives in:
//   - a repeat's day: tick / skip / undo that one day (useRepeatDay — it says
//     "Done for 15.10.2026 · Undo"), the Repeat mark, Missed / Skipped;
//   - a training session: the session's own status and actions (unchanged);
//   - a slot with no task (made before "Convert old items"): no tick, +30 min /
//     next day / delete behind ⋯;
//   - a Google event the app didn't make: its calendar mark, no tick;
//   - the part after midnight of yesterday's thing: a continuation line.
//  Timed rows sit beside the time gutter (start, end, the slot's colour, an
//  overlap mark).
// ─────────────────────────────────────────────────────────────────────────────

// time_blocks / schedule_blocks.color is a user-picked tag; each maps onto a
// tone so both themes work. Google events use the success edge.
const EDGE: Record<string, string> = {
  blue:   'border-r-info',
  green:  'border-r-success',
  orange: 'border-r-warn',
  purple: 'border-r-highlight',
  accent: 'border-r-accent-500',
  red:    'border-r-danger',
}

function edgeOf(row: DayRow): string {
  if (row.kind === 'event') return EDGE.green
  const tag = (row.item?.block ?? row.item?.template)?.color
  if (!tag) return 'border-r-transparent'
  return EDGE[tag] ?? EDGE.accent
}

/** The time column beside a timed row: start, where a span ends, its colour, an overlap. */
export function TimeGutter({ row }: { row: DayRow }) {
  return (
    <div className={cx('flex w-12 shrink-0 flex-col items-end border-r-2 pr-1.5 pt-2.5 tabular-nums', edgeOf(row))}>
      <span className="text-meta font-semibold leading-none text-fg">{hourLabel(row.startHour ?? 0)}</span>
      {row.endHour !== null && <span className="mt-1 text-micro leading-none text-fg-muted">–{untilLabel(row.endHour)}</span>}
      {row.overlaps && <AlertTriangle data-tone="danger" className="tone-text mt-1 h-3 w-3" aria-label="Overlaps another plan" />}
    </div>
  )
}

/** The now-line between timed rows (today only). */
export function NowMarker({ hour }: { hour: number }) {
  return (
    <div className="flex items-center gap-1.5" data-tone="danger" aria-label={`Now, ${hourLabel(hour)}`}>
      <span className="tone-text w-12 shrink-0 pr-2 text-right text-micro font-semibold tabular-nums">{hourLabel(hour)}</span>
      <span className="tone-dot !h-1.5 !w-1.5" aria-hidden />
      <span className="flex-1 border-t border-danger/40" aria-hidden />
    </div>
  )
}

// ── Row anatomy (the same as ToDoItem's: 44px row, tick, title, pills, ⋯) ──

const ROW = 'group relative flex min-h-[44px] cursor-pointer items-start gap-2.5 rounded-row bg-surface px-3 py-2 transition-colors duration-150 press-feedback hover:bg-surface-hover'
// The tick's 44px tap area reaches into the row's padding (-my-2), so a
// one-line row stays 44px tall.
const LEAD = '-my-2 -ml-3 flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center lg:my-0 lg:ml-0 lg:mt-0.5 lg:h-5 lg:min-h-0 lg:w-5 lg:min-w-0'

function Tick({ checked, onToggle, disabled, label }: { checked: boolean; onToggle: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onToggle() }}
      disabled={disabled}
      title={disabled ? label : undefined}
      aria-label={label}
      aria-pressed={checked}
      className={cx(LEAD, 'disabled:cursor-default')}
    >
      <span className={cx(
        'flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors duration-150',
        checked ? 'border-accent-500 bg-accent-500 text-on-accent' : 'border-line-strong hover:border-accent-500',
      )}>
        {checked && <Check className="h-3 w-3" strokeWidth={3} aria-hidden />}
      </span>
    </button>
  )
}

/** Where there is nothing to tick: what the row is, in the tick's place. */
function Mark({ children, label }: { children: ReactNode; label: string }) {
  return <span className={cx(LEAD, 'text-fg-faint [&_svg]:h-4 [&_svg]:w-4')} aria-label={label} role="img">{children}</span>
}

function RowShell({ lead, title, icons, pills, menu, onOpen, dim, struck }: {
  lead: ReactNode; title: string; icons?: ReactNode; pills?: ReactNode; menu?: ReactNode; onOpen: () => void; dim?: boolean
  /** Done: the title is struck through, as a done task's is. */
  struck?: boolean
}) {
  return (
    <div
      role="button" tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      className={cx(ROW, dim && 'opacity-60')}
    >
      {lead}
      <div className="min-w-0 flex-1 py-0.5">
        <p className={cx('flex min-w-0 items-start gap-1.5 text-body leading-snug', struck ? 'text-fg-faint line-through' : 'text-fg')}>
          {/* The row opens the editor, which shows the whole title. */}
          <Truncate lines={2} reveal="none">{title}</Truncate>
          {icons && <span className="mt-[3px] flex shrink-0 items-center gap-1 [&_svg]:h-3.5 [&_svg]:w-3.5">{icons}</span>}
        </p>
        {pills && <div className="mt-1 flex flex-wrap items-center gap-1.5">{pills}</div>}
      </div>
      {menu}
    </div>
  )
}

interface MenuEntry { key: string; label: string; icon: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean }

function RowMenu({ entries, label = 'More actions' }: { entries: readonly MenuEntry[]; label?: string }) {
  if (entries.length === 0) return null
  return (
    <Menu as="div" className="-my-2 shrink-0" onClick={e => e.stopPropagation()}>
      <MenuButton className="icon-btn text-fg-faint" title={label} aria-label={label}>
        <MoreHorizontal className="h-[18px] w-[18px]" aria-hidden />
      </MenuButton>
      <MenuItems anchor="bottom end" transition className="menu w-56 [--anchor-gap:4px] transition duration-150 data-[closed]:scale-95 data-[closed]:opacity-0">
        {entries.map((e, n) => (
          <div key={e.key} className="contents">
            {e.danger && n > 0 && <div className="menu-sep" role="separator" />}
            <MenuItem disabled={e.disabled}>
              <button type="button" onClick={e.onSelect} className={cx('menu-item data-[disabled]:opacity-40 [&_svg]:h-4 [&_svg]:w-4', e.danger && 'is-danger')}>
                <span aria-hidden className="contents">{e.icon}</span>
                <Truncate>{e.label}</Truncate>
              </button>
            </MenuItem>
          </div>
        ))}
      </MenuItems>
    </Menu>
  )
}

const NowWord = () => <span className="shrink-0 text-micro font-semibold text-accent-600">now</span>

// ── A day of a repeating plan ───────────────────────────────────────────────

/** Tick, skip and undo ONE day of a repeat (useRepeatDay reports it and offers Undo). */
export function RepeatRow({ row, active }: { row: DayRow; active: boolean }) {
  const modal = useEntityModal()
  const repeatDay = useRepeatDay()
  const r = row.repeat!
  // The tick answers at once; the hook's own toast says what was saved.
  const pending = repeatDay.isPending ? repeatDay.variables?.action : null
  const done = pending ? pending === 'done' : row.state === 'done'
  const skipped = row.state === 'skipped' && pending !== 'undo' && pending !== 'done'
  const act = (action: RepeatDayAction) => {
    void repeatDay.mutateAsync({ scheduleBlockId: r.scheduleBlockId, date: r.date, action }).catch(() => {})
  }
  // A day already acted on is its own task + slot (142): the sheet opens it
  // and offers This day / All days; a day nobody acted on opens the plan on that day.
  const open = () => (r.acted && row.task
    ? modal.open({ kind: 'task', id: row.task.id })
    : modal.open(repeatDayRequest(r.scheduleBlockId, r.date)))

  const entries: MenuEntry[] = [
    row.state === 'skipped'
      ? { key: 'undo', label: 'Undo skip', icon: <Undo2 />, onSelect: () => act('undo') }
      : row.state === 'done'
        ? { key: 'undo', label: 'Not done', icon: <Undo2 />, onSelect: () => act('undo') }
        : { key: 'skip', label: 'Skip this day', icon: <SkipForward />, onSelect: () => act('skip') },
    { key: 'edit', label: 'Edit…', icon: <Pencil />, onSelect: open },
  ]
  return (
    <RowShell
      lead={<Tick checked={done} onToggle={() => act(done ? 'undo' : 'done')} disabled={repeatDay.isPending} label={done ? 'Mark as not done' : 'Mark this day done'} />}
      title={row.title}
      icons={<><Repeat className="text-fg-muted" aria-label="Repeats" />{active && <NowWord />}</>}
      pills={skipped ? <TonePill tone="neutral">Skipped</TonePill>
        : row.state === 'missed' && !done ? <TonePill tone="danger">Missed</TonePill>
        : undefined}
      menu={<RowMenu entries={entries} />}
      onOpen={open}
      dim={done || skipped}
      struck={done}
    />
  )
}

// ── A planned training session ──────────────────────────────────────────────

type PlanContext = ReturnType<typeof useDayPlanContext>

/** The session as it is: its task (and slot), an older slot with no task, a
 *  day of a repeating plan that is a task (156 — made on its day), or one
 *  with no task yet. */
function trainingPlanOf(row: DayRow, planCtx: PlanContext): TrainingPlanRef {
  const i = row.item!
  const b = i.block
  const date = i.planDate
  const target: TrainingPlanRef['target'] = i.kind === 'recurring'
    ? (row.task ? { kind: 'task', taskId: row.task.id, blockId: null } : { kind: 'weekly', templateId: i.canonicalId, date })
    : i.taskId ? { kind: 'task', taskId: i.taskId, blockId: i.canonicalId } : { kind: 'block', blockId: i.canonicalId }
  const routineId = b?.source_type === 'training_session' ? b.source_id ?? null : null
  return {
    target,
    info: {
      title: i.title, date,
      startHHMM: i.startHour >= 0 && !i.spillover ? hourLabel(i.startHour) : null,
      minutes: i.startHour >= 0 ? Math.round((i.endHour - i.startHour) * 60) || null : null,
      routineId: b?.task_routine_id ?? row.task?.hevy_routine_id ?? routineId ?? planCtx.routineOf({ title: i.title, date }),
    },
  }
}

export function TrainingRow({ row, planCtx, nowHour, active }: { row: DayRow; planCtx: PlanContext; nowHour: number; active: boolean }) {
  const modal = useEntityModal()
  const actions = useTrainingPlanActions()
  const i = row.item!
  const b = i.block
  const plan = trainingPlanOf(row, planCtx)
  // The row's task (its slot's, or the day's own — 156) is the session's truth.
  const t = row.task
  const status = sessionStatus(planFacts({
    date: plan.info.date, startHHMM: plan.info.startHHMM, minutes: plan.info.minutes,
    taskId: t?.id ?? i.taskId ?? null, taskStatus: t?.status ?? (b?.task_status as TaskStatus | null | undefined) ?? null,
    taskWorkoutId: t?.hevy_workout_id ?? b?.task_workout_id ?? null, taskRoutineId: t?.hevy_routine_id ?? b?.task_routine_id ?? null,
    taskMissed: t ? t.closed_reason === 'missed' : b?.task_status === 'cancelled' && b?.task_closed_reason === 'missed',
    firstDate: t?.first_plan_date ?? b?.task_first_plan_date ?? null,
    routineId: plan.info.routineId,
  }, { today: format(new Date(), 'yyyy-MM-dd'), nowHHMM: hourLabel(nowHour), skips: planCtx.skips, hasActivity: planCtx.hasActivity }))
  // A day of a repeating plan (with its day's task or not): the plan's own entries too.
  const weekly = i.kind === 'recurring' ? { templateId: i.canonicalId } : null
  const can = sessionActions(status, { hasTask: plan.target.kind === 'task', weekly: !!weekly })
  const isDone = status.state === 'done'
  const mark = isDone || status.state === 'skipped' || status.state === 'missed' ? status.state : null
  const open = () => modal.open({ kind: 'training-session', plan: { kind: i.kind === 'recurring' ? 'recurring' : 'block', id: i.canonicalId, date: plan.info.date } })
  const toggle = () => {
    if (!isDone && can.includes('done')) void actions.markDone(plan).catch(() => {})
    else if (isDone && can.includes('reopen')) void actions.reopen(plan).catch(() => {})
  }
  const canToggle = isDone ? can.includes('reopen') : can.includes('done')
  return (
    <RowShell
      lead={<Tick checked={isDone} onToggle={toggle} disabled={!canToggle || actions.busy}
        label={isDone ? (canToggle ? 'Reopen the session' : 'Done by a workout') : canToggle ? 'Mark the session done' : SESSION_LABEL[status.state]} />}
      title={row.title}
      icons={<>{(i.kind === 'recurring' || row.repeat) && <Repeat className="text-fg-muted" aria-label="Repeats" />}{active && <NowWord />}</>}
      pills={mark ? <TonePill tone={SESSION_TONE[mark]}>{SESSION_LABEL[mark]}</TonePill> : undefined}
      menu={<div className="-my-2 flex shrink-0 items-center" onClick={e => e.stopPropagation()}><TrainingPlanMenu plan={plan} status={status} weekly={weekly} /></div>}
      onOpen={open}
      dim={isDone || status.state === 'skipped'}
      struck={isDone}
    />
  )
}

// ── A slot with no task, a Google event, a continuation ─────────────────────

export function SlotRow({ row, past, active }: { row: DayRow; past: boolean; active: boolean }) {
  const modal = useEntityModal()
  const update = useUpdateTimeBlock()
  const remove = useDeleteTimeBlock()
  const i = row.item!
  const date = i.block?.date ?? i.planDate
  const open = () => modal.open({ kind: 'time-block', id: i.canonicalId })
  const entries: MenuEntry[] = [
    ...(row.startHour !== null ? [{
      key: 'later', label: '30 minutes later', icon: <Timer />,
      onSelect: () => update.mutate({ id: i.canonicalId, patch: { start_time: `${hourLabel(Math.min(23.5, row.startHour! + 0.5))}:00` } }),
    }] : []),
    { key: 'tomorrow', label: 'Move to the next day', icon: <CalendarArrowUp />, onSelect: () => update.mutate({ id: i.canonicalId, patch: { date: addDaysIso(date, 1) } }) },
    { key: 'edit', label: 'Edit…', icon: <Pencil />, onSelect: open },
    {
      key: 'delete', label: 'Delete', icon: <Trash2 />, danger: true, disabled: remove.busy,
      onSelect: () => { void remove.run([i.canonicalId], { title: `Delete “${row.title}” from the schedule?`, done: 'Slot deleted' }) },
    },
  ]
  return (
    <RowShell
      lead={<Mark label="A slot with no task"><Clock3 /></Mark>}
      title={row.title}
      icons={active ? <NowWord /> : undefined}
      menu={<RowMenu entries={entries} />}
      onOpen={open}
      dim={past}
    />
  )
}

export function EventRow({ row, past, active, onOpen }: { row: DayRow; past: boolean; active: boolean; onOpen: () => void }) {
  return (
    <RowShell
      lead={<Mark label="Google Calendar"><CalendarDays data-tone="success" className="tone-text" /></Mark>}
      title={row.title}
      icons={active ? <NowWord /> : undefined}
      pills={row.allDay ? <TonePill tone="neutral">All day</TonePill> : undefined}
      onOpen={onOpen}
      dim={past}
    />
  )
}

/** A slot's task that hasn't loaded yet (it is read by id): the row still opens it. */
export function LinkedTaskRow({ row }: { row: DayRow }) {
  const modal = useEntityModal()
  const taskId = row.item?.taskId
  return (
    <RowShell
      lead={<Tick checked={row.state === 'done'} onToggle={() => {}} disabled label="Loading the task" />}
      title={row.title}
      onOpen={() => { if (taskId) modal.open({ kind: 'task', id: taskId }) }}
      dim={row.state !== 'open'}
    />
  )
}

/** The part after midnight of yesterday's slot, plan or event: it opens the same thing. */
export function ContinuationRow({ row, onOpen, past }: { row: DayRow; onOpen: () => void; past: boolean }) {
  return (
    <RowShell
      lead={<Mark label="Continued from yesterday"><CornerDownRight /></Mark>}
      title={row.title}
      icons={row.repeat || row.item?.kind === 'recurring' ? <Repeat className="text-fg-muted" aria-label="Repeats" /> : undefined}
      onOpen={onOpen}
      dim={past || row.state === 'done' || row.state === 'skipped'}
    />
  )
}
