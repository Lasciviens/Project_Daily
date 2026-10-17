import { useState } from 'react'
import { ChevronDown, ChevronUp, Plus } from 'lucide-react'
import { ModalShell } from '../../../shared/modals'
import { Button, IconButton, Skeleton, Truncate } from '../../../shared/ui'
import { useDeleteQuickGuess, useMoveQuickGuess, useQuickGuessItems, useSaveQuickGuess } from '../hooks/useQuickGuess'
import {
  DEFAULT_GUESSES, draftProblem, draftToInput, EMPTY_DRAFT, itemToDraft, moveGuess, nextSortOrder,
  type GuessDraft, type QuickGuessItem,
} from '../quickGuess'
import { DecimalInput } from './foodLogKit'
import { foodEmoji } from './foodLogUtils'
import { QuickGuessOptionsField } from './QuickGuessOptionsField'

const FORM_ID = 'quick-guess-form'
// Before migration 152 the editor shows the built-in presets; their ids are
// not rows, so a save adds a row and the api names the missing migration.
const BUILT_IN = 'built-in:'
const BUILT_IN_ITEMS: QuickGuessItem[] = DEFAULT_GUESSES.map((g, i) => ({
  id: `${BUILT_IN}${g.key}`, name: g.title, icon: g.icon, portion: g.portion,
  calories: g.kcal, protein_g: g.protein, carbs_g: g.carbs, fat_g: g.fat, sugar_g: g.sugar, sort_order: i, options: [],
}))

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

/**
 * Settings → Food → Quick guess: the presets Food · Today's Quick guess card
 * offers (quick_guess_items, migration 152). Tap one to edit it (delete is in
 * there, with Undo), move it with the arrows, add one at the end.
 */
export function QuickGuessEditor({ onClose }: { onClose: () => void }) {
  const q = useQuickGuessItems()
  const move = useMoveQuickGuess()
  const [editing, setEditing] = useState<QuickGuessItem | 'new' | null>(null)
  const migrated = q.data !== null
  const items = q.data ?? (q.data === null ? BUILT_IN_ITEMS : [])

  function step(item: QuickGuessItem, dir: -1 | 1) {
    const changes = moveGuess(items, item.id, dir)
    if (changes.length) move.mutate(changes)
  }

  return (
    <ModalShell
      onClose={onClose}
      size="sm"
      title="Quick guess"
      subtitle="The one-tap chips on Food · Today"
      footer={
        <div className="flex justify-between gap-2">
          <Button icon={<Plus />} onClick={() => setEditing('new')} disabled={q.isLoading || q.isError}>Add</Button>
          <Button variant="primary" onClick={onClose}>Done</Button>
        </div>
      }
    >
      {!migrated && (
        <p className="mb-2 text-meta text-fg-muted">These are the built-in presets. Saving your own needs migration 152 — until it runs, a save says so.</p>
      )}
      {q.isError && (
        <p className="text-meta text-fg-muted">Your presets didn't load. <button type="button" onClick={() => { void q.refetch() }} className="font-semibold text-accent-600">Try again</button></p>
      )}
      {q.isLoading && <div className="flex flex-col gap-1.5">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-11" />)}</div>}
      {q.data?.length === 0 && <p className="text-meta text-fg-muted">No presets. Add the things you often eat but can't weigh.</p>}
      <ul className="-mx-2 flex flex-col">
        {items.map((item, i) => (
          <li key={item.id} className="flex items-center gap-0.5 rounded-row pr-1 hover:bg-surface-hover">
            <button type="button" onClick={() => setEditing(item)} aria-label={`Edit ${item.name}`}
              className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2.5 px-2 py-1 text-left">
              <span aria-hidden className="w-6 shrink-0 text-center text-base leading-none">{item.icon || foodEmoji(item.name)}</span>
              <span className="min-w-0 flex-1">
                <Truncate className="text-body font-medium text-fg">{item.name}</Truncate>
                {/* One line: kcal and protein (what the chip shows), then its option groups, or carbs and fat where the popup is wider. */}
                <p className="whitespace-nowrap text-meta tabular-nums text-fg-muted">
                  {item.calories} kcal · {item.protein_g} g protein
                  {item.options.length > 0
                    ? <> · <span className="text-fg-2">{item.options.length === 1 ? '1 option group' : `${item.options.length} option groups`}</span></>
                    : <span className="hidden sm:inline"> · {item.carbs_g} g carbs · {item.fat_g} g fat</span>}
                </p>
              </span>
            </button>
            <IconButton label={`Move ${item.name} up`} disabled={i === 0 || move.isPending} onClick={() => step(item, -1)} className="shrink-0 text-fg-muted disabled:opacity-30"><ChevronUp /></IconButton>
            <IconButton label={`Move ${item.name} down`} disabled={i === items.length - 1 || move.isPending} onClick={() => step(item, 1)} className="shrink-0 text-fg-muted disabled:opacity-30"><ChevronDown /></IconButton>
          </li>
        ))}
      </ul>
      {editing && (
        <QuickGuessSheet key={editing === 'new' ? 'new' : editing.id} item={editing === 'new' ? null : editing}
          sortOrder={nextSortOrder(items)} onClose={() => setEditing(null)} />
      )}
    </ModalShell>
  )
}
