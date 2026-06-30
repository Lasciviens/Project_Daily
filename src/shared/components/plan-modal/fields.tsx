// ─────────────────────────────────────────────────────────────────────────────
//  UnifiedPlanModal — REUSABLE FIELD PRIMITIVES
//  Presentational only. Each is controlled (value + onChange) and respects a
//  `locked` flag (visible but disabled). Add a new field here, wire it in a tab.
// ─────────────────────────────────────────────────────────────────────────────

import {
  DURATION_PRESETS, CATEGORY_LABELS, RECURRENCE_OPTIONS, DAY_LABELS,
  displayDate, todayStr, tomorrowStr,
} from './planModal.config'
import type { TimeBlockCategory } from '../../../features/daily/types'
import type { RecurrenceMode } from './planModal.types'

// ── Label ─────────────────────────────────────────────────────────────────────

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">
      {children}
    </label>
  )
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
      className="w-full min-h-[44px] bg-cream-50 border border-ink-200 rounded-xl px-4 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-400 disabled:opacity-60"
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
  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          type="button" disabled={locked} onClick={() => onStep(-1)}
          className="min-h-[44px] min-w-[40px] flex items-center justify-center border border-ink-200 rounded-xl text-ink-600 hover:bg-cream-50 transition-colors disabled:opacity-40"
        >←</button>
        <div className="flex-1">
          <input
            type="date" value={value} disabled={locked} id="plan-date-input"
            onChange={e => onChange(e.target.value)} className="sr-only"
          />
          <label
            htmlFor="plan-date-input"
            className="block min-h-[44px] bg-cream-50 border border-ink-200 rounded-xl px-3 text-sm text-ink-900 font-medium cursor-pointer flex items-center justify-center"
          >
            {displayDate(value)}
          </label>
        </div>
        <button
          type="button" disabled={locked} onClick={() => onStep(1)}
          className="min-h-[44px] min-w-[40px] flex items-center justify-center border border-ink-200 rounded-xl text-ink-600 hover:bg-cream-50 transition-colors disabled:opacity-40"
        >→</button>
      </div>
      <div className="flex gap-2 mt-2">
        {[{ label: 'Today', v: today }, { label: 'Tomorrow', v: tmrw }].map(s => (
          <button
            key={s.label} type="button" disabled={locked} onClick={() => onChange(s.v)}
            className={`px-3 min-h-[36px] text-xs font-medium rounded-lg border transition-colors disabled:opacity-40 ${
              value === s.v ? 'bg-accent-500 text-white border-accent-500' : 'border-ink-200 text-ink-600 hover:bg-cream-50'
            }`}
          >{s.label}</button>
        ))}
      </div>
    </div>
  )
}

// ── Time stepper — 24h input · −30m / +30m ────────────────────────────────────

export function TimeStepperField({
  value, onChange, onShift, locked,
}: {
  value: string
  onChange: (v: string) => void
  onShift: (deltaMin: number) => void
  locked?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button" disabled={locked} onClick={() => onShift(-30)}
        className="min-h-[44px] px-2.5 flex items-center justify-center border border-ink-200 rounded-xl text-ink-600 hover:bg-cream-50 transition-colors text-xs font-medium disabled:opacity-40"
      >−30m</button>
      <input
        type="time" value={value} disabled={locked} onChange={e => onChange(e.target.value)}
        className="flex-1 min-h-[44px] bg-cream-50 border border-ink-200 rounded-xl px-4 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-accent-400 text-center disabled:opacity-60"
      />
      <button
        type="button" disabled={locked} onClick={() => onShift(30)}
        className="min-h-[44px] px-2.5 flex items-center justify-center border border-ink-200 rounded-xl text-ink-600 hover:bg-cream-50 transition-colors text-xs font-medium disabled:opacity-40"
      >+30m</button>
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
  const fmt = (d: number) => d < 60 ? `${d}m` : d % 60 === 0 ? `${d / 60}h` : `${Math.floor(d / 60)}h${d % 60}m`
  return (
    <div className="flex flex-wrap gap-2">
      {DURATION_PRESETS.map(d => (
        <button
          key={d} type="button" disabled={locked} onClick={() => { onPreset(d); onCustom('') }}
          className={`min-h-[44px] px-3 text-xs font-medium rounded-lg border transition-colors disabled:opacity-40 ${
            duration === d && customMin === '' ? 'bg-accent-500 text-white border-accent-500' : 'border-ink-200 text-ink-600 hover:bg-cream-50'
          }`}
        >{fmt(d)}</button>
      ))}
      <input
        type="number" min={1} value={customMin} disabled={locked}
        onChange={e => onCustom(e.target.value)} placeholder="Custom"
        className="min-h-[44px] w-20 bg-cream-50 border border-ink-200 rounded-lg px-2 text-xs text-ink-900 focus:outline-none focus:ring-1 focus:ring-accent-400 disabled:opacity-60"
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
      className="w-full min-h-[44px] bg-cream-50 border border-ink-200 rounded-xl px-4 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-accent-400 disabled:opacity-60"
    >
      {(Object.entries(CATEGORY_LABELS) as [TimeBlockCategory, string][]).map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </select>
  )
}

// ── Recurrence — mode pills + (weekly) day picker ─────────────────────────────

export function RecurrenceField({
  mode, weeklyDays, onMode, onToggleDay, locked,
}: {
  mode: RecurrenceMode
  weeklyDays: number[]
  onMode: (m: RecurrenceMode) => void
  onToggleDay: (day: number) => void
  locked?: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {RECURRENCE_OPTIONS.map(o => (
          <button
            key={o.value} type="button" disabled={locked} onClick={() => onMode(o.value)}
            className={`min-h-[44px] px-3 text-xs font-medium rounded-lg border transition-colors disabled:opacity-40 ${
              mode === o.value ? 'bg-ink-900 text-white border-ink-900' : 'border-ink-200 text-ink-600 hover:bg-cream-50'
            }`}
          >{o.label}</button>
        ))}
      </div>
      {mode === 'weekly' && (
        <div className="flex gap-1">
          {DAY_LABELS.map((d, i) => (
            <button
              key={i} type="button" disabled={locked} onClick={() => onToggleDay(i)}
              className={`min-w-[40px] min-h-[40px] rounded-full text-[11px] font-medium transition-colors disabled:opacity-40 ${
                weeklyDays.includes(i) ? 'bg-accent-500 text-white' : 'bg-ink-100 text-ink-500'
              }`}
            >{d}</button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Checkbox row ──────────────────────────────────────────────────────────────

export function CheckboxRow({
  checked, onChange, label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <label className="flex items-center gap-3 min-h-[44px] cursor-pointer">
      <input
        type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 accent-accent-500 rounded"
      />
      <span className="text-sm text-ink-700">{label}</span>
    </label>
  )
}

// ── Pill group — single-select chips (section / priority / domain) ────────────

export function PillGroup<T extends string>({
  options, value, onChange, locked,
}: {
  options: { id: T; label: string; dot?: string }[]
  value: T
  onChange: (v: T) => void
  locked?: boolean
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => (
        <button
          key={o.id} type="button" disabled={locked} onClick={() => onChange(o.id)}
          className={`flex items-center gap-1.5 px-3 min-h-[36px] text-xs font-medium rounded-lg transition-colors disabled:opacity-40 ${
            value === o.id ? 'bg-accent-500 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
          }`}
        >
          {o.dot && <span className={`w-1.5 h-1.5 rounded-full ${o.dot}`} />}
          {o.label}
        </button>
      ))}
    </div>
  )
}
