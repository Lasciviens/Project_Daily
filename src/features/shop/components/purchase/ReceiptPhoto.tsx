import { useEffect, useRef, useState } from 'react'
import { PhotoButton } from '../../../ai/claude/components/PhotoButton'
import { useReadReceipt } from '../../../ai/claude/hooks/useAiFeatures'
import { receiptFill, type ReceiptFill, type ReceiptRead } from '../../../ai/claude/featureRules'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { ChoiceChip } from '../shopPickers'
import type { ShopStore } from '../../types'

/**
 * "From a receipt": a photo of the receipt fills the form it sits in (what was paid, the currency, the day, the
 * store matched to the owner's own stores, the item's name, and a receipt note), for the owner to check and save.
 * The AI only reads what is printed; the store match, the checks and the NOK rate of the day (frozen by the
 * database on save) are not its work. A receipt with several lines asks which one was bought, never guesses.
 * The photo is not kept.
 */
export function ReceiptPhoto({ stores, onFill, withTitle = true }: { stores: readonly ShopStore[]; onFill: (fill: ReceiptFill) => void; withTitle?: boolean }) {
  const read = useReadReceipt()
  const [data, setData] = useState<ReceiptRead | null>(null)
  const [pick, setPick] = useState<number | 'total' | null>(null)
  const filled = useRef<string>('')

  const fill = data ? receiptFill(data, stores, pick) : null
  // Fill the form whenever what was read or the picked line changes (the owner may then edit any field).
  useEffect(() => {
    if (!fill) return
    const key = JSON.stringify([data, pick])
    if (filled.current === key) return
    filled.current = key
    onFill(withTitle ? fill : { ...fill, title: undefined })
  }, [fill, data, pick, onFill, withTitle])

  async function onFile(file: File) {
    try {
      const r = await read.mutateAsync(file)
      setData(r)
      setPick(r.items && r.items.length > 1 ? null : 0)
    } catch { /* the hook reports it */ }
  }

  const lines = data?.items ?? []
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <PhotoButton onFile={f => { void onFile(f) }} loading={read.isPending}>{data ? 'Another receipt' : 'From a receipt'}</PhotoButton>
        {!data && <span className="text-meta text-fg-muted">A photo fills what it can; you check it</span>}
      </div>
      {data && fill && (
        <>
          <p className="text-meta text-fg-muted">
            Read: {[data.store, data.total !== undefined ? `${data.total}${data.currency ? ` ${data.currency}` : ''}` : null, data.date ? formatDate(data.date) : null].filter(Boolean).join(' · ') || 'nothing clear'}
            {fill.storeId ? '' : fill.storeName ? ' · not one of your stores' : ''}
          </p>
          {lines.length > 1 && (
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Which line did you buy?">
              {lines.map((l, i) => (
                <ChoiceChip key={i} on={pick === i} onClick={() => setPick(i)}>{l.name}{l.price != null ? ` · ${l.price}` : ''}</ChoiceChip>
              ))}
              <ChoiceChip on={pick === 'total'} onClick={() => setPick('total')}>Use the total</ChoiceChip>
            </div>
          )}
          {fill.left.map(l => <p key={l} className="text-meta text-warn">{l}</p>)}
        </>
      )}
    </div>
  )
}
