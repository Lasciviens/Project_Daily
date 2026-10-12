import { useState } from 'react'
import { DateInput } from '../../../../shared/components/DateInput'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { cx } from '../../../../shared/ui'
import { DecimalInput } from '../../../recipes/components/foodLogKit'
import { complete, DISPOSAL_LABEL, type Amount } from '../../ownModel'
import { LEAVE_WAYS, takesMoney, type DraftStep, type ProblemField, type StepProblem } from '../../chainDraft'
import { MoneyEditor, Toggle } from '../record/factKit'
import { money } from '../shopFormat'
import type { ShopCurrency } from '../../types'

export type SetStep = (patch: Partial<DraftStep>) => void

export function Problem({ problems, field }: { problems: readonly StepProblem[]; field: ProblemField }) {
  const p = problems.find(x => x.field === field)
  return p ? <p className="mt-1 text-meta text-danger">{p.message}</p> : null
}

/**
 * An amount in another currency in NOK at its own day's rate: Norges Bank's
 * (looked up as you type) or one typed by hand — never today's rate.
 */
export function NokLine({ amount, currency, day, typed, onTyped, loading, label }: {
  amount: Amount | null
  currency: ShopCurrency
  day: string
  typed: number | null
  onTyped: (rate: number | null) => void
  loading: boolean
  label: string
}) {
  const [typing, setTyping] = useState(typed != null)
  if (currency === 'NOK' || !amount || amount.missing) return null
  return (
    <div className="mt-1 flex flex-col gap-1 text-meta text-fg-muted">
      <p className="tabular-nums">
        {complete(amount)
          ? <>= {money(amount.nok)} <span className="text-fg-faint">· {typed != null ? 'your rate' : `Norges Bank's rate of ${formatDate(day)}`}</span></>
          : !day ? 'In NOK once the day is set'
          : loading ? 'Looking up Norges Bank\'s rate of that day…'
          : 'NOK: rate pending — Norges Bank has no rate for that day yet'}
        {!typing && (
          <button type="button" onClick={() => setTyping(true)} className="ml-2 inline-flex items-center font-semibold text-accent-600 hover:underline [@media(pointer:coarse)]:min-h-[44px]">
            Type a rate
          </button>
        )}
      </p>
      {typing && (
        <label className="flex flex-wrap items-center gap-2">
          <span>1 {currency} =</span>
          <DecimalInput value={typed} onValue={onTyped} placeholder="Norges Bank's" aria-label={`${label}: NOK per ${currency}`} className="input w-[8rem] tabular-nums" />
          <span>NOK</span>
        </label>
      )}
    </div>
  )
}

/** The purchase: what was paid and when (the next thing is often bought the day the last one sold). */
export function StepBuy({ s, set, paid, problems, sameDay, today, loading }: {
  s: DraftStep
  set: SetStep
  paid: Amount | null
  problems: readonly StepProblem[]
  /** The day the thing before it left — offered as this one's purchase day. */
  sameDay: string | null
  today: string
  loading: boolean
}) {
  return (
    <div className="grid grid-cols-1 gap-3 @[30rem]:grid-cols-2">
      <div>
        <span className="field-label">Paid</span>
        <MoneyEditor label="Paid" amount={s.price} currency={s.currency} onAmount={price => set({ price })} onCurrency={currency => set({ currency })} />
        <NokLine amount={paid} currency={s.currency} day={s.boughtOn} typed={s.rate} onTyped={rate => set({ rate })} loading={loading} label="Paid" />
      </div>
      <div>
        <span className="field-label">Bought on</span>
        <div className="flex flex-wrap items-center gap-2">
          <DateInput value={s.boughtOn} onChange={boughtOn => set({ boughtOn })} max={today} aria-label="Bought on" className="input w-[10rem] tabular-nums" />
          {sameDay && sameDay !== s.boughtOn && (
            <button type="button" onClick={() => set({ boughtOn: sameDay })} className="chip min-h-[44px] tabular-nums hover:bg-surface-hover">
              The day it sold · {formatDate(sameDay)}
            </button>
          )}
        </div>
        <Problem problems={problems} field="boughtOn" />
      </div>
    </div>
  )
}

/** How it left (sold, traded in, given away…), or — still yours — what it could sell for. */
export function StepLeave({ s, set, got, problems, today, loading }: {
  s: DraftStep
  set: SetStep
  got: Amount | null
  problems: readonly StepProblem[]
  today: string
  loading: boolean
}) {
  const gotCurrency = s.gotCurrency ?? s.currency
  return (
    <div className="flex flex-col gap-2">
      <Toggle checked={s.left} onChange={left => set({ left })}>It left me — sold, traded in, given away…</Toggle>
      {s.left ? (
        <div className="flex flex-col gap-3 rounded-row border border-line bg-surface-2 p-3">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="How it left">
            {LEAVE_WAYS.map(h => (
              <button key={h} type="button" role="radio" aria-checked={s.disposal === h} onClick={() => set({ disposal: h })}
                className={cx('chip min-h-[44px] px-3', s.disposal === h ? 'border-accent-500 bg-accent-50 font-semibold text-accent-700' : 'hover:bg-surface')}>
                {DISPOSAL_LABEL[h]}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 @[30rem]:grid-cols-2">
            <div>
              <span className="field-label">On</span>
              <DateInput value={s.leftOn} onChange={leftOn => set({ leftOn })} min={s.boughtOn || undefined} max={today} aria-label="Left on" className="input w-[10rem] tabular-nums" />
              <Problem problems={problems} field="leftOn" />
            </div>
            <div>
              <label className="field-label" htmlFor={`to-${s.key}`}>{s.disposal === 'given' ? 'Given to' : s.disposal === 'traded_in' ? 'Traded in at' : 'To'} <span className="font-normal text-fg-faint">(optional)</span></label>
              <input id={`to-${s.key}`} value={s.soldTo} onChange={e => set({ soldTo: e.target.value })} placeholder={s.disposal === 'traded_in' ? 'Apple, POWER…' : 'FINN, a friend…'} className="input max-w-md" />
            </div>
          </div>
          {takesMoney(s.disposal) && (
            <div>
              <span className="field-label">Got</span>
              <MoneyEditor label="Got" amount={s.got} currency={gotCurrency} onAmount={v => set({ got: v })} onCurrency={c => set({ gotCurrency: c })} />
              <NokLine amount={got} currency={gotCurrency} day={s.leftOn} typed={s.gotRate} onTyped={gotRate => set({ gotRate })} loading={loading} label="Got" />
              {s.got == null && <p className="mt-1 text-meta text-fg-faint">Without an amount the result stays Unknown.</p>}
            </div>
          )}
        </div>
      ) : (
        <div>
          <span className="field-label">Could sell for <span className="font-normal normal-case tracking-normal text-fg-faint">(optional — shows what the whole chain would come to)</span></span>
          <MoneyEditor label="Could sell for" amount={s.valueNow} currency={s.valueCurrency ?? s.currency} onAmount={valueNow => set({ valueNow })} onCurrency={valueCurrency => set({ valueCurrency })} />
        </div>
      )}
    </div>
  )
}
