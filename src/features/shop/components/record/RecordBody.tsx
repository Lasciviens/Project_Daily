import { useMemo, type ReactNode } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { MoreHorizontal, Trash2 } from 'lucide-react'
import { Button, TonePill, cx } from '../../../../shared/ui'
import { useEntityModal } from '../../../../shared/modals'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { useNeedsALook } from '../../hooks/useNeedsALook'
import { boughtOn, durationLabel } from '../../ownModel'
import { chainTitle } from '../../chainModel'
import { nudgeFor, storyOf } from '../../recordStory'
import { ItemThumb } from '../shopKit'
import { imageOf } from '../shopFormat'
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
import { PurchaseDetailsButton, RecordPurchase } from '../purchase/RecordPurchase'
import { LookElsewhere } from '../purchase/LookElsewhere'
import { useMarketSearches } from '../../hooks/useShopStores'
import { useOpenRecord } from './recordOpen'
import type { ShopRecordModel } from './useShopRecord'

/**
 * The record as a life story (step A, 10.11.2026), the same in the popup and
 * in Owned's side pane: what it is and its one row of actions, the money
 * strip, one nudge line (the most useful next step), its Story, then the
 * sections that open in place — Price · Resale · Facts · Money (a general
 * wish's Models first). Narrow (a phone, the pane) it is one column; in the
 * wide popup the Story sits beside the sections. `pill`: where the state pill
 * shows in the body — on a phone, where the popup's header has no room.
 */
export function RecordBody({ r, openFact, pill }: { r: ShopRecordModel; openFact?: 'value'; pill: 'phone' | 'none' }) {
  const { item, state, d, today, owned } = r
  const modal = useEntityModal()
  const openRecord = useOpenRecord()
  const watch = r.watches.get(item.id) ?? null
  const { looks, loading: looksLoading } = useNeedsALook(r.items, false)
  // Only once its reads have answered: a nudge from part of the data would come and go as the rest lands.
  const nudge = useMemo(() => (looksLoading ? null : nudgeFor(item, looks, today)), [looksLoading, item, looks, today])
  const itemCosts = useMemo(() => r.ctx.costs.get(item.id) ?? r.costs.filter(c => c.item_id === item.id), [r.ctx.costs, r.costs, item.id])
  const story = useMemo(() => storyOf(item, { items: r.items, links: r.links, costs: itemCosts, today }), [item, r.items, r.links, itemCosts, today])
  const resale = state === 'mine' || state === 'gone'
  const { data: listings = [] } = useListings()
  const listing = resale ? openListingOf(listings, item.id) : null
  const sections = useOpenSections(state === 'general' ? ['models'] : [], openFact === 'value' ? (resale ? 'resale' : 'facts') : null)
  const picture = imageOf(item, watch)
  const from = boughtOn(item)
  // "Look on FINN / Tise" while it is still to buy, on the marketplaces that are rows (191).
  const searches = useMarketSearches(item)
  // New vs used vs refurbished while it is to buy, whenever its numbers say something — with a link or without.
  const ownership = useOwnership(item, { items: r.items, categories: r.categories, watch, ctx: r.ctx, on: state === 'buy' })

  /** Open a fact's editor in its section (a nudge's action). */
  const edit = (fact: string, section: SectionId) => { sections.show(section); d.setEditing(fact) }
  const onNudge = () => {
    if (nudge?.action === 'bought') r.buy()
    else if (nudge?.action === 'value') edit('value', resale ? 'resale' : 'facts')
    else if (nudge?.action === 'day') edit('bought', 'facts')
    else if (nudge?.action === 'claim') modal.open({ kind: 'shop-claim', id: item.id })
  }

  const more = r.actions.filter(a => a.more)
  const actions = r.actions.length > 0 && (
    <div className="flex flex-wrap items-center gap-1.5">
      {r.actions.map(a => (
        <Button key={a.key} size="sm" variant={a.primary ? 'primary' : a.ghost ? 'ghost' : 'secondary'} icon={a.icon} onClick={a.onClick}
          className={a.more ? 'hidden @[30rem]:inline-flex' : undefined}>
          {a.label}
        </Button>
      ))}
      {more.length > 0 && (
        <Menu as="div" className="@[30rem]:hidden">
          <MenuButton className="icon-btn icon-btn-bordered" aria-label="More actions" title="More actions">
            <MoreHorizontal aria-hidden className="h-[18px] w-[18px]" />
          </MenuButton>
          <MenuItems anchor={{ to: 'bottom end', gap: 4, padding: 12 }} className="menu z-toast w-56">
            {more.map(a => (
              <MenuItem key={a.key}>
                <button type="button" onClick={a.onClick} className="menu-item"><span aria-hidden className="[&_svg]:h-4 [&_svg]:w-4">{a.icon}</span> {a.label}</button>
              </MenuItem>
            ))}
          </MenuItems>
        </Menu>
      )}
    </div>
  )

  const box = (id: SectionId, title: string, summary: string | undefined, action: ReactNode, body: ReactNode, keepAction = false) => (
    <RecordSection id={id} title={title} summary={summary} open={sections.open.has(id)} onToggle={() => sections.toggle(id)} action={action} keepAction={keepAction}>{body}</RecordSection>
  )
  const factsSummary = [item.platform, from && `${item.approx_dates ? '≈ ' : ''}${formatDate(from)}`, r.accessories.length > 0 && `${r.accessories.length} accessor${r.accessories.length === 1 ? 'y' : 'ies'}`]
    .filter(Boolean).join(' · ') || undefined
  const money = hasMoneyLinks(item) || owned || item.status === 'bought'
  const moneySummary = r.chain && r.chain.nodes.length > 1 ? chainTitle(r.chain)
    : itemCosts.length ? `${itemCosts.length} extra cost${itemCosts.length === 1 ? '' : 's'}` : undefined

  const parts = (
    <div className="flex min-w-0 flex-col gap-2">
      {state === 'general' && box('models', 'Models', `${r.models.filter(m => m.status === 'wishlist').length} in the running`, <AddModelButton wish={item} />,
        <RecordModels wish={item} models={r.models} watches={r.watches} />)}
      {state === 'mine' && box('purchase', 'Purchase', purchaseSummary(item, today), <PurchaseDetailsButton item={item} />,
        <RecordPurchase item={item} today={today} />)}
      {(item.url || ownership) && box('price', 'Price', item.url ? priceSummary(item, watch) : ownership ? ownershipSummary(ownership) : undefined,
        <PriceCheckButton item={item} watch={watch} />, <>
          {item.url && <RecordPriceWatch item={item} watch={watch} owned={owned} today={today} />}
          {ownership && <RecordOwnership item={item} categories={r.categories} ownership={ownership} />}
        </>)}
      {state === 'buy' && searches.length > 0 && box('market', 'Used market', marketSummary(item, searches), null,
        <LookElsewhere item={item} today={today} searches={searches} />)}
      {resale && box('resale', 'Resale', resaleSummary(item, r.ctx, today, listing), null, <>
        <RecordFacts item={item} d={d} state={state} categories={r.categories} stores={r.stores} watch={watch} today={today} section="resale" />
        <RecordResale r={r} watch={watch} />
      </>)}
      {box('facts', 'Facts', factsSummary, null, <>
        <RecordFacts item={item} d={d} state={state} categories={r.categories} stores={r.stores} watch={watch} today={today} parents={r.parents} />
        {!item.accessory_of && state !== 'general' && <RecordAccessories item={item} accessories={r.accessories} ctx={r.ctx} canAdd={state === 'mine'} />}
      </>)}
      {money && box('money', 'Money', moneySummary, <MoneyChainButton item={item} chain={r.chain} />, <>
        {hasMoneyLinks(item) && <RecordMoney item={item} items={r.items} links={r.links} ctx={r.ctx} chain={r.chain} />}
        {(owned || item.status === 'bought') && <RecordCosts itemId={item.id} costs={itemCosts} />}
      </>, true)}
    </div>
  )

  return (
    <div className="@container flex flex-col gap-3">
      <div className="flex items-start gap-3">
        {/* Only a real picture: an empty box took 80px beside the actions. */}
        {picture && <ItemThumb src={picture} className="@[30rem]:h-20 @[30rem]:w-20" />}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {/* The pill (on a phone) shares its line with how long it has been yours (its day is the Paid cell's and the Story's). */}
          {(pill === 'phone' || (state === 'mine' && from)) && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 empty:hidden">
              {pill === 'phone' && <TonePill tone={r.pill.tone} className="w-fit sm:hidden">{r.pill.label}</TonePill>}
              {state === 'mine' && from && (
                <p className="text-meta tabular-nums text-fg-muted">Yours for {item.approx_dates ? '≈ ' : ''}{durationLabel(from, today)}</p>
              )}
            </div>
          )}
          {r.parent && (
            <button type="button" onClick={() => openRecord((r.parent as NonNullable<typeof r.parent>).id)} className="w-fit text-left text-meta text-fg-muted hover:text-fg-2">
              {item.accessory_of ? 'Accessory of' : 'A model of'} <span className="font-semibold text-accent-600 hover:underline">{r.parent.title}</span>
            </button>
          )}
          {actions}
        </div>
      </div>
      <RecordStrip item={item} state={state} ctx={r.ctx} chain={r.chain} watch={watch} models={r.models} watches={r.watches} accessories={r.accessories} today={today} />
      {nudge && <RecordNudge nudge={nudge} onAction={onNudge} />}
      <div className={cx('grid items-start gap-3', story.length > 0 && '@[46rem]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @[46rem]:gap-5')}>
        <RecordStory steps={story} today={today} />
        {parts}
      </div>
      {/* Delete (asks, then Undo) ends the record: the footer shows only with changes to save, so the Story keeps its room. */}
      <Button variant="ghost" size="sm" icon={<Trash2 />} className="-ml-2 w-fit text-danger" onClick={() => { void r.del() }}>Delete</Button>
    </div>
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
      <Button variant="primary" onClick={() => { void r.save() }} loading={r.saving}>Save</Button>
    </div>
  )
}
