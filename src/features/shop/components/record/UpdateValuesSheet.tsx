import { useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import { ModalShell } from '../../../../shared/modals/ModalShell'
import { Button, Truncate, cx } from '../../../../shared/ui'
import { DateInput } from '../../../../shared/components/DateInput'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { DecimalInput } from '../../../recipes/components/foodLogKit'
import { useUpdateValues } from '../../hooks/useShopSelling'
import { durationLabel } from '../../ownModel'
import { oldEstimates } from '../../sellingModel'
import { isPrice } from '../../resaleRows'
import { money } from '../shopFormat'
import type { ShopItem } from '../../types'

/**
 * "Update values": every estimate over six months old in one sheet, the oldest first. Type a new "Could sell
 * for", or Same to keep the number on a new day; Save writes each changed one with the day picked (today by
 * default) — the database keeps each in the value history — and says how many, with Undo.
 */
export function UpdateValuesSheet({ items, today, onClose }: { items: readonly ShopItem[]; today: string; onClose: () => void }) {
  const save = useUpdateValues()
  // The list as it was when the sheet opened: a row saved here stays in it (it is no longer old).
  const [rows] = useState(() => oldEstimates(items, today))
  const [next, setNext] = useState<Record<string, number | null>>({})
  const [on, setOn] = useState(today)
  const changed = useMemo(() => rows.filter(i => next[i.id] != null), [rows, next])
  // An estimate is below a billion (192): one that isn't holds the Save back and says so.
  const wrong = changed.filter(i => !isPrice(next[i.id]))

  function submit() {
    save.mutate({
      rows: changed.map(item => ({ item, next: { id: item.id, value_now: next[item.id] as number, value_currency: item.value_currency ?? 'NOK', value_on: on } })),
    }, { onSuccess: onClose })
  }

  return (
    <ModalShell onClose={onClose} title="Update values" subtitle={`${rows.length} estimate${rows.length === 1 ? '' : 's'} over six months old`} size="md"
      dismissible={!save.isPending}
      footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button variant="primary" className="ml-auto" onClick={submit} disabled={!changed.length || wrong.length > 0 || !on} loading={save.isPending}>
            {changed.length ? `Save ${changed.length}` : 'Save'}
          </Button>
        </div>
      }>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-meta text-fg-muted">Valued on</span>
          <DateInput value={on} onChange={v => v && setOn(v)} max={today} aria-label="Valued on" className="input w-[10rem] tabular-nums" />
        </div>
        {wrong.length > 0 && <p className="text-meta text-danger">An estimate is from 0 below a billion: {wrong.map(i => i.title).join(', ')}.</p>}
        {rows.length === 0 ? <p className="text-body text-fg-muted">No estimate is over six months old.</p> : (
          <ul className="flex flex-col divide-y divide-line rounded-row border border-line">
            {rows.map(i => {
              const cur = i.value_currency ?? 'NOK'
              const v = next[i.id] ?? null
              return (
                <li key={i.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
                  <span className="min-w-0 flex-1 basis-40">
                    <Truncate as="span" className="block text-body font-medium text-fg">{i.title}</Truncate>
                    <span className="block text-meta tabular-nums text-fg-muted">
                      {money(i.value_now as number, cur)} · {formatDate(i.value_on)} · {durationLabel(i.value_on as string, today)} ago
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <DecimalInput value={v} onValue={n => setNext(s => ({ ...s, [i.id]: n }))} placeholder={String(i.value_now)} aria-label={`New estimate for ${i.title}`}
                      className="input w-[7rem] tabular-nums" />
                    <span className="text-meta text-fg-muted">{cur}</span>
                    <button type="button" onClick={() => setNext(s => ({ ...s, [i.id]: v === i.value_now ? null : i.value_now ?? null }))}
                      aria-pressed={v === i.value_now}
                      className={cx('chip min-h-[36px] gap-1 px-2.5', v === i.value_now ? 'border-accent-500 bg-accent-50 font-semibold text-accent-700' : 'hover:bg-surface-hover')}>
                      {v === i.value_now && <Check aria-hidden className="h-3.5 w-3.5" />}Same
                    </button>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </ModalShell>
  )
}
