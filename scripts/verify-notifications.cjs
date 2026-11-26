#!/usr/bin/env node
/* Verification — notifications (migration 212, docs/features/notifications.md), the app's side: the registry's words
 * and addresses (notificationKinds.ts, copied verbatim into push-send), the check every row passes before it shows
 * (notificationsApi.noticeFromRow), the Claude key's end day (keyExpiry.ts, the same days verify-db-notifications
 * checks in SQL), the producers in the sync functions, push-send's notifications path, and one shared list for the
 * bell's drop-down and the page. The database side: verify-db-notifications.mjs.
 * Run: node scripts/verify-notifications.cjs */
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const Module = require('module')
const origLoad = Module._load
Module._load = function (request) {
  if (/integrations\/supabase\/client$/.test(request)) return { supabase: {} }
  if (/shared\/utils\/requireUser$/.test(request)) return { requireUser: async () => ({ id: 'u' }) }
  return origLoad.apply(this, arguments)
}
const root = path.join(__dirname, '..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8')
const K = require('../src/features/notifications/notificationKinds.ts')
const A = require('../src/features/notifications/api/notificationsApi.ts')
const E = require('../src/features/notifications/keyExpiry.ts')

let ok = 0, bad = 0
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) { ok++; console.log(`  ✓ ${name}`) } else { bad++; console.log(`  ✗ ${name}\n      got      ${a}\n      expected ${e}`) }
}

console.log('the registry')
const today = '2026-11-26'
const f = (kind, extra = {}) => ({ kind, service: null, due_on: null, subject: null, ...extra })
check('a sign-in that ends: the service, and when in plain words',
  [K.noticeTitle(f('sign_in_expiring', { service: 'psn', due_on: '2026-12-10' }), today), K.noticeTitle(f('sign_in_expiring', { service: 'psn', due_on: '2026-11-27' }), today),
    K.noticeTitle(f('sign_in_expiring', { service: 'psn', due_on: '2026-11-26' }), today)],
  ['PlayStation sign-in ends in 14 days', 'PlayStation sign-in ends tomorrow', 'PlayStation sign-in ends today'])
check('a passed end day says its date (DD.MM.YYYY)', K.noticeWhen(today, '2026-11-20'), 'on 20.11.2026')
check('the key and the failures', [K.noticeTitle(f('claude_key_expiring', { service: 'anthropic', due_on: '2026-12-03' }), today),
  K.noticeTitle(f('sign_in_failed', { service: 'icloud' }), today), K.noticeTitle(f('claude_key_rejected', { service: 'anthropic' }), today)],
  ['Claude API key ends in 7 days', 'Apple Calendar needs you to sign in again', 'Anthropic rejected the Claude API key'])
check('the second line: the thing\'s name, else what to do', [K.noticeDetail(f('follow_new_title', { subject: 'Dune' })), K.noticeDetail(f('sign_in_failed', { service: 'trakt' })),
  K.noticeDetail(f('claude_key_expiring', { due_on: '2026-12-03' }))],
  ['Dune', 'Connect it again in Settings → Subscriptions', 'Ends 03.12.2026 · make a new key in the Anthropic Console'])
check('each kind leads to a fixed address (never one from the row)', K.NOTICE_KINDS.map(k => K.noticeRoute({ kind: k.kind })),
  ['/settings?tab=subscriptions', '/settings?tab=subscriptions', '/settings?tab=subscriptions', '/settings?tab=subscriptions', '/shop', '/media?view=lists', '/media?view=lists'])
check('noticeRoute reads only the kind', /export function noticeRoute\(n: Pick<NoticeFacts, 'kind'>\)/.test(read('src/features/notifications/notificationKinds.ts')), true)
const one = K.noticePush([f('sign_in_failed', { service: 'strava' })], 'now', today)
check('one notice: its own push, to its own page', one, { title: '🔔 Strava needs you to sign in again', body: 'Connect it again in Settings → Subscriptions', url: '#/settings?tab=subscriptions', tag: 'notifications' })
const many = K.noticePush([f('follow_new_title', { subject: 'A' }), f('follow_trailer', { subject: 'B' }), f('sign_in_failed', { service: 'google' }),
  f('shop_bought_draft', { subject: 'C' }), f('follow_new_title', { subject: 'D' })], 'weekly', today)
check('several: one push with the first four and a count, to the Notifications page', [many.title, many.url, many.tag, /\+1 more$/.test(many.body)],
  ['🔔 This week: 5 notifications', '#/notifications', 'notifications-weekly', true])
check('none: no push', K.noticePush([], 'now', today), null)
check('the morning line: two titles and a count, or nothing', [K.noticeMorningLine([], today), K.noticeMorningLine([f('sign_in_failed', { service: 'trakt' }), f('claude_key_rejected'), f('follow_trailer')], today)],
  ['', ' · 🔔 Trakt needs you to sign in again, Anthropic rejected the Claude API key +1'])
check('every kind has a channel the database knows', K.NOTICE_KINDS.every(k => K.isNoticeChannel(k.defaultChannel)), true)

console.log('every row is checked before it shows')
const row = { id: '11111111-1111-1111-1111-111111111111', kind: 'follow_new_title', link_kind: 'media_follow_event', link_id: '22222222-2222-2222-2222-222222222222',
  service: null, due_on: null, created_at: '2026-11-26T08:00:00Z', read_at: null, acted_at: null, subject: 'Dune', subject_tmdb: 693134 }
check('a good row shows', A.noticeFromRow(row)?.subject_tmdb, 693134)
check('an unknown kind, a service outside the list, a link without an id, a wrong day: left out',
  [A.noticeFromRow({ ...row, kind: 'phishing' }), A.noticeFromRow({ ...row, service: 'https://evil.example' }), A.noticeFromRow({ ...row, link_id: 'javascript:alert(1)' }),
    A.noticeFromRow({ ...row, due_on: '10.12.2026' }), A.noticeFromRow({ ...row, link_kind: 'url' })], [null, null, null, null, null])
check('a long name is cut, a TMDB id must be a whole number', [A.noticeFromRow({ ...row, subject: 'x'.repeat(500) })?.subject.length, A.noticeFromRow({ ...row, subject_tmdb: '1;drop' })?.subject_tmdb],
  [300, null])

console.log('the Claude key\'s end day (the same days as the SQL scenarios)')
check('31.01 + 1 month, + 90 days, a leap February', [E.keyEndDay('2026-01-31', 1, 'months'), E.keyEndDay('2026-01-31', 90, 'days'), E.keyEndDay('2028-01-31', 1, 'months'), E.keyEndDay('2026-11-01', 40, 'days')],
  ['2026-02-28', '2026-05-01', '2028-02-29', '2026-12-11'])
check('12 months across a year; out of range or not a day: none', [E.keyEndDay('2026-11-26', 12, 'months'), E.keyEndDay('2026-11-26', 121, 'months'), E.keyEndDay('2026-11-26', 0, 'days'), E.keyEndDay('2026-02-30', 1, 'days')],
  ['2027-11-26', null, null, null])
check('the last 4: 4 key characters, nothing, or refused', [E.keyHint('Ab3_'), E.keyHint('  '), E.keyHint('sk-ant-api03'), E.keyHint('a b!')], ['Ab3_', null, undefined, undefined])

console.log('the producers')
const producers = [['trakt-api', 'trakt'], ['strava-activities', 'strava'], ['google-tasks-sync', 'google'], ['calendar-token', 'google'], ['icloud-calendar', 'icloud']]
check('each sync function tells the database which service refused its sign-in (a code, never text)',
  producers.map(([fn, svc]) => new RegExp(`rpc\\('notify_service_problem', \\{ p_user: userId, p_service: '${svc}' \\}\\)`).test(read(`supabase/functions/${fn}/index.ts`))
    && /await notifySignInFailed\(/.test(read(`supabase/functions/${fn}/index.ts`))), producers.map(() => true))

console.log('push-send')
const block = s => (s.match(/\/\/ <notification-text>\n([\s\S]*?)\/\/ <\/notification-text>/) || [])[1]
const pushSend = read('supabase/functions/push-send/index.ts')
check('push-send carries notificationKinds.ts\'s block verbatim', !!block(pushSend) && block(pushSend) === block(read('src/features/notifications/notificationKinds.ts')), true)
check('the notifications path is the cron\'s only, claims, sends one push, puts the stamps back when no device took it',
  [/body\.trigger === 'notifications'\) \{\n\s+if \(!viaCron\) return json\(\{ ok: false, error: 'forbidden' \}, 403\)/.test(pushSend), /rpc\('notifications_claim'/.test(pushSend),
    /res = await sendToAll\(userId, msg\)/.test(pushSend), /if \(res\.sent === 0 && res\.devices > 0\) await unclaimNotices\(userId, items, stamp\)/.test(pushSend)], [true, true, true, true])
check('the morning push carries the morning notices as one line (claimed only on the cron\'s run)',
  [/body\.trigger === 'morning' && viaCron \? await claimNotices\(userId, 'push_morning', morningStamp\)/.test(pushSend), /buildMorning\(userId, noticeMorningLine\(morningNotices, osloToday\(\)\)\)/.test(pushSend),
    /\$\{suppLine\}\$\{noticeLine\}/.test(pushSend)], [true, true, true])

console.log('one list, every way in')
const list = read('src/features/notifications/components/NotificationList.tsx')
check('the bell\'s drop-down and the page render the one NotificationList',
  [/<NotificationList mode="dropdown"/.test(read('src/features/notifications/components/NotificationBell.tsx')), /<NotificationList mode="page"/.test(read('src/features/notifications/pages/NotificationsPage.tsx')),
    /export function NotificationList\(/.test(list)], [true, true, true])
check('the bell sits next to the avatar in the top bar and the phone header',
  ['src/app/shell/AppTopBar.tsx', 'src/app/shell/MobileHeader.tsx'].map(p => /<NotificationBell look="(bar|header)" \/>\n\s+<SettingsMenu \/>/.test(read(p))), [true, true])
check('/notifications is a page of the registry and a lazy page', [/path: '\/notifications'/.test(read('src/app/navigation.ts')), /NotificationsPage = lazyPage\(/.test(read('src/app/pages.ts')),
  /path="\/notifications"/.test(read('src/app/router.tsx'))], [true, true, true])
check('a notice opens its thing by the kind\'s fixed way (a popup by id, else noticeRoute) — never an address from the row',
  [/navigate\(noticeRoute\(n\)\)/.test(list), !/href=\{n\./.test(list), !/navigate\(n\./.test(list)], [true, true, true])
check('the Claude key\'s dates sit on the Anthropic card (connections live in one place)', /<ClaudeKeyDates \/>/.test(read('src/features/developer/components/ConnectionsTab.tsx')), true)

console.log(`\n${ok} passed, ${bad} failed`)
process.exit(bad ? 1 : 0)
