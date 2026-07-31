import type { ReactNode } from 'react'
import { SegmentedControl } from '../../../shared/components/SegmentedControl'
import { WindowChips } from '../../../shared/components/windowChips'
import type { WishKind, WishPriority, WishStatus } from '../types'

// Everything about a wish that is NOT capture. Split out of WishSheet so the
// sheet owns only the draft + save, and this stays a plain controlled form.
export interface WishDraft {
  title:        string
  notes:        string
  kind:         WishKind
  priority:     WishPriority
  status:       WishStatus
  city:         string
  country:      string
  url:          string
  period_start: string | null
  period_end:   string | null
  period_label: string | null
}

const FIELD = 'min-h-[44px] w-full max-w-md rounded-xl border border-ink-200 bg-canvas px-3 text-sm text-ink-900 placeholder:text-ink-400'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-500">{label}</span>
      {children}
    </label>
  )
}

interface Props {
  draft:    WishDraft
  onChange: (patch: Partial<WishDraft>) => void
}

export function WishForm({ draft, onChange }: Props) {
  return (
    <div className="flex flex-col gap-4 p-5">
      <Field label="Wish">
        <input value={draft.title} onChange={e => onChange({ title: e.target.value })} className={FIELD} />
      </Field>

      <Field label="Kind">
        <SegmentedControl<WishKind>
          value={draft.kind}
          onChange={kind => onChange({ kind })}
          size="sm"
          options={[{ value: 'thing', label: 'Thing' }, { value: 'place', label: '📍 Place' }]}
        />
      </Field>

      {draft.kind === 'place' && (
        <div className="flex flex-wrap gap-3">
          <Field label="City">
            <input value={draft.city} onChange={e => onChange({ city: e.target.value })} className={`${FIELD} sm:w-52`} />
          </Field>
          <Field label="Country">
            <input value={draft.country} onChange={e => onChange({ country: e.target.value })} className={`${FIELD} sm:w-52`} />
          </Field>
        </div>
      )}

      <Field label="When to bring it up">
        <WindowChips
          value={{ start: draft.period_start, end: draft.period_end, label: draft.period_label }}
          onChange={v => onChange({ period_start: v.start, period_end: v.end, period_label: v.label })}
        />
      </Field>

      <Field label="Notes">
        <textarea value={draft.notes} onChange={e => onChange({ notes: e.target.value })} rows={3} className={`${FIELD} py-2`} />
      </Field>

      <Field label="Link">
        <input
          value={draft.url}
          onChange={e => onChange({ url: e.target.value })}
          inputMode="url"
          placeholder="https://…"
          className={FIELD}
        />
      </Field>

      <Field label="Priority">
        <SegmentedControl<WishPriority>
          value={draft.priority}
          onChange={priority => onChange({ priority })}
          size="sm"
          options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]}
        />
      </Field>

      <Field label="Status">
        <SegmentedControl<WishStatus>
          value={draft.status}
          onChange={status => onChange({ status })}
          size="sm"
          fullWidth
          options={[
            { value: 'idea', label: 'Idea' }, { value: 'planned', label: 'Planned' },
            { value: 'done', label: 'Done' }, { value: 'dropped', label: 'Dropped' },
          ]}
        />
      </Field>
    </div>
  )
}
