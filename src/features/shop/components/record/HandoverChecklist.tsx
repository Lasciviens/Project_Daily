import { useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button, CardHeader, cx } from '../../../../shared/ui'
import { useCreateChecklist, useHandoverChecklists } from '../../hooks/useShopResale'
import { useEditChecklist, useHandoverTicks } from '../../hooks/useShopSelling'
import { checklistSteps } from '../../resaleRows'
import { categoryNamesOf, checklistFor } from '../../resaleTexts'
import { stepsProblem, stepsText } from '../../sellingModel'
import type { ShopCategory, ShopItem } from '../../types'

/**
 * The hand-over checklist for the thing's category (its subcategory's, else its top category's — the owner's own
 * rows): tick through it before it goes (the ticks stay on this device); Edit steps turns the steps into rows to
 * change, add or take out — saved with Undo. A category without one offers to make one.
 */
export function HandoverChecklist({ item, categories }: { item: ShopItem; categories: readonly ShopCategory[] }) {
  const { data: lists = [], isLoading } = useHandoverChecklists()
  const names = useMemo(() => categoryNamesOf(item.category_id, categories), [item.category_id, categories])
  const list = checklistFor(lists, names)
  const steps = useMemo(() => (list ? checklistSteps(list.steps) : []), [list])
  const { ticked, toggle } = useHandoverTicks(item.id, steps)
  const [editing, setEditing] = useState(false)
  if (isLoading || !names.length) return null
  const done = steps.filter(s => ticked.has(s)).length

  return (
    <div>
      <CardHeader title="Before you hand it over" variant="label" className="mb-1"
        subtitle={list && !editing ? `${done} of ${steps.length}${list.category !== names[0] ? ` · ${list.category}` : ''}` : undefined}
        action={!editing && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>{list ? 'Edit steps' : `Make one for ${names[0]}`}</Button>} />
      {editing ? (
        <StepsEditor checklist={list} category={names[0]} steps={steps} onDone={() => setEditing(false)} />
      ) : list ? (
        <>
          <ul className="flex flex-col">
            {steps.map(s => (
              <li key={s}>
                <label className="flex min-h-[40px] items-start gap-2 py-1 text-body text-fg-2">
                  <input type="checkbox" checked={ticked.has(s)} onChange={() => toggle(s)} className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-accent-500" />
                  <span className={cx('min-w-0 break-words', ticked.has(s) && 'text-fg-muted line-through')}>{s}</span>
                </label>
              </li>
            ))}
          </ul>
          {done === steps.length && steps.length > 0 && <p data-tone="success" className="tone-text text-meta font-semibold">All done — ready to hand it over.</p>}
        </>
      ) : (
        <p className="text-meta text-fg-muted">No hand-over checklist for {names[0]} yet.</p>
      )}
    </div>
  )
}

/** The steps as rows: change one, take one out, add one; Save writes them (an edit with Undo, a new list "added"). */
function StepsEditor({ checklist, category, steps, onDone }: {
  checklist: ReturnType<typeof checklistFor>
  category: string
  steps: readonly string[]
  onDone: () => void
}) {
  const edit = useEditChecklist()
  const create = useCreateChecklist()
  const [rows, setRows] = useState<string[]>(() => (steps.length ? [...steps] : ['']))
  const problem = stepsProblem(rows)
  const save = () => {
    if (problem) return
    const text = stepsText(rows)
    if (checklist) edit.mutate({ checklist, steps: text }, { onSuccess: onDone })
    else create.mutate({ category, steps: text }, { onSuccess: onDone })
  }
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((s, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input value={s} onChange={e => setRows(r => r.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Step ${i + 1}`} className="input input-sm min-w-0 flex-1" />
          <button type="button" aria-label={`Take out step ${i + 1}`} onClick={() => setRows(r => r.filter((_, j) => j !== i))} className="icon-btn shrink-0 text-fg-faint hover:!text-danger">
            <X aria-hidden className="h-4 w-4" />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setRows(r => [...r, ''])}>Step</Button>
        {problem && <span className="text-meta text-fg-muted">{problem}</span>}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onDone}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={save} disabled={!!problem} loading={edit.isPending || create.isPending}>Save steps</Button>
      </div>
    </div>
  )
}
