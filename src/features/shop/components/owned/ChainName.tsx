import { useState } from 'react'
import { Check, Link2, Pencil, Plus, X } from 'lucide-react'
import { Truncate } from '../../../../shared/ui'
import { useUpdateShopItem } from '../../hooks/useShop'
import { chainNameHolder, type Chain } from '../../chainModel'

/**
 * A chain's name as a field (migration 138): Enter or ✓ saves it on the row
 * that carries the name (else the chain's oldest thing), an empty name
 * removes it; Esc or × leaves it as it was.
 */
export function ChainNameForm({ chain, onDone }: { chain: Chain; onDone: () => void }) {
  const update = useUpdateShopItem()
  const [draft, setDraft] = useState(chain.name ?? '')
  const save = () => {
    const name = draft.trim().slice(0, 80) || null
    onDone()
    if (name !== chain.name) update.mutate({ id: chainNameHolder(chain), patch: { chain_name: name } })
  }
  return (
    <form onSubmit={e => { e.preventDefault(); save() }} className="flex max-w-md items-center gap-1">
      <input value={draft} onChange={e => setDraft(e.target.value)} maxLength={80} autoFocus aria-label="Chain name"
        placeholder="Handhelds, The phone line…" className="input min-w-0 flex-1"
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onDone() } }} />
      <button type="submit" aria-label="Save the name" title="Save" className="icon-btn shrink-0 text-accent-600"><Check aria-hidden className="h-4 w-4" /></button>
      <button type="button" onClick={onDone} aria-label="Cancel" title="Cancel" className="icon-btn shrink-0 text-fg-muted"><X aria-hidden className="h-4 w-4" /></button>
    </form>
  )
}

/**
 * A money chain's name, where nothing else shows it (the record's Money
 * card): read as text with a pencil, or "Name this chain" while it has none.
 * The chain popup names it in its title, with a pencil beside it.
 */
export function ChainName({ chain }: { chain: Chain }) {
  const [editing, setEditing] = useState(false)
  if (editing) return <ChainNameForm chain={chain} onDone={() => setEditing(false)} />
  if (!chain.name) {
    return (
      <button type="button" onClick={() => setEditing(true)} className="chip min-h-[44px] w-fit gap-1 text-fg-muted hover:bg-surface-hover hover:text-fg-2">
        <Plus aria-hidden className="h-3 w-3" /> Name this chain
      </button>
    )
  }
  return (
    <button type="button" onClick={() => setEditing(true)} title="Rename the chain"
      className="group flex min-h-[44px] max-w-full items-center gap-1.5 rounded-row px-1 text-left hover:bg-surface-hover">
      <Link2 aria-hidden className="h-4 w-4 shrink-0 text-fg-muted" />
      <Truncate as="span" className="min-w-0 text-ui font-semibold text-fg">{chain.name}</Truncate>
      <Pencil aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-muted opacity-70 group-hover:opacity-100" />
    </button>
  )
}
