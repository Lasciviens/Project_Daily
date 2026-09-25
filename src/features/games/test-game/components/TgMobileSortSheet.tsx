import { Check } from 'lucide-react'
import { useTestGameStore } from '../testGameStore'
import { SORT_LABEL, type TgSort } from '../testGameModel'
import { TgMobileSheet } from './TgMobileSheet'

const SORTS = Object.keys(SORT_LABEL) as TgSort[]

/** The phone's sort picker: one tap picks an order and closes the sheet. */
export function TgMobileSortSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sort = useTestGameStore(s => s.sort)
  const setSort = useTestGameStore(s => s.setSort)

  return (
    <TgMobileSheet open={open} onClose={onClose} title="Sort by">
      <div role="radiogroup" aria-label="Sort by" className="-mx-2 flex flex-col">
        {SORTS.map(s => {
          const active = s === sort
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => { setSort(s); onClose() }}
              className={`flex min-h-[48px] items-center justify-between gap-3 rounded-xl px-3 text-left text-[15px] ${
                active ? 'font-semibold text-[var(--tg-accent)]' : 'text-[var(--tg-text)]'
              }`}
            >
              {SORT_LABEL[s]}
              {active && <Check aria-hidden size={18} strokeWidth={2.4} />}
            </button>
          )
        })}
      </div>
    </TgMobileSheet>
  )
}
