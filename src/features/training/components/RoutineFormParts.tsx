import { useState, type ReactNode } from 'react'
import { Combobox, ComboboxInput, ComboboxOptions, ComboboxOption } from '@headlessui/react'
import { X } from 'lucide-react'
import { SET_TYPE_OPTIONS, type SetType } from '../setTypeMeta'
import type { FormSet, setFieldsForType } from '../routineForm'
import type { HevyExerciseTemplate } from '../types.hevy'

export const inputCls = 'input w-full px-2 text-center'

// Tiny field-label sits above a set input so the column is scannable.
// The label only renders on the header row; later rows keep the spacing.
export function SetField({ label, showLabel, children, wide }: { label: string; showLabel: boolean; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`flex flex-col gap-0.5 min-w-0 ${wide ? 'flex-[2]' : 'flex-1'}`}>
      <span className="h-3 text-center text-micro font-semibold uppercase leading-3 tracking-[0.08em] text-fg-muted">
        {showLabel ? label : ' '}
      </span>
      {children}
    </label>
  )
}

// ─── Exercise search combobox ─────────────────────────────────────────────────

interface ExerciseSearchProps {
  templates: HevyExerciseTemplate[]
  onSelect: (t: HevyExerciseTemplate) => void
}

export function ExerciseSearch({ templates, onSelect }: ExerciseSearchProps) {
  const [query, setQuery] = useState('')

  const filtered = query.length < 1
    ? []
    : templates.filter(t => t.title.toLowerCase().includes(query.toLowerCase())).slice(0, 20)

  return (
    <Combobox
      onChange={(t: HevyExerciseTemplate | null) => {
        if (t) { onSelect(t); setQuery('') }
      }}
      onClose={() => {}}
    >
      <div className="relative">
        <ComboboxInput
          className="input w-full"
          placeholder="Search and add exercise…"
          displayValue={() => query}
          onChange={e => setQuery(e.target.value)}
        />
        {filtered.length > 0 && (
          <ComboboxOptions className="menu absolute mt-1 max-h-56 w-full overflow-y-auto">
            {filtered.map(t => (
              <ComboboxOption
                key={t.id}
                value={t}
                className="menu-item cursor-pointer"
              >
                <span className="font-medium">{t.title}</span>
                {t.primary_muscle_group && (
                  <span className="ml-auto text-meta capitalize text-fg-muted">{t.primary_muscle_group}</span>
                )}
              </ComboboxOption>
            ))}
          </ComboboxOptions>
        )}
      </div>
    </Combobox>
  )
}

// ─── Single set row ───────────────────────────────────────────────────────────

interface SetRowProps {
  set:       FormSet
  index:     number
  fields:    ReturnType<typeof setFieldsForType>
  useRange:  boolean
  canRemove: boolean
  showLabel: boolean
  onChange:  (patch: Partial<FormSet>) => void
  onRemove:  () => void
}

export function SetRow({ set, index, fields, useRange, canRemove, showLabel, onChange, onRemove }: SetRowProps) {
  return (
    <div className="flex items-end gap-2">
      {/* Set number badge */}
      <div className="flex flex-col gap-0.5 shrink-0">
        <span className="h-3" aria-hidden />
        <span className="flex min-h-[44px] w-7 items-center justify-center rounded-control bg-surface-2 text-meta font-bold tabular-nums text-fg-muted">
          {index + 1}
        </span>
      </div>

      {/* Type — fixed width, the rest of the metrics share a flexible grid */}
      <div className="shrink-0 w-[84px] sm:w-[96px]">
        <SetField label="Type" showLabel={showLabel}>
          <select
            value={set.type}
            onChange={e => onChange({ type: e.target.value as SetType })}
            className="select w-full px-2"
          >
            {SET_TYPE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </SetField>
      </div>

      <div className="flex-1 min-w-0 flex items-end gap-2">
        {fields.weight && (
          <SetField label="kg" showLabel={showLabel}>
            <input
              type="number" inputMode="decimal" value={set.weight_kg}
              onChange={e => onChange({ weight_kg: e.target.value })}
              placeholder="–" className={inputCls}
            />
          </SetField>
        )}

        {fields.reps && !useRange && (
          <SetField label="Reps" showLabel={showLabel}>
            <input
              type="number" inputMode="numeric" value={set.reps}
              onChange={e => onChange({ reps: e.target.value })}
              placeholder="–" className={inputCls}
            />
          </SetField>
        )}

        {fields.reps && useRange && (
          <SetField label="Rep range" showLabel={showLabel} wide>
            <div className="flex items-center gap-1">
              <input
                type="number" inputMode="numeric" value={set.rep_range_start}
                onChange={e => onChange({ rep_range_start: e.target.value })}
                placeholder="min" className={inputCls}
              />
              <span className="shrink-0 text-meta text-fg-faint">–</span>
              <input
                type="number" inputMode="numeric" value={set.rep_range_end}
                onChange={e => onChange({ rep_range_end: e.target.value })}
                placeholder="max" className={inputCls}
              />
            </div>
          </SetField>
        )}

        {fields.duration && (
          <SetField label="Sec" showLabel={showLabel}>
            <input
              type="number" inputMode="numeric" value={set.duration_seconds}
              onChange={e => onChange({ duration_seconds: e.target.value })}
              placeholder="–" className={inputCls}
            />
          </SetField>
        )}

        {fields.distance && (
          <SetField label="Meters" showLabel={showLabel}>
            <input
              type="number" inputMode="numeric" value={set.distance_meters}
              onChange={e => onChange({ distance_meters: e.target.value })}
              placeholder="–" className={inputCls}
            />
          </SetField>
        )}
      </div>

      {/* Remove — fixed slot so columns stay aligned across rows */}
      <div className="flex flex-col gap-0.5 shrink-0">
        <span className="h-3" aria-hidden />
        {canRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="icon-btn text-fg-faint hover:!text-danger"
            aria-label={`Remove set ${index + 1}`}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : (
          <span className="min-h-[44px] min-w-[44px] block" aria-hidden />
        )}
      </div>
    </div>
  )
}

