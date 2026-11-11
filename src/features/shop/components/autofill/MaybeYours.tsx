import { useEntityModal } from '../../../../shared/modals'
import { Truncate } from '../../../../shared/ui'
import type { Duplicate } from '../../autofillModel'

const BY_WORDS: Record<Duplicate['by'], string> = { ean: 'the same EAN', prisjakt: 'the same Prisjakt product', title: 'the same name' }

/**
 * "You may already have this: … · Open" — the owner's things a new one may be (the same EAN, Prisjakt product or
 * name). A warning in the warning tone, never a block on Add; Open shows the thing over the sheet.
 */
export function MaybeYours({ duplicates, lead = 'You may already have this' }: { duplicates: readonly Duplicate[]; lead?: string }) {
  const modal = useEntityModal()
  if (!duplicates.length) return null
  return (
    <ul data-tone="warn" className="tone-soft flex flex-col gap-0.5 rounded-row px-3 py-1.5" data-testid="shop-maybe-yours">
      {duplicates.map(({ item, by }) => (
        <li key={item.id} className="flex min-h-[32px] min-w-0 items-center gap-1 text-meta text-fg-2" title={`Matched by ${BY_WORDS[by]}`}>
          <span className="shrink-0">{lead}:</span>
          <Truncate className="min-w-0 font-medium text-fg">{item.title}</Truncate>
          <span aria-hidden className="shrink-0 text-fg-muted">·</span>
          <button type="button" onClick={() => modal.open({ kind: 'shop-item', id: item.id })}
            className="shrink-0 font-semibold text-fg underline-offset-2 hover:underline">Open</button>
        </li>
      ))}
    </ul>
  )
}
