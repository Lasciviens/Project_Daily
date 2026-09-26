// ─────────────────────────────────────────────────────────────────────────────
//  UnifiedPlanModal — REUSABLE FIELD PRIMITIVES
//  Presentational only. Each is controlled (value + onChange) and respects a
//  `locked` flag (visible but disabled). Add a new field here, wire it in a tab.
//  Styling: theme tokens only (.input / .select / .field-label, tones).
// ─────────────────────────────────────────────────────────────────────────────

import { useId } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  DURATION_PRESETS, CATEGORY_LABELS, RECURRENCE_OPTIONS, DAY_LABELS,
  displayDate, todayStr, tomorrowStr,
} from './planModal.config'
import { formatDurationMinutes } from '../../utils/formatDuration'
import { ToneDot, cx, type Tone } from '../../ui'
import { choiceClass } from './fieldStyles'
import type { TimeBlockCategory } from '../../../features/daily/types'
import type { RecurrenceMode } from './planModal.types'

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

// ── Date stepper — DD.MM.YYYY Day · ← → · compact Today/Tomorrow ──────────────

export function DateStepperField({
  value, onChange, onStep, locked,
}: {
  value: string
  onChange: (v: string) => void
  onStep: (dir: 1 | -1) => void
  locked?: boolean
}) {
  const today = todayStr()
  const tmrw  = tomorrowStr()
  const inputId = useId()
  return (
    <div>
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
      <div className="mt-2 flex gap-2">
        {[{ label: 'Today', v: today }, { label: 'Tomorrow', v: tmrw }].map(s => (
          <button
            key={s.label} type="button" disabled={locked} onClick={() => onChange(s.v)}
            aria-pressed={value === s.v} className={choiceClass(value === s.v)}
          >{s.label}</button>
        ))}
      </div>
    </div>
  )
}

// ── Time field — strict 24h (HH + MM selects, NO AM/PM) · −30m / +30m ─────────
//  Native <input type="time"> renders AM/PM in some locales — selects guarantee
//  24h everywhere. Minutes step by 5; the ±30m buttons keep the value on-grid.

const HOUR_OPTS   = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTE_OPTS = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'))

export function Time24Field({
  value, onChange, onShift, locked,
}: {
  value: string                       // 'HH:MM'
  onChange: (v: string) => void
  onShift: (deltaMin: number) => void
  locked?: boolean
}) {
  const [hh = '09', mm = '00'] = value.split(':')
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
          {(MINUTE_OPTS.includes(mm) ? MINUTE_OPTS : [mm, ...MINUTE_OPTS]).map(m => <option key={m} value={m}>{m}</option>)}
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

// ── Recurrence — mode pills + (weekly) day picker ─────────────────────────────

export function RecurrenceField({
  mode, weeklyDays, onMode, onToggleDay, locked, options = RECURRENCE_OPTIONS,
}: {
  mode: RecurrenceMode
  weeklyDays: number[]
  onMode: (m: RecurrenceMode) => void
  onToggleDay: (day: number) => void
  locked?: boolean
  /** Defaults to the full list (incl. "No repeat") — RecurringTab passes
   *  RECURRING_EDIT_OPTIONS instead, since an existing recurring template
   *  must never offer converting itself into a one-off block. */
  options?: { value: RecurrenceMode; label: string }[]
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {options.map(o => (
          <button
            key={o.value} type="button" disabled={locked} onClick={() => onMode(o.value)}
            aria-pressed={mode === o.value} className={choiceClass(mode === o.value)}
          >{o.label}</button>
        ))}
      </div>
      {mode === 'weekly' && (
        <div className="flex gap-1">
          {DAY_LABELS.map((d, i) => {
            const on = weeklyDays.includes(i)
            return (
              <button
                key={i} type="button" disabled={locked} onClick={() => onToggleDay(i)} aria-pressed={on}
                className={cx(
                  'h-10 w-10 rounded-full text-meta font-semibold transition-colors disabled:opacity-40 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11',
                  on ? 'bg-accent-500 text-on-accent' : 'bg-surface-2 text-fg-muted hover:bg-surface-hover',
                )}
              >{d}</button>
            )
          })}
        </div>
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

// ── Pill group — single-select chips (section / priority / domain) ────────────

export function PillGroup<T extends string>({
  options, value, onChange, locked,
}: {
  options: { id: T; label: string; tone?: Tone }[]
  value: T
  onChange: (v: T) => void
  locked?: boolean
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => (
        <button
          key={o.id} type="button" disabled={locked} onClick={() => onChange(o.id)}
          aria-pressed={value === o.id} className={choiceClass(value === o.id)}
        >
          {o.tone && <ToneDot tone={o.tone} className={value === o.id ? 'ring-2 ring-surface/60' : undefined} />}
          {o.label}
        </button>
      ))}
    </div>
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
