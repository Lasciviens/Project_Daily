import { Truncate, cx, useChartColors } from '../../../../shared/ui'
import type { Chain } from '../../chainModel'
import { complete } from '../../ownModel'
import { boughtToSell } from '../../statsModel'
import { money } from '../shopFormat'
import { StatsCard, Swatch } from './statsKit'
import { countReason, num } from './statsFormat'
import { dayOf } from './drillTypes'

/**
 * Things you sold to pay for the next one: "RP4 Pro → RP5 → RP6", what the
 * chain cost you in the end (or made), and how much of the money came back.
 * A loss on things you used is just what using them cost — only things bought
 * to sell show a profit in green. A chain opens its own popup.
 */
export function ChainsCard({ chains, onOpen }: { chains: Chain[]; onOpen: (id: string) => void }) {
  const c = useChartColors()
  if (!chains.length) return null
  return (
    <StatsCard
      title="Money chains"
      subtitle="Sold one thing, paid the next with the money"
      action={<span className="flex gap-3"><Swatch color={c.series[1]} label="Got back" /><Swatch color={c.series[0]} label="Net cost" /></span>}
    >
      <ul className="-mx-3 flex flex-col">
        {chains.map(ch => <li key={ch.id}><ChainRow chain={ch} colors={[c.series[0], c.series[1]]} onOpen={() => onOpen(ch.id)} /></li>)}
      </ul>
    </StatsCard>
  )
}

function ChainRow({ chain, colors, onOpen }: { chain: Chain; colors: [string, string]; onOpen: () => void }) {
  const names = chain.nodes.map(n => (n.state === 'wish' ? `${n.item.title} (to buy)` : n.item.title)).join(' → ')
  const known = complete(chain.net)
  const profit = known && Math.round(chain.net.nok) < 0
  const tone = profit && boughtToSell(chain) ? 'success' : undefined
  const first = chain.nodes.find(n => n.state !== 'wish')
  const totals = complete(chain.paid) && complete(chain.got) ? { paid: chain.paid.nok, got: chain.got.nok } : null
  const scale = totals ? Math.max(totals.paid, totals.got, 1) : 1
  return (
    <button type="button" onClick={onOpen} className="row row-interactive w-full flex-col items-stretch gap-1 py-2.5 text-left">
      <Truncate lines={2} className="text-body font-medium text-fg">{names}</Truncate>
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
