import { useState } from 'react'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button, MetaLine } from '../../../shared/ui'
import { useQuickGuessItems, useSaveQuickGuess } from '../hooks/useQuickGuess'
import { draftProblem, draftToInput, nextSortOrder, parseGuessTitle } from '../quickGuess'

// Edit entry's "Save as Quick guess" on a one-off line (Food point 6): the
// line becomes a Quick guess preset, prefilled, written only on Save.
//
// TODO(merge, coordinator): replace the stand-in below with the Quick guess
// agent's prefilled editor (it lands with Food point 7):
//   import { QuickGuessSheet } from './QuickGuessEditor'
//   import { lineToDraft } from '../quickGuess'
//   return <QuickGuessSheet item={null} initial={lineToDraft(line)} onClose={onClose} />

/** A one-off diary line as it is stored. */
export interface GuessLine {
  title: string
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  sugar_g: number | null
}

export function SaveAsQuickGuess({ line, onClose }: { line: GuessLine; onClose: () => void }) {
  const save = useSaveQuickGuess()
  const { data: items } = useQuickGuessItems()
  // "Beer ×2" at 430 kcal is one 215 kcal Beer.
  const { base, factor } = parseGuessTitle(line.title)
  const one = (v: number | null) => (v == null ? null : Math.round((v / factor) * 10) / 10)
  const [name, setName] = useState(base)
  const draft = { name, icon: '', portion: '', kcal: one(line.calories), protein: one(line.protein_g), carbs: one(line.carbs_g), fat: one(line.fat_g), sugar: one(line.sugar_g) }
  const [problem, setProblem] = useState<string | null>(null)

  async function submit() {
    const p = draftProblem(draft)
    if (p) { setProblem(p); return }
    try { await save.mutateAsync({ input: draftToInput(draft, nextSortOrder(items ?? [])) }) } catch { return }
    onClose()
  }

  return (
    <ModalShell compact size="sm" onClose={onClose} dismissible={!save.isPending} title="Save as Quick guess"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={() => { void submit() }} loading={save.isPending}>Save</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-micro text-fg-muted">Name</span>
          <input value={name} onChange={e => { setName(e.target.value); setProblem(null) }} maxLength={60} className="input" />
        </label>
        <MetaLine className="text-meta text-fg-muted tabular-nums" items={[
          `One portion: ${draft.kcal ?? 0} kcal`,
          `${draft.protein ?? 0} g protein`, `${draft.carbs ?? 0} g carbs`, `${draft.fat ?? 0} g fat`,
        ]} />
        {problem && <p role="alert" className="text-meta text-danger">{problem}</p>}
      </div>
    </ModalShell>
  )
}
