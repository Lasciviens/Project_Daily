import { supabase } from '../../../integrations/supabase/client'
import type { ServiceSubscription, SubscriptionInput } from '../subscriptionRules'

// service_subscriptions (migration 115). Same guard convention as
// trainingSkipsApi.ts: a missing table READ degrades to [], a WRITE throws a
// message naming the migration instead of a silent no-op.

const NOT_MIGRATED_115 = 'Subscriptions are not available yet — migration 115 (service_subscriptions) has not been applied.'

function isMissingTable(e: unknown): boolean {
  const x = e as { code?: string; message?: string }
  return x?.code === '42P01' || x?.code === 'PGRST205' || /Could not find the table/i.test(x?.message ?? '')
}

function toRow(s: ServiceSubscription): ServiceSubscription {
  return { ...s, price: s.price == null ? null : Number(s.price) }
}

export async function fetchSubscriptions(): Promise<ServiceSubscription[]> {
  const { data, error } = await supabase
    .from('service_subscriptions')
    .select('*')
    .order('renews_on', { ascending: true, nullsFirst: false })
  if (error) {
    if (isMissingTable(error)) return []
    throw error
  }
  return ((data ?? []) as ServiceSubscription[]).map(toRow)
}

export async function createSubscription(input: SubscriptionInput): Promise<void> {
  const { error } = await supabase.from('service_subscriptions').insert(input)
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED_115) : error
}

export async function updateSubscription(id: string, patch: Partial<SubscriptionInput>): Promise<void> {
  const { error } = await supabase.from('service_subscriptions').update(patch).eq('id', id)
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED_115) : error
}

export async function deleteSubscription(id: string): Promise<void> {
  const { error } = await supabase.from('service_subscriptions').delete().eq('id', id)
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED_115) : error
}
