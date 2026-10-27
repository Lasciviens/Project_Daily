import { useState } from 'react'
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react'
import { ArrowUpDown, Check, ChevronDown } from 'lucide-react'
import { IconButton, cx } from '../../../shared/ui'
import {
  CONVERTER_START, CONVERT_CURRENCIES, CURRENCY_FLAG, convertAmount, converterFields, pickCurrency, swapCurrencies, typeIn,
  type ConvertCurrency, type ConvertSide, type ConverterState,
} from '../api/currencyConvert'

type Size = 'tile' | 'full'

const SIDES: readonly ConvertSide[] = ['top', 'bottom']

/**
 * The one currency converter: two amounts, each with its currency. Typing in
 * either field computes the other; a currency change recomputes from the field
 * typed in last. Every visit starts at 1,000 TRY → NOK (nothing is stored).
 * `tile` fits a glance tile's screen (Home's Money tile: two rows of 24px or a
 * little more, no swap button); `full` is the Convert tab of the Currency
 * popup and widget. Logic: `api/currencyConvert.ts`.
 */
export function CurrencyConverter({ rawRates, size }: { rawRates: Record<string, number>; size: Size }) {
  const [state, setState] = useState<ConverterState>(CONVERTER_START)
  const fields = converterFields(state, rawRates)
  const field = (side: ConvertSide, className: string) => (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      maxLength={16}
      aria-label={`Amount in ${state[side]}`}
      placeholder="0"
      value={fields[side]}
      onChange={e => setState(s => typeIn(s, side, e.target.value))}
      className={className}
    />
  )
  const picker = (side: ConvertSide) => (
    <CurrencyPicker size={size} value={state[side]} onChange={c => setState(s => pickCurrency(s, side, c))} />
  )

  if (size === 'tile') {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-0.5">
        {SIDES.map(side => (
          <div key={side} className="flex max-h-8 min-h-6 flex-1 items-stretch gap-1.5">
            {field(side, 'input input-xs min-w-0 flex-1 cursor-text select-text font-semibold tabular-nums')}
            {picker(side)}
          </div>
        ))}
      </div>
    )
  }

  const rate = convertAmount(1, state.top, state.bottom, rawRates)
  return (
    <div className="overflow-hidden rounded-row border border-line">
      {SIDES.map(side => (
        <div key={side} className={cx('flex items-center gap-3 px-3 py-2.5 transition-colors focus-within:bg-surface-2', side === 'bottom' && 'border-t border-line')}>
          {field(side, 'min-w-0 flex-1 cursor-text select-text bg-transparent text-kpi font-semibold tabular-nums text-fg outline-none placeholder:text-fg-faint')}
          {picker(side)}
        </div>
      ))}
      <div className="flex items-center justify-between gap-2 border-t border-line py-1 pl-3 pr-1">
        <p className="text-meta tabular-nums text-fg-muted">{rate != null ? `1 ${state.top} = ${rate.toFixed(4)} ${state.bottom}` : 'No rate for this pair'}</p>
        <IconButton label="Swap currencies" onClick={() => setState(swapCurrencies)}><ArrowUpDown aria-hidden /></IconButton>
      </div>
    </div>
  )
}

// A minimum width that holds every code, so both rows' fields end at the same place.
const PICKER_BUTTON: Record<Size, string> = {
  tile: 'inline-flex h-6 min-w-[3.5rem] shrink-0 items-center justify-between gap-0.5 self-center rounded-full bg-surface-2 pl-2 pr-1 text-meta font-semibold text-fg transition-colors hover:bg-surface-hover data-[open]:bg-surface-hover',
  full: 'flex min-h-[40px] min-w-[6.5rem] shrink-0 items-center justify-between gap-1.5 rounded-control border border-line bg-surface-2 pl-3 pr-2 text-body font-medium text-fg transition-colors hover:border-line-strong data-[open]:border-line-strong [@media(pointer:coarse)]:min-h-[44px]',
}

/** A side's currency: a Headless UI listbox (the app's menu look), small enough for a glance tile. */
function CurrencyPicker({ size, value, onChange }: { size: Size; value: ConvertCurrency; onChange: (c: ConvertCurrency) => void }) {
  return (
    <Listbox value={value} onChange={onChange}>
      <ListboxButton aria-label={`Currency: ${value}`} className={PICKER_BUTTON[size]}>
        <span className="flex items-center gap-1.5">
          {size === 'full' && <span aria-hidden className="text-base">{CURRENCY_FLAG[value]}</span>}
          {value}
        </span>
        <ChevronDown aria-hidden className={size === 'tile' ? 'h-3 w-3 text-fg-faint' : 'h-4 w-4 text-fg-faint'} />
      </ListboxButton>
      <ListboxOptions anchor="bottom end" className="menu w-36 [--anchor-gap:4px]">
        {CONVERT_CURRENCIES.map(c => (
          <ListboxOption key={c} value={c} className="menu-item data-[selected]:font-semibold data-[selected]:text-fg">
            <span aria-hidden>{CURRENCY_FLAG[c]}</span>
            <span className="flex-1">{c}</span>
            {c === value && <Check aria-hidden className="h-4 w-4 text-accent-600" />}
          </ListboxOption>
        ))}
      </ListboxOptions>
    </Listbox>
  )
}
