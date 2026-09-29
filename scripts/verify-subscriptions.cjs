#!/usr/bin/env node
/*
 * Verification — Settings → Integrations subscriptions
 * (src/features/settings/subscriptionRules.ts) against the real module
 * through sucrase: monthly-equivalent cost, per-currency totals, renewal
 * state, next renewal, service matching and the required-but-lapsed rule.
 *
 *   Run:  node scripts/verify-subscriptions.cjs
 */
require('sucrase/register')
const S = require('../src/features/settings/subscriptionRules')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const J = JSON.stringify
const sub = (o) => ({ id: o.id ?? 'x', service: 'hevy', name: null, account: null, plan: null, price: null, currency: 'NOK', billing_cycle: 'monthly', renews_on: null, requirement: 'info', notes: null, active: true, ...o })

console.log('\nmonthly cost')
check('monthly is the price', S.monthlyCost(sub({ price: 99 })) === 99)
check('yearly is /12', S.monthlyCost(sub({ price: 120, billing_cycle: 'yearly' })) === 10)
check('weekly is ×52/12', Math.abs(S.monthlyCost(sub({ price: 30, billing_cycle: 'weekly' })) - 130) < 1e-9)
check('once / free / no price → 0', S.monthlyCost(sub({ price: 500, billing_cycle: 'once' })) === 0 && S.monthlyCost(sub({ billing_cycle: 'free', price: 10 })) === 0 && S.monthlyCost(sub({ price: null })) === 0)
check('a negative price never counts', S.monthlyCost(sub({ price: -5 })) === 0)

console.log('\nmonthly totals')
{
  const t = S.monthlyTotals([
    sub({ price: 99 }), sub({ price: 120, billing_cycle: 'yearly' }),
    sub({ price: 5, currency: 'eur' }), sub({ price: 1000, active: false }),
    sub({ price: 0, billing_cycle: 'free' }),
  ])
  check('per currency, inactive and free skipped, biggest first', J(t) === J([{ currency: 'NOK', amount: 109 }, { currency: 'EUR', amount: 5 }]), J(t))
  check('nothing billable → empty', S.monthlyTotals([sub({ billing_cycle: 'free' })]).length === 0)
  check('rounds to cents', J(S.monthlyTotals([sub({ price: 100, billing_cycle: 'yearly' })])) === J([{ currency: 'NOK', amount: 8.33 }]))
}

console.log('\nrenewal state')
check('no date → none', S.renewalState(null, '2026-09-29').state === 'none')
check('today → soon, 0 days', J(S.renewalState('2026-09-29', '2026-09-29')) === J({ state: 'soon', days: 0 }))
check('7 days → soon', S.renewalState('2026-10-06', '2026-09-29').state === 'soon')
check('8 days → ok', S.renewalState('2026-10-07', '2026-09-29').state === 'ok')
check('yesterday → past', J(S.renewalState('2026-09-28', '2026-09-29')) === J({ state: 'past', days: -1 }))
check('across a month and DST', S.daysBetween('2026-10-24', '2026-11-02') === 9)

console.log('\nnext renewal')
{
  const list = [sub({ id: 'a', renews_on: '2026-12-01' }), sub({ id: 'b', renews_on: '2026-10-10' }), sub({ id: 'c', renews_on: '2026-09-01' }), sub({ id: 'd', renews_on: '2026-10-01', active: false })]
  check('earliest future active one', S.nextRenewal(list, '2026-09-29').id === 'b')
  check('none left → null', S.nextRenewal([sub({ renews_on: '2026-01-01' })], '2026-09-29') === null)
}

console.log('\nservice matching')
check('case and spaces fold', S.serviceKey('  Hevy ') === 'hevy')
check('aliases fold (PSN → playstation)', S.serviceKey('PSN') === 'playstation' && S.serviceKey('PlayStation Plus') === 'playstation')
{
  const list = [sub({ id: '1', service: 'Hevy' }), sub({ id: '2', service: 'psn' }), sub({ id: '3', service: 'Netflix' })]
  check('subscriptionsFor matches by key', J(S.subscriptionsFor(list, 'playstation').map(s => s.id)) === J(['2']))
  check('otherSubscriptions keeps the ones without a card', J(S.otherSubscriptions(list, ['hevy', 'playstation']).map(s => s.id)) === J(['3']))
  check('label of a known key, else the typed text', S.serviceLabel('psn') === 'PlayStation' && S.serviceLabel('Netflix') === 'Netflix')
}

console.log('\nattention + labels')
check('required and inactive → attention', S.needsAttention(sub({ requirement: 'required', active: false }), '2026-09-29'))
check('required and past → attention', S.needsAttention(sub({ requirement: 'required', renews_on: '2026-09-01' }), '2026-09-29'))
check('required and fine → no', !S.needsAttention(sub({ requirement: 'required', renews_on: '2026-12-01' }), '2026-09-29'))
check('info never needs attention', !S.needsAttention(sub({ active: false }), '2026-09-29'))
check('en-GB date', S.formatDayGB('2026-10-12') === '12/10/2026')
check('price labels', S.priceLabel(sub({ price: 99 })) === '99 NOK / month' && S.priceLabel(sub({ price: 12.5, billing_cycle: 'yearly', currency: 'eur' })) === '12.50 EUR / year' && S.priceLabel(sub({ billing_cycle: 'free' })) === 'Free' && S.priceLabel(sub({})) === null)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
