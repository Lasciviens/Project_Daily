import { useState } from 'react'
import { Truncate, cx, useChartColors } from '../../../../shared/ui'
import { chainPath, type Chain } from '../../chainModel'
import { complete } from '../../ownModel'
import { boughtToSell, filterChains, type ChainShow } from '../../statsModel'
import { money } from '../shopFormat'
import { CardFilter, StatsCard, Swatch } from './statsKit'
import { countReason, num } from './statsFormat'
import { dayOf } from './drillTypes'

const SHOWS = [{ value: 'all' as const, label: 'All' }, { value: 'going' as const, label: 'Going' }, { value: 'ended' as const, label: 'Ended' }]

/**
 * Things you sold to pay for the next one: "RP4 Pro → RP5 → RP6" (or the
 * chain's name, with that path under it), what the chain cost you in the end
 * (or made), and how much of the money came back. A loss on things you used
 * is just what using them cost — only things bought to sell show a profit in
 * green. Going or ended (everything in it sold or gone, no wish left). A
 * chain opens its own popup.
 */
export function ChainsCard({ chains, onOpen }: { chains: Chain[]; onOpen: (id: string) => void }) {
  const c = useChartColors()
  const [picked, setPicked] = useState<ChainShow>('all')
  if (!chains.length) return null
  const show = chains.length > 1 ? picked : 'all'
  const shown = filterChains(chains, show)
  return (
    <StatsCard
      title="Money chains"
      subtitle="Sold one thing, paid the next with the money"
      action={<span className="flex gap-3"><Swatch color={c.series[1]} label="Got back" /><Swatch color={c.series[0]} label="Net cost" /></span>}
    >
      {chains.length > 1 && <CardFilter label="Show" options={SHOWS} value={show} onChange={setPicked} />}
      {shown.length === 0
        ? <p className="text-body text-fg-muted">{show === 'ended' ? 'No chain has ended yet.' : 'Every chain has ended.'}</p>
        : (
          <ul className="-mx-3 flex flex-col">
            {shown.map(ch => <li key={ch.id}><ChainRow chain={ch} colors={[c.series[0], c.series[1]]} onOpen={() => onOpen(ch.id)} /></li>)}
          </ul>
        )}
    </StatsCard>
  )
}

function ChainRow({ chain, colors, onOpen }: { chain: Chain; colors: [string, string]; onOpen: () => void }) {
  const known = complete(chain.net)
  const profit = known && Math.round(chain.net.nok) < 0
  const tone = profit && boughtToSell(chain) ? 'success' : undefined
  const first = chain.nodes.find(n => n.state !== 'wish')
  const totals = complete(chain.paid) && complete(chain.got) ? { paid: chain.paid.nok, got: chain.got.nok } : null
  const scale = totals ? Math.max(totals.paid, totals.got, 1) : 1
  return (
    <button type="button" onClick={onOpen} className="row row-interactive w-full flex-col items-stretch gap-1 py-2.5 text-left">
      {chain.name
        ? (
          <span className="flex flex-col">
            <Truncate className="text-body font-semibold text-fg">{chain.name}</Truncate>
            <Truncate lines={2} className="text-meta text-fg-muted">{chainPath(chain)}</Truncate>
          </span>
        )
        : <Truncate lines={2} className="text-body font-medium text-fg">{chainPath(chain)}</Truncate>}
      <span className="flex flex-wrap items-baseline justify-between gap-x-3 text-meta">
        <span data-tone={tone} className={cx('font-semibold', tone ? 'tone-text' : 'text-fg')}>
          {!known ? `Unknown · ${countReason(chain.net)}` : profit ? `Profit ${money(-chain.net.nok)}` : `Net cost ${money(chain.net.nok)}`}
        </span>
        {first?.bought && <span className="text-fg-muted tabular-nums">since {dayOf(first.item, first.bought)}</span>}
      </span>
      {totals && (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span aria-hidden className="flex h-1.5 min-w-[5rem] flex-1 gap-0.5 overflow-hidden rounded-full bg-surface-2">
            {totals.got > 0 && <span className="h-full rounded-full" style={{ width: `${(totals.got / scale) * 100}%`, background: colors[1] }} />}
            {totals.paid > totals.got && <span className="h-full rounded-full" style={{ width: `${((totals.paid - totals.got) / scale) * 100}%`, background: colors[0] }} />}
          </span>
          <span className="shrink-0 text-micro tabular-nums text-fg-muted">paid {num(totals.paid)} · got back {num(totals.got)}</span>
        </span>
      )}
    </button>
  )
}
