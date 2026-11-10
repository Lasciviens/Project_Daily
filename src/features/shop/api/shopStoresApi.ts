import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { dealRuleOf, parseDealDay } from '../dealDays'
import {
  dealDayRows, isHost, isSearchPattern, isShownLink, parseDealDayEdit, parseLawRule, parseStore, parseStoreRule,
  rulePatchProblem, type StoreRulePatch,
} from '../storeRows'
import { allPages } from './shopApi'
import type { ShopDealDay, ShopDealDayEdit, ShopDealDayRow, ShopLawRule, ShopStore, ShopStoreRule, ShopStoreRuleFacts } from '../types'

// Stores, marketplaces and their rules, Norway's law and the owner's deal-day edits (migration 191), and which
// sites forbid apps to read them (188). Every row is checked where it enters (storeRows). An edit answers the row
// before and after, so the app's Undo writes `before` back exactly; the database works out owner_edited itself.
//
// Before 191 is applied (a failed migration, a revert) the reads answer nothing and a write says so by name.
// Remove those fallbacks once 191 has run everywhere.

type PgError = { code?: string; message?: string }
const missingTable = (e: PgError) => e.code === '42P01' || e.code === 'PGRST205' || /does not exist|could not find the table/i.test(e.message ?? '')
const missingFunction = (e: PgError) => e.code === '42883' || e.code === 'PGRST202' || /could not find the function/i.test(e.message ?? '')

/** A write before migration 191 is applied. */
export const NEEDS_191 = 'Stores and their rules can\'t be saved yet — migration 191 is not applied'

const nonNull = <T>(x: T | null): x is T => x !== null

/** A row as it was and as it is after a write. */
export interface RowChange<T> { before: T; after: T }

async function readAll<T>(table: string, order: string, parse: (row: unknown) => T | null): Promise<T[]> {
  try {
    const rows = await allPages<unknown>((from, to) => supabase.from(table).select('*').order(order, { ascending: true }).order('id', { ascending: true }).range(from, to))
    return rows.map(parse).filter(nonNull)
  } catch (e) {
    if (missingTable(e as PgError)) return []
    throw e
  }
}

const fail = (e: PgError): Error => (missingTable(e) || missingFunction(e) ? new Error(NEEDS_191) : e as Error)

// ── Reads ────────────────────────────────────────────────────────────────────

/** The account's stores and marketplaces (seeded ones and the owner's own), by name. */
export function fetchShopStores(): Promise<ShopStore[]> {
  return readAll('shop_stores', 'name', parseStore)
}

/** The account's store rules. */
export function fetchStoreRules(): Promise<ShopStoreRule[]> {
  return readAll('shop_store_rules', 'created_at', parseStoreRule)
}

/** Norway's consumer law (the same for every account). */
export function fetchLawRules(): Promise<ShopLawRule[]> {
  return readAll('shop_law_rules', 'slug', parseLawRule)
}

/** The hosts whose terms forbid apps to read them (188): a store is on one when a host of its is that host or under it. */
export async function fetchSitePolicyHosts(): Promise<string[]> {
  try {
    const rows = await allPages<{ host: unknown; no_automated_reading: unknown }>((from, to) => supabase
      .from('shop_site_policies').select('host, no_automated_reading').order('host', { ascending: true }).range(from, to))
    return rows.filter(r => r.no_automated_reading === true && isHost(r.host)).map(r => r.host as string)
  } catch (e) {
    if (missingTable(e as PgError)) return []
    throw e
  }
}

// ── A rule: edit, reset, Undo ────────────────────────────────────────────────

/** The facts an edit may send (the database keeps origin, the source and owner_edited itself). */
const RULE_FACTS = ['kind', 'label', 'days', 'member_tier', 'window_from', 'window_to', 'return_until', 'exclusions', 'payout', 'against',
  'against_stores', 'words', 'source_url', 'read_on', 'off'] as const

async function ruleById(id: string, userId: string): Promise<ShopStoreRule> {
  const { data, error } = await supabase.from('shop_store_rules').select('*').eq('id', id).eq('user_id', userId).maybeSingle()
  if (error) throw fail(error)
  const rule = parseStoreRule(data)
  if (!rule) throw new Error('That rule is not there any more')
  return rule
}

async function writeRule(id: string, userId: string, payload: Record<string, unknown>): Promise<ShopStoreRule> {
  const { data, error } = await supabase.from('shop_store_rules').update(payload).eq('id', id).eq('user_id', userId).select('*').maybeSingle()
  if (error) throw fail(error)
  const rule = parseStoreRule(data)
  if (!rule) throw new Error('That rule is not there any more')
  return rule
}

/** Edit a rule's facts — it becomes the owner's ("you edited it"), never overwritten by a later seed or page read. */
export async function updateStoreRule(id: string, patch: StoreRulePatch): Promise<RowChange<ShopStoreRule>> {
  const user = await requireUser()
  const before = await ruleById(id, user.id)
  const problem = rulePatchProblem(before, patch)
  if (problem) throw new Error(problem)
  const payload: Record<string, unknown> = {}
  for (const k of RULE_FACTS) if (k in patch) payload[k] = (patch as Record<string, unknown>)[k]
  if (!Object.keys(payload).length) return { before, after: before }
  return { before, after: await writeRule(id, user.id, payload) }
}

/** Write a rule's facts back exactly as they were — the Undo of an edit or a reset (its edit time too). */
export async function putStoreRule(rule: ShopStoreRule): Promise<ShopStoreRule> {
  const user = await requireUser()
  const payload: Record<string, unknown> = { edited_at: rule.edited_at }
  for (const k of RULE_FACTS) payload[k] = rule[k]
  return writeRule(rule.id, user.id, payload)
}

/** Reset a rule to its source (the seed's, a page's or Ask AI's words): not edited any more. */
export async function resetStoreRule(id: string): Promise<RowChange<ShopStoreRule>> {
  await requireUser()
  const { data, error } = await supabase.rpc('shop_store_rule_reset', { p_id: id })
  if (error) throw fail(error)
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const before = parseStoreRule(d.before), after = parseStoreRule(d.after)
  if (!before || !after) throw new Error('The rule was reset, but its answer could not be read — reload to see it')
  return { before, after }
}

/** A new rule's facts before the owner fills them: none (a kind's own fields come from the form). */
export const BLANK_RULE: Omit<ShopStoreRuleFacts, 'kind'> = {
  label: null, days: null, member_tier: null, window_from: null, window_to: null, return_until: null, exclusions: [], payout: null,
  against: null, against_stores: null, words: null, source_url: null, read_on: null, off: false,
}

/** Add a rule of the owner's own to a store (the database makes it origin 'owner': "typed by you"). */
export async function addStoreRule(storeId: string, facts: ShopStoreRuleFacts): Promise<ShopStoreRule> {
  const user = await requireUser()
  const problem = rulePatchProblem(facts, {})
  if (problem) throw new Error(problem)
  const payload: Record<string, unknown> = { store_id: storeId, user_id: user.id }
  for (const k of RULE_FACTS) payload[k] = facts[k]
  const { data, error } = await supabase.from('shop_store_rules').insert(payload).select('*').maybeSingle()
  if (error) throw fail(error)
  const rule = parseStoreRule(data)
  if (!rule) throw new Error('The rule was saved, but its answer could not be read — reload to see it')
  return rule
}

/** Take a rule the owner added away again (its Undo; the database refuses a seeded or page-read one — those are turned off). */
export async function removeOwnStoreRule(id: string): Promise<void> {
  const user = await requireUser()
  const { error } = await supabase.from('shop_store_rules').delete().eq('id', id).eq('user_id', user.id).eq('origin', 'owner')
  if (error) throw fail(error)
}

// ── A store: edit (the member tier too), reset, Undo ─────────────────────────

/** What an edit of a store may send: its facts, and the owner's own member tier and `hidden`. */
export type StorePatch = Partial<Pick<ShopStore, 'kind' | 'name' | 'country' | 'currency' | 'hosts' | 'search_url' | 'ad_template'
  | 'ad_language' | 'source_url' | 'read_on' | 'member_tier' | 'hidden'>>
const STORE_FIELDS = ['kind', 'name', 'country', 'currency', 'hosts', 'search_url', 'ad_template', 'ad_language', 'source_url', 'read_on',
  'member_tier', 'hidden'] as const

/** What is wrong with a store after `patch` (the words the owner sees), or null. */
export function storePatchProblem(store: ShopStore, patch: StorePatch): string | null {
  const next = { ...store, ...patch }
  if (!next.name.trim() || next.name.trim().length > 80) return 'A store needs a name of at most 80 characters'
  if (!/^[A-Z]{2}$/.test(next.country) || !/^[A-Z]{3}$/.test(next.currency)) return 'A country is two capitals (NO), a currency three (NOK)'
  const hosts = next.hosts.map(h => h.trim().toLowerCase())
  if (!hosts.length || hosts.length > 20 || !hosts.every(isHost)) return 'Web addresses are like elkjop.no — no https:// or path'
  if (next.search_url !== null && !isSearchPattern(next.search_url, hosts)) return 'A search link is https, on the store\'s own address, with {q} for the words'
  if (next.source_url !== null && !isShownLink(next.source_url)) return 'The source must be a https link'
  if ((next.ad_template === null) !== (next.ad_language === null) || (next.ad_template !== null && next.kind !== 'marketplace')) return 'An ad template is for a marketplace, with its language'
  if (next.member_tier !== null && (next.member_tier.trim() === '' || next.member_tier.length > 60)) return 'A member tier is at most 60 characters'
  return null
}

async function writeStore(id: string, userId: string, payload: Record<string, unknown>): Promise<ShopStore> {
  const { data, error } = await supabase.from('shop_stores').update(payload).eq('id', id).eq('user_id', userId).select('*').maybeSingle()
  if (error) throw fail(error)
  const store = parseStore(data)
  if (!store) throw new Error('That store is not there any more')
  return store
}

/** Edit a store (a fact makes it "edited"; the member tier and hiding are the owner's own and don't). */
export async function updateShopStore(id: string, patch: StorePatch): Promise<RowChange<ShopStore>> {
  const user = await requireUser()
  const { data, error } = await supabase.from('shop_stores').select('*').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (error) throw fail(error)
  const before = parseStore(data)
  if (!before) throw new Error('That store is not there any more')
  const problem = storePatchProblem(before, patch)
  if (problem) throw new Error(problem)
  const payload: Record<string, unknown> = {}
  for (const k of STORE_FIELDS) if (k in patch) payload[k] = patch[k]
  if (!Object.keys(payload).length) return { before, after: before }
  return { before, after: await writeStore(id, user.id, payload) }
}

/** Write a store back exactly as it was — the Undo of an edit or a reset. */
export async function putShopStore(store: ShopStore): Promise<ShopStore> {
  const user = await requireUser()
  const payload: Record<string, unknown> = { edited_at: store.edited_at }
  for (const k of STORE_FIELDS) payload[k] = store[k]
  return writeStore(store.id, user.id, payload)
}

/** Reset a store's facts to its source; its member tier and `hidden` stay. */
export async function resetShopStore(id: string): Promise<RowChange<ShopStore>> {
  await requireUser()
  const { data, error } = await supabase.rpc('shop_store_reset', { p_id: id })
  if (error) throw fail(error)
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const before = parseStore(d.before), after = parseStore(d.after)
  if (!before || !after) throw new Error('The store was reset, but its answer could not be read — reload to see it')
  return { before, after }
}

// ── Deal days: the owner's own versions ──────────────────────────────────────

async function sharedDealDays(): Promise<ShopDealDay[]> {
  return readAll('shop_deal_days', 'slug', parseDealDay)
}

/** The owner's deal-day edits. */
export function fetchDealDayEdits(): Promise<ShopDealDayEdit[]> {
  return readAll('shop_deal_day_edits', 'slug', parseDealDayEdit)
}

/** Every deal day as the owner sees it: 190's row, their own version, and what counts. */
export async function fetchDealDayRows(): Promise<ShopDealDayRow[]> {
  const [shared, edits] = await Promise.all([sharedDealDays(), fetchDealDayEdits()])
  return dealDayRows(shared, edits)
}

/** A deal day as the owner types it (190's rule shape), by slug. */
export type DealDayInput = Pick<ShopDealDayEdit, 'slug' | 'name' | 'rule_kind' | 'month' | 'day' | 'weekday' | 'nth' | 'offset_days' | 'length_days'>
  & Partial<Pick<ShopDealDayEdit, 'off' | 'source_url'>>

const DEAL_FIELDS = ['name', 'rule_kind', 'month', 'day', 'weekday', 'nth', 'offset_days', 'length_days', 'off', 'source_url'] as const

/** What is wrong with a deal day as typed, or null (190's bounds: a day every year has, a whole n-th weekday). */
export function dealDayProblem(d: DealDayInput): string | null {
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(d.slug)) return 'Not a deal day the app knows'
  if (!d.name.trim() || d.name.trim().length > 80) return 'A deal day needs a name of at most 80 characters'
  if (d.source_url != null && !isShownLink(d.source_url)) return 'The source must be a https link'
  const rule = dealRuleOf({ ...d, day: d.rule_kind === 'fixed' ? d.day : null, weekday: d.rule_kind === 'nth_weekday' ? d.weekday : null, nth: d.rule_kind === 'nth_weekday' ? d.nth : null })
  if (!rule) return d.rule_kind === 'fixed' ? 'A day every year has (no 29.02)' : 'A weekday and which one (1st–4th or the last)'
  return null
}

async function ownDealDay(slug: string, userId: string): Promise<ShopDealDayEdit | null> {
  const { data, error } = await supabase.from('shop_deal_day_edits').select('*').eq('slug', slug).eq('user_id', userId).maybeSingle()
  if (error) throw fail(error)
  return data ? parseDealDayEdit(data) : null
}

/** Save the owner's version of a deal day (190's slug replaces it for this account). Answers the row before and after. */
export async function saveDealDayEdit(input: DealDayInput): Promise<{ before: ShopDealDayEdit | null; after: ShopDealDayEdit }> {
  const user = await requireUser()
  const problem = dealDayProblem(input)
  if (problem) throw new Error(problem)
  const before = await ownDealDay(input.slug, user.id)
  const payload: Record<string, unknown> = { name: input.name.trim() }
  for (const k of DEAL_FIELDS) if (k !== 'name' && k in input) payload[k] = input[k]
  if (input.rule_kind === 'fixed') Object.assign(payload, { weekday: null, nth: null })
  else Object.assign(payload, { day: null })
  const { data, error } = before
    ? await supabase.from('shop_deal_day_edits').update(payload).eq('id', before.id).eq('user_id', user.id).select('*').maybeSingle()
    : await supabase.from('shop_deal_day_edits').insert({ ...payload, slug: input.slug, user_id: user.id }).select('*').maybeSingle()
  if (error) throw fail(error)
  const after = parseDealDayEdit(data)
  if (!after) throw new Error('The deal day was saved, but its answer could not be read — reload to see it')
  return { before, after }
}

/** Reset a deal day: the owner's version goes (190's row counts again). Answers the version that went. */
export async function resetDealDay(slug: string): Promise<{ before: ShopDealDayEdit | null }> {
  const user = await requireUser()
  const before = await ownDealDay(slug, user.id)
  if (!before) return { before: null }
  const shared = await supabase.from('shop_deal_days').select('id').eq('slug', slug).maybeSingle()
  if (shared.error) throw fail(shared.error)
  if (!shared.data) throw new Error('This deal day is your own — it has no rule of the app\'s to go back to')
  const { error } = await supabase.from('shop_deal_day_edits').delete().eq('id', before.id).eq('user_id', user.id)
  if (error) throw fail(error)
  return { before }
}

/** Put a deal day's own version back exactly (the Undo of a save or a reset); null = none (it goes). */
export async function putDealDayEdit(slug: string, edit: ShopDealDayEdit | null): Promise<void> {
  const user = await requireUser()
  const now = await ownDealDay(slug, user.id)
  if (!edit) {
    if (!now) return
    const { error } = await supabase.from('shop_deal_day_edits').delete().eq('id', now.id).eq('user_id', user.id)
    if (error) throw fail(error)
    return
  }
  const payload: Record<string, unknown> = {}
  for (const k of DEAL_FIELDS) payload[k] = edit[k]
  const { error } = now
    ? await supabase.from('shop_deal_day_edits').update(payload).eq('id', now.id).eq('user_id', user.id)
    : await supabase.from('shop_deal_day_edits').insert({ ...payload, id: edit.id, slug, user_id: user.id, created_at: edit.created_at })
  if (error) throw fail(error)
}

