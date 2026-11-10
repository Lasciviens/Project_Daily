import { useMemo, type ReactNode } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { MoreHorizontal, Trash2 } from 'lucide-react'
import { Button, TonePill, cx } from '../../../../shared/ui'
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
import { useListings } from '../../hooks/useShopResale'
import { openListingOf } from '../../sellingModel'
import { RecordSection } from './RecordSection'
import { hasMoneyLinks, priceSummary, resaleSummary, useOpenSections, type SectionId } from './recordSections'
import { RecordStory } from './RecordStory'
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
  const openRecord = useOpenRecord()
  const watch = r.watches.get(item.id) ?? null
  const { looks } = useNeedsALook(r.items, false)
  const nudge = useMemo(() => nudgeFor(item, looks), [item, looks])
  const itemCosts = useMemo(() => r.ctx.costs.get(item.id) ?? r.costs.filter(c => c.item_id === item.id), [r.ctx.costs, r.costs, item.id])
  const story = useMemo(() => storyOf(item, { items: r.items, links: r.links, costs: itemCosts, today }), [item, r.items, r.links, itemCosts, today])
  const resale = state === 'mine' || state === 'gone'
  const { data: listings = [] } = useListings()
  const listing = resale ? openListingOf(listings, item.id) : null
  const sections = useOpenSections(state === 'general' ? ['models'] : [], openFact === 'value' ? (resale ? 'resale' : 'facts') : null)
  const picture = imageOf(item, watch)
  const from = boughtOn(item)

  /** Open a fact's editor in its section (a nudge's action). */
  const edit = (fact: string, section: SectionId) => { sections.show(section); d.setEditing(fact) }
  const onNudge = () => {
    if (nudge?.action === 'bought') r.buy()
    else if (nudge?.action === 'value') edit('value', resale ? 'resale' : 'facts')
    else if (nudge?.action === 'day') edit('bought', 'facts')
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

  const box = (id: SectionId, title: string, summary: string | undefined, action: ReactNode, body: ReactNode) => (
    <RecordSection id={id} title={title} summary={summary} open={sections.open.has(id)} onToggle={() => sections.toggle(id)} action={action}>{body}</RecordSection>
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
      {item.url && box('price', 'Price', priceSummary(item, watch), <PriceCheckButton item={item} watch={watch} />,
        <RecordPriceWatch item={item} watch={watch} owned={owned} today={today} />)}
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
      </>)}
    </div>
  )

  return (
    <div className="@container flex flex-col gap-3">
      <div className="flex items-start gap-3">
        {/* Only a real picture: an empty box took 80px beside the actions. */}
        {picture && <ItemThumb src={picture} className="@[30rem]:h-20 @[30rem]:w-20" />}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {/* The pill (on a phone) shares its line with how long it has been yours. */}
          {(pill === 'phone' || (state === 'mine' && from)) && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 empty:hidden">
              {pill === 'phone' && <TonePill tone={r.pill.tone} className="w-fit sm:hidden">{r.pill.label}</TonePill>}
              {state === 'mine' && from && (
                <p className="text-meta tabular-nums text-fg-muted">Yours for {durationLabel(from, today)} · since {item.approx_dates ? '≈ ' : ''}{formatDate(from)}</p>
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
    </div>
  )
}

/** The record's footer: Save only when something changed; else Delete (asks, then Undo) and Close. */
export function RecordFooter({ r }: { r: ShopRecordModel }) {
  return r.d.dirty ? (
    <div className="flex items-center gap-2">
      <span className="text-meta text-fg-muted">Unsaved changes</span>
      <Button onClick={r.d.discard} className="ml-auto">Discard</Button>
      <Button variant="primary" onClick={() => { void r.save() }} loading={r.saving}>Save</Button>
    </div>
  ) : (
    <div className="flex items-center gap-2">
      <Button variant="ghost" icon={<Trash2 />} className="text-danger" onClick={() => { void r.del() }}>Delete</Button>
      <Button onClick={() => { void r.close() }} className="ml-auto">Close</Button>
    </div>
  )
}
