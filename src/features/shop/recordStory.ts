// The record as a life story (step A, plan approved 10.11.2026): its Story —
// wished → bought → accessories, costs and its value → sold, with the
// deadlines still ahead — and the one nudge line above it, the most useful
// next step. Built only from facts the Shop already has: a step without its
// own date is never shown, and nothing is guessed (an arrival day comes with
// step B's "Arrived"). Pure — scripts/verify-shop-record.cjs.
import { formatMoney } from '../settings/subscriptionRules'
import { DISPOSAL_LABEL, durationLabel, isMine } from './ownModel'
import { currencyOf, localDay } from './shopModel'
import type { Look, LookKind, LookTone } from './shopSuggestions'
import type { ShopItem, ShopItemCost, ShopItemLink } from './types'

export type StoryKind = 'wished' | 'model' | 'planned' | 'bought' | 'accessory' | 'cost' | 'value' | 'gone' | 'return' | 'complaint'

export interface StoryStep {
  key: string
  kind: StoryKind
  /** yyyy-mm-dd: every step has its own day. */
  day: string
  /** Added from memory ("≈"). */
  approx: boolean
  title: string
  detail: string | null
  /** After today: a deadline or a plan still to come. */
  ahead: boolean
}

/** The order of steps on one day: the wish before the purchase, the purchase before what came with it. */
const ORDER: Record<StoryKind, number> = {
  wished: 0, model: 1, planned: 2, bought: 3, accessory: 4, cost: 5, value: 6, gone: 7, return: 8, complaint: 9,
}

const money = (n: number, currency: string) => formatMoney(Math.round(n), currency)
const join = (...xs: (string | null | false | undefined)[]): string | null => xs.filter(Boolean).join(' · ') || null
const names = (ids: readonly string[], byId: ReadonlyMap<string, ShopItem>) => ids.map(id => byId.get(id)?.title).filter((t): t is string => !!t)

/** What was paid, as paid: "13 990 NOK", "a gift", or null with no price. */
function paidWords(i: ShopItem): string | null {
  if (i.got_as_gift && !i.price) return null
  return i.price != null ? money(i.price, currencyOf(i)) : null
}

export interface StoryInput {
  items: readonly ShopItem[]
  links: readonly ShopItemLink[]
  costs: readonly ShopItemCost[]
  today: string
}

/**
 * The thing's life, oldest first. On the wishlist — only when the row was
 * there before it was bought (made on an earlier day; a thing added as owned
 * never was a wish), or while it still is one; a planned day ahead; bought
 * (where, what it cost, the money it was paid with — `bought_at` only, never
 * the last edit); the accessories bought for it; each extra cost and rebate;
 * the "Could sell for" estimate on its day; how it left; while it is yours
 * the return window still ahead and the complaint right's end. A general
 * wish that was fulfilled tells which model was bought.
 */
export function storyOf(item: ShopItem, { items, links, costs, today }: StoryInput): StoryStep[] {
  const out: StoryStep[] = []
  const byId = new Map(items.map(i => [i.id, i]))
  const step = (kind: StoryKind, day: string | null | undefined, title: string, detail: string | null = null, approx = false, key: string = kind) => {
    if (!day) return
    out.push({ key, kind, day, approx, title, detail, ahead: day > today })
  }
  const created = localDay(item.created_at)
  const bought = item.status === 'bought' && item.bought_at ? localDay(item.bought_at) : null
  const approx = !!item.approx_dates
  const parent = item.option_for ? byId.get(item.option_for) : null

  if (item.status === 'wishlist' || (bought && created < bought)) {
    if (parent) step('model', created, `A model for ${parent.title}`)
    else step('wished', created, 'On the wishlist')
  }
  if (item.status === 'wishlist' && item.planned_date) {
    step('planned', item.planned_date, item.wait_for_deal ? 'Waiting for a deal from' : 'Planned to buy')
  }
  if (item.kind === 'general' && item.status === 'fulfilled') {
    const model = items.find(m => m.option_for === item.id && m.status === 'bought' && m.bought_at)
    if (model) step('bought', localDay(model.bought_at as string), `Bought ${model.title}`, join(model.platform && `at ${model.platform}`, paidWords(model)), !!model.approx_dates)
  }
  if (bought) {
    const from = names(links.filter(l => l.to_id === item.id).map(l => l.from_id), byId)
    step('bought', bought, item.got_as_gift && !item.price ? 'Got it as a gift' : `Bought${item.platform ? ` at ${item.platform}` : ''}`,
      join(paidWords(item), item.used && 'used', from.length > 0 && `paid with money from ${from.join(' and ')}`), approx)
  }
  if (item.status === 'bought') {
    for (const a of items) {
      if (a.accessory_of !== item.id || a.status !== 'bought' || !a.bought_at) continue
      step('accessory', localDay(a.bought_at), `Added ${a.title}`, paidWords(a), !!a.approx_dates, `accessory:${a.id}`)
    }
  }
  for (const c of costs) {
    if (c.item_id !== item.id) continue
    step('cost', c.spent_on, c.label, c.amount < 0 ? `${money(-c.amount, c.currency)} back` : money(c.amount, c.currency), false, `cost:${c.id}`)
  }
  if (isMine(item) && item.value_now != null) {
    step('value', item.value_on, `Could sell for ${money(item.value_now, item.value_currency ?? 'NOK')}`, 'your estimate')
  }
  if (item.status === 'bought' && item.disposal && item.disposed_on) {
    const to = names(links.filter(l => l.from_id === item.id).map(l => l.to_id), byId)
    const together = item.sale_group ? items.filter(a => a.id !== item.id && a.sale_group === item.sale_group).length : 0
    step('gone', item.disposed_on, `${DISPOSAL_LABEL[item.disposal]}${item.sold_to ? ` to ${item.sold_to}` : ''}`,
      join(item.sale_price != null && `got ${money(item.sale_price, item.sale_currency ?? currencyOf(item))}`,
        together > 0 && `with ${together} accessor${together === 1 ? 'y' : 'ies'}`,
        to.length > 0 && `its money went to ${to.join(' and ')}`), approx)
  }
  if (isMine(item)) {
    if (item.return_by && item.return_by >= today) step('return', item.return_by, 'Last day to return it')
    if (item.warranty_until) step('complaint', item.warranty_until, item.warranty_until >= today ? 'Complaint right ends' : 'Complaint right ended')
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || ORDER[a.kind] - ORDER[b.kind] || a.key.localeCompare(b.key))
}

/**
 * The nudge's action: the record can do it at once (Bought, open a fact's editor, Claim) or it only says what is
 * due. Claim only where Needs a look's own row has it — a price protection a checked rule decides
 * (`purchaseModel.protectionOf`), never Ask AI's or a price site's — so the record and the list never differ.
 */
export type NudgeAction = 'bought' | 'value' | 'day' | 'claim' | null

export interface Nudge {
  key: string
  /** The Needs-a-look kind behind it (its icon), or a fact the record lacks. */
  kind: LookKind
  tone: LookTone
  /** What is due and the money, as short facts. */
  facts: string[]
  /** Where the last fact's price was read ("at elkjop.no"). */
  where: string | null
  action: NudgeAction
}

/**
 * The record's one nudge line — the most useful next step: the first of
 * Needs a look's rows (already in urgency order, and without what was
 * snoozed or put away) that is about this thing; else the tidy-up row's
 * words for it; else, for a thing still yours with no "Could sell for", the
 * one fact that gives its cost per month. None for anything else. An old
 * estimate says only how old it is: the money strip right above shows the
 * amount and its day (review, 10.11.2026: the same facts three times).
 */
export function nudgeFor(item: ShopItem, looks: readonly Look[], today: string): Nudge | null {
  const own = looks.find(l => l.itemId === item.id)
  if (own) {
    const action: NudgeAction = own.action === 'bought' ? 'bought' : own.action === 'value' ? 'value'
      : own.action === 'claim' && own.kind === 'cheaper_returnable' && own.claim ? 'claim' : null
    const facts = own.kind === 'old_value' && item.value_on ? [`Your "Could sell for" is ${durationLabel(item.value_on, today)} old`] : own.facts
    return { key: own.key, kind: own.kind, tone: own.tone, facts, where: own.kind === 'old_value' ? null : own.where, action }
  }
  const tidy = looks.find(l => l.kind === 'tidy_up')?.things.find(t => t.id === item.id)
  if (tidy) {
    return { key: 'tidy_up', kind: 'tidy_up', tone: 'info', facts: ['To tidy up', ...tidy.facts], where: null, action: tidy.facts.includes('no purchase day') ? 'day' : null }
  }
  if (isMine(item) && item.value_now == null && !item.accessory_of) {
    return { key: 'no_value', kind: 'old_value', tone: 'info', facts: ['What could it sell for?', 'it gives the cost per month'], where: null, action: 'value' }
  }
  return null
}
