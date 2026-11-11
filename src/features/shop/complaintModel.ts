// "Something's wrong" (Shop step C, owner's plan 10.11.2026): the complaint right first — how long is left to
// complain and to return it — then the complaint letter, filled in, and what a claim brought back as money.
// Pure — scripts/verify-shop-owning.cjs.
//
// Norwegian law only (owner, 10.11.2026): forbrukerkjøpsloven § 27 — a fault can be claimed up to two years after
// the buyer got the thing, five years for a thing meant to last considerably longer. The days come from the
// thing's own facts: "Can complain until" (`warranty_until`) when the owner noted it, else the law's two years
// from the purchase day (when unsure, the earlier day — the five years are named in the explanation). Step B's
// store rules will add the store's own days; until "Arrived" exists, the purchase day is the day it was got.
//
// A claim that brings money back is a rebate on the thing — a negative extra cost (`shop_item_costs`, 137), the
// same money path as every other rebate — labelled so Stats can count it as saved by watching.

import { formatDate } from '../../shared/utils/dateFormat'
import { addMonths, boughtOn, daysBetween, durationLabel } from './ownModel'
import type { ShopItem } from './types'

/** The law the letter cites, and its two limits in years. */
export const COMPLAINT_LAW = { act: 'forbrukerkjøpsloven', section: '§ 27', years: 2, longYears: 5 } as const

/** How close a deadline is, as a tone: ended (danger), soon (warn), ahead (success). */
export type DeadlineTone = 'danger' | 'warn' | 'success'

export interface Deadline {
  /** yyyy-mm-dd */
  until: string
  /** Days from today (below 0: it ended). */
  daysLeft: number
  tone: DeadlineTone
  /** "until 24.04.2028 · 1 year 5 months left", "ended 05.10.2026". */
  words: string
}

/** A complaint right ends warn-soon inside 60 days (as Needs a look's row); a return window inside 3. */
export const COMPLAINT_SOON_DAYS = 60
export const RETURN_SOON_DAYS = 3

function deadline(until: string, today: string, soon: number): Deadline {
  const daysLeft = daysBetween(today, until)
  const left = daysLeft === 0 ? 'last day today' : daysLeft === 1 ? '1 day left' : `${durationLabel(today, until)} left`
  return {
    until, daysLeft,
    tone: daysLeft < 0 ? 'danger' : daysLeft <= soon ? 'warn' : 'success',
    words: daysLeft < 0 ? `ended ${formatDate(until)}` : `until ${formatDate(until)} · ${left}`,
  }
}

export interface ComplaintRight extends Deadline {
  /** `noted`: the owner's own "Can complain until"; `law`: two years from the purchase day. */
  source: 'noted' | 'law'
  /** The law's two and five years from the purchase day (null without one). */
  law: { from: string; two: string; five: string } | null
}

/** How long it can still be claimed, or null when neither a noted day nor a purchase day is known. */
export function complaintRight(item: ShopItem, today: string): ComplaintRight | null {
  const from = boughtOn(item)
  const law = from ? { from, two: addMonths(from, 12 * COMPLAINT_LAW.years), five: addMonths(from, 12 * COMPLAINT_LAW.longYears) } : null
  if (item.warranty_until) return { ...deadline(item.warranty_until, today, COMPLAINT_SOON_DAYS), source: 'noted', law }
  if (!law) return null
  return { ...deadline(law.two, today, COMPLAINT_SOON_DAYS), source: 'law', law }
}

/** The return window while it is still open (return_by today or later), else null. */
export function returnWindow(item: Pick<ShopItem, 'return_by'>, today: string): Deadline | null {
  if (!item.return_by || item.return_by < today) return null
  return deadline(item.return_by, today, RETURN_SOON_DAYS)
}

// ── The letter (Norwegian: it goes to a Norwegian store) ─────────────────────

export interface LetterInput {
  title: string
  store: string | null
  /** yyyy-mm-dd, or null when not known. */
  bought: string | null
  /** The day was added from memory ("≈"). */
  approx: boolean
  serial: string | null
  /** What is wrong, as the owner typed it. */
  problem: string
}

/** What the letter says where the owner has not written what is wrong yet. */
export const PROBLEM_PLACEHOLDER = '[Beskriv feilen her]'

/** One line of text: no line breaks or control characters, spaces squeezed (a title is pasted from a page). */
const oneLine = (s: string | null | undefined): string => (s ?? '').replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim()

export function letterFacts(item: ShopItem): Omit<LetterInput, 'problem'> {
  return { title: item.title, store: item.platform ?? null, bought: boughtOn(item), approx: !!item.approx_dates, serial: item.serial ?? null }
}

/** The complaint letter, filled in from the thing's facts and what is wrong. */
export function complaintLetter(input: LetterInput): string {
  const title = oneLine(input.title) || 'varen'
  const store = oneLine(input.store)
  const serial = oneLine(input.serial)
  const problem = input.problem.trim() || PROBLEM_PLACEHOLDER
  const when = input.bought ? ` ${input.approx ? 'rundt ' : ''}${formatDate(input.bought)}` : ''
  return [
    `Emne: Reklamasjon – ${title}`,
    '',
    store ? `Hei ${store},` : 'Hei,',
    '',
    `Jeg kjøpte ${title} hos dere${when}.${serial ? ` Serienummeret er ${serial}.` : ''}`,
    '',
    `Feilen: ${problem}`,
    '',
    `Jeg reklamerer herved på feilen, jf. ${COMPLAINT_LAW.act} ${COMPLAINT_LAW.section}. Fristen for å reklamere er to år fra jeg fikk varen, og fem år for varer som ved vanlig bruk er ment å vare vesentlig lenger.`,
    '',
    'Jeg ber om at dere retter feilen eller leverer en ny vare, uten kostnad for meg. Gi meg gjerne svar innen 14 dager om hvordan dere vil løse dette.',
    '',
    'Kvitteringen er vedlagt.',
    '',
    'Vennlig hilsen',
  ].join('\n')
}

// ── Money back ───────────────────────────────────────────────────────────────

/** What money back is for: a claim (a complaint), a price match (or price protection), or something else. */
export type RebateKind = 'claim' | 'match' | 'other'

/** The label each flow writes on its rebate, so the record's Story says it and Stats counts it. */
export const REBATE_LABEL: Readonly<Record<RebateKind, string>> = {
  claim: 'Complaint: money back',
  match: 'Price match: money back',
  other: 'Money back',
}

/**
 * What a rebate's label says it was for — the app's own labels first, then the owner's own words for a price
 * match (price protection, "prisgaranti") or a complaint ("reklamasjon"); anything else is other money back.
 */
export function rebateKind(label: string): RebateKind {
  const t = label.toLocaleLowerCase('nb')
  if (t.startsWith(REBATE_LABEL.claim.toLocaleLowerCase('nb'))) return 'claim'
  if (t.startsWith(REBATE_LABEL.match.toLocaleLowerCase('nb'))) return 'match'
  if (/price\s*(match|protection|guarantee|drop)|pris\s*(match|garanti|fall|justering)|prismatch/.test(t)) return 'match'
  if (/complaint|reklamasjon|warranty claim/.test(t)) return 'claim'
  return 'other'
}
