import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { ChevronLeft, ChevronRight, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { Button, IconButton, SegmentedControl, TonePill, cx } from '../../../../shared/ui'
import { useElementWidthRem } from '../../../../shared/hooks/useElementWidth'
import { useEntityModal } from '../../../../shared/modals'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { useNeedsALook } from '../../hooks/useNeedsALook'
import { boughtOn, DISPOSAL_LABEL, durationLabel } from '../../ownModel'
import { chainTitle } from '../../chainModel'
import { nudgeFor, storyOf } from '../../recordStory'
import { ItemThumb } from '../shopKit'
import { Toggle } from '../shopEditors'
import { imageOf } from '../shopFormat'
import { fitActions } from './recordActions'
import { RecordFacts } from './RecordFacts'
import { RecordStrip } from './RecordStrip'
import { PriceCheckButton, RecordPriceWatch } from './RecordPriceWatch'
import { RecordAccessories } from './RecordAccessories'
import { MoneyChainButton, RecordMoney } from './RecordMoney'
import { RecordCosts } from './RecordCosts'
import { AddModelButton, RecordModels } from './RecordModels'
import { RecordNudge } from './RecordNudge'
import { RecordResale } from './RecordResale'
import { RecordOwnership } from './RecordOwnership'
import { ownershipSummary, useOwnership } from './useOwnership'
import { useListings } from '../../hooks/useShopResale'
import { openListingOf } from '../../sellingModel'
import { RecordSection } from './RecordSection'
import { hasMoneyLinks, marketSummary, priceSummary, purchaseSummary, resaleSummary, useOpenSections, type SectionId } from './recordSections'
import { RecordStory } from './RecordStory'
import { RecordPurchase } from './RecordPurchase'
import { PurchaseEditor } from './PurchaseEditor'
import { usePurchaseEdit, type PurchaseEditModel } from './usePurchaseEdit'
import { FindPicture } from './FindPicture'
import { useSavePicture } from './useFindPicture'
import { ShopAutofill } from './ShopAutofill'
import { ReceiptPhoto } from './ReceiptPhoto'
import { LookElsewhere } from '../purchase/LookElsewhere'
import { useMarketSearches } from '../../hooks/useShopStores'
import { useOpenRecord } from './recordOpen'
import { newCategoryMissing } from './useRecordDraft'
import { sectionOfFact, type RecordFact } from '../../shopSuggestions'
import type { ShopRecordModel } from './useShopRecord'
import type { CreateRecordModel } from './useCreateRecord'
import type { PagePicture } from '../../productPicture'
import type { ShopItem, ShopPriceWatch } from '../../types'

/**
 * How the one body is used (owner, 24.11.2026: "One screen, different ways to use it"):
 *   · `open`   — a saved thing (ShopRecord): its actions, money strip, nudge, Story and every section, edited in place;
 *   · `add`    — a thing being made (ShopCreate): the same Facts with every editor open, the autofill, the receipt, the
 *                Purchase and Money parts, a read receipt's lines "1 of 3"; nothing is written until Save;
 *   · `bought` — Just bought (JustBought): the same Purchase editor, opened, on the thing just bought.
 * A mode hides a section or renames a label; it never has a copy of one. Every part of a thing — its facts, picture finding,
 * the receipt, the purchase facts, extra costs, money links — lives here, never in a frame.
 */
export type RecordBodyProps =
  | { mode: 'open'; r: ShopRecordModel; openFact?: RecordFact; openSection?: 'money'; pill: 'phone' | 'none' }
  | { mode: 'bought'; r: ShopRecordModel; p: PurchaseEditModel; bought: boolean }
  | { mode: 'add'; c: CreateRecordModel }

export function RecordBody(props: RecordBodyProps) {
  const { mode } = props
  const r = props.mode === 'add' ? null : props.r
  const c = props.mode === 'add' ? props.c : null
  const p = props.mode === 'bought' ? props.p : null
  const openFact = props.mode === 'open' ? props.openFact : undefined
  // The thing as it stands: the saved row, or the draft's view while adding.
  const item: ShopItem = r ? r.item : (c as CreateRecordModel).v
  const state = r ? r.state : (c as CreateRecordModel).kind
  const today = r ? r.today : (c as CreateRecordModel).today
  const categories = r ? r.categories : (c as CreateRecordModel).categories
  const d = r ? r.d : (c as CreateRecordModel).draftApi
  const watch: ShopPriceWatch | null = r ? r.watches.get(item.id) ?? null : null
  const owned = state === 'mine' || state === 'gone'
  const sections = useOpenSections(
    mode === 'open' ? (state === 'general' ? ['models'] : []) : mode === 'add' ? ['facts', 'money'] : ['purchase'],
    openFact ? sectionOfFact(openFact, state) : props.mode === 'open' ? props.openSection ?? null : null,
    mode === 'open',
  )
  const savePicture = useSavePicture()
  // Opened at a fact from the Needs a look sheet: the sheet's close hands the focus back to the header's button while it
  // fades; once that is done the fact's editor takes it (only from the page's body or that button — never from where
  // the owner moved it).
  useEffect(() => {
    if (!openFact) return
    const take = () => {
      const now = document.activeElement
      if (now && now !== document.body && !(now instanceof HTMLElement && now.hasAttribute('data-look-trigger'))) return
      document.querySelector<HTMLElement>('[data-fact-open] input, [data-fact-open] select, [data-fact-open] textarea')?.focus({ preventScroll: true })
    }
    const timers = [450, 900].map(ms => window.setTimeout(take, ms))
    return () => timers.forEach(window.clearTimeout)
  }, [openFact])
  const picture = r ? imageOf(item, watch) : item.image_url ?? null
  const from = boughtOn(item)
  const busy = c ? c.saving : p ? p.saving : false

  // Find picture, every mode: free from the thing's own pages first, the AI's search on a second tap (its cost on the button).
  const pages = useMemo(() => [...(c?.st.receipt?.pageUrls ?? []), ...(item.url ? [item.url] : [])], [c?.st.receipt?.pageUrls, item.url])
  const onPicture = (pic: PagePicture) => {
    if (!pic.image) return
    if (c) c.takePicture(pic)
    else savePicture.mutate({ item, image: pic.image })
  }
  const finder = !item.image_url && !item.disposal && (mode !== 'bought' || props.mode === 'bought' && props.bought) && (
    <FindPicture item={item} pages={pages} named={c ? c.st.receipt?.pageNamed ?? true : true} categories={categories} onUse={onPicture} saving={savePicture.isPending} />
  )

  // One line at every width (open): the buttons that fit in the room the row has, the rest behind ⋯ (recordActions.ts).
  const { ref: actionsRef, width: actionsRoom } = useElementWidthRem<HTMLDivElement>()
  // One column below 46rem: the add's "Filled in for you" list folds to a line there.
  const { ref: rootRef, width: rootWidth } = useElementWidthRem<HTMLDivElement>()
  const { shown, more } = fitActions(actionsRoom, r && mode === 'open' ? r.actions : [])
  const actions = r && mode === 'open' && r.actions.length > 0 && (
    <div ref={actionsRef} className="min-w-0">
      <div className="flex flex-nowrap items-center gap-1.5">
        {shown.map(a => a.iconOnly
          ? <IconButton key={a.key} bordered size="sm" label={a.tip ?? a.label} onClick={a.onClick}>{a.icon}</IconButton>
          : (
            <Button key={a.key} size="sm" variant={a.primary ? 'primary' : a.ghost ? 'ghost' : 'secondary'} icon={a.icon} onClick={a.onClick} tip={a.tip} className="shrink-0">
              {a.label}
            </Button>
          ))}
        {more.length > 0 && (
          <Menu as="div" className="shrink-0">
            <MenuButton className="icon-btn icon-btn-bordered h-9 w-9 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" aria-label="More actions" title="More actions">
              <MoreHorizontal aria-hidden className="h-[18px] w-[18px]" />
            </MenuButton>
            <MenuItems anchor={{ to: 'bottom end', gap: 4, padding: 12 }} className="menu z-toast w-56">
              {more.map(a => (
                <MenuItem key={a.key}>
                  <button type="button" onClick={a.onClick} className="menu-item"><span aria-hidden className="[&_svg]:h-4 [&_svg]:w-4">{a.icon}</span> {a.tip ?? a.label}</button>
                </MenuItem>
              ))}
            </MenuItems>
          </Menu>
        )}
      </div>
    </div>
  )

  const head = (
    <div className="flex items-start gap-3">
      {/* Only a real picture: an empty box took 80px beside the actions. A thing that left always has its picture box: the ribbon with its word is the banner (owner, 23.11.2026). */}
      {(picture || item.disposal) && <ItemThumb src={picture} ribbon={item.disposal ? DISPOSAL_LABEL[item.disposal] : null} className={item.disposal ? 'h-20 w-20' : '@[30rem]:h-20 @[30rem]:w-20'} />}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {/* The pill (on a phone) shares its line with how long it has been yours (its day is the Paid cell's and the Story's). */}
        {r && mode === 'open' && ((props.mode === 'open' && props.pill === 'phone' && r.pill) || (state === 'mine' && from)) && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 empty:hidden">
            {props.mode === 'open' && props.pill === 'phone' && r.pill && <TonePill tone={r.pill.tone} className="w-fit sm:hidden">{r.pill.label}</TonePill>}
            {state === 'mine' && from && <p className="text-meta tabular-nums text-fg-muted">Yours for {item.approx_dates ? '≈ ' : ''}{durationLabel(from, today)}</p>}
          </div>
        )}
        {r && mode === 'open' && r.parent && <ParentLink item={item} parent={r.parent} />}
        {actions}
        {finder}
      </div>
    </div>
  )

  return (
    <div ref={rootRef} className="@container flex flex-col gap-3">
      {c && <AddBar c={c} />}
      {/* Nothing is editable while a save is out: what it writes is what was on screen when it was tapped. */}
      <fieldset disabled={busy} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
        {head}
        {r && mode === 'open' && <OpenLines r={r} sections={sections} />}
        <Sections mode={mode} r={r} c={c} p={p} bought={props.mode === 'bought' ? props.bought : true} item={item} state={state} today={today} owned={owned}
          watch={watch} sections={sections} d={d} narrow={rootWidth != null && rootWidth < 46} />
        {/* Delete (asks, then Undo) ends a saved record: the footer shows only with changes to save, so the Story keeps its room. */}
        {r && mode === 'open' && <Button variant="ghost" size="sm" icon={<Trash2 />} className="-ml-2 w-fit text-danger" onClick={() => { void r.del() }}>Delete</Button>}
      </fieldset>
    </div>
  )
}

function ParentLink({ item, parent }: { item: ShopItem; parent: ShopItem }) {
  const openRecord = useOpenRecord()
  return (
    <button type="button" onClick={() => openRecord(parent.id)} className="w-fit text-left text-meta text-fg-muted hover:text-fg-2">
      {item.accessory_of ? 'Accessory of' : 'A model of'} <span className="font-semibold text-accent-600 hover:underline">{parent.title}</span>
    </button>
  )
}

/** A saved thing's money strip and its one nudge line (Needs a look's own row for it, once its reads answered). */
function OpenLines({ r, sections }: { r: ShopRecordModel; sections: ReturnType<typeof useOpenSections> }) {
  const modal = useEntityModal()
  const { item, state, today } = r
  const watch = r.watches.get(item.id) ?? null
  const { looks, loading } = useNeedsALook(r.items, false)
  // Only once its reads have answered: a nudge from part of the data would come and go as the rest lands.
  const nudge = useMemo(() => (loading ? null : nudgeFor(item, looks, today)), [loading, item, looks, today])
  const onNudge = () => {
    if (nudge?.action === 'bought') r.buy()
    else if (nudge?.action === 'value' || nudge?.action === 'fix') {
      const fact = nudge.fact ?? 'value'
      sections.show(sectionOfFact(fact, state))
      r.d.setEditing(fact)
    }
    else if (nudge?.action === 'claim') modal.open({ kind: 'shop-claim', id: item.id })
  }
  return (
    <>
      <RecordStrip item={item} state={state} ctx={r.ctx} chain={r.chain} watch={watch} models={r.models} watches={r.watches} accessories={r.accessories} today={today} />
      {nudge && <RecordNudge nudge={nudge} onAction={onNudge} />}
    </>
  )
}

/** Adding: a read receipt's lines "1 of 3 ‹ ›" (a saved line shows ✓) and the switch of what is made. */
function AddBar({ c }: { c: CreateRecordModel }) {
  const { spec, st, count, index } = c
  const stepper = count > 1 && (
    <div className="flex items-center gap-1">
      <IconButton bordered size="sm" label="Previous line" disabled={c.saving} onClick={() => c.setIndex((index - 1 + count) % count)}><ChevronLeft aria-hidden /></IconButton>
      <span className="min-w-[4.5rem] text-center text-body font-medium tabular-nums text-fg">
        {index + 1} of {count}{st.savedId ? <span className="text-success"> ✓</span> : st.skipped ? <span className="text-fg-muted"> –</span> : null}
      </span>
      <IconButton bordered size="sm" label="Next line" disabled={c.saving} onClick={() => c.setIndex((index + 1) % count)}><ChevronRight aria-hidden /></IconButton>
    </div>
  )
  const switches = (spec.preset === 'own' || spec.preset === 'had') && !st.needSale ? (
    <SegmentedControl<'own' | 'had'> size="sm" value={st.had ? 'had' : 'own'} onChange={x => c.patch(s => ({ ...s, had: x === 'had' }))}
      options={[{ value: 'own', label: 'I have it' }, { value: 'had', label: 'I had it' }]} />
  ) : (spec.preset === 'wish' || spec.preset === 'general') ? (
    <SegmentedControl<'one' | 'any'> size="sm" value={st.general ? 'any' : 'one'} onChange={x => c.patch(s => ({ ...s, general: x === 'any' }))}
      options={[{ value: 'one', label: <span title="One product">One</span> }, { value: 'any', label: <span title="Any model that fits">Any model</span> }]} />
  ) : null
  if (!stepper && !switches) return null
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-2">{stepper}{switches}</div>
}

/** The sections, each once; a mode hides the ones it has no use for. */
function Sections({ mode, r, c, p, bought, item, state, today, owned, watch, sections, d, narrow }: {
  mode: RecordBodyProps['mode']
  r: ShopRecordModel | null
  c: CreateRecordModel | null
  p: PurchaseEditModel | null
  bought: boolean
  item: ShopItem
  state: ShopRecordModel['state']
  today: string
  owned: boolean
  watch: ShopPriceWatch | null
  sections: ReturnType<typeof useOpenSections>
  d: ShopRecordModel['d']
  narrow: boolean
}) {
  const open = mode === 'open' && r
  const resale = open && (state === 'mine' || state === 'gone')
  const { data: listings = [] } = useListings()
  const listing = resale ? openListingOf(listings, item.id) : null
  const searches = useMarketSearches(item)
  // New vs used vs refurbished while it is to buy, whenever its numbers say something — with a link or without.
  const ownership = useOwnership(item, { items: r?.items ?? [], categories: r?.categories ?? c?.categories ?? [], watch, ctx: r?.ctx ?? EMPTY_CTX, on: !!open && state === 'buy' })
  const [editPurchase, setEditPurchase] = useState(false)
  const itemCosts = useMemo(() => (r ? r.ctx.costs.get(item.id) ?? r.costs.filter(x => x.item_id === item.id) : []), [r, item.id])
  const story = useMemo(() => (r && open ? storyOf(item, { items: r.items, links: r.links, costs: itemCosts, today }) : []), [r, open, item, itemCosts, today])

  const toggle = (id: SectionId) => {
    // Adding: the Purchase part starts its form on first opening (an untouched Purchase writes nothing).
    if (c && id === 'purchase') c.openPurchase()
    sections.toggle(id)
  }
  const box = (id: SectionId, title: string, summary: string | undefined, action: ReactNode, body: ReactNode, keepAction = false) => (
    <RecordSection id={id} title={title} summary={summary} open={sections.open.has(id)} onToggle={() => toggle(id)} action={action} keepAction={keepAction}>{body}</RecordSection>
  )
  const from = boughtOn(item)
  // A thing still yours names its store in Purchase.
  const factsSummary = [state !== 'mine' && item.platform, from && `${item.approx_dates ? '≈ ' : ''}${formatDate(from)}`, r && r.accessories.length > 0 && `${r.accessories.length} accessor${r.accessories.length === 1 ? 'y' : 'ies'}`]
    .filter(Boolean).join(' · ') || undefined
  const moneyOpen = !!r && (hasMoneyLinks(item) || owned || item.status === 'bought')
  const moneyAdd = !!c && c.owns
  const moneySummary = r?.chain && r.chain.nodes.length > 1 ? chainTitle(r.chain)
    : itemCosts.length ? `${itemCosts.length} extra cost${itemCosts.length === 1 ? '' : 's'}`
    : c && c.st.costs.length ? `${c.st.costs.filter(x => x.on).length} extra cost${c.st.costs.filter(x => x.on).length === 1 ? '' : 's'}` : undefined

  // Purchase: a saved thing's facts (open: shown, edited in place; bought: the editor), or a thing being added (its own part, optional).
  const purchase = mode === 'bought' && p
    ? box('purchase', 'Purchase', undefined, null, bought
      ? <PurchaseEditor item={item} form={p.form} onForm={p.setForm} view={p.view} stores={p.stores} storesLoading={p.storesLoading} today={today} />
      : <p className="text-body text-fg-muted">It's on the wishlist again — nothing to fill in.</p>)
    : open && state === 'mine'
      ? box('purchase', 'Purchase', purchaseSummary(item, today),
        !editPurchase && <IconButton size="sm" label="Edit how it was bought" onClick={() => setEditPurchase(true)}><Pencil aria-hidden /></IconButton>,
        editPurchase ? <PurchaseInPlace item={item} onDone={() => setEditPurchase(false)} /> : <RecordPurchase item={item} today={today} />)
      : c && state === 'mine'
        ? box('purchase', 'Purchase', c.purchaseForm ? undefined : 'optional', null, c.purchaseForm && c.purchase
          ? <PurchaseEditor item={c.purchaseItem} form={c.purchaseForm} onForm={c.setPurchase} view={c.purchase} stores={c.stores} storesLoading={c.storesLoading} today={today} add />
          : null)
        : null

  const parts = (
    <div className="flex min-w-0 flex-col gap-2">
      {open && state === 'general' && box('models', 'Models', `${r.models.filter(m => m.status === 'wishlist').length} in the running`, <AddModelButton wish={item} />,
        <RecordModels wish={item} models={r.models} watches={r.watches} />)}
      {purchase}
      {open && (item.url || ownership) && box('price', 'Price', item.url ? priceSummary(item, watch) : ownership ? ownershipSummary(ownership) : undefined,
        <PriceCheckButton item={item} watch={watch} />, <>
          {item.url && <RecordPriceWatch item={item} watch={watch} owned={owned} today={today} />}
          {ownership && <RecordOwnership item={item} categories={r.categories} ownership={ownership} />}
        </>)}
      {open && state === 'buy' && searches.length > 0 && box('market', 'Used market', marketSummary(item, searches), null,
        <LookElsewhere item={item} today={today} searches={searches} />)}
      {resale && box('resale', 'Resale', resaleSummary(item, r.ctx, today, listing), null, <>
        <RecordFacts item={item} d={d} state={state} categories={r.categories} today={today} section="resale" />
        <RecordResale r={r} watch={watch} />
      </>)}
      {mode !== 'bought' && box('facts', 'Facts', c ? undefined : factsSummary, null, <>
        {/* One list of facts for every mode: adding opens every editor (`create`), the link is the autofill's. */}
        <RecordFacts item={c ? c.base : item} d={d} state={state} categories={r?.categories ?? c?.categories ?? []} today={today} parents={r ? r.parents : c?.parents}
          create={c ? { without: state === 'general' ? [] : ['link'] } : undefined} />
        {r && !item.accessory_of && state !== 'general' && <RecordAccessories item={item} accessories={r.accessories} ctx={r.ctx} canAdd={state === 'mine'} />}
      </>)}
      {(moneyOpen || moneyAdd) && box('money', 'Money', moneySummary, r && <MoneyChainButton item={item} chain={r.chain} />, <>
        {r && hasMoneyLinks(item) && <RecordMoney item={item} items={r.items} links={r.links} ctx={r.ctx} chain={r.chain} />}
        {c && <DraftLinks c={c} />}
        {r && (owned || item.status === 'bought') && <RecordCosts itemId={item.id} costs={itemCosts} />}
        {c && <RecordCosts drafts={c.st.costs} onDrafts={c.setCosts}
          moveTo={c.costTargets.length > 1 ? { current: c.index, options: c.costTargets, onMove: c.moveCost } : undefined} />}
      </>, !!r)}
    </div>
  )

  // Adding something you own has tools beside its facts (the autofill, a receipt), so two columns from 46rem; a wish is one
  // column with the link reader on top. Narrow, the facts come first (name and category on the first screen). A saved thing
  // has its Story beside the sections.
  const side = c ? <AddTools c={c} narrow={narrow} /> : open && story.length > 0 ? <RecordStory steps={story} today={today} /> : null
  const two = c ? c.owns : story.length > 0
  return (
    <div className={cx('grid items-start gap-3', two && '@[46rem]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @[46rem]:gap-5')}>
      {side}
      <div className={cx('min-w-0', c && 'order-1 @[46rem]:order-2')}>{parts}</div>
    </div>
  )
}

const EMPTY_CTX = { costs: new Map() } as unknown as ShopRecordModel['ctx']

/** A saved thing's purchase facts, edited in place (open): the same editor as Just bought, its own Save and Cancel. */
function PurchaseInPlace({ item, onDone }: { item: ShopItem; onDone: () => void }) {
  const p = usePurchaseEdit(item)
  return (
    <fieldset disabled={p.saving} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
      <PurchaseEditor item={item} form={p.form} onForm={p.setForm} view={p.view} stores={p.stores} storesLoading={p.storesLoading} today={p.today} />
      <div className="flex gap-2">
        <Button size="sm" variant="primary" onClick={() => p.submit(onDone)} loading={p.saving} disabled={!p.valid}>Save</Button>
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </fieldset>
  )
}

/** Adding: the link reader, scan and "Filled in for you"; a receipt (handed to Read a receipt); the receipt's other lines. */
function AddTools({ c, narrow }: { c: CreateRecordModel; narrow: boolean }) {
  const { st, kind, owns, batch } = c
  const showAutofill = (kind as string) !== 'general'
  if (!showAutofill && !(owns && !batch) && !c.pictureNote && !(st.receipt && st.receipt.others.length > 0 && st.receipt.currency && !batch)) return null
  return (
    <div className="order-2 flex min-w-0 flex-col gap-3 @[46rem]:order-1">
      {showAutofill && <ShopAutofill draft={c.view} onChange={c.onChange} update={c.update} categories={c.categories} collapsible={narrow} />}
      {owns && !batch && <ReceiptPhoto stores={c.stores} onFill={c.fromReceipt} handoff onHandoff={c.closeIfClean} />}
      {c.pictureNote && <p className="text-meta text-fg-muted" role="status">{c.pictureNote}</p>}
      {st.receipt && st.receipt.others.length > 0 && st.receipt.currency && !batch && (
        <Toggle checked={st.withOthers} onChange={x => c.patch(s => ({ ...s, withOthers: x }))}>
          Add the other {st.receipt.others.length === 1 ? 'line' : `${st.receipt.others.length} lines`} as {st.receipt.others.length === 1 ? 'an accessory' : 'accessories'}
        </Toggle>
      )}
    </div>
  )
}

/** Adding something you own or had: "Paid with money from" and "Money went to" — only to what this popup offers. */
function DraftLinks({ c }: { c: CreateRecordModel }) {
  const { st, sources, targets, money } = c
  return (
    <>
      {sources.length > 0 && (
        <div>
          <label htmlFor="create-from" className="field-label">Paid with money from <span className="font-normal text-fg-muted">(optional)</span></label>
          <select id="create-from" value={st.paidFrom} onChange={e => { const v = e.target.value; c.patch(s => ({ ...s, paidFrom: v })) }} className="select">
            <option value="">Nothing I sold</option>
            {sources.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </div>
      )}
      {money && targets.length > 0 && (
        <div>
          <label htmlFor="create-to" className="field-label">Money went to <span className="font-normal text-fg-muted">(optional)</span></label>
          <select id="create-to" value={st.moneyTo} onChange={e => { const v = e.target.value; c.patch(s => ({ ...s, moneyTo: v })) }} className="select">
            <option value="">Nothing in particular</option>
            {targets.map(t => <option key={t.id} value={t.id}>{t.title}{t.status === 'wishlist' ? ' (to buy)' : ''}</option>)}
          </select>
        </div>
      )}
    </>
  )
}

/**
 * The record's footer, only while something changed (review, 10.11.2026: at 1469×680 a footer of Delete and Close
 * pushed the Story below the fold; × closes): Discard and Save.
 */
export function RecordFooter({ r }: { r: ShopRecordModel }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-meta text-fg-muted">Unsaved changes</span>
      <Button onClick={r.d.discard} className="ml-auto">Discard</Button>
      <Button variant="primary" onClick={() => { void r.save() }} loading={r.saving} disabled={!!newCategoryMissing(r.d.draft)}>Save</Button>
    </div>
  )
}
