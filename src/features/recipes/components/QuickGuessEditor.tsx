import { useState } from 'react'
import { ModalShell } from '../../../shared/modals'
import { Button } from '../../../shared/ui'
import { useDeleteQuickGuess, useQuickGuessItems, useSaveQuickGuess } from '../hooks/useQuickGuess'
import {
  draftProblem, draftToInput, EMPTY_DRAFT, itemToDraft, nextSortOrder,
  type GuessDraft, type QuickGuessItem,
} from '../quickGuess'
import { DecimalInput } from './foodLogKit'
import { foodEmoji } from './foodLogUtils'
import { QuickGuessOptionsField } from './QuickGuessOptionsField'
import { BUILT_IN } from './quickGuessBuiltIn'

const FORM_ID = 'quick-guess-form'

const MACROS = [
  { key: 'kcal', label: 'Kcal' },
  { key: 'protein', label: 'Protein' },
  { key: 'carbs', label: 'Carbs' },
  { key: 'fat', label: 'Fat' },
  { key: 'sugar', label: 'Sugar' },
] as const

/**
 * Add or edit one preset: name, icon, portion, kcal and macros per portion,
 * and the options asked before logging. A local stacked sheet; `initial`
 * prefills a new one ("Save as preset" from Describe it, "Save as Quick
 * guess" from a diary line — lineToDraft). A new preset goes last.
 */
export function QuickGuessSheet({ item, sortOrder, initial, onClose }: {
  item: QuickGuessItem | null
  /** Where a new preset goes; by default after the last one. */
  sortOrder?: number
  initial?: GuessDraft
  onClose: () => void
}) {
  const q = useQuickGuessItems()
  const save = useSaveQuickGuess()
  const remove = useDeleteQuickGuess()
  const [draft, setDraft] = useState<GuessDraft>(() => (item ? itemToDraft(item) : initial ?? EMPTY_DRAFT))
  const [problem, setProblem] = useState<string | null>(null)
  const set = <K extends keyof GuessDraft>(k: K, v: GuessDraft[K]) => { setDraft(d => ({ ...d, [k]: v })); setProblem(null) }
  const row = item && !item.id.startsWith(BUILT_IN) ? item : null
  const busy = save.isPending || remove.busy

  async function submit() {
    const p = draftProblem(draft)
    if (p) { setProblem(p); return }
    const order = item?.sort_order ?? sortOrder ?? nextSortOrder(q.data ?? [])
    try { await save.mutateAsync({ id: row?.id, input: draftToInput(draft, order) }) } catch { return }
    onClose()
  }

  async function handleDelete() {
    if (!row) return
    const result = await remove.run([row.id], { title: `Delete “${row.name}”?`, message: 'Lines you already logged with it stay in the diary.', done: `${row.name} deleted` })
    if (result === 'deleted' || result === 'gone') onClose()
  }

  return (
    <ModalShell
      onClose={onClose}
      size="sm"
      dismissible={!busy}
      title={item ? 'Edit quick guess' : 'New quick guess'}
      footer={
        <div className="flex gap-2 sm:justify-end">
          {row && <Button className="mr-auto" variant="danger" onClick={() => { void handleDelete() }} disabled={busy}>Delete</Button>}
          <Button className={row ? '' : 'ml-auto sm:ml-0'} onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" form={FORM_ID} variant="primary" loading={save.isPending}>Save</Button>
        </div>
      }
    >
      <form id={FORM_ID} className="flex flex-col gap-3" onSubmit={e => { e.preventDefault(); void submit() }}>
        <div className="grid grid-cols-[4rem_minmax(0,1fr)] gap-2">
          <label className="flex flex-col gap-1">
            <span className="field-label">Icon</span>
            <input value={draft.icon} onChange={e => set('icon', e.target.value)} maxLength={16}
              placeholder={foodEmoji(draft.name)} aria-label="Icon (an emoji)" className="input w-full text-center" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="field-label">Name</span>
            <input value={draft.name} onChange={e => set('name', e.target.value)} maxLength={60} required
              placeholder="e.g. Sweet" className="input w-full" />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="field-label">One portion is</span>
          <input value={draft.portion} onChange={e => set('portion', e.target.value)} maxLength={120}
            placeholder="e.g. a handful (about 50 g)" className="input w-full" />
        </label>
        <div>
          <p className="field-label mb-1">Per portion (kcal, then grams)</p>
          <div className="grid grid-cols-5 gap-2">
            {MACROS.map(m => (
              <label key={m.key} className="flex min-w-0 flex-col gap-1">
                <span className="text-micro font-semibold text-fg-muted">{m.label}</span>
                <DecimalInput value={draft[m.key]} onValue={v => set(m.key, v)} aria-label={m.key === 'kcal' ? 'Kcal' : `${m.label} (g)`}
                  className="input w-full px-2 text-right tabular-nums" />
              </label>
            ))}
          </div>
        </div>
        <QuickGuessOptionsField draft={draft} onChange={options => set('options', options)} />
        {problem && <p role="alert" className="text-meta text-danger">{problem}</p>}
      </form>
    </ModalShell>
  )
}
