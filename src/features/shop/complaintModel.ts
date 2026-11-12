// "Something's wrong" (Shop step C, owner's plan 10.11.2026): the complaint letter, filled in, the store's own
// page, and what a claim brought back as money. Pure — scripts/verify-shop-owning.cjs. The days to complain and
// to return it are the Purchase section's (`purchaseModel.deadlinesOf`: the store's rules and Norway's law rows).
//
// A claim that brings money back is a rebate on the thing — a negative extra cost (`shop_item_costs`, 137), the
// same money path as every other rebate — labelled so Stats can count it as saved by watching.

import { formatDate } from '../../shared/utils/dateFormat'
import { boughtOn } from './ownModel'
import { oneLine } from './oneLine'
import type { ShopItem } from './types'

/** The law the letter cites (forbrukerkjøpsloven § 27: two years, five for things meant to last much longer). */
const COMPLAINT_LAW = { act: 'forbrukerkjøpsloven', section: '§ 27' } as const

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


/**
 * The store's own page for the thing, for Something's wrong: the record's link only when it is an https page and not
 * a price site's — Prisjakt is told by its host (any page on prisjakt.no or under it) or by the watch's source —
 * so the sheet never offers a plain-http or a price-site page as the store's (security review, 11.11.2026).
 */
export function storePageOf(url: string | null | undefined, watchSource: string | null | undefined): string | null {
  if (!url || watchSource === 'prisjakt') return null
  let u: URL
  try { u = new URL(url) } catch { return null }
  return u.protocol === 'https:' && !/(^|\.)prisjakt\.no$/i.test(u.hostname) ? u.href : null
}

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
