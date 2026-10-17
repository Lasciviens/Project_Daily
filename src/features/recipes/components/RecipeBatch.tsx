import { useState } from 'react'
import { Button, cx } from '../../../shared/ui'
import { chipClass } from '../../../shared/components/plan-modal/fieldStyles'
import { formatDate } from '../../../shared/utils/dateFormat'
import { useUpdateRecipeBatch } from '../hooks/useRecipes'
import { DecimalInput } from './foodLogKit'
import { batchBar, countLabel, formatCount, plural, portionWord, type BatchBar, type BatchState } from '../foodAmount'
import type { RecipeWithIngredients } from '../types'

// What is left of a recipe's batch (Food point 8.3): "Batch from 16.10.2026 ·
// 14 of 20 pieces left" over a bar [eaten | this | left | over]; more than
// what is left is hatched and said ("2 more than left") but allowed. "New
// batch" starts one (how many it made, the pot's cooked weight if weighed);
// "Pot weight" adds the weight later, which offers "g cooked". Leftovers are
// derived from the diary (foodAmount.batchState), never stored.

const HATCH = { backgroundImage: 'repeating-linear-gradient(135deg, rgb(var(--tone)) 0 3px, transparent 3px 6px)' }

function BatchBarView({ bar, word }: { bar: BatchBar; word: string }) {
  const pct = (v: number) => `${(v / bar.total) * 100}%`
  const label = `${countLabel(bar.eaten, word)} eaten, ${countLabel(bar.this, word)} now, ${countLabel(bar.left, word)} left${bar.over > 0 ? `, ${countLabel(bar.over, word)} more than left` : ''}`
  return (
    <div role="img" aria-label={label} title={label} className="flex h-2 overflow-hidden rounded-full bg-line">
      {bar.eaten > 0 && <div className="bg-fg-faint" style={{ width: pct(bar.eaten) }} />}
      {bar.this > 0 && <div className="bg-accent-500" style={{ width: pct(bar.this) }} />}
      {bar.left > 0 && <div style={{ width: pct(bar.left) }} />}
      {bar.over > 0 && <div data-tone="warn" style={{ width: pct(bar.over), ...HATCH }} />}
    </div>
  )
}

export function RecipeBatchPanel({ recipe, batch, thisServings }: {
  recipe: RecipeWithIngredients
  /** From useRecipeBatch: null while loading or when no batch was ever started. */
  batch: BatchState | null
  /** The servings being logged now (the bar's "this"). */
  thisServings: number
}) {
  const word = portionWord(recipe.serving_label)
  const save = useUpdateRecipeBatch()
  const [form, setForm] = useState<null | 'new' | 'pot'>(null)
  const [made, setMade] = useState<number | null>(recipe.servings)
  const [pot, setPot] = useState<number | null>(batch?.cookedG ?? null)
  const live = batch?.active ? batch : null
  const bar = live ? batchBar(live, thisServings) : null

  function start() {
    if (!(made && made > 0)) return
    save.mutate(
      { id: recipe.id, patch: { start: true, batch_servings: made, batch_cooked_g: pot && pot > 0 ? pot : null }, done: `New batch of ${recipe.title} · ${countLabel(made, word)}` },
      { onSuccess: () => setForm(null) },
    )
  }
  function savePot() {
    save.mutate({ id: recipe.id, patch: { batch_cooked_g: pot && pot > 0 ? pot : null }, done: pot ? `Pot weight saved · ${Math.round(pot)} g` : 'Pot weight cleared' },
      { onSuccess: () => setForm(null) })
  }
  const openForm = (f: 'new' | 'pot') => {
    setForm(v => (v === f ? null : f))
    if (f === 'new') { setMade(recipe.servings); setPot(null) } else setPot(live?.cookedG ?? null)
  }

  const ended = batch && !batch.active
    ? (batch.left <= 0 ? `The batch from ${formatDate(batch.startedAt)} is eaten up` : `The batch from ${formatDate(batch.startedAt)} is over (4 days)`)
    : 'No batch on the go'

  return (
    <div className="flex flex-col gap-1.5 rounded-row bg-surface-2 px-3 py-2">
      <div className="flex min-h-[32px] items-center gap-2 text-meta">
        {live ? (
          <span className="min-w-0 flex-1 text-fg-2 tabular-nums">
            Batch from {formatDate(live.startedAt)} · <strong className="text-fg">{formatCount(Math.max(0, live.left))}</strong> of {formatCount(live.servings)} {plural(word, live.servings)} left
          </span>
        ) : (
          <span className="min-w-0 flex-1 text-fg-muted">{ended}</span>
        )}
        {live && <button type="button" onClick={() => openForm('pot')} aria-expanded={form === 'pot'} className={chipClass('quiet')}>{live.cookedG ? `Pot ${Math.round(live.cookedG)} g` : '+ Pot weight'}</button>}
        <button type="button" onClick={() => openForm('new')} aria-expanded={form === 'new'} className={chipClass('quiet')}>New batch</button>
      </div>
      {bar && <BatchBarView bar={bar} word={word} />}
      {bar && bar.over > 0 && (
        <p data-tone="warn" className="tone-text text-meta tabular-nums">{countLabel(bar.over, word)} more than left</p>
      )}
      {form && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2 text-meta text-fg-muted">
          {form === 'new' && <>
            <span>Made</span>
            <DecimalInput value={made} onValue={setMade} aria-label={`How many ${plural(word, 2)} the batch made`}
              className="input input-sm w-14 px-1.5 text-right tabular-nums" />
            <span>{plural(word, made ?? 2)} ·</span>
          </>}
          <span>Pot</span>
          <DecimalInput value={pot} onValue={setPot} aria-label="Cooked weight of the pot in grams" placeholder="—"
            className="input input-sm w-16 px-1.5 text-right tabular-nums" />
          <span>g cooked</span>
          <Button size="sm" variant="primary" className={cx('ml-auto')} loading={save.isPending}
            disabled={form === 'new' && !(made && made > 0)} onClick={form === 'new' ? start : savePot}>
            {form === 'new' ? 'Start' : 'Save'}
          </Button>
        </div>
      )}
    </div>
  )
}
