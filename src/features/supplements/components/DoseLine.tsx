import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { AlarmClock, Check, CheckCircle2, Circle, CircleSlash, Clock, MoreHorizontal, PauseCircle, Pencil, RotateCcw, SkipForward, TriangleAlert } from 'lucide-react'
import { Button, MetaLine, Truncate, cx } from '../../../shared/ui'
import { doseWhen, type Dose, type LocalNow } from '../supplementDoses'

export interface DoseActions {
  take:      (d: Dose) => void
  takeAt:    (d: Dose) => void
  skip:      (d: Dose) => void
  unskip:    (d: Dose) => void
  snooze:    (d: Dose) => void
  untake:    (d: Dose) => void
  edit:      (d: Dose) => void
  pause:     (d: Dose) => void
}

const ICON: Record<Dose['status'], { icon: typeof Circle; className: string; label: string }> = {
  taken:    { icon: CheckCircle2, className: 'text-success', label: 'Taken' },
  skipped:  { icon: CircleSlash, className: 'text-fg-faint', label: 'Skipped' },
  due:      { icon: Circle, className: 'text-warn', label: 'Due' },
  upcoming: { icon: Clock, className: 'text-fg-faint', label: 'Later' },
  missed:   { icon: TriangleAlert, className: 'text-danger', label: 'Missed dose' },
}

/**
 * One dose on the Supplement card: "Kreatin 5 g · 08:00 · due 2 h ago
 * [Take] [Skip] ⋯" — taken ones read "taken 08:12". The name opens the
 * schedule; the ⋯ menu holds the rest (snooze, taken at…, pause …).
 */
export function DoseLine({ dose, now, actions, busy, kcal }: {
  dose: Dose
  now: LocalNow
  actions: DoseActions
  busy?: boolean
  /** The taken line's kcal (shown when above 0). */
  kcal?: number | null
}) {
  const { icon: Icon, className: iconClass, label: stateLabel } = ICON[dose.status]
  // Take is a button once the dose is due (or was missed); before, it waits in the menu.
  const takeable = dose.status === 'due' || dose.status === 'missed'
  const early = dose.status === 'upcoming' && dose.date === now.date
  const when = doseWhen(dose, now)
  const meta = [dose.time, when, dose.status === 'taken' && kcal != null && kcal > 0 && `${Math.round(kcal)} kcal`]

  const items: { label: string; icon: typeof Circle; run: () => void; danger?: boolean }[] = []
  if (early) items.push({ label: 'Take now', icon: Check, run: () => actions.take(dose) })
  if (dose.status === 'due') items.push({ label: 'Snooze 1 h', icon: AlarmClock, run: () => actions.snooze(dose) })
  // A narrow card has no room for the Skip button: it is always here too.
  if (dose.status === 'due') items.push({ label: 'Skip today', icon: SkipForward, run: () => actions.skip(dose) })
  if (takeable || early) items.push({ label: 'Taken at…', icon: Clock, run: () => actions.takeAt(dose) })
  if (dose.status === 'upcoming' && dose.date === now.date) items.push({ label: 'Skip today', icon: SkipForward, run: () => actions.skip(dose) })
  if (dose.status === 'missed') items.push({ label: 'Skip', icon: SkipForward, run: () => actions.skip(dose) })
  if (dose.status === 'skipped') items.push({ label: 'Not skipped', icon: RotateCcw, run: () => actions.unskip(dose) })
  if (dose.status === 'taken') items.push({ label: 'Not taken', icon: RotateCcw, run: () => actions.untake(dose), danger: true })
  items.push({ label: 'Edit schedule', icon: Pencil, run: () => actions.edit(dose) })
  if (dose.date >= now.date) items.push({ label: 'Pause', icon: PauseCircle, run: () => actions.pause(dose) })

  return (
    <li className="flex items-center gap-2 py-1 pl-4 pr-2">
      <Icon aria-label={stateLabel} className={cx('h-4 w-4 shrink-0', iconClass)} />
      <button type="button" onClick={() => actions.edit(dose)}
        className="flex min-h-[40px] min-w-0 flex-1 flex-col justify-center text-left transition-colors hover:text-accent-600 @[34rem]:flex-row @[34rem]:items-center @[34rem]:justify-start @[34rem]:gap-2">
        <Truncate fullText={`${dose.title} ${dose.label}`} className={cx('text-body', dose.status === 'skipped' || dose.status === 'taken' ? 'text-fg-2' : 'text-fg')}>
          {dose.title} <span className="tabular-nums text-fg-muted">{dose.label}</span>
        </Truncate>
        <MetaLine items={meta} className={cx('shrink-0 text-meta tabular-nums',
          dose.status === 'missed' ? 'text-danger' : dose.status === 'due' ? 'text-warn' : 'text-fg-muted')} />
      </button>
      {takeable && (
        <Button size="sm" icon={<Check />} disabled={busy} onClick={() => actions.take(dose)} className="shrink-0 !px-2.5"
          aria-label={`Take ${dose.title} ${dose.label}`}>
          Take
        </Button>
      )}
      {dose.status === 'due' && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => actions.skip(dose)} className="hidden shrink-0 !px-2 text-fg-muted @[28rem]:inline-flex"
          aria-label={`Skip ${dose.title} today`}>
          Skip
        </Button>
      )}
      <Menu>
        <MenuButton className="icon-btn shrink-0 text-fg-faint [&_svg]:h-[18px] [&_svg]:w-[18px]" aria-label={`More for ${dose.title} ${dose.time}`}>
          <MoreHorizontal aria-hidden />
        </MenuButton>
        <MenuItems anchor={{ to: 'bottom end', gap: 6, padding: 12 }} className="menu z-toast min-w-[11rem]">
          {items.map(i => (
            <MenuItem key={i.label}>
              <button type="button" onClick={i.run} className={cx('menu-item', i.danger && 'is-danger')}>
                <i.icon aria-hidden className="h-4 w-4 shrink-0" />{i.label}
              </button>
            </MenuItem>
          ))}
        </MenuItems>
      </Menu>
    </li>
  )
}
