import { Suspense } from 'react'
import { Skeleton } from '../../../../shared/ui'
import { lazyWithReload } from '../../../../shared/utils/lazyWithReload'
import type { ShopCategory } from '../../types'
import type { DraftUpdate } from '../autofill/AutofillPanel'
import type { ShopDraft } from '../ShopItemForm'

// The autofill loads in its own chunk (the reader's rules, the facts, the scanner): only a thing being added shows it,
// and the Shop page stays within its budget.
const AutofillPanel = lazyWithReload('shop-autofill', () => import('../autofill/AutofillPanel').then(m => m.default), AutofillUnavailable)

function AutofillUnavailable() {
  return <p className="text-meta text-fg-muted">Couldn't load the link reader — reload the page to paste a link.</p>
}

/** The link row's room while the autofill loads: the same label, field and buttons, so nothing moves when it lands. */
function AutofillLoading() {
  return (
    <div aria-hidden>
      <span className="field-label">Link</span>
      <div className="flex max-w-xl gap-2">
        <div className="input min-w-0 flex-1" />
        <Skeleton className="h-10 w-[4.75rem] shrink-0 rounded-control [@media(pointer:coarse)]:h-11" />
        <Skeleton className="h-10 w-10 shrink-0 rounded-control [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" />
      </div>
    </div>
  )
}

/** The link reader, barcode scan, facts and duplicate warning — a part of the one body (RecordBody, mode add). */
export function ShopAutofill(props: { draft: ShopDraft; onChange: (patch: Partial<ShopDraft>) => void; update: DraftUpdate; categories: readonly ShopCategory[]; collapsible?: boolean }) {
  return (
    <Suspense fallback={<AutofillLoading />}>
      <AutofillPanel {...props} />
    </Suspense>
  )
}
