import { useId, useState } from 'react'
import { Card, CardHeader } from '../../../../shared/ui'
import { Fact, FactChips } from './factKit'
import { buyFacts, commonFacts, generalFacts, goneFacts, ownFacts, type FactCtx, type FactDef } from './factList'
import type { useRecordDraft } from './useRecordDraft'
import type { RecordState } from './recordState'
import type { ShopCategory, ShopItem, ShopPriceWatch } from '../../types'

/** The record's facts as text, tap to edit; the empty ones wait as "+" chips. */
export function RecordFacts({ item, d, state, categories, stores, watch, today }: {
  item: ShopItem
  d: ReturnType<typeof useRecordDraft>
  state: RecordState
  categories: readonly ShopCategory[]
  stores: readonly string[]
  watch: ShopPriceWatch | null
  today: string
}) {
  const listId = useId()
  const [added, setAdded] = useState<Set<string>>(new Set())
  const v = { ...item, ...d.draft } as ShopItem
  const ctx: FactCtx = { v, boughtDay: d.boughtDay, set: d.set, categories, stores, watch, today, listId }
  const owned = state === 'mine' || state === 'gone' || (state === 'other' && item.status === 'bought')
  const byId = new Map<string, FactDef>()
  for (const f of [
    ...commonFacts(ctx, state === 'general' ? 'general' : owned ? 'owned' : 'buy'),
    ...(state === 'general' ? generalFacts(ctx) : owned ? ownFacts(ctx, state === 'gone') : buyFacts(ctx)),
    ...(state === 'gone' ? goneFacts(ctx) : []),
  ]) byId.set(f.id, f)
  const pick = (ids: string[]) => ids.map(id => byId.get(id)).filter((f): f is FactDef => !!f)
  const groups: { title: string; facts: FactDef[] }[] = state === 'general'
    ? [{ title: 'The wish', facts: pick(['title', 'category', 'range', 'requirements', 'reason', 'notes', 'picture']) }]
    : !owned
      ? [{ title: 'Details', facts: pick(['title', 'category', 'price', 'reason', 'priority', 'store', 'deal', 'buyOn', 'target', 'errand', 'region', 'link', 'notes', 'picture']) }]
      : [
          ...(state === 'gone' ? [{ title: 'How it left', facts: pick(['how', 'left', 'soldTo', 'got']) }] : []),
          { title: 'Bought', facts: pick(['title', 'category', 'bought', 'paid', 'rate', 'store', 'region', 'saved', 'returnBy', 'complain', 'value', 'serial', 'link', 'notes', 'picture', 'resale', 'kept']) },
        ]

  return (
    <>
      {groups.map(g => {
        const shown = g.facts.filter(f => f.filled || added.has(f.id) || d.editing === f.id)
        const chips = g.facts
          .filter(f => !f.filled && !added.has(f.id) && d.editing !== f.id && f.chip && f.editor)
          .map(f => ({ id: f.id, label: f.chip as string, onAdd: () => { setAdded(s => new Set(s).add(f.id)); d.setEditing(f.id) } }))
        return (
          <Card key={g.title} className="flex flex-col gap-0.5">
            <CardHeader title={g.title} variant="label" className="mb-1" />
            {shown.map(f => (
              <Fact key={f.id} id={f.id} label={f.label} value={f.value} hint={f.hint} editing={d.editing}
                onEdit={d.setEditing} onDone={() => d.setEditing(null)}>
                {f.editor}
              </Fact>
            ))}
            <FactChips chips={chips} />
          </Card>
        )
      })}
    </>
  )
}
