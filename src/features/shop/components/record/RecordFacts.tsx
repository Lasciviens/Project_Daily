import { useState } from 'react'
import { CardHeader } from '../../../../shared/ui'
import { Fact, FactChips, FactField, Toggle } from './factKit'
import { buyFacts, commonFacts, generalFacts, goneFacts, ownFacts, type FactCtx, type FactDef } from './factList'
import type { RecordDraft, RecordDraftApi } from './useRecordDraft'
import type { RecordState } from './recordState'
import type { ShopCategory, ShopItem } from '../../types'

/** The facts the record's Resale section holds (the rest are in Facts). */
const RESALE_OWN = ['value', 'resale']
const RESALE_GONE = ['how', 'left', 'soldTo', 'got', 'saleRate']

/**
 * The record's facts as text, tap to edit; the empty ones wait as "+" chips.
 * `section`: the Facts section (what it is and how it was bought) or the
 * Resale section (what it could sell for, bought to sell — or how it left).
 * A thing still yours shows its store and its return and complaint days in Purchase, never here too.
 */
export function RecordFacts({ item, d, state, categories, today, parents, section = 'facts', create }: {
  item: ShopItem
  d: RecordDraftApi
  state: RecordState
  categories: readonly ShopCategory[]
  today: string
  /** Things it can be an accessory of (owned only); absent = it cannot become one. */
  parents?: readonly ShopItem[]
  section?: 'facts' | 'resale'
  /**
   * A new thing (the create popup): every fact the record can edit is a field to fill, its editor open, in the order
   * the record lists them; `without` names facts shown elsewhere in the popup (the link, which the link reader has).
   */
  create?: { without?: readonly string[] }
}) {
  const [added, setAdded] = useState<Set<string>>(new Set())
  const v = { ...item, ...d.draft } as ShopItem & RecordDraft
  const ctx: FactCtx = { v, boughtDay: d.boughtDay, set: d.set, categories, today, parents, focus: !create }
  const owned = state === 'mine' || state === 'gone' || (state === 'other' && item.status === 'bought')
  // A returned thing is "other", not "gone", yet it left with a sale's facts: they sit in Facts.
  const left = state === 'gone' || (state === 'other' && !!item.disposal)
  const byId = new Map<string, FactDef>()
  for (const f of [
    ...commonFacts(ctx, state === 'general' ? 'general' : owned ? 'owned' : 'buy'),
    ...(state === 'general' ? generalFacts(ctx) : owned ? ownFacts(ctx, state === 'gone') : buyFacts(ctx)),
    ...(left ? goneFacts(ctx) : []),
    // A general wish has a priority at creation (the add form always had one), though its record shows none.
    ...(create && state === 'general' ? buyFacts(ctx).filter(f => f.id === 'priority') : []),
  ]) byId.set(f.id, f)
  const pick = (ids: string[]) => ids.map(id => byId.get(id)).filter((f): f is FactDef => !!f)
  const bought = ['title', 'category', 'parent', 'bought', 'paid', 'rate', ...(state === 'mine' ? [] : ['store']), 'region', 'saved', 'serial', 'link', 'notes', 'picture', 'kept']
  const without = new Set(create?.without ?? [])
  // A thing not yet saved names its store here (a record of a thing still yours names it in Purchase).
  const boughtAt = ['title', 'category', 'parent', 'bought', 'paid', 'rate', 'store', 'region', 'saved', 'serial', 'link', 'notes', 'picture', 'kept']
  // Created, a thing carries all of its facts at once: what it is and how it was bought, and — for something that has
  // left — how it went (the record keeps those two in Facts and Resale).
  const createFacts = state === 'general' ? ['title', 'category', 'range', 'requirements', 'reason', 'priority', 'notes', 'picture']
    : !owned ? ['title', 'category', 'price', 'reason', 'priority', 'store', 'deal', 'buyOn', 'target', 'errand', 'region', 'link', 'notes', 'picture']
    : state === 'gone' ? [...boughtAt, 'resale', 'how', 'left', 'soldTo', 'got', 'saleRate']
    : [...boughtAt, 'value', 'resale']
  const groups: { title: string | null; facts: FactDef[] }[] = create
    ? [{ title: null, facts: pick(createFacts).filter(f => !without.has(f.id)) }]
    : section === 'resale'
    ? [{ title: null, facts: pick(state === 'gone' ? RESALE_GONE : RESALE_OWN) }]
    : state === 'general'
      ? [{ title: null, facts: pick(['title', 'category', 'range', 'requirements', 'reason', 'notes', 'picture']) }]
      : !owned
        ? [{ title: null, facts: pick(['title', 'category', 'price', 'reason', 'priority', 'store', 'deal', 'buyOn', 'target', 'errand', 'region', 'link', 'notes', 'picture']) }]
        // A thing gone keeps "Bought to sell" with its purchase (Resale holds how it left).
        : [{ title: null, facts: pick(state === 'gone' ? [...bought, 'resale'] : state === 'other' && item.disposal ? [...bought, 'how', 'left', 'soldTo', 'got', 'saleRate'] : bought) }]

  return (
    <>
      {groups.map((g, i) => {
        if (create) {
          return (
            <div key={i} className="flex flex-col gap-0.5">
              {g.facts.filter(f => !f.toggle && f.editor).map(f => <FactField key={f.id} label={f.label} hint={f.hint}>{f.editor}</FactField>)}
              {g.facts.some(f => f.toggle) && (
                <div className="flex flex-col pt-1">
                  {g.facts.filter(f => f.toggle).map(f => <Toggle key={f.id} checked={f.toggle?.checked ?? false} onChange={x => f.toggle?.onChange(x)}>{f.toggle?.text}</Toggle>)}
                </div>
              )}
            </div>
          )
        }
        const shown = g.facts.filter(f => !f.toggle && (f.filled || added.has(f.id) || d.editing === f.id))
        const toggles = g.facts.filter(f => f.toggle)
        const chips = g.facts
          .filter(f => !f.toggle && !f.filled && !added.has(f.id) && d.editing !== f.id && f.chip && f.editor)
          .map(f => ({ id: f.id, label: f.chip as string, onAdd: () => { setAdded(s => new Set(s).add(f.id)); d.setEditing(f.id) } }))
        return (
          <div key={g.title ?? i} className="flex flex-col gap-0.5">
            {g.title && <CardHeader title={g.title} variant="label" className="mb-1" />}
            {shown.map(f => (
              <Fact key={f.id} id={f.id} label={f.label} value={f.value} hint={f.hint} editing={d.editing}
                onEdit={d.setEditing} onDone={() => d.setEditing(null)}>
                {f.editor}
              </Fact>
            ))}
            {toggles.length > 0 && (
              <div className="flex flex-col pt-1">
                {toggles.map(f => <Toggle key={f.id} checked={f.toggle?.checked ?? false} onChange={v => f.toggle?.onChange(v)}>{f.toggle?.text}</Toggle>)}
              </div>
            )}
            <FactChips chips={chips} />
          </div>
        )
      })}
    </>
  )
}
