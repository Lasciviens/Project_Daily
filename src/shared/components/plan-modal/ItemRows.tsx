// ─────────────────────────────────────────────────────────────────────────────
//  The item screen's grouped rows (THEME §8, The item screen), drawn as iOS
//  Calendar draws its event screen: a quiet header over a rounded group,
//  rows of one height with the label left and the value right (fixed widths,
//  so nothing moves when a value changes), inset hairlines between rows, and
//  editors (a wheel, a month, a list of choices) that open inside the group
//  under the row tapped.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, type ReactNode } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { cx, Switch, Truncate } from '../../ui'
import { useMotion } from '../../hooks/useMotion'

/** A row's top hairline, inset like Apple's; the first row of a group has none. */
const LINE = 'relative before:absolute before:left-3.5 before:right-0 before:top-0 before:h-px before:bg-line first:before:content-none'
const ROW = `${LINE} flex min-h-11 w-full items-center gap-2.5 px-3.5 text-lead`

export function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      {title && <h3 className="section-label px-3.5">{title}</h3>}
      <div className="overflow-hidden rounded-row bg-surface">{children}</div>
    </section>
  )
}

/** The label and its mark, left. */
function Label({ children, mark, grow = true }: { children: ReactNode; mark?: ReactNode; grow?: boolean }) {
  return <span className={cx('flex min-w-0 items-center gap-1.5 text-fg', grow ? 'flex-1' : 'shrink-0')}>{children}{mark}</span>
}

/** A row whose value is a control of its own (pills, a switch, a segmented choice). `wide`: the value takes the room
 *  and may wrap (the labels). */
export function Row({ label, mark, children, className, wide = false }: {
  label: ReactNode
  mark?: ReactNode
  children?: ReactNode
  className?: string
  wide?: boolean
}) {
  return (
    <div className={cx(ROW, className)}>
      <Label mark={mark} grow={!wide}>{label}</Label>
      {children}
    </div>
  )
}

/** A whole row that opens its editor in the list (a chevron that turns down while open). */
export function TapRow({ label, mark, value, open, onClick, disabled, tone }: {
  label: ReactNode
  mark?: ReactNode
  value: ReactNode
  open?: boolean
  onClick: () => void
  disabled?: boolean
  /** The value as a status (a refused send). */
  tone?: 'danger' | 'warn'
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-expanded={open}
      className={cx(ROW, 'text-left transition-colors hover:bg-surface-hover active:bg-surface-hover disabled:cursor-default disabled:hover:bg-transparent')}>
      <Label mark={mark}>{label}</Label>
      <span data-tone={tone} className={cx('flex min-w-0 max-w-[60%] items-center justify-end gap-1.5 tabular-nums', tone ? 'tone-text' : open ? 'text-accent-600' : 'text-fg-muted')}>
        {typeof value === 'string' ? <Truncate className="min-w-0">{value}</Truncate> : value}
      </span>
      {!disabled && <ChevronRight aria-hidden className={cx('h-4 w-4 shrink-0 text-fg-faint transition-transform motion-reduce:transition-none', open && 'rotate-90')} />}
    </button>
  )
}

export function ToggleRow({ label, mark, on, onChange, note, disabled }: {
  label: string
  mark?: ReactNode
  on: boolean
  onChange: (on: boolean) => void
  /** A short word before the switch ("Today" — where a dated item is filed). */
  note?: string
  disabled?: boolean
}) {
  return (
    <Row label={label} mark={mark}>
      {note && <span className="text-meta text-fg-muted">{note}</span>}
      <Switch size="sm" on={on} onChange={onChange} label={label} disabled={disabled} />
    </Row>
  )
}

/** An editor opened in the list under its row. */
export function Panel({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const motion = useMotion()
  // Opened, it comes into view (a month under the last row would open below the screen's edge).
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest', behavior: motion ? 'smooth' : 'auto' })
  }, [motion])
  return <div ref={ref} role="group" aria-label={label} className={cx(LINE, 'scroll-my-3 px-3.5 pb-3 pt-2', className)}>{children}</div>
}

/** A line of explanation or warning inside a group. */
export function NoteRow({ children, tone }: { children: ReactNode; tone?: 'danger' | 'warn' }) {
  return (
    <p data-tone={tone} className={cx(LINE, 'px-3.5 py-2 text-meta', tone ? 'tone-text' : 'text-fg-muted')}>{children}</p>
  )
}

/**
 * A Starts / Ends pill: a date (`wide`) or a time, each of one width — nothing jumps sideways as values change.
 * Open while its wheel or month shows; struck through red when the end can't be.
 */
export function Pill({ children, label, open, onClick, wide, bad, disabled }: {
  children: ReactNode
  label: string
  open?: boolean
  onClick: () => void
  wide?: boolean
  bad?: boolean
  disabled?: boolean
}) {
  return (
    <button type="button" onClick={onClick} aria-expanded={open} aria-label={label} disabled={disabled}
      className={cx(
        'inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-control px-2 text-lead tabular-nums transition-colors',
        wide ? 'w-[8.5rem]' : 'w-[4.25rem]',
        bad ? 'bg-danger-soft text-danger line-through'
          : open ? 'bg-accent-50 text-accent-600'
          : 'bg-surface-2 text-fg hover:bg-surface-hover',
        'disabled:text-fg-muted disabled:hover:bg-surface-2',
      )}>
      {children}
    </button>
  )
}

/** One choice of a list opened in a row (the Calendar row's destinations, Time Zone, Category). */
export function ChoiceRow({ label, hint, chosen, disabled, icon, onClick }: {
  label: ReactNode
  hint?: ReactNode
  chosen: boolean
  disabled?: boolean
  icon?: ReactNode
  onClick: () => void
}) {
  return (
    <button type="button" role="menuitemradio" aria-checked={chosen} disabled={disabled} onClick={onClick}
      className="flex min-h-10 w-full items-center gap-2.5 border-t border-line py-1.5 text-left text-body first:border-t-0 disabled:opacity-50">
      {icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-fg">{label}</span>
        {hint && <span className="text-meta text-fg-muted">{hint}</span>}
      </span>
      <Check aria-hidden className={cx('h-4 w-4 shrink-0 text-accent-600', chosen ? 'visible' : 'invisible')} />
    </button>
  )
}
