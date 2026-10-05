// Verifies the Kobo-control pure modules: the settings catalogue and its checks,
// the menu order, the Kobo tab's views, captures and passage questions (sucrase, no test framework).
require('sucrase/register')
const cat = require('../src/features/books/koboSettingsCatalogue.ts')
const ks = require('../src/features/books/koboSettings.ts')
const sv = require('../src/features/books/kobo/settingsView.ts')
const mv = require('../src/features/books/kobo/menuView.ts')
const dv = require('../src/features/books/koboDevice.ts')
let n = 0
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1) } n++ }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`)

// ── catalogue invariants ──
const all = cat.SETTING_GROUPS.flatMap(g => g.settings)
ok(all.length > 300, `catalogue is large (${all.length})`)
eq(new Set(all.map(s => s.key)).size, all.length, 'keys are unique')
ok(all.every(s => /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$|^pt:[A-Za-z0-9_]+$/.test(s.key)), 'keys are plain, a.b or pt:x')
ok(all.every(s => s.type !== 'enum' || (s.options ?? []).length > 0), 'every enum has options')
ok(all.every(s => s.source && s.path && s.label), 'every entry has a source, path and label')
for (const risky of ['plugins_disabled', 'plugins_disable_external', 'language', 'screen_dpi', 'http_proxy', 'statistics.is_enabled', 'SSH_allow_no_password', 'frontlight_intensity', 'end_document_action'])
  ok(!all.some(s => s.key === risky), `risky key ${risky} left out`)
ok(all.find(s => s.key === 'screensaver_dir')?.managed === true, 'sleep folder is managed by the plugin')
ok(all.find(s => s.key === 'screensaver_type')?.options.some(o => o.value === 'bookshelf'), 'bookshelf mode offered')
ok(all.some(s => s.key.startsWith('footer.')), 'status bar fields included')
ok(all.some(s => s.key.startsWith('pt:')), 'Project: Title settings included')

// ── cleanSettings ──
const r = ks.cleanSettings({ screensaver_type: 'cover', auto_restore_wifi: true, bogus_key: 1, screensaver_dir: '/x', auto_suspend_timeout_seconds: 5, screensaver_show_message: 'yes' })
eq(r.settings, { screensaver_type: 'cover', auto_restore_wifi: true }, 'only valid catalogue values pass')
eq(r.refused.sort(), ['auto_suspend_timeout_seconds', 'bogus_key', 'screensaver_dir', 'screensaver_show_message'], 'refused: unknown, managed, out of range, wrong type')
eq(ks.cleanSettings({ screensaver_type: null }).settings, { screensaver_type: null }, 'null = back to default')
eq(ks.cleanSettings({ screensaver_type: 'evil' }).refused, ['screensaver_type'], 'enum value outside the options')
eq(ks.cleanSettings([1, 2]).settings, {}, 'array refused')

// ── menu order ──
eq(ks.cleanMenuOrder({ filemanager: { tools: ['lascisboard', 'x', 'x', '----------------------------', '----------------------------', 'bad id!'] }, other: {} }),
  { filemanager: { tools: ['lascisboard', 'x', '----------------------------'] } }, 'menu order cleaned (dupes, double separators, bad ids, unknown side)')
const order = { 'KOMenu:menu_buttons': ['setting', 'tools', 'main'], tools: ['a', 'lascisboard', 'b'], main: ['m1'] }
eq(ks.moveMenuItem(order, 'lascisboard', 'tools', 0), { tools: ['lascisboard', 'a', 'b'] }, 'to the top of its own tab')
eq(ks.moveMenuItem(order, 'lascisboard', 'main', 0), { tools: ['a', 'b'], main: ['lascisboard', 'm1'] }, 'to another tab: both lists change')
eq(ks.menuTabs({ order, labels: {} }), ['setting', 'tools', 'main'], 'tabs from the button list')
const vis = new Set(['a', 'b'])
eq(mv.stepItem(['a', 'hidden', 'b'], 2, -1, vis, 'b'), ['b', 'a', 'hidden'], 'up past a hidden item')
eq(mv.stepItem(['a', 'b'], 0, -1, vis, 'a'), null, 'top edge')
eq(mv.visibleItems(['a', 'ghost', '----------------------------'], { a: 'A' }, {}), ['a', '----------------------------'], 'items the Kobo does not have are hidden')
eq(mv.effectiveOrder({ order: { tools: ['a'], main: ['m'] }, labels: {} }, { tools: ['b'] }), { tools: ['b'], main: ['m'] }, 'owner lists over the Kobo lists')
eq(mv.listName('tools', {}), 'Tools (wrench)', 'tab name')
eq(mv.moveTargets({ ...order, more_tools: ['z'] }, { more_tools: 'More tools' }, ['setting', 'tools', 'main']).map(t => t.id), ['setting', 'tools', 'main', 'more_tools'], 'tabs then submenus')

// ── settings view ──
const def = all.find(s => s.key === 'auto_restore_wifi')
eq(sv.settingView(def, {}, undefined), { value: false, changed: false, pending: false, onKobo: null }, 'never reported: KOReader default')
eq(sv.settingView(def, { auto_restore_wifi: true }, {}), { value: true, changed: true, pending: true, onKobo: 'Off (default)' }, 'asked, Kobo still off (default)')
eq(sv.settingView(def, {}, { auto_restore_wifi: false }).onKobo, 'Off', 'set on the Kobo: no (default)')
eq(sv.settingView(def, { auto_restore_wifi: true }, { auto_restore_wifi: true }).pending, false, 'applied')
eq(sv.settingView(def, {}, { auto_restore_wifi: true }).value, true, 'shows what the Kobo has')
eq(sv.formatSeconds(900), '15 min', '15 min'); eq(sv.formatSeconds(259200), '3 days', '3 days'); eq(sv.formatSeconds(5400), '1 h 30 min', 'h + min')
ok(sv.matchesSetting(def, 'WI-FI'), 'search is case-insensitive')

// ── captures ──
eq(dv.cleanCaptures([{ id: 'kobo-1a-000001', kind: 'task', text: '  buy   milk ' }, { id: 'kobo-1a-000001', kind: 'task', text: 'dup' }, { id: 'x', kind: 'task', text: 'short id' }, { id: 'kobo-1a-000002', kind: 'note', text: 'bad kind' }]).length, 1, 'valid, unique captures only')
eq(dv.cleanCaptures([{ id: 'kobo-1a-000001', kind: 'task', text: '  buy   milk ' }])[0].text, 'buy milk', 'text tidied')
eq(dv.splitBookCapture('Sult — Knut Hamsun'), { title: 'Sult', author: 'Knut Hamsun' }, 'title — author')
eq(dv.splitBookCapture('Kongen av Os by Jo Nesbø'), { title: 'Kongen av Os', author: 'Jo Nesbø' }, 'title by author')
eq(dv.splitBookCapture('Snømannen'), { title: 'Snømannen', author: null }, 'title only')
ok(dv.captureNote({ note: 'a line', book: 'Sult' }).includes('“a line”') && dv.captureNote({ note: null, book: 'Sult' }).includes('Sult'), 'capture note names the book')

// ── ask ──
ok(typeof dv.cleanAsk({ ask: 'explain', selection: '' }) === 'string', 'no selection refused')
ok(typeof dv.cleanAsk({ ask: 'free', selection: 'x' }) === 'string', 'free question needs a question')
ok(typeof dv.cleanAsk({ ask: 'hack', selection: 'x' }) === 'string', 'unknown kind refused')
const a = dv.cleanAsk({ ask: 'translate', selection: 'Han var sulten.', percent: 140, answer_language: 'Klingon', title: 'Sult' })
eq([a.percent, a.answer_language], [100, 'Turkish'], 'percent capped, language falls back to Turkish')
const p = dv.buildAskPrompt({ ...a, percent: 42 })
ok(p.system.includes('Turkish') && p.system.includes('Never reveal'), 'system: language + no spoilers')
ok(p.user.includes('42% through') && p.user.includes('«Han var sulten.»'), 'user turn: position + selection')
eq(dv.cleanAnswer('**Hi**\n## x'), 'Hi\nx', 'markdown stripped')
eq(dv.cleanDeviceFacts({ battery: 57.4, charging: false, koreader_version: 'v2026.07.1' }), { battery: 57, charging: false, koreader_version: 'v2026.07.1' }, 'device facts')
eq(dv.cleanDeviceFacts({ battery: 140 }), {}, 'battery out of range dropped')
console.log(`verify-kobo-settings: ${n} assertions passed`)
