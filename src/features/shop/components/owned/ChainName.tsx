import { useState } from 'react'
import { Check, Link2, Pencil, Plus, X } from 'lucide-react'
import { Truncate } from '../../../../shared/ui'
import { useUpdateShopItem } from '../../hooks/useShop'
import { chainNameHolder, type Chain } from '../../chainModel'

/**
 * A money chain's name (migration 138): read as text with a pencil, or
 * "Name this chain" while it has none. Saved on the row that carries the
 * name (else the chain's oldest thing); an empty name removes it.
 * `renameOnly`: the name is shown elsewhere (a popup's title) — just "Rename".
 */
export function ChainName({ chain, renameOnly }: { chain: Chain; renameOnly?: boolean }) {
  const update = useUpdateShopItem()
  const [draft, setDraft] = useState<string | null>(null)
  const save = () => {
    const name = (draft ?? '').trim().slice(0, 80) || null
    setDraft(null)
    if (name === chain.name) return
    update.mutate({ id: chainNameHolder(chain), patch: { chain_name: name } })
  }

  if (draft != null) {
    return (
      <form onSubmit={e => { e.preventDefault(); save() }} className="flex max-w-md items-center gap-1">
        <input value={draft} onChange={e => setDraft(e.target.value)} maxLength={80} autoFocus aria-label="Chain name"
          placeholder="Handhelds, The phone line…" className="input min-w-0 flex-1"
          onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setDraft(null) } }} />
        <button type="submit" aria-label="Save the name" title="Save" className="icon-btn shrink-0 text-accent-600"><Check aria-hidden className="h-4 w-4" /></button>
        <button type="button" onClick={() => setDraft(null)} aria-label="Cancel" title="Cancel" className="icon-btn shrink-0 text-fg-muted"><X aria-hidden className="h-4 w-4" /></button>
      </form>
    )
  }
  if (!chain.name) {
    return (
      <button type="button" onClick={() => setDraft('')} className="chip min-h-[44px] w-fit gap-1 text-fg-muted hover:bg-surface-hover hover:text-fg-2">
        <Plus aria-hidden className="h-3 w-3" /> Name this chain
      </button>
    )
  }
  if (renameOnly) {
    return (
      <button type="button" onClick={() => setDraft(chain.name ?? '')} className="chip min-h-[44px] w-fit gap-1 text-fg-muted hover:bg-surface-hover hover:text-fg-2">
        <Pencil aria-hidden className="h-3 w-3" /> Rename the chain
      </button>
    )
  }
  return (
    <button type="button" onClick={() => setDraft(chain.name ?? '')} title="Rename the chain"
      className="group flex min-h-[44px] max-w-full items-center gap-1.5 rounded-row px-1 text-left hover:bg-surface-hover">
      <Link2 aria-hidden className="h-4 w-4 shrink-0 text-fg-muted" />
      <Truncate as="span" className="min-w-0 text-ui font-semibold text-fg">{chain.name}</Truncate>
      <Pencil aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-faint opacity-60 group-hover:opacity-100" />
    </button>
  )
}
