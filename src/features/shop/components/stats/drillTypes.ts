// The shape of a Stats drill-down: which number was tapped, and the rows
// (things) behind it with the amount each one adds.
import type { Tone } from '../../../../shared/ui'
import { formatDate } from '../../../../shared/utils/dateFormat'
import type { ShopCategory, ShopItem } from '../../types'
import type { Amount, MoneyCtx } from '../../ownModel'
import { dayLabel, money } from '../shopFormat'

export type Drill =
  | { kind: 'period'; year: string | null }
  | { kind: 'month'; month: string }
  | { kind: 'own' }
  | { kind: 'use' }
  | { kind: 'kept' }
  | { kind: 'resale' }
  | { kind: 'category'; key: string }
  | { kind: 'store'; key: string; year: string | null }

export interface DrillRow {
  key: string
  /** The thing a tap opens. */
  id: string
  title: string
  sub: string
  /** A sum in NOK (shown with the reason when it is not complete)… */
  amount?: Amount
  /** …shown taken off ("-1 490 NOK": a refund) or with its sign ("+1 101 NOK": a result). */
  negate?: boolean
  signed?: boolean
  /** …or words instead ("≈ 87 NOK/month", "Still yours"). */
  text?: string
  muted?: boolean
  tone?: Tone
}

export interface DrillGroup { key: string; title: string | null; total?: Amount; rows: DrillRow[] }
export interface DrillContent { title: string; subtitle: string; groups: DrillGroup[]; empty: string }

/** Everything a drill-down needs, computed once per screen. */
export interface StatsData {
  items: ShopItem[]
  categories: ShopCategory[]
  ctx: MoneyCtx
  today: string
  /** Years with money moving, newest first. */
  years: string[]
  byId: Map<string, ShopItem>
}

/** "≈ 01.03.2022" for a day added from memory, else "01.03.2022". */
export const dayOf = (i: Pick<ShopItem, 'approx_dates'>, day: string | null | undefined) => dayLabel(day, i.approx_dates, formatDate)

/** "8 999 TRY" when it was not in NOK (the NOK amount sits beside it), else null. */
export function native(amount: number | null | undefined, currency: string | null | undefined): string | null {
  return amount != null && currency && currency !== 'NOK' ? money(amount, currency) : null
}

/** "a · b · c" from the parts that are there. */
export const join = (parts: (string | null | false | undefined)[]) => parts.filter(Boolean).join(' · ')
