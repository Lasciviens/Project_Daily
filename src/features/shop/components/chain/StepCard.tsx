import { ChevronDown, Trash2 } from 'lucide-react'
import { IconButton, Truncate, cx } from '../../../../shared/ui'
import { DecimalInput } from '../../../recipes/components/foodLogKit'
import { complete, gotOf, paidOf } from '../../ownModel'
import type { DraftStep, FullShopItem, StepProblem, StepView } from '../../chainDraft'
import { Toggle } from '../record/factKit'
import { AmountText } from '../shopKit'
import { money } from '../shopFormat'
import { copiedLine, signed, stepLine } from './chainText'
import { Problem, StepBuy, StepLeave, type SetStep } from './StepFields'
import { StepMore } from './StepMore'
import type { ShopCategory } from '../../types'

export interface StepCardProps {
  /** The step with what it copies filled in. */
  s: DraftStep
  index: number
  /** The thing before it (the step before, or the saved thing the chain continues), for "paid with" and "copy". */
  before: { title: string; saleCurrency: string; leftOn: string | null } | null
  row: FullShopItem | undefined
  view: StepView
  problems: readonly StepProblem[]
  open: boolean
  canRemove: boolean
  categories: readonly ShopCategory[]
  stores: readonly string[]
  today: string
  ratesLoading: boolean
  set: SetStep
  onCopy: (on: boolean) => void
  onToggle: () => void
  onRemove: () => void
}

/** One thing in the chain: its name, then (unfolded) how it was paid, what it cost, its details and how it left. */
export function StepCard(p: StepCardProps) {
  const { s, index, before, view } = p
  const title = s.title.trim() || `Thing ${index + 1}`
  return (
    <div className={cx('rounded-card border bg-surface', p.problems.length ? 'border-danger/50' : 'border-line')}>
      <div className="flex items-start gap-1.5 p-3 pb-2">
        <span aria-hidden className="grid h-11 w-7 shrink-0 place-items-center text-ui font-semibold tabular-nums text-fg-muted">{index + 1}</span>
        <div className="min-w-0 flex-1">
          <input value={s.title} onChange={e => p.set({ title: e.target.value })} aria-label={`Thing ${index + 1}`}
            placeholder={index === 0 && !before ? 'What did you buy first? (RP5…)' : 'What did that money buy?'} className="input font-semibold" />
          <Problem problems={p.problems} field="title" />
          {!p.open && (
            <button type="button" onClick={p.onToggle} className="mt-0.5 block w-full min-w-0 py-1 text-left">
              <Truncate as="span" className="block text-meta text-fg-muted">{stepLine(s, p.categories)}</Truncate>
            </button>
          )}
        </div>
        <IconButton label={p.open ? `Fold ${title}` : `Open ${title}`} aria-expanded={p.open} onClick={p.onToggle}>
          <ChevronDown className={cx('transition-transform', p.open && 'rotate-180')} />
        </IconButton>
        <IconButton label={`Remove ${title}`} onClick={p.onRemove} disabled={!p.canRemove} className="disabled:opacity-40"><Trash2 /></IconButton>
      </div>

      {p.open && (
        <div className="@container flex flex-col gap-3 border-t border-line px-3 py-3 sm:pl-11">
          {before && (
            <div className="flex flex-col">
              <Toggle checked={s.fromPrev} onChange={fromPrev => p.set({ fromPrev })}>Paid with the money from {before.title}</Toggle>
              {s.fromPrev && (
                <div className="mb-1 ml-[26px] flex items-center gap-2 text-meta text-fg-muted">
                  <DecimalInput value={s.fromAmount} onValue={fromAmount => p.set({ fromAmount })} placeholder="All of it" aria-label="How much of that money" className="input w-[7.5rem] shrink-0 tabular-nums" />
                  <span className="min-w-0">{before.saleCurrency} of it (empty: all)</span>
                </div>
              )}
              <Problem problems={p.problems} field="fromAmount" />
              <Toggle checked={s.copyPrev} onChange={p.onCopy}>
                <span>Copy category, subcategory and details from {before.title}</span>
                {s.copyPrev && <span className="block text-meta text-fg-muted">{copiedLine(s, p.categories)}</span>}
              </Toggle>
            </div>
          )}
          <StepBuy s={s} set={p.set} paid={p.row ? paidOf(p.row) : null} problems={p.problems} sameDay={before?.leftOn ?? null} today={p.today} loading={p.ratesLoading} />
          <StepMore s={s} set={p.set} categories={p.categories} stores={p.stores} listId={`stores-${s.key}`} />
          <StepLeave s={s} set={p.set} got={p.row ? gotOf(p.row) : null} problems={p.problems} today={p.today} loading={p.ratesLoading} />
          <Problem problems={p.problems} field="rate" />
        </div>
      )}

      <StepResult view={view} accessories={s.accessories.filter(a => a.title.trim()).length} />
    </div>
  )
}

/** The step's own numbers from the chain: paid, got back, and what it made or lost by itself. */
function StepResult({ view, accessories }: { view: StepView; accessories: number }) {
  const n = view.node
  if (!n) return null
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-0.5 border-t border-line px-3 py-2 text-meta tabular-nums text-fg-muted sm:pl-11">
      <span>Paid <AmountText amount={n.paid} className="font-semibold text-fg-2" />{accessories > 0 && ` with ${accessories} accessor${accessories === 1 ? 'y' : 'ies'}`}</span>
      {n.got
        ? <>
            <span>Got back <AmountText amount={n.got} className="font-semibold text-fg-2" /></span>
            {view.own && (complete(view.own)
              // A loss on a thing you used is its cost of use (neutral); only a thing bought to sell shows a profit in green.
              ? <span className={cx('font-semibold', Math.round(view.own.nok) > 0 && n.item.for_resale ? 'text-success' : 'text-fg')}>{signed(view.own.nok)} on this one</span>
              : <span>Result unknown</span>)}
          </>
        : <span>still yours{n.item.value_now != null ? ` · could sell for ${money(n.item.value_now, n.item.value_currency ?? 'NOK')}` : ''}</span>}
    </p>
  )
}
