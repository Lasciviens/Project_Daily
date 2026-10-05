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
eq(mv.inside({ more_tools: ['sub'], sub: ['x'] }, 'more_tools', 'sub'), true, 'a submenu cannot move into its own child')
eq(mv.inside({ more_tools: ['sub'] }, 'more_tools', 'main'), false, 'another tab is fine')
eq(mv.moveTargets({ ...order, more_tools: ['z'] }, { more_tools: 'More tools' }, ['setting', 'tools', 'main']).map(t => t.id), ['setting', 'tools', 'main', 'more_tools'], 'tabs then submenus')

// ── settings view ──
const def = all.find(s => s.key === 'auto_restore_wifi')
eq(sv.settingView(def, {}, undefined), { value: false, changed: false, pending: false, onKobo: null }, 'never reported: KOReader default')
eq(sv.settingView(def, { auto_restore_wifi: true }, {}), { value: true, changed: true, pending: true, onKobo: 'Off (default)' }, 'asked, Kobo still off (default)')
eq(sv.settingView(def, {}, { auto_restore_wifi: false }).onKobo, 'Off', 'set on the Kobo: no (default)')
eq(sv.settingView(def, { auto_restore_wifi: true }, { auto_restore_wifi: true }).pending, false, 'applied')
eq(sv.settingView(def, {}, { auto_restore_wifi: true }).value, true, 'shows what the Kobo has')
eq(sv.formatSeconds(900), '15 min', '15 min'); eq(sv.formatSeconds(259200), '3 days', '3 days'); eq(sv.formatSeconds(5400), '1 h 30 min', 'h + min')
eq(sv.settingView(def, { auto_restore_wifi: null }, { auto_restore_wifi: true }), { value: false, changed: false, pending: true, onKobo: 'On' }, 'reset: waits until the Kobo drops its value')
eq(sv.settingView(def, { auto_restore_wifi: null }, {}).pending, false, 'reset done once the Kobo reports no value')
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
eq([a.percent, a.answer_language], [100, 'English'], 'percent capped, language falls back to English')
const p = dv.buildAskPrompt({ ...a, percent: 42 })
ok(p.system.includes('English') && p.system.includes('Never reveal'), 'system: language + no spoilers')
ok(p.user.includes('42% through') && p.user.includes('«Han var sulten.»'), 'user turn: position + selection')
eq(dv.cleanAnswer('**Hi**\n## x'), 'Hi\nx', 'markdown stripped')
eq(dv.cleanDeviceFacts({ battery: 57.4, charging: false, koreader_version: 'v2026.07.1' }), { battery: 57, charging: false, koreader_version: 'v2026.07.1' }, 'device facts')
eq(dv.cleanDeviceFacts({ battery: 140 }), {}, 'battery out of range dropped')

// ── round 3: plain help, areas, storage, menu report ──
const ar = require('../src/features/books/kobo/settingsAreas.ts')
const st = require('../src/features/books/kobo/storageView.ts')
ok(all.every(s => typeof s.help === 'string' && s.help.length > 20 && !/\.lua\b|:\d+\b|G_reader_settings|crengine|sidecar/.test(s.help)), 'every setting has plain help (no file names, line numbers or jargon)')
ok(all.every(s => s.level === 'basic' || s.level === 'advanced'), 'every setting has a level')
ok(all.filter(s => s.level === 'basic').length >= 60, 'a useful number of common settings')
ok(cat.SETTING_GROUPS.every(g => g.summary && g.affects), 'every section has a summary and what it affects')
eq(ar.unplacedGroups(cat.SETTING_GROUPS), [], 'every group sits in one area or the sleep section')
eq(new Set(ar.AREAS.flatMap(a => a.groups)).size, ar.AREAS.flatMap(a => a.groups).length, 'no group in two areas')
const none = () => false
const basic = ar.summarizeAreas(cat.SETTING_GROUPS, { query: '', level: 'basic', changedOnly: false }, none)
const every = ar.summarizeAreas(cat.SETTING_GROUPS, { query: '', level: 'all', changedOnly: false }, none)
ok(basic.every(a => a.shown <= a.total) && every.every(a => a.shown === a.total), 'Common shows a subset; All shows everything')
eq(every.reduce((t, a) => t + a.total, 0) + cat.SETTING_GROUPS.filter(g => ar.SLEEP_GROUPS.includes(g.id)).flatMap(g => g.settings).filter(s => !s.managed).length,
  all.filter(s => !s.managed).length, 'areas + sleep section cover every setting once')
const adv = all.find(s => s.level === 'advanced' && !ar.SLEEP_GROUPS.some(id => cat.SETTING_GROUPS.find(g => g.id === id).settings.includes(s)))
const withChanged = ar.summarizeAreas(cat.SETTING_GROUPS, { query: '', level: 'basic', changedOnly: false }, k => k === adv.key)
ok(withChanged.some(a => a.groups.some(g => g.settings.some(d => d.key === adv.key))), 'a changed advanced setting stays visible under Common')
const onlyChanged = ar.summarizeAreas(cat.SETTING_GROUPS, { query: '', level: 'all', changedOnly: true }, k => k === adv.key)
eq(onlyChanged.reduce((t, a) => t + a.shown, 0), 1, 'Changed by me shows exactly the changed one')
const search = ar.summarizeAreas(cat.SETTING_GROUPS, { query: 'battery', level: 'basic', changedOnly: false }, none)
ok(search.reduce((t, a) => t + a.shown, 0) > 0, 'search finds "battery" (advanced included while searching)')
ok(sv.matchesSetting(all.find(s => s.key === 'auto_restore_wifi'), 'reconnect'), 'search reads the plain label')
eq(cat.SETTING_GROUPS.flatMap(g => g.settings).find(s => s.key === 'txt_preformatted').absent, 'lines as written', 'txt_preformatted default corrected from the source')
ok(!all.some(s => ['custom_screen_dpi', 'kopt_detect_indent', 'notification_sources_to_show_mask', 'pt:show_progress_in_mosaic'].includes(s.key)), 'settings that do nothing are left out')

const GB = 1024 ** 3
const books = [
  { kind: 'book', on_device: true, file_size: 2 * 1024 ** 2 }, { kind: 'book', on_device: true, file_size: null },
  { kind: 'news', on_device: true, file_size: 1024 ** 2 }, { kind: 'book', on_device: false, file_size: 5 * 1024 ** 2 },
]
const sb = st.storageBreakdown({ storage_total: 16 * GB, storage_free: 12 * GB, storage_at: 'x' }, books)
eq([sb.used, sb.books, sb.news, sb.unsized], [4 * GB, 2 * 1024 ** 2, 1024 ** 2, 1], 'storage: used, books and news on the Kobo only, unsized counted')
eq(sb.other, 4 * GB - 3 * 1024 ** 2, 'other = used minus counted files')
eq(st.storageBreakdown({ storage_total: 10, storage_free: 20 }, []), null, 'free above total → no card')
eq(st.storageBreakdown(null, []), null, 'nothing reported → no card')
eq([st.formatBytes(1.5 * GB), st.formatBytes(12.34 * GB), st.formatBytes(312 * 1024 ** 2), st.formatBytes(2.5 * 1024 ** 2)], ['1.50 GB', '12.3 GB', '312 MB', '2.5 MB'], 'byte format')
eq(dv.cleanDeviceFacts({ storage_total: 16 * GB, storage_free: 3 * GB }, 'now'), { storage_total: 16 * GB, storage_free: 3 * GB, storage_at: 'now' }, 'storage facts kept')
eq(dv.cleanDeviceFacts({ storage_total: 10, storage_free: 11 }), {}, 'free above total dropped')

const SEP = ks.MENU_SEPARATOR
const order3 = { navi: [SEP, 'toc', SEP, SEP, 'hidden', SEP, 'bookmarks', SEP], toc: [] }
const labels3 = { toc: 'Table of contents', bookmarks: 'Bookmarks' }
eq(mv.rowsToShow(order3.navi, labels3, order3).map(r => r.id), ['toc', SEP, 'bookmarks'], 'separators only between shown items')
eq(mv.rowsToShow(order3.navi, labels3, order3).map(r => r.index), [1, 2, 6], 'rows keep their real index')
ok(mv.labelCoverage(['navi'], { toc: 'Table of contents' }, order3) < mv.MIN_LABEL_COVERAGE, 'a report missing names reads as incomplete (1 of 3 named)')
ok(mv.labelCoverage(['navi'], { ...labels3, hidden: 'Hidden' }, order3) >= mv.MIN_LABEL_COVERAGE, 'a full report reads as complete')
console.log(`verify-kobo-settings: ${n} assertions passed`)
