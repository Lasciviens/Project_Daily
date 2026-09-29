import { useState } from 'react'
import { ModalShell, useEntityModal } from '../../../shared/modals'
import { Button } from '../../../shared/ui'
import { useDeleteSubscription, useSaveSubscription } from '../hooks/useSubscriptions'
import {
  BILLING_CYCLES, KNOWN_SERVICES, normalizeCurrency, serviceKey, SUBSCRIPTION_CURRENCIES,
  type BillingCycle, type Requirement, type ServiceSubscription, type SubscriptionInput,
} from '../subscriptionRules'

const FORM_ID = 'subscription-form'
const CYCLE_LABEL: Record<BillingCycle, string> = { monthly: 'Monthly', yearly: 'Yearly', weekly: 'Weekly', once: 'One-off', free: 'Free' }

function initialInput(sub: ServiceSubscription | null, service?: string): SubscriptionInput {
  if (sub) {
    const { service: s, name, account, plan, price, currency, billing_cycle, renews_on, requirement, notes, active } = sub
    // Folded (try → TRY, TL → TRY) so an existing row lands on its dropdown option.
    return { service: s, name, account, plan, price, currency: normalizeCurrency(currency), billing_cycle, renews_on, requirement, notes, active }
  }
  return {
    service: service ?? '', name: null, account: null, plan: null, price: null, currency: 'NOK',
    billing_cycle: 'monthly', renews_on: null, requirement: 'info', notes: null, active: true,
  }
}

const blank = (v: string) => (v.trim() === '' ? null : v.trim())

/** Add or edit one subscription. `sub` edits; `service` prefills a new one. */
export function SubscriptionSheet({ open, sub, service, onClose }: {
  open: boolean; sub: ServiceSubscription | null; service?: string; onClose: () => void
}) {
  const save = useSaveSubscription()
  const remove = useDeleteSubscription()
  const modal = useEntityModal()
  const [form, setForm] = useState<SubscriptionInput>(() => initialInput(sub, service))
  const [priceText, setPriceText] = useState(sub?.price != null ? String(sub.price) : '')
  const set = <K extends keyof SubscriptionInput>(k: K, v: SubscriptionInput[K]) => setForm(f => ({ ...f, [k]: v }))
  const valid = form.service.trim() !== ''
  // A row saved earlier in another currency keeps its own option, so opening
  // and saving it never changes the currency behind the user's back.
  const currencyOptions: string[] = (SUBSCRIPTION_CURRENCIES as readonly string[]).includes(form.currency)
    ? [...SUBSCRIPTION_CURRENCIES] : [...SUBSCRIPTION_CURRENCIES, form.currency]
  const busy = save.isPending || remove.isPending

  async function submit() {
    if (!valid) return
    const price = priceText.trim() === '' ? null : Number(priceText.replace(',', '.'))
    const input: SubscriptionInput = {
      ...form,
      service: serviceKey(form.service),
      price: price != null && Number.isFinite(price) && price >= 0 ? price : null,
      currency: normalizeCurrency(form.currency),
      name: blank(form.name ?? ''), account: blank(form.account ?? ''), plan: blank(form.plan ?? ''), notes: blank(form.notes ?? ''),
      renews_on: form.renews_on || null,
    }
    try { await save.mutateAsync({ id: sub?.id, input }) } catch { return }
    onClose()
  }

  async function handleDelete() {
    if (!sub) return
    if (!(await modal.confirm({ title: 'Remove this subscription?', confirmLabel: 'Remove', destructive: true }))) return
    try { await remove.mutateAsync(sub.id) } catch { return }
    onClose()
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      size="sm"
      dismissible={!busy}
      title={sub ? 'Edit subscription' : 'Add subscription'}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {sub && <Button block className="sm:mr-auto sm:w-auto" variant="danger" onClick={() => { void handleDelete() }} disabled={busy}>Remove</Button>}
          <Button block className="sm:w-auto" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button block className="sm:w-auto" type="submit" form={FORM_ID} variant="primary" loading={save.isPending} disabled={!valid}>Save</Button>
        </div>
      }
    >
      <form id={FORM_ID} className="flex flex-col gap-3" onSubmit={e => { e.preventDefault(); void submit() }}>
        <label className="flex flex-col gap-1">
          <span className="field-label">Service</span>
          <input list="subscription-services" value={form.service} onChange={e => set('service', e.target.value)} className="input w-full" placeholder="e.g. hevy, netflix" required />
          <datalist id="subscription-services">
            {KNOWN_SERVICES.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
          </datalist>
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="field-label">Plan</span>
            <input value={form.plan ?? ''} onChange={e => set('plan', e.target.value)} className="input w-full" placeholder="e.g. Pro" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="field-label">Account</span>
            <input value={form.account ?? ''} onChange={e => set('account', e.target.value)} className="input w-full" placeholder="username or email" />
          </label>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
          <label className="flex flex-col gap-1">
            <span className="field-label">Price</span>
            <input inputMode="decimal" value={priceText} onChange={e => setPriceText(e.target.value.replace(/[^0-9.,]/g, ''))} className="input w-full" placeholder="0" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="field-label">Currency</span>
            <select value={form.currency} onChange={e => set('currency', e.target.value)} className="select w-full min-h-[44px]">
              {currencyOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
        <div>
          <p className="field-label" id="sub-cycle">Billing</p>
          <div role="group" aria-labelledby="sub-cycle" className="flex flex-wrap gap-1.5">
            {BILLING_CYCLES.map(c => (
              <button key={c} type="button" aria-pressed={form.billing_cycle === c} onClick={() => set('billing_cycle', c)} className="pill-tab">
                {CYCLE_LABEL[c]}
              </button>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1">
          <span className="field-label">Renews on</span>
          <input type="date" value={form.renews_on ?? ''} onChange={e => set('renews_on', e.target.value || null)} className="input w-full max-w-xs" />
        </label>
        <div>
          <p className="field-label" id="sub-req">Does the integration need it?</p>
          <div role="group" aria-labelledby="sub-req" className="flex flex-wrap gap-1.5">
            {([['required', 'Required for the integration'], ['info', 'Info only']] as [Requirement, string][]).map(([v, l]) => (
              <button key={v} type="button" aria-pressed={form.requirement === v} onClick={() => set('requirement', v)} className="pill-tab">{l}</button>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1">
          <span className="field-label">Notes</span>
          <textarea value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} rows={2} className="input w-full py-2" />
        </label>
        <label className="flex min-h-[44px] items-center gap-2 text-body text-fg-2">
          <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} className="rounded border-line-strong" />
          Active
        </label>
      </form>
    </ModalShell>
  )
}
