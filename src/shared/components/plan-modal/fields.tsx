// ─────────────────────────────────────────────────────────────────────────────
//  UnifiedPlanModal — REUSABLE FIELD PRIMITIVES
//  Presentational only. Each is controlled (value + onChange) and respects a
//  `locked` flag (visible but disabled). Add a new field here, wire it in a tab.
//  Styling: theme tokens only (.input / .select / .field-label, tones).
// ─────────────────────────────────────────────────────────────────────────────

import { useId, type ReactNode } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Repeat } from 'lucide-react'
import {
  DURATION_PRESETS, CATEGORY_LABELS, RECURRENCE_OPTIONS, DAY_LABELS, DAY_NAMES, DAY_ORDER, REPEAT_UNIT_OPTIONS,
  displayDate, todayStr, dayPickerFor, litDays, toggleRepeatDay, pickRecurrence, recurrenceProblem, repeatPreview,
  type RepeatFormFields,
} from './planModal.config'
import { weekdayOfIso } from '../../../features/daily/recurrence'
import { formatDurationMinutes } from '../../utils/formatDuration'
import { formatDate } from '../../utils/dateFormat'
import { MetaLine, cx } from '../../ui'
import { SegmentedControl } from '../SegmentedControl'
import { DateCalendar } from '../DateCalendar'
import { choiceClass, chipClass } from './fieldStyles'
import type { TimeBlockCategory } from '../../../features/daily/types'
import type { CustomRepeatKind, RecurrenceMode } from './planModal.types'

const STEP_BTN =
  'inline-grid h-11 w-10 shrink-0 place-items-center rounded-input border border-line bg-surface-2 text-fg-2 ' +
  'transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-40'

// ── Label ─────────────────────────────────────────────────────────────────────

export function FieldLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="field-label">{children}</label>
}

/** Red asterisk for a required field. */
export function Required() {
  return <span className="text-danger" aria-hidden> *</span>
}

// ── Single-line text ────────────────────────────────────────────────────────

export function TextField({
  value, onChange, placeholder, locked, autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  locked?: boolean
  autoFocus?: boolean
}) {
  return (
    <input
      type="text"
      value={value}
      autoFocus={autoFocus}
      disabled={locked}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="input disabled:opacity-60"
    />
  )
}

// ── Date stepper — ← Day DD.MM.YYYY → (tap the date for a calendar) ──────────

export function DateStepperField({
  value, onChange, onStep, locked,
}: {
  value: string
  onChange: (v: string) => void
  onStep: (dir: 1 | -1) => void
  locked?: boolean
}) {
  const inputId = useId()
  return (
    <div className="flex items-center gap-2">
      <button type="button" disabled={locked} onClick={() => onStep(-1)} aria-label="Previous day" className={STEP_BTN}>
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </button>
      <div className="flex-1">
        <input
          type="date" value={value} disabled={locked} id={inputId}
          onChange={e => onChange(e.target.value)} className="sr-only"
        />
        <label
          htmlFor={inputId}
          className="flex min-h-[44px] cursor-pointer items-center justify-center rounded-input border border-line bg-surface-2 px-3 text-body font-medium tabular-nums text-fg"
        >
          {displayDate(value)}
        </label>
      </div>
      <button type="button" disabled={locked} onClick={() => onStep(1)} aria-label="Next day" className={STEP_BTN}>
        <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
    </div>
  )
}

// ── Time field — strict 24h (HH + MM selects, NO AM/PM) · −30m / +30m ─────────
//  Native <input type="time"> renders AM/PM in some locales — selects guarantee
//  24h everywhere. Minutes step by 5; the ±30m buttons keep the value on-grid.

const HOUR_OPTS   = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTE_OPTS = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'))

export function Time24Field({
  value, onChange, onShift, locked, size = 'md',
}: {
  value: string                       // 'HH:MM'
  onChange: (v: string) => void
  onShift: (deltaMin: number) => void
  locked?: boolean
  /** `sm`: the Add sheet's chips (its time picker, the deadline's time) — the
   *  hour and minute as chips, −30m / +30m after them, wrapping when narrow. */
  size?: 'md' | 'sm'
}) {
  const [hh = '09', mm = '00'] = value.split(':')
  const minutes = MINUTE_OPTS.includes(mm) ? MINUTE_OPTS : [mm, ...MINUTE_OPTS]
  if (size === 'sm') {
    const shift = choiceClass(false, undefined, 'sm')
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex items-center gap-1">
          <ChipSelect label="Hour" value={hh} options={HOUR_OPTS.map(h => ({ value: h, label: h }))} disabled={locked} onChange={h => onChange(`${h}:${mm}`)} />
          <span className="font-bold text-fg-faint" aria-hidden>:</span>
          <ChipSelect label="Minute" value={mm} options={minutes.map(m => ({ value: m, label: m }))} disabled={locked} onChange={m => onChange(`${hh}:${m}`)} />
        </div>
        <button type="button" disabled={locked} onClick={() => onShift(-30)} className={shift}>−30m</button>
        <button type="button" disabled={locked} onClick={() => onShift(30)} className={shift}>+30m</button>
      </div>
    )
  }
  const selectCls = 'select w-auto px-2 pr-7 tabular-nums disabled:opacity-60'
  // In a narrow slot (a half-width dialog column) the selects take the first
  // row and the two shift buttons share the second, so nothing is pushed out
  // of the dialog; from 17rem up it is one row.
  const shiftCls = 'inline-flex min-h-[44px] flex-1 @[17rem]:flex-none shrink-0 items-center justify-center rounded-input border border-line bg-surface-2 px-2.5 text-meta font-semibold tabular-nums text-fg-2 transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-40'
  return (
    <div className="@container">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={locked} onClick={() => onShift(-30)} className={shiftCls}>−30m</button>
      <div className="order-first flex basis-full items-center justify-center gap-1 @[17rem]:order-none @[17rem]:basis-auto @[17rem]:flex-1">
        <select value={hh} disabled={locked} aria-label="Hour" onChange={e => onChange(`${e.target.value}:${mm}`)} className={selectCls}>
          {HOUR_OPTS.map(h => <option key={h} value={h}>{h}</option>)}
        </select>
        <span className="font-bold text-fg-faint" aria-hidden>:</span>
        <select value={mm} disabled={locked} aria-label="Minute" onChange={e => onChange(`${hh}:${e.target.value}`)} className={selectCls}>
          {minutes.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <button type="button" disabled={locked} onClick={() => onShift(30)} className={shiftCls}>+30m</button>
    </div>
    </div>
  )
}

// ── Duration — presets + custom minutes ───────────────────────────────────────

export function DurationField({
  duration, customMin, onPreset, onCustom, locked,
}: {
  duration: number
  customMin: string
  onPreset: (v: number) => void
  onCustom: (v: string) => void
  locked?: boolean
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {DURATION_PRESETS.map(d => {
        const active = duration === d && customMin === ''
        return (
          <button
            key={d} type="button" disabled={locked} onClick={() => { onPreset(d); onCustom('') }}
            aria-pressed={active} className={choiceClass(active, 'tabular-nums')}
          >{formatDurationMinutes(d)}</button>
        )
      })}
      <input
        // min/max alone don't block a form submit (a real bug: `min` was
        // 1 with no `max` at all, and nothing downstream re-validated it —
        // the actual clamp is UnifiedPlanModal's clampDurationMinutes,
        // this is only the visible hint matching that same [1,1440] range).
        type="number" min={1} max={1440} value={customMin} disabled={locked}
        onChange={e => onCustom(e.target.value)} placeholder="Custom" aria-label="Custom duration in minutes"
        className="input w-24 tabular-nums disabled:opacity-60"
      />
    </div>
  )
}

// ── Category select ───────────────────────────────────────────────────────────

export function CategorySelect({
  value, onChange, locked,
}: {
  value: TimeBlockCategory
  onChange: (v: TimeBlockCategory) => void
  locked?: boolean
}) {
  return (
    <select
      value={value} disabled={locked}
      onChange={e => onChange(e.target.value as TimeBlockCategory)}
      className="select disabled:opacity-60"
    >
      {(Object.entries(CATEGORY_LABELS) as [TimeBlockCategory, string][]).map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </select>
  )
}

// ── Recurrence — one line for the choice, the M–S day circles, Custom ────────
//  The choice is a select so it stays ONE line at every width, whatever the
//  number of options (owner, 13.10.2026). The circles show whenever days
//  matter: Every day / Weekdays light theirs, a tap turns the choice into the
//  set it now is (planModal.config's toggleRepeatDay). Monthly takes one
//  weekday (or none = the same date). Custom is "every N days / weeks /
//  months" or picked dates. For Monthly and Custom a summary and the next
//  three days follow, from the same rule the agenda projects (recurrence.ts).

function DayCircles({ lit, onToggle, single, locked }: {
  lit: number[]
  onToggle: (day: number) => void
  single: boolean
  locked?: boolean
}) {
  return (
    <div role="group" aria-label={single ? 'Weekday (optional)' : 'Days'} className="flex gap-1">
      {DAY_ORDER.map(d => {
        const on = lit.includes(d)
        return (
          <button
            key={d} type="button" disabled={locked} onClick={() => onToggle(d)} aria-pressed={on}
            title={DAY_NAMES[d]} aria-label={DAY_NAMES[d]}
            className={cx(
              // 30px: on a 402px phone the seven fit on the select's line.
              'h-[30px] w-[30px] shrink-0 rounded-full text-meta font-semibold transition-colors disabled:opacity-40',
              on ? 'bg-accent-500 text-on-accent' : 'bg-surface-2 text-fg-muted hover:bg-surface-hover hover:text-fg',
            )}
          >{DAY_LABELS[d]}</button>
        )
      })}
    </div>
  )
}

/**
 * A native select drawn as a sheet chip ("Weekly ▾"): the chip shows the
 * choice at the chip's size; the select lies invisible over it and takes the
 * tap (the phone's own picker) and the keys. A visible select would render at
 * 16px on touch screens (the iOS zoom guard) and stand out of the chip row.
 */
function ChipSelect<T extends string>({ label, value, options, onChange, icon, disabled }: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (v: T) => void
  icon?: ReactNode
  disabled?: boolean
}) {
  return (
    <span className={chipClass('set', 'relative pr-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent-500/50')}>
      {icon}{options.find(o => o.value === value)?.label ?? value}
      <ChevronDown className="text-fg-faint" aria-hidden />
      <select
        aria-label={label} value={value} disabled={disabled} onChange={e => onChange(e.target.value as T)}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-full opacity-0 disabled:cursor-default"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </span>
  )
}

const CUSTOM_KINDS: { value: CustomRepeatKind; label: string }[] = [
  { value: 'every', label: 'Every…' },
  { value: 'dates', label: 'Dates' },
]

export function RecurrenceField({
  value, onChange, start, exceptDates, locked, options = RECURRENCE_OPTIONS,
}: {
  value: RepeatFormFields
  onChange: (p: Partial<RepeatFormFields>) => void
  /** The plan's start ('yyyy-MM-dd'): the monthly / every-N anchor and Weekly's first day. */
  start: string
  /** A saved plan's left-out days — the preview skips them too. */
  exceptDates?: readonly string[]
  locked?: boolean
  /** Defaults to the full list (incl. "No repeat") — RecurringTab passes
   *  RECURRING_EDIT_OPTIONS instead, since an existing recurring template
   *  must never offer converting itself into a one-off block. */
  options?: { value: RecurrenceMode; label: string }[]
}) {
  const picker = dayPickerFor(value)
  const circles = picker && (
    <DayCircles lit={litDays(value)} single={picker === 'single'} locked={locked} onToggle={d => onChange(toggleRepeatDay(value, d))} />
  )
  const custom = value.recurrence === 'custom'
  const every = Number(value.repeatEvery)
  const problem = recurrenceProblem(value)
  // Every day / Weekdays / Weekly: the select and the circles already say it
  // all — a summary line would only repeat them (an extra line on a phone).
  const preview = value.recurrence === 'monthly' || custom ? repeatPreview(value, start, todayStr(), exceptDates) : null

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <ChipSelect
          label="Repeat" icon={<Repeat aria-hidden />} value={value.recurrence} options={options} disabled={locked}
          onChange={mode => onChange(pickRecurrence(value, mode, weekdayOfIso(start)))}
        />
        {custom
          ? <SegmentedControl size="xs" options={CUSTOM_KINDS} value={value.customKind} onChange={k => onChange({ customKind: k })} />
          : circles}
      </div>

      {custom && value.customKind === 'every' && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex items-center gap-1.5">
            <span className="text-body text-fg-2">Every</span>
            <input
              type="number" inputMode="numeric" min={1} max={99} value={value.repeatEvery} disabled={locked}
              onChange={e => onChange({ repeatEvery: e.target.value })} aria-label="Repeat every"
              className="input input-sm w-14 text-center tabular-nums disabled:opacity-60"
            />
            <ChipSelect
              label="Unit" value={value.repeatUnit} disabled={locked}
              options={REPEAT_UNIT_OPTIONS.map(u => ({ value: u.value, label: every === 1 ? u.one : u.many }))}
              onChange={repeatUnit => onChange({ repeatUnit })}
            />
          </div>
          {circles}
        </div>
      )}

      {custom && value.customKind === 'dates' && (
        <DateCalendar
          value={value.repeatDates[0] ?? start} selected={value.repeatDates}
          onPick={iso => onChange({
            repeatDates: value.repeatDates.includes(iso) ? value.repeatDates.filter(d => d !== iso) : [...value.repeatDates, iso].sort(),
          })}
        />
      )}

      {custom && value.customKind === 'dates' && value.repeatDates.length === 0
        ? <p className="text-meta text-fg-muted">Tap the days it happens on.</p>
        : problem
        ? <p className="text-meta text-danger">{problem}</p>
        : preview && (
          <MetaLine
            className="text-meta text-fg-muted"
            items={[
              <span key="s" className="font-medium text-fg-2">{preview.summary}</span>,
              preview.next.length > 0 ? `Next ${preview.next.map(d => formatDate(d)).join(', ')}` : 'No date ahead',
            ]}
          />
        )}
    </div>
  )
}

// ── Checkbox row ──────────────────────────────────────────────────────────────

export function CheckboxRow({
  checked, onChange, label, disabled, title,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
  title?: string
}) {
  return (
    <label className={cx('flex min-h-[44px] items-center gap-3', disabled ? 'cursor-default opacity-60' : 'cursor-pointer')} title={title}>
      <input
        type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)}
        className="h-4 w-4 rounded accent-accent-500 disabled:cursor-default"
      />
      <span className="text-body text-fg-2">{label}</span>
    </label>
  )
}

/** Hairline section divider with an eyebrow label. */
export function SectionDivider({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mb-1 flex items-center gap-2">
      <span className="section-label">{children}</span>
      <div className="h-px flex-1 bg-line" />
    </div>
  )
}
