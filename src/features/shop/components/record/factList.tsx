import type { ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { SegmentedControl } from '../../../../shared/ui'
import { DateInput } from '../../../../shared/components/DateInput'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { DecimalInput } from '../../../recipes/components/foodLogKit'
import { categoryPath, currencyOf, SHOP_CURRENCIES } from '../../shopModel'
import { DISPOSAL_LABEL, durationLabel, paidOf, complete, savedOf } from '../../ownModel'
import { initialsOf, tintOf } from '../../wishTile'
import { hostOf, money, moneyRange, webUrl } from '../shopFormat'
import { PaidText } from '../owned/PaidText'
import { ChoiceChips, StoreNameField } from '../shopPickers'
import { RowPicture } from '../tileKit'
import { MoneyEditor, Toggle } from './factKit'
import { CategoryEditor } from './CategoryEditor'
import { isNewCategory, NEW_CATEGORY, newPickOf, type RecordDraft } from './useRecordDraft'
import type { ShopCategory, ShopCurrency, ShopDisposal, ShopItem, ShopPriority, ShopReason, ShopRegion, ShopStoreKind } from '../../types'

/** Where a thing went (sold to, traded in at, who offered it): a marketplace, a refurbisher or a shop. */
export const WENT_TO: readonly ShopStoreKind[] = ['marketplace', 'refurbisher', 'shop']
/** How it left, in the Sell sheet's order. */
const HOW: readonly ShopDisposal[] = ['sold', 'traded_in', 'given', 'returned', 'broken', 'lost', 'other']
const HOW_OPTIONS = HOW.map(h => ({ value: h, label: DISPOSAL_LABEL[h] }))

export interface FactDef {
  id: string
  label: string
  value: ReactNode
  editor?: ReactNode
  filled: boolean
  /** Shown as a "+" chip while empty. */
  chip?: string
  hint?: ReactNode
  /** A yes/no fact: always a checkbox line (never a chip). */
  toggle?: { checked: boolean; onChange: (v: boolean) => void; text: string }
}

export interface FactCtx {
  /** The row with the edits on top. */
  v: ShopItem & RecordDraft
  boughtDay: string
  set: (patch: RecordDraft) => void
  categories: readonly ShopCategory[]
  today: string
  /** The things it can be an accessory of; absent = it cannot become one (it has accessories or money links). */
  parents?: readonly ShopItem[]
}

const quiet = (t: string) => <span className="text-fg-muted">{t}</span>

/** The category as words; a "+ New category…" pick by the names typed for it. */
function pathText(v: FactCtx['v'], categories: readonly ShopCategory[]): string {
  if (isNewCategory(v.category_id)) {
    const p = newPickOf(v.category_id)
    const top = p.topId === NEW_CATEGORY ? v.new_top?.trim() || 'New category' : categoryPath(p.topId, categories).topName
    return [top, p.subId === NEW_CATEGORY || p.topId === NEW_CATEGORY ? v.new_sub?.trim() : null].filter(Boolean).join(' › ')
  }
  const path = categoryPath(v.category_id, categories)
  return path.topId ? [path.topName, path.subName].filter(Boolean).join(' › ') : 'No category'
}

/** Facts every wishlist-side row has. */
export function commonFacts(c: FactCtx, state: 'buy' | 'general' | 'owned'): FactDef[] {
  const { v, set } = c
  const picture = webUrl(v.image_url)
  const thumb = <RowPicture src={picture} initials={initialsOf(v.title)} tint={tintOf(categoryPath(v.category_id, c.categories).topId)} />
  return [
    { id: 'title', label: 'Item', filled: true, value: v.title,
      editor: <input value={v.title} onChange={e => set({ title: e.target.value })} aria-label="Item" className="input" autoFocus /> },
    { id: 'category', label: 'Category', filled: !!v.category_id, chip: 'Category', value: pathText(v, c.categories),
      editor: <CategoryEditor v={v} set={set} categories={c.categories} /> },
    ...(state !== 'owned' ? [{
      id: 'reason', label: 'Why', filled: !!v.reason, chip: 'Need or just for fun', value: v.reason === 'need' ? 'Need it' : 'Just for fun',
      editor: <SegmentedControl<ShopReason | ''> size="sm" value={v.reason ?? ''} onChange={r => set({ reason: r || null })}
        options={[{ value: 'need', label: 'Need it' }, { value: 'fun', label: 'Just for fun' }, { value: '', label: 'Not set' }]} />,
    }] : []),
    { id: 'store', label: state === 'owned' ? 'Bought at' : 'Store', filled: !!v.platform, chip: 'Store', value: v.platform,
      editor: <StoreNameField value={v.platform ?? ''} onChange={n => set({ platform: n || null })} label="Store" className="max-w-sm" /> },
    { id: 'region', label: state === 'owned' ? 'Bought in' : 'Buy it in', filled: !!v.region, chip: 'Country', value: v.region === 'TR' ? '🇹🇷 Turkey' : '🇳🇴 Norway',
      editor: <select value={v.region ?? ''} onChange={e => set({ region: (e.target.value || null) as ShopRegion | null })} aria-label="Country" className="select max-w-xs">
        <option value="">Anywhere</option><option value="NO">🇳🇴 Norway</option><option value="TR">🇹🇷 Turkey</option>
      </select> },
    { id: 'link', label: 'Link', filled: !!v.url, chip: 'Link', value: v.url && webUrl(v.url)
        ? <a href={webUrl(v.url) as string} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="inline-flex items-center gap-1 font-medium text-accent-600 hover:underline">{hostOf(v.url)} <ExternalLink aria-hidden className="h-3 w-3" /></a>
        : v.url,
      hint: !v.url ? undefined : 'A Prisjakt or shop link: its price is checked every morning, if the site lets apps read it.',
      editor: <input type="url" inputMode="url" value={v.url ?? ''} onChange={e => set({ url: e.target.value.trim() || null })} placeholder="https://www.prisjakt.no/…" aria-label="Link" className="input" autoFocus /> },
    { id: 'notes', label: 'Notes', filled: !!v.notes, chip: 'Notes', value: <span className="whitespace-pre-line">{v.notes}</span>,
      editor: <textarea value={v.notes ?? ''} onChange={e => set({ notes: e.target.value || null })} rows={3} aria-label="Notes" className="input resize-y" autoFocus /> },
    { id: 'picture', label: 'Picture', filled: !!v.image_url, chip: 'Picture link',
      value: v.image_url ? <span className="flex items-center gap-2">{thumb}<span className="min-w-0 break-all">{hostOf(v.image_url) ?? v.image_url}</span></span> : null,
      editor: (
        <div className="flex items-center gap-2">
          {thumb}
          <input type="url" inputMode="url" value={v.image_url ?? ''} onChange={e => set({ image_url: e.target.value.trim() || null })} placeholder="https://…/image.jpg" aria-label="Picture link" className="input min-w-0 flex-1" autoFocus />
        </div>
      ) },
  ]
}

/** A thing still to buy. */
export function buyFacts(c: FactCtx): FactDef[] {
  const { v, set } = c
  const cur = currencyOf(v)
  return [
    { id: 'price', label: 'Price', filled: v.price != null, chip: 'Price', value: v.price != null ? <>{money(v.price, cur)}{v.price_source === 'ai_estimate' && quiet(' (estimate)')}</> : null,
      editor: <MoneyEditor label="Price" amount={v.price} currency={cur} onAmount={p => set({ price: p })} onCurrency={x => set({ currency: x })} autoFocus /> },
    { id: 'priority', label: 'Priority', filled: true, value: { low: 'Low', medium: 'Medium', high: 'High' }[v.priority],
      editor: <SegmentedControl<ShopPriority> size="sm" value={v.priority} onChange={p => set({ priority: p })}
        options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]} /> },
    { id: 'deal', label: 'Wait for a deal', filled: !!v.wait_for_deal, chip: 'Wait for a deal',
      value: <>{v.planned_date ? `From ${formatDate(v.planned_date)}` : 'Yes'}{v.platform ? ` at ${v.platform}` : ''}{v.deal_note ? ` · ${v.deal_note}` : ''}</>,
      hint: v.wait_for_deal && v.platform && v.planned_date ? 'From that day it shows on the quick list under its store.' : undefined,
      editor: <>
        <Toggle checked={!!v.wait_for_deal} onChange={x => set({ wait_for_deal: x })}>Wait for a deal</Toggle>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-meta text-fg-muted">From</span>
          <DateInput value={v.planned_date ?? ''} onChange={d => set({ planned_date: d || null })} aria-label="Deal from" className="input w-[10rem] tabular-nums" />
        </div>
        <input value={v.deal_note ?? ''} onChange={e => set({ deal_note: e.target.value || null })} placeholder="Black Week, members' price…" aria-label="Deal note" className="input" />
      </> },
    ...(!v.wait_for_deal ? [{
      id: 'buyOn', label: 'Buy on', filled: !!v.planned_date, chip: 'Buy on', value: formatDate(v.planned_date),
      editor: <DateInput value={v.planned_date ?? ''} onChange={d => set({ planned_date: d || null })} aria-label="Buy on" className="input w-[10rem] tabular-nums" />,
    }] : []),
    { id: 'target', label: 'Target price', filled: v.target_price != null, chip: 'Target price', value: v.target_price != null ? money(v.target_price, cur) : null,
      hint: 'The price watch says when the price is at or below it.',
      editor: <DecimalInput value={v.target_price ?? null} onValue={t => set({ target_price: t })} aria-label="Target price" className="input w-[10rem] tabular-nums" autoFocus /> },
    { id: 'errand', label: 'Next errand', filled: !!v.errand, value: null,
      toggle: { checked: !!v.errand, onChange: x => set({ errand: x }), text: 'Pick it up on the next errand' } },
  ]
}

/** A general wish: its range and must-haves. */
export function generalFacts(c: FactCtx): FactDef[] {
  const { v, set } = c
  const cur = currencyOf(v)
  return [
    { id: 'range', label: 'Price range', filled: v.price_min != null || v.price_max != null, chip: 'Price range',
      value: v.price_min != null && v.price_max != null ? moneyRange(v.price_min, v.price_max, cur) : `${v.price_min != null ? money(v.price_min, cur) : '…'}–${v.price_max != null ? money(v.price_max, cur) : '…'}`,
      editor: (
        <div className="flex max-w-sm items-center gap-2">
          <DecimalInput value={v.price_min ?? null} onValue={x => set({ price_min: x })} aria-label="From" placeholder="From" className="input min-w-0 flex-1 tabular-nums" autoFocus />
          <span className="text-fg-faint">–</span>
          <DecimalInput value={v.price_max ?? null} onValue={x => set({ price_max: x })} aria-label="To" placeholder="To" className="input min-w-0 flex-1 tabular-nums" />
          <select value={cur} onChange={e => set({ currency: e.target.value as ShopCurrency })} aria-label="Currency" className="select w-[6rem] shrink-0">
            {SHOP_CURRENCIES.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
      ) },
    { id: 'requirements', label: 'Must have', filled: !!v.requirements?.trim(), chip: 'Must-haves',
      value: <span className="whitespace-pre-line">{v.requirements}</span>,
      hint: 'Each line is a row in the models\' comparison.',
      editor: <textarea value={v.requirements ?? ''} onChange={e => set({ requirements: e.target.value || null })} rows={4} placeholder={'Pen support\n11 inch or bigger'} aria-label="Must have" className="input resize-y" autoFocus /> },
  ]
}

/** A thing you have or had. */
export function ownFacts(c: FactCtx, gone: boolean): FactDef[] {
  const { v, set, today } = c
  const cur = currencyOf(v)
  const paid = paidOf(v)
  const saved = savedOf(v)
  const parent = v.accessory_of ? c.parents?.find(p => p.id === v.accessory_of) : undefined
  const facts: FactDef[] = [
    ...(c.parents ? [{
      id: 'parent', label: 'Accessory of', filled: !!v.accessory_of, chip: 'Accessory of…', value: parent?.title ?? 'Another thing',
      hint: v.accessory_of ? 'It sits under that thing on Owned and in Stats, and goes with it in a chain.' : undefined,
      editor: <select value={v.accessory_of ?? ''} onChange={e => set({ accessory_of: e.target.value || null })} aria-label="Accessory of" className="select max-w-sm" autoFocus>
        <option value="">Not an accessory</option>
        {c.parents.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
      </select>,
    }] : []),
    { id: 'bought', label: 'Bought on', filled: !!c.boughtDay, value: <>{v.approx_dates ? '≈ ' : ''}{formatDate(c.boughtDay)}{!gone && c.boughtDay ? quiet(` · ${durationLabel(c.boughtDay, today)} ago`) : ''}</>,
      editor: <>
        <DateInput value={c.boughtDay} onChange={d => d && set({ bought_day: d })} max={today} aria-label="Bought on" className="input w-[10rem] tabular-nums" />
        <Toggle checked={!!v.approx_dates} onChange={x => set({ approx_dates: x })}>Roughly — from memory</Toggle>
      </> },
    { id: 'paid', label: 'Paid', filled: v.price != null || !!v.got_as_gift, chip: 'Price paid', value: <><PaidText item={v} />{v.used ? quiet(' · used') : ''}</>,
      editor: <>
        <MoneyEditor label="Paid" amount={v.price} currency={cur} onAmount={p => set({ price: p })} onCurrency={x => set({ currency: x })} autoFocus />
        <div className="flex flex-wrap gap-x-4">
          <Toggle checked={!!v.got_as_gift} onChange={x => set({ got_as_gift: x })}>A gift to me</Toggle>
          <Toggle checked={!!v.used} onChange={x => set({ used: x })}>Bought used</Toggle>
        </div>
      </> },
  ]
  if (cur !== 'NOK' && v.price != null) {
    facts.push({ id: 'rate', label: 'Exchange rate', filled: true,
      value: complete(paid) && v.fx_nok ? <>1 {cur} = {v.fx_nok} NOK{quiet(v.fx_source === 'manual' ? ' · typed by you' : ` · Norges Bank, ${formatDate(c.boughtDay)}`)}</> : quiet('Waiting for Norges Bank\'s rate of that day'),
      editor: <>
        <p className="text-meta text-fg-muted">The rate you paid at (NOK for 1 {cur}), e.g. your card's — or leave it to Norges Bank's rate of the day.</p>
        <DecimalInput value={v.fx_nok ?? null} onValue={r => set({ fx_nok: r, fx_source: r == null ? null : 'manual' })} aria-label="NOK per unit" className="input w-[10rem] tabular-nums" autoFocus />
      </> })
  }
  facts.push(
    { id: 'saved', label: 'Price before discount', filled: v.market_price != null, chip: 'Price before discount',
      value: <>{v.market_price != null && money(v.market_price, v.market_currency ?? cur)}{saved ? <span className="text-success"> · saved {money(saved.nok)}</span> : ''}</>,
      hint: 'The normal price at the time — a staff price or a sale shows what it saved.',
      editor: <MoneyEditor label="Price before discount" amount={v.market_price ?? null} currency={v.market_currency ?? cur} onAmount={p => set({ market_price: p })} onCurrency={x => set({ market_currency: x })} autoFocus /> },
    { id: 'serial', label: 'Serial number', filled: !!v.serial, chip: 'Serial number', value: <span className="font-mono text-meta">{v.serial}</span>,
      editor: <input value={v.serial ?? ''} onChange={e => set({ serial: e.target.value || null })} aria-label="Serial number" className="input max-w-sm font-mono" autoFocus /> },
  )
  // The return and complaint days are the Purchase section's, from the store's rules and the law (Details edits them).
  if (!gone) {
    facts.push(
      { id: 'value', label: 'Could sell for', filled: v.value_now != null, chip: 'Could sell for',
        value: <>{v.value_now != null && money(v.value_now, v.value_currency ?? 'NOK')}{v.value_on ? quiet(` · ${formatDate(v.value_on)}`) : ''}</>,
        hint: 'Your own estimate (FINN, a trade-in offer). It is dated, so you can see when it gets old.',
        editor: <MoneyEditor label="Could sell for" amount={v.value_now ?? null} currency={v.value_currency ?? 'NOK'} onAmount={p => set({ value_now: p })} onCurrency={x => set({ value_currency: x })} autoFocus /> },
    )
  }
  facts.push(
    { id: 'resale', label: 'Bought to sell', filled: !!v.for_resale, value: null,
      toggle: { checked: !!v.for_resale, onChange: x => set({ for_resale: x }), text: 'Bought to sell later' } },
    { id: 'kept', label: 'Not mine to keep', filled: v.kept === false, value: null,
      toggle: { checked: v.kept === false, onChange: x => set({ kept: !x }), text: 'Not mine to keep (bought for someone else, or used up)' } },
  )
  return facts
}

/** How a thing left, and the money back. */
export function goneFacts(c: FactCtx): FactDef[] {
  const { v, set } = c
  const sc = v.sale_currency ?? currencyOf(v)
  const how = v.disposal ?? 'other'
  const to = how === 'given' ? 'Given to' : how === 'traded_in' ? 'Traded in at' : 'To'
  return [
    { id: 'how', label: 'How it left', filled: true, value: DISPOSAL_LABEL[how],
      editor: <ChoiceChips<ShopDisposal> value={how} options={HOW_OPTIONS} onChange={d => set({ disposal: d })} label="How it left" /> },
    { id: 'left', label: 'On', filled: !!v.disposed_on, value: formatDate(v.disposed_on),
      editor: <DateInput value={v.disposed_on ?? ''} onChange={d => d && set({ disposed_on: d })} min={c.boughtDay || undefined} aria-label="Left on" className="input w-[10rem] tabular-nums" /> },
    { id: 'soldTo', label: to, filled: !!v.sold_to, chip: how === 'given' ? 'Given to' : 'Sold to', value: v.sold_to,
      // A gift goes to a person, not a store.
      editor: how === 'given'
        ? <input value={v.sold_to ?? ''} onChange={e => set({ sold_to: e.target.value || null })} placeholder="A friend…" aria-label={to} className="input max-w-sm" autoFocus />
        : <StoreNameField value={v.sold_to ?? ''} onChange={n => set({ sold_to: n || null })} kinds={WENT_TO} label={to} className="max-w-sm" /> },
    { id: 'got', label: 'Got back', filled: v.sale_price != null, chip: 'Money back', value: v.sale_price != null ? money(v.sale_price, sc) : null,
      hint: v.sale_group ? 'Its share of a sale together with other things.' : undefined,
      editor: <MoneyEditor label="Got back" amount={v.sale_price ?? null} currency={sc} onAmount={p => set({ sale_price: p, ...(p != null && !v.sale_currency ? { sale_currency: sc } : {}) })} onCurrency={x => set({ sale_currency: x })} autoFocus /> },
  ]
}
