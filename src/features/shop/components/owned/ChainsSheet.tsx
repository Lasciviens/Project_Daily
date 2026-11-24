import { useMemo } from 'react'
import { Plus } from 'lucide-react'
import { ModalShell } from '../../../../shared/modals/ModalShell'
import { useEntityModal } from '../../../../shared/modals'
import { Button, Skeleton, useChartColors } from '../../../../shared/ui'
import { useShopItems } from '../../hooks/useShop'
import { useShopLinks, useShopMoney } from '../../hooks/useShopMoney'
import { chainsOf } from '../../chainModel'
import { chainsWithThings } from '../../statsModel'
import { ChainRow } from '../stats/ChainsCard'

/**
 * Every money chain in one list (owner, 23.11.2026: "Money chains" in the Shop header's ⋯): the name or the path, what
 * the chain cost you in the end, and how much of the money came back — the same rows as Stats' card (`ChainRow`, one
 * job, one look). A tap opens that chain's popup (rename, Try other prices, Add what its money bought, each thing's
 * record with its money links); "New money chain" starts one. The list stays under the popups it opens.
 */
export function ChainsSheet({ onClose }: { onClose: () => void }) {
  const modal = useEntityModal()
  const c = useChartColors()
  const itemsQ = useShopItems()
  const linksQ = useShopLinks()
  const { ctx } = useShopMoney()
  const chains = useMemo(() => chainsWithThings(chainsOf(itemsQ.data ?? [], linksQ.data ?? [], ctx)), [itemsQ.data, linksQ.data, ctx])
  const loading = itemsQ.isLoading || linksQ.isLoading
  const failed = (itemsQ.isError && !itemsQ.data) || (linksQ.isError && !linksQ.data)
  return (
    <ModalShell onClose={onClose} title="Money chains" subtitle="Sold one thing, paid the next with the money" size="md"
      footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" icon={<Plus />} onClick={() => modal.open({ kind: 'shop-chain-builder' })} tip="New money chain">Chain</Button>
          <Button onClick={onClose} className="ml-auto">Close</Button>
        </div>
      }>
      {loading
        ? <div aria-busy="true" className="flex flex-col gap-3"><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></div>
        : failed
          ? (
            <p className="text-body text-fg-muted">
              Couldn't load your money chains.{' '}
              <button type="button" onClick={() => { void itemsQ.refetch(); void linksQ.refetch() }} className="font-semibold text-accent-600 hover:underline">Try again</button>
            </p>
          )
          : chains.length === 0
            ? <p className="text-body text-fg-muted">No money chain yet. A chain starts when you sell a thing and pay for the next one with the money.</p>
            : (
              <ul className="-mx-3 flex flex-col">
                {chains.map(ch => (
                  <li key={ch.id}><ChainRow chain={ch} colors={[c.series[0], c.series[1]]} onOpen={() => modal.open({ kind: 'shop-chain', id: ch.id })} /></li>
                ))}
              </ul>
            )}
    </ModalShell>
  )
}
