import { formatDate } from '../../../../shared/utils/dateFormat'
import { categoryPath } from '../../shopModel'
import { complete, DISPOSAL_LABEL, type Amount } from '../../ownModel'
import { takesMoney, type DraftOutcome, type DraftStep } from '../../chainDraft'
import { amountReason, money } from '../shopFormat'
import type { ShopCategory } from '../../types'

// The chain builder's words: the answer at the top, a step folded to one line.

/** "+1 500 NOK" / "−1 500 NOK" (+ = made). */
export function signed(n: number): string {
  const r = Math.round(n)
  return r > 0 ? `+${money(r)}` : r < 0 ? `−${money(-r)}` : money(0)
}

export interface Headline {
  /** Above the number: what it is about. */
  label: string
  /** The answer. */
  value: string
  /** One short line for the footer. */
  short: string
  /** + made, − lost, null: not a result (unknown or nothing sold yet). */
  sign: number | null
  /** Why it is not a number, or what would make it one. */
  note?: string
}

const said = (n: number, verb: 'did' | 'would') => {
  const r = Math.round(n)
  if (r === 0) return verb === 'did' ? 'You broke even' : 'You\'d break even'
  return `${verb === 'did' ? 'You' : 'You\'d'} ${r > 0 ? (verb === 'did' ? 'gained' : 'gain') : (verb === 'did' ? 'lost' : 'lose')} ${money(Math.abs(r))}`
}

function unknown(label: string, a: Amount): Headline {
  return { label, value: 'Unknown', short: 'Result unknown', sign: null, note: `Unknown until: ${amountReason(a)}.` }
}

export function headline(o: DraftOutcome | null): Headline {
  if (!o) return { label: 'Your chain', value: 'Nothing yet', short: 'Nothing yet', sign: null }
  if (o.kind === 'holding') {
    const title = o.held.map(h => h.node.item.title.trim() || 'the last thing').join(', ')
    const hint = `Add "Could sell for" on ${title} to see the whole chain.`
    if (!o.leftCount) return { label: 'Your chain', value: 'Nothing sold yet', short: 'Nothing sold yet', sign: null, note: hint }
    if (!complete(o.onLeft)) return { ...unknown('On what you sold', o.onLeft), note: `Unknown until: ${amountReason(o.onLeft)}. ${hint}` }
    return { label: 'On what you sold', value: signed(o.onLeft.nok), short: `So far ${signed(o.onLeft.nok)}`, sign: Math.sign(Math.round(o.onLeft.nok)), note: `${title} is still yours. ${hint}` }
  }
  const result = o.result as Amount
  const label = o.kind === 'done' ? 'The whole chain' : `If you sold ${o.held.map(h => h.node.item.title.trim() || 'it').join(', ')} now`
  if (!complete(result)) return unknown(label, result)
  const verb = o.kind === 'done' ? 'did' : 'would'
  return { label, value: said(result.nok, verb), short: o.kind === 'done' ? said(result.nok, 'did') : `If sold now: ${signed(result.nok)}`, sign: Math.sign(Math.round(result.nok)) }
}

/** A folded step in one line: "Gaming › Handhelds · Elkjøp · 01.03.2023 · 2 000 NOK → sold 01.03.2024 · 1 800 NOK". */
export function stepLine(s: DraftStep, categories: readonly ShopCategory[]): string {
  const path = categoryPath(s.categoryId, categories)
  const cat = path.topId ? [path.topName, path.subName].filter(Boolean).join(' › ') : null
  const bought = [s.boughtOn ? `${s.approx ? '≈ ' : ''}${formatDate(s.boughtOn)}` : null, s.price != null ? money(s.price, s.currency) : s.gift ? 'a gift' : null].filter(Boolean).join(' · ')
  const left = s.left
    ? `${DISPOSAL_LABEL[s.disposal].toLowerCase()}${s.leftOn ? ` ${formatDate(s.leftOn)}` : ''}${takesMoney(s.disposal) && s.got != null ? ` · ${money(s.got, s.gotCurrency ?? s.currency)}` : ''}`
    : 'still yours'
  const parts = [cat, s.platform.trim() || null, bought || null].filter(Boolean)
  return `${parts.join(' · ')}${parts.length ? ' → ' : ''}${left}`
}

/** What "Copy … from the previous thing" copies, in a few words. */
export function copiedLine(s: DraftStep, categories: readonly ShopCategory[]): string {
  const path = categoryPath(s.categoryId, categories)
  return [
    path.topId ? [path.topName, path.subName].filter(Boolean).join(' › ') : 'No category',
    s.platform.trim() || null,
    s.region === 'TR' ? 'Turkey' : s.region === 'NO' ? 'Norway' : null,
    s.used ? 'used' : null,
    s.forResale ? 'to sell later' : null,
  ].filter(Boolean).join(' · ')
}
