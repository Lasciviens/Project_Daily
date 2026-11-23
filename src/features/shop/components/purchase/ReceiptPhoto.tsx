import { useEffect, useRef, useState } from 'react'
import { PhotoButton } from '../../../ai/claude/components/PhotoButton'
import { useReadReceipt } from '../../../ai/claude/hooks/useAiFeatures'
import { costNote, receiptFill, type ReceiptFill, type ReceiptRead } from '../../../ai/claude/featureRules'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { ChoiceChip } from '../shopPickers'
import type { ShopStore } from '../../types'

/**
 * "From a receipt" (an AI call: the photo is read by the model): a photo of the receipt fills the form it sits in. The
 * AI only reads what is printed; the store match, the checks and the NOK rate of the day (frozen by the database on
 * save) are not its work. The caller decides where each value goes (the add sheet through its "Filled in for you"
 * list, so nothing the owner typed is overwritten). A receipt with several lines asks which one was bought when the
 * caller needs a line (`pickLines`), never guesses. The photo is not kept.
 */
export function ReceiptPhoto({ stores, onFill, pickLines = true }: {
  stores: readonly ShopStore[]
  onFill: (fill: ReceiptFill, read: ReceiptRead) => void
  /** Offer the item lines to pick from (a form with a name and a price); Just bought has neither and matches by name itself. */
  pickLines?: boolean
}) {
  const read = useReadReceipt()
  const [data, setData] = useState<(ReceiptRead & { costUsd: number | null }) | null>(null)
  const [pick, setPick] = useState<number | 'total' | null>(null)
  const filled = useRef<string>('')

  const fill = data ? receiptFill(data, stores, pickLines ? pick : null) : null
  // Fill the form whenever what was read or the picked line changes (the owner may then edit any field).
  useEffect(() => {
    if (!fill || !data) return
    const key = JSON.stringify([data, pick])
    if (filled.current === key) return
    filled.current = key
    onFill(fill, data)
  }, [fill, data, pick, onFill])

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
        <PhotoButton accept="image/*,application/pdf" onFile={f => { void onFile(f) }} loading={read.isPending}>{data ? 'Another receipt' : 'From a receipt'}</PhotoButton>
        {!data && <span className="text-meta text-fg-muted">AI reads a photo or PDF; you check it</span>}
      </div>
      {data && fill && (
        <>
          <p className="text-meta text-fg-muted">
            AI read{costNote(data.costUsd) ? ` (${costNote(data.costUsd)})` : ''}: {[data.store, data.total !== undefined ? `${data.total}${data.currency ? ` ${data.currency}` : ''}` : null, data.date ? formatDate(data.date) : null].filter(Boolean).join(' · ') || 'nothing clear'}
            {fill.storeId ? '' : fill.storeName ? ' · not one of your stores' : ''}
          </p>
          {pickLines && lines.length > 1 && (
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Which line did you buy?">
              {lines.map((l, i) => (
                <ChoiceChip key={i} on={pick === i} onClick={() => setPick(i)}>{l.name}{l.price != null ? ` · ${l.price}` : ''}</ChoiceChip>
              ))}
              <ChoiceChip on={pick === 'total'} onClick={() => setPick('total')}>Use the total</ChoiceChip>
            </div>
          )}
          {pickLines && fill.left.map(l => <p key={l} className="text-meta text-warn">{l}</p>)}
        </>
      )}
    </div>
  )
}
