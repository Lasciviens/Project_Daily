import { useMemo, useState, type ReactNode } from 'react'
import { ChartColumn, Plus } from 'lucide-react'
import { Button, EmptyState, PageBoard } from '../../../../shared/ui'
import { useEntityModal } from '../../../../shared/modals'
import { todayStr } from '../../../../shared/utils/dateUtils'
import type { ShopCategory, ShopItem } from '../../types'
import { chainsOf } from '../../chainModel'
import {
  byStore, chainsWithThings, chartMonths, costOfUseIn, keptRows, moneyByMonth, NO_SCOPE, ownedAt, periodOf, periodTotals, resaleSummary,
  scopeChains, scopeItems, scopeThingCount, statsYears, storeScores, valueRanking, type StatsScope,
} from '../../statsModel'
import { KeptValueCard, SavedCard, WaitCard, WhyCard, YearVsCard } from './OwningCards'
import { useShopLinks, useShopMoney } from '../../hooks/useShopMoney'
import { STATS_BOARD, type StatsSection } from '../../shopBoard'
import { drillContent } from './statsDrill'
import type { Drill, StatsData } from './drillTypes'
import { StatsTiles } from './StatsTiles'
import { MoneyCard } from './MoneyCard'
import { OwnershipTimeline } from './OwnershipTimeline'
import { ChainsCard } from './ChainsCard'
import { CategoriesCard } from './CategoriesCard'
import { StoresCard } from './StoresCard'
import { ValueCard } from './ValueCard'
import { ResaleCard } from './ResaleCard'
import { StatsDrillSheet } from './StatsDrillSheet'
import { PeriodPicker, StatsSkeleton } from './StatsChrome'
import { StatsScopeBar } from './StatsScopeBar'
import { StatsScopeSheet } from './StatsScopeSheet'
import { scopeOptions } from './statsScopeOptions'

/**
 * Owned → Stats for all time or one year — every part follows the period
 * (owner, 09.11.2026): where the money went (net spend, money in and out by
 * month, stores), what you owned at its end, what using your things cost in
 * it, the sales and the chains' steps in it, and the timeline of the things
 * you had in it. The Filter narrows the whole screen to categories, chains,
 * things or stores. Every number opens the things behind it; a thing opens
 * its own record.
 */
export function ShopStatsView({ items: allItems, categories, isLoading, scope, onScope: setScope, year: picked, onYear: setPicked }: {
  items: ShopItem[]; categories: ShopCategory[]; isLoading: boolean
  /** The Filter (kept by the page, so Owned's summary line can open Stats on its own things). */
  scope: StatsScope; onScope: (s: StatsScope) => void
  /** The picked period: a year, all time (null), or not picked yet (undefined: this year when it has data). */
  year: string | null | undefined; onYear: (y: string | null) => void
}) {
  const modal = useEntityModal()
  const { ctx } = useShopMoney()
  const { data: links = [] } = useShopLinks()
  const today = todayStr()
  const [scopeOpen, setScopeOpen] = useState(false)
  // Chains always from every row and link (a partial list would cut them), then narrowed.
  const allChains = useMemo(() => chainsWithThings(chainsOf(allItems, links, ctx)), [allItems, links, ctx])
  const options = useMemo(() => scopeOptions(allItems, categories, allChains), [allItems, categories, allChains])
  const items = useMemo(() => scopeItems(allItems, scope, categories, allChains), [allItems, scope, categories, allChains])
  const anyYears = useMemo(() => statsYears(allItems, ctx).length > 0, [allItems, ctx])
  const years = useMemo(() => statsYears(items, ctx), [items, ctx])
  // Until a period is picked: this year when it has data, else all time.
  const fallback = years.includes(today.slice(0, 4)) ? today.slice(0, 4) : null
  const year = picked === undefined || (picked !== null && !years.includes(picked)) ? fallback : picked
  const [drill, setDrill] = useState<Drill | null>(null)
  const [drillOpen, setDrillOpen] = useState(false)

  const period = useMemo(() => periodOf(year, today), [year, today])
  const byId = useMemo(() => new Map(allItems.map(i => [i.id, i])), [allItems])
  const data = useMemo<StatsData>(() => ({ items, categories, ctx, today, years, period, byId }), [items, categories, ctx, today, years, period, byId])
  const totals = useMemo(() => periodTotals(items, ctx, year), [items, ctx, year])
  const months = useMemo(() => { const r = chartMonths(year, today); return moneyByMonth(items, ctx, r.from, r.to) }, [items, ctx, year, today])
  const owned = useMemo(() => ownedAt(items, ctx, period), [items, ctx, period])
  const use = useMemo(() => costOfUseIn(items, ctx, period), [items, ctx, period])
  const resale = useMemo(() => resaleSummary(items, ctx, period), [items, ctx, period])
  const kept = useMemo(() => {
    const rows = keptRows(items, period)
    return { months: rows.length ? rows.reduce((s, r) => s + r.months, 0) / rows.length : null, count: rows.length }
  }, [items, period])
  const chains = useMemo(() => scopeChains(allChains, items, scope), [allChains, items, scope])
  const stores = useMemo(() => byStore(items, year ?? undefined), [items, year])
  const scores = useMemo(() => storeScores(items, ctx, period), [items, ctx, period])
  const value = useMemo(() => valueRanking(items, ctx, today, period), [items, ctx, today, period])
  const content = useMemo(() => (drill ? drillContent(drill, data) : null), [drill, data])

  if (isLoading) return <StatsSkeleton />
  if (!anyYears) {
    return (
      <EmptyState
        bordered icon={<ChartColumn />} title="Nothing bought yet"
        description="Mark a wish as bought, or add something you already own, to see where your money goes and what your things cost you to use."
        action={<Button icon={<Plus />} onClick={() => modal.open({ kind: 'shop-own' })}>Add something I own</Button>}
      />
    )
  }

  const openDrill = (d: Drill) => { setDrill(d); setDrillOpen(true) }
  const openItem = (id: string) => modal.open({ kind: 'shop-item', id })
  const openThings = (ids: string[], title: string) => openDrill({ kind: 'things', ids, title: `${title} · ${year ?? 'all time'}` })
  const sections: Record<StatsSection, ReactNode> = {
    tiles: <StatsTiles period={period} totals={totals} owned={owned} use={use} resale={resale} kept={kept} onDrill={openDrill} />,
    money: <MoneyCard rows={months} year={year} data={data} onMonth={month => openDrill({ kind: 'month', month })} onOpen={openItem} />,
    timeline: <OwnershipTimeline items={items} categories={categories} period={period} onOpen={openItem} />,
    chains: <ChainsCard chains={chains} period={period} onOpen={id => modal.open({ kind: 'shop-chain', id })} onNew={() => modal.open({ kind: 'shop-chain-builder' })} />,
    categories: <CategoriesCard data={data} onPick={(key, level) => openDrill({ kind: 'category', key, level })} />,
    stores: <StoresCard rows={stores} scores={scores} year={year} onPick={key => openDrill({ kind: 'store', key, year })} />,
    value: <ValueCard rows={value} period={period} onOpen={openItem} />,
    resale: <ResaleCard summary={resale} data={data} onOpen={openItem} />,
    compare: <YearVsCard data={data} />,
    why: <WhyCard data={data} onOpen={openThings} />,
    saved: <SavedCard data={data} onOpen={openItem} />,
    wait: <WaitCard data={data} onOpen={openItem} />,
    kept: <KeptValueCard data={data} onOpen={openThings} />,
  }

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <div className="flex flex-col gap-2">
        <PeriodPicker years={years} value={year} onChange={setPicked} />
        <StatsScopeBar scope={scope} options={options} onChange={setScope} onOpen={() => setScopeOpen(true)} />
      </div>
      {years.length === 0
        ? (
          <p className="text-body text-fg-muted">
            Nothing matches these filters.{' '}
            <button type="button" onClick={() => setScope(NO_SCOPE)} className="font-semibold text-accent-600 [@media(pointer:coarse)]:min-h-[44px]">Clear filters</button>
          </p>
        )
        : <PageBoard sections={sections} layout={STATS_BOARD} />}
      <StatsDrillSheet open={drillOpen} content={content} onClose={() => setDrillOpen(false)} />
      <StatsScopeSheet open={scopeOpen} onClose={() => setScopeOpen(false)} scope={scope} options={options} onChange={setScope} matching={scopeThingCount(items)} />
    </div>
  )
}
