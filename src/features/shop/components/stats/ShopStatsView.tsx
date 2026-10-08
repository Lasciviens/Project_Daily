import { useMemo, useState, type ReactNode } from 'react'
import { ChartColumn, Plus } from 'lucide-react'
import { Button, EmptyState, PageBoard } from '../../../../shared/ui'
import { useEntityModal } from '../../../../shared/modals'
import { todayStr } from '../../../../shared/utils/dateUtils'
import type { ShopCategory, ShopItem } from '../../types'
import { ownedSummary } from '../../ownModel'
import { chainsOf } from '../../chainModel'
import {
  byStore, chartMonths, chainsWithThings, costOfUseNow, keptRows, moneyByMonth, NO_SCOPE, periodTotals, resaleSummary, scopeChains, scopeItems,
  scopeThingCount, statsYears, valueRanking, type StatsScope,
} from '../../statsModel'
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
 * Owned → Stats: where the money went (net spend, money in and out by month,
 * stores) for all time or one year, and what you own and owned (the
 * timeline, chains, categories, cost of use, things bought to sell). The
 * Filter narrows the whole screen to categories, chains, things or stores.
 * Every number opens the things behind it; a thing opens its own record.
 */
export function ShopStatsView({ items: allItems, categories, isLoading }: { items: ShopItem[]; categories: ShopCategory[]; isLoading: boolean }) {
  const modal = useEntityModal()
  const { ctx } = useShopMoney()
  const { data: links = [] } = useShopLinks()
  const today = todayStr()
  const [scope, setScope] = useState<StatsScope>(NO_SCOPE)
  const [scopeOpen, setScopeOpen] = useState(false)
  // Chains always from every row and link (a partial list would cut them), then narrowed.
  const allChains = useMemo(() => chainsWithThings(chainsOf(allItems, links, ctx)), [allItems, links, ctx])
  const options = useMemo(() => scopeOptions(allItems, categories, allChains), [allItems, categories, allChains])
  const items = useMemo(() => scopeItems(allItems, scope, categories, allChains), [allItems, scope, categories, allChains])
  const anyYears = useMemo(() => statsYears(allItems, ctx).length > 0, [allItems, ctx])
  const years = useMemo(() => statsYears(items, ctx), [items, ctx])
  // Until a period is picked: this year when it has data, else all time.
  const [picked, setPicked] = useState<string | null | undefined>(undefined)
  const fallback = years.includes(today.slice(0, 4)) ? today.slice(0, 4) : null
  const year = picked === undefined || (picked !== null && !years.includes(picked)) ? fallback : picked
  const [drill, setDrill] = useState<Drill | null>(null)
  const [drillOpen, setDrillOpen] = useState(false)

  const byId = useMemo(() => new Map(allItems.map(i => [i.id, i])), [allItems])
  const data = useMemo<StatsData>(() => ({ items, categories, ctx, today, years, byId }), [items, categories, ctx, today, years, byId])
  const totals = useMemo(() => periodTotals(items, ctx, year), [items, ctx, year])
  const months = useMemo(() => { const r = chartMonths(year, today); return moneyByMonth(items, ctx, r.from, r.to) }, [items, ctx, year, today])
  const owned = useMemo(() => ownedSummary(items, ctx), [items, ctx])
  const use = useMemo(() => costOfUseNow(items, ctx, today), [items, ctx, today])
  const resale = useMemo(() => resaleSummary(items, ctx), [items, ctx])
  const kept = useMemo(() => {
    const rows = keptRows(items)
    return { months: rows.length ? rows.reduce((s, r) => s + r.months, 0) / rows.length : null, count: rows.length }
  }, [items])
  const chains = useMemo(() => scopeChains(allChains, items, scope), [allChains, items, scope])
  const stores = useMemo(() => byStore(items, year ?? undefined), [items, year])
  const value = useMemo(() => valueRanking(items, ctx, today), [items, ctx, today])
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
  const valuedThings = use.things.filter(i => i.value_now != null).length

  const sections: Record<StatsSection, ReactNode> = {
    tiles: <StatsTiles year={year} totals={totals} owned={owned} valuedThings={valuedThings} use={use} resale={resale} kept={kept} onDrill={openDrill} />,
    money: <MoneyCard rows={months} year={year} data={data} onMonth={month => openDrill({ kind: 'month', month })} onOpen={openItem} />,
    timeline: <OwnershipTimeline items={items} categories={categories} today={today} onOpen={openItem} />,
    chains: <ChainsCard chains={chains} onOpen={id => modal.open({ kind: 'shop-chain', id })} />,
    categories: <CategoriesCard data={data} onPick={(key, level) => openDrill({ kind: 'category', key, level })} />,
    stores: <StoresCard rows={stores} year={year} onPick={key => openDrill({ kind: 'store', key, year })} />,
    value: <ValueCard rows={value} today={today} onOpen={openItem} />,
    resale: <ResaleCard summary={resale} data={data} onOpen={openItem} />,
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
