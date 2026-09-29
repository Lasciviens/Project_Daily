#!/usr/bin/env node
/*
 * Verification — the requests backlog's pure logic:
 *   devRequestContext.ts  (picked-element / page-context blocks, description preview)
 *   devRequestRules.ts    (draft read-back from localStorage, drag-reorder plan)
 *   devRequestPrompt.ts   (the prompt for Claude)
 *   useFloatingWindow.ts  (keeping the composer window on screen)
 *   numberedList.ts       (the description's "1- " numbered points)
 *   pick/componentSourceTransform.ts (the build-time data-src stamps)
 * Against the REAL un-mocked modules via sucrase (no unit-test runner by convention).
 *
 * Run: node scripts/verify-dev-request-context.cjs
 */
require('sucrase/register')

const ctx = require('../src/features/devRequests/devRequestContext')
const rules = require('../src/features/devRequests/devRequestRules')
const { buildClaudePrompt } = require('../src/features/devRequests/devRequestPrompt')
const win = require('../src/shared/hooks/useFloatingWindow')
const list = require('../src/features/devRequests/numberedList')
const stamps = require('../src/features/devRequests/pick/componentSourceTransform')
const ts = require('typescript')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

const page = {
  route: '/recipes?tab=today', pageTitle: 'Food', heading: 'Food', viewport: { w: 1469, h: 680 },
  breakpoint: 'desktop', theme: 'light', tabs: ['Today'], popups: [], build: 'index-AbC123.js', at: '2026-09-28T12:05:00.000Z',
}

console.log('\n1 · Text helpers')
check('collapses whitespace', ctx.cleanText('  a \n\t b  ') === 'a b')
check('cuts with an ellipsis', ctx.cleanText('abcdefghij', 5) === 'abcd…')
check('null → empty', ctx.cleanText(null) === '')
check('route label', ctx.routeLabel(page) === 'Food · /recipes?tab=today')
check('route label without a page name', ctx.routeLabel({ route: '/x', pageTitle: '' }) === '/x')
check('screen label', ctx.screenLabel(page) === '1469×680, desktop, light theme')
check('element label uses role and name', ctx.elementLabel({ tag: 'button', role: 'tab', name: 'Week' }) === 'tab "Week"')
check('element label falls back to text', ctx.elementLabel({ tag: 'div', role: null, name: null, text: 'Hello' }) === 'div "Hello"')
check('element label bare tag', ctx.elementLabel({ tag: 'svg' }) === 'svg')
check('stamp is en-GB day-first', /^\d{2}\/09\/2026 \d{2}:05$/.test(ctx.formatStamp(page.at)), ctx.formatStamp(page.at))
check('bad stamp → empty', ctx.formatStamp('nope') === '' && ctx.formatStamp(null) === '')

console.log('\n2 · Picked element block')
const element = {
  tag: 'button', role: 'button', name: 'Log food', text: 'Log food 420 kcal', value: null,
  trail: ['"Nutrition" card', 'row "Lunch"'], area: 'page', tabs: ['Today'],
  data: [['tone', 'warn'], ['status', '']], rect: { x: 1043.4, y: 212.6, w: 120, h: 36 }, components: [],
}
const block = ctx.formatCapture({ kind: 'element', page, element })
const lines = block.split('\n')
check('header names page and route', lines[0] === '[Picked on Food · /recipes?tab=today]', lines[0])
check('header matches the block pattern', ctx.BLOCK_HEADER_RE.test(lines[0]))
check('element line', lines.includes('Element: button "Log food"'))
check('where = area › trail', lines.includes('Where: page › "Nutrition" card › row "Lunch"'))
check('text line when it adds something', lines.includes('Text: "Log food 420 kcal"'))
check('selected tabs', lines.includes('Selected: Today'))
check('empty data values dropped', lines.includes('Data: tone=warn'))
check('box rounded with screen', lines.includes('Box: x 1043, y 213, 120×36 px on 1469×680, desktop, light theme'))
check('no components line when empty', !block.includes('Components'))
{
  const same = ctx.formatCapture({ kind: 'element', page, element: { tag: 'button', name: 'Save', text: 'Save' } })
  check('no Text line when it repeats the name', !same.includes('Text:'))
  const dev = ctx.formatCapture({ kind: 'element', page, element: { tag: 'div' } })
  check('no dev-only components line any more', !dev.includes('Components'))
  const val = ctx.formatCapture({ kind: 'element', page, element: { tag: 'select', role: 'dropdown', name: 'Priority', value: 'high' } })
  check('form control value', val.includes('Value: "high"'))
}

console.log('\n3 · Quoted selection and bare blocks')
{
  const q = ctx.formatCapture({ kind: 'selection', page, quote: '  Remaining   protein 42 g ', element: { tag: 'p', trail: ['"Nutrition" card'], area: 'page' } })
  check('selection header', q.startsWith('[Picked text on Food · /recipes?tab=today]'))
  check('quote cleaned', q.includes('Quote: "Remaining protein 42 g"'))
  check('selection keeps where', q.includes('Where: page › "Nutrition" card'))
  check('selection has no Element line', !q.includes('Element:'))
  const bare = ctx.formatCapture({ kind: 'element', page, element: null })
  check('no element → screen line', bare.includes('Screen: 1469×680, desktop, light theme'))
}

console.log('\n4 · Page context block')
{
  const saved = { ...page, route: '/training', pageTitle: 'Training' }
  const pc = ctx.formatPageContext({ ...page, popups: ['Log food'], heading: 'Monday 28 September' }, saved)
  const pl = pc.split('\n')
  check('header', pl[0] === '[Page context]')
  check('page line', pl.includes('Page: Food · /recipes?tab=today'))
  check('heading when it differs from the name', pl.includes('Heading: Monday 28 September'))
  check('selected tabs', pl.includes('Selected tabs: Today'))
  check('open popup', pl.includes('Open popup: Log food'))
  check('saved-on only when the route differs', pl.includes('Saved on: Training · /training'))
  check('build', pl.includes('Build: index-AbC123.js'))
  check('started stamp', pl.some(l => l.startsWith('Started: ')))
  const same = ctx.formatPageContext(page, page)
  check('no heading when equal to the name', !same.includes('Heading:'))
  check('no saved-on on the same route', !same.includes('Saved on'))
}

console.log('\n5 · Appending and splitting a description')
check('append to empty = block only', ctx.appendBlock('', '[Page context]\nPage: x') === '[Page context]\nPage: x')
check('append after a blank line', ctx.appendBlock('Broken chart\n\n', 'B') === 'Broken chart\n\nB')
check('blank block is a no-op', ctx.appendBlock('A', '  ') === 'A')
{
  const text = ctx.appendBlock(ctx.appendBlock('The chart gridlines\nare too bright', block), ctx.formatPageContext(page))
  const s = ctx.splitDescription(text)
  check('body is the user prose', s.body === 'The chart gridlines\nare too bright')
  check('two blocks', s.blocks.length === 2, String(s.blocks.length))
  check('blocks start with their header', s.blocks[0].startsWith('[Picked on') && s.blocks[1].startsWith('[Page context]'))
  check('count blocks', ctx.countBlocks(text) === 2)
  check('preview = prose, one line', ctx.descriptionPreview(text) === 'The chart gridlines are too bright')
  check('preview from a pick when there is no prose', ctx.descriptionPreview(block) === 'Picked: button "Log food"')
  check('preview empty for nothing', ctx.descriptionPreview(null) === '' && ctx.descriptionPreview('[Page context]\nPage: x') === '')
  check('plain text has no blocks', ctx.splitDescription('Just words').blocks.length === 0)
  check('a bracket mid-sentence is prose', ctx.splitDescription('See [Picked] later').blocks.length === 0)
  check('preview truncates', ctx.descriptionPreview('x'.repeat(300), 20).length === 20)
}

console.log('\n6 · Drafts read back from localStorage')
{
  const d = rules.sanitizeDraftState(null)
  check('garbage → defaults', d.composer.open === false && d.newDraft.title === '' && d.drawer.sortMode === 'manual')
  check('defaults are a copy', d !== rules.DEFAULT_STATE && d.newDraft !== rules.DEFAULT_STATE.newDraft)
  const s = rules.sanitizeDraftState({
    newDraft: { title: 'Half written', description: 'details', category: 'nonsense', priority: 'high', effort: 'huge', page: '/daily', start: { route: '/daily', pageTitle: 'Personal', viewport: { w: 393, h: 852 }, theme: 'dark', tabs: ['Today', 7] } },
    editDrafts: { r1: { title: 'Edited', description: 'x', category: 'bug', priority: 'low', effort: 'small', page: 'home', baseUpdatedAt: 't' }, r2: 'junk' },
    composer: { open: true, minimized: true, tab: 'prompt', target: { kind: 'edit', id: 'r1' }, pos: { x: 10, y: NaN } },
    drawer: { categories: ['bug', 'bug', 'nope'], sortMode: 'priority', showDone: true, editingId: '', picked: ['a', 'a', 5, 'b'] },
    prompt: { ids: ['a'], text: 'Please…', edited: true },
  })
  check('typed text survives', s.newDraft.title === 'Half written' && s.newDraft.description === 'details')
  check('bad category → default, good priority kept', s.newDraft.category === 'feature' && s.newDraft.priority === 'high')
  check('bad effort → none', s.newDraft.effort === '')
  check('start context kept, non-string tabs dropped', s.newDraft.start && s.newDraft.start.route === '/daily' && s.newDraft.start.tabs.length === 1)
  check('attach context defaults on', s.newDraft.attachContext === true)
  check('valid edit draft kept, junk dropped', s.editDrafts.r1 && s.editDrafts.r1.title === 'Edited' && !('r2' in s.editDrafts))
  check('legacy page value kept as-is', s.editDrafts.r1.page === 'home')
  check('composer target + tab', s.composer.target.kind === 'edit' && s.composer.target.id === 'r1' && s.composer.tab === 'prompt')
  check('NaN position → default corner', s.composer.pos === null)
  check('categories deduped and validated', s.drawer.categories.length === 1 && s.drawer.categories[0] === 'bug')
  check('retired drawer fields are not read back', !('editingId' in s.drawer) && !('selecting' in s.drawer) && !('newFormOpen' in s.drawer))
  check('picked deduped, non-strings dropped', JSON.stringify(s.drawer.picked) === '["a","b"]')
  check('edited prompt kept', s.prompt.edited && s.prompt.text === 'Please…')
}

console.log('\n7 · Draft helpers')
{
  const row = { title: 'T', description: null, page: null, category: 'bug', priority: 'high', effort: null, updated_at: 'u' }
  const seed = rules.draftFromRow(row)
  check('row → draft', seed.description === '' && seed.page === 'other' && seed.effort === '' && seed.baseUpdatedAt === 'u')
  check('same fields ignores edge whitespace', rules.sameFields(seed, { ...seed, title: ' T ' }))
  check('different priority is a change', !rules.sameFields(seed, { ...seed, priority: 'low' }))
  check('empty draft', rules.isDraftEmpty({ title: ' ', description: '\n' }))
  check('a title makes it non-empty', !rules.isDraftEmpty({ title: 'x', description: '' }))
}

console.log('\n8 · Drag reorder keeps hidden rows (the optimistic-update bug)')
{
  // a, b, d are open and visible; c is done, e is filtered out. All start at 0 (never reordered).
  const all = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, sort_order: 0 }))
  const changes = rules.planReorder(all, ['d', 'a', 'b'])
  const next = rules.applyReorder(all, changes)
  check('every row stays in the list', next.length === 5 && ['a', 'b', 'c', 'd', 'e'].every(id => next.some(r => r.id === id)))
  check('visible rows take the new order in their old slots', next.map(r => r.id).join('') === 'dacbe', next.map(r => r.id).join(''))
  check('numbers are unique 0..n-1', next.map(r => r.sort_order).join(',') === '0,1,2,3,4')
  check('only changed rows are written', changes.length === 4 && !changes.some(c => c.id === 'd'))
  const again = rules.planReorder(next, ['d', 'a', 'b'])
  check('the same order again writes nothing', again.length === 0)
  const unknown = rules.planReorder(next, ['zzz', 'a'])
  check('an id not in the list is ignored', rules.applyReorder(next, unknown).length === 5)
  check('new request goes above the top', rules.topSortOrder(next) === -1 && rules.topSortOrder([]) === 0)
}

console.log('\n9 · Prompt for Claude')
{
  const text = ctx.appendBlock('Gridlines too bright', block)
  const p = buildClaudePrompt([
    { title: 'Low one', description: null, page: 'other', category: 'feature', priority: 'low' },
    { title: 'Urgent one', description: text, page: '/training', category: 'bug', priority: 'urgent', effort: 'small' },
  ])
  check('urgent first', p.indexOf('Urgent one') < p.indexOf('Low one'))
  check('picked context travels with the description', p.includes('[Picked on Food · /recipes?tab=today]'))
  check('meta line', p.includes('(bug · urgent priority · effort small · page /training)'))
  check('"other" page left out', !p.includes('page other'))
  check('empty list → empty prompt', buildClaudePrompt([]) === '')
  check('a blank line between items', /\n\n2\. \*\*Low one/.test(p))
  check('paragraphs stay apart, indented', p.includes('   Gridlines too bright\n\n   [Picked on Food'))
  check('captured blocks are explained', p.includes('were captured from the live page'))
  const plain = buildClaudePrompt([{ title: 'A', description: 'words', page: null, category: 'bug', priority: 'low' }])
  check('no explanation without captured blocks', !plain.includes('captured from the live page'))
}

console.log('\n10 · Floating window stays on screen')
{
  const vp = { w: 1469, h: 680 }, size = { w: 416, h: 500 }
  const c = win.cornerPosition(size, vp)
  check('default corner', c.x === 1469 - 416 - 24 && c.y === 680 - 500 - 24, JSON.stringify(c))
  check('dragged past the right edge is pulled back', win.clampPosition({ x: 5000, y: 100 }, size, vp).x === 1469 - 416 - 8)
  check('dragged above the top is pulled back', win.clampPosition({ x: 100, y: -300 }, size, vp).y === 8)
  check('window taller than the screen sits at the margin', win.clampPosition({ x: 0, y: 300 }, { w: 416, h: 900 }, vp).y === 8)
  check('fractions rounded', Number.isInteger(win.clampPosition({ x: 100.4, y: 100.6 }, size, vp).x))
  check('Alt+Arrow nudge', JSON.stringify(win.nudgeFor('ArrowLeft', false)) === '{"x":-16,"y":0}' && win.nudgeFor('ArrowDown', true).y === 64)
  check('other keys do nothing', win.nudgeFor('a', false) === null)
}

console.log('\n11 · Where line says each part once')
check('unnamed sidebar not repeated', JSON.stringify(ctx.whereParts('sidebar', ['sidebar', 'Main navigation'])) === '["sidebar","Main navigation"]')
check('"Main navigation" already names the area', JSON.stringify(ctx.whereParts('navigation', ['Main navigation'])) === '["Main navigation"]')
check('ordinary trail keeps the area', JSON.stringify(ctx.whereParts('page', ['"Nutrition" card'])) === '["page","\\"Nutrition\\" card"]')
check('no area, no trail → nothing', ctx.whereParts('', []).length === 0)
check('duplicates in the trail dropped', ctx.whereParts('page', ['"A"', '"A"']).length === 2)
{
  const block = ctx.formatCapture({ kind: 'element', page, element: { tag: 'a', role: 'link', name: 'Training', area: 'sidebar', trail: ['sidebar', 'Main navigation'] } })
  check('sidebar pick reads cleanly', block.includes('Where: sidebar › Main navigation') && !block.includes('sidebar › sidebar'), block)
}

console.log('\n12 · Two tabs, one draft (newer change wins)')
{
  const base = rules.sanitizeDraftState(null)
  const withNew = (text, t) => ({ ...base, newDraft: { ...base.newDraft, title: text, touchedAt: t } })
  const typedA = withNew('Typed in tab A', 2000)
  const staleB = { ...withNew('', 0), drawer: { ...base.drawer, sortMode: 'priority' } }
  const m1 = rules.mergeDraftContent(typedA, staleB)
  check('an older copy from another tab never replaces typed text', m1 === typedA && m1.newDraft.title === 'Typed in tab A')
  check('…and the tab knows the stored copy is behind', !rules.sameDraftContent(typedA, staleB))
  const m2 = rules.mergeDraftContent(staleB, typedA)
  check('the stale tab takes the newer text', m2 !== staleB && m2.newDraft.title === 'Typed in tab A')
  const reset = withNew('', 3000)
  check('a reset after a save wins over the older text', rules.mergeDraftContent(typedA, reset).newDraft.title === '')
  check('nothing new → same object (no write loop)', rules.mergeDraftContent(typedA, typedA) === typedA)
  const edit = (title, t) => ({ title, description: '', page: 'other', category: 'bug', priority: 'low', effort: '', baseUpdatedAt: 'x', touchedAt: t })
  const a = { ...base, editDrafts: { r1: edit('A edit', 1000) } }
  const cleared = { ...base, clearedEdits: { r1: 1500 } }
  check('a clear after the edit removes it in the other tab', !('r1' in rules.mergeDraftContent(a, cleared).editDrafts) && rules.mergeDraftContent(a, cleared).clearedEdits.r1 === 1500)
  const later = { ...base, editDrafts: { r1: edit('Edited again', 2000) } }
  check('an edit after the clear survives it', rules.mergeDraftContent(cleared, later).editDrafts.r1.title === 'Edited again')
  const legacy = { ...base, editDrafts: { r2: edit('From before stamps', 0) } }
  check('an unstamped (older-version) draft is kept', rules.mergeDraftContent(legacy, base).editDrafts.r2.title === 'From before stamps')
  const both = rules.mergeDraftContent({ ...base, editDrafts: { r1: edit('old', 100) } }, { ...base, editDrafts: { r1: edit('new', 200), r3: edit('other', 50) } })
  check('per request the later edit wins, the rest are joined', both.editDrafts.r1.title === 'new' && both.editDrafts.r3.title === 'other')
  const p1 = { ...base, prompt: { ids: ['a'], text: 'mine', edited: true, touchedAt: 900 } }
  check('the edited prompt follows the same rule', rules.mergeDraftContent(base, p1).prompt.text === 'mine' && rules.mergeDraftContent(p1, base).prompt.text === 'mine')
}

console.log('\n13 · Stored drafts: stamps, tombstones, newest kept')
{
  const many = {}
  for (let i = 0; i < 60; i++) many[`r${i}`] = { title: `t${i}`, touchedAt: i + 1 }
  const s = rules.sanitizeDraftState({ editDrafts: many, clearedEdits: { gone: 123, bad: 'x', zero: 0 } })
  const keys = Object.keys(s.editDrafts)
  check('keeps the 50 most recently touched edits', keys.length === rules.MAX_EDIT_DRAFTS && !('r0' in s.editDrafts) && !('r9' in s.editDrafts) && 'r10' in s.editDrafts && 'r59' in s.editDrafts, keys.slice(0, 3).join())
  check('stamps read back', s.editDrafts.r59.touchedAt === 60)
  check('tombstones read back, junk dropped', s.clearedEdits.gone === 123 && !('bad' in s.clearedEdits) && !('zero' in s.clearedEdits))
  const d = rules.sanitizeDraftState({ newDraft: { title: 'x', touchedAt: 'soon' }, prompt: { text: 'p', touchedAt: 7 } })
  check('a bad stamp reads as 0, a good one is kept', d.newDraft.touchedAt === 0 && d.prompt.touchedAt === 7)
  check('a seed from the saved row carries no stamp', rules.draftFromRow({ title: 'A', description: null, page: null, category: 'bug', priority: 'low', effort: null, updated_at: 'u' }).touchedAt === 0)
}

console.log('\n14 · Edit drafts of deleted requests')
{
  const e = (t) => ({ title: 'x', description: '', page: 'other', category: 'bug', priority: 'low', effort: '', baseUpdatedAt: '', touchedAt: t })
  const drafts = { kept: e(10), gone: e(10), newer: e(5000) }
  const orphans = rules.orphanEditDrafts(drafts, ['kept'], 1000)
  check('a draft for a missing request is an orphan', orphans.includes('gone'))
  check('a draft for an existing request is not', !orphans.includes('kept'))
  check('a draft touched after the list was read may be for a new request — kept', !orphans.includes('newer'))
}

console.log('\n15 · Picks name the component (data-src stamps)')
{
  const chain = [
    'src/shared/ui/Button.tsx#Button',
    'src/features/daily/components/summary/NutritionCard.tsx#NutritionCard',
    'src/shared/ui/Card.tsx#Card',
    'src/features/daily/components/summary/TodaySummary.tsx#TodaySummary',
    'src/features/daily/pages/DailyPage.tsx#DailyPage',
    'src/app/shell/AppShell.tsx#AppShell',
  ]
  const sum = ctx.summarizeSources(chain)
  check('skips the shared primitive for the name', sum.name === 'NutritionCard' && sum.file === 'src/features/daily/components/summary/NutritionCard.tsx')
  check('says which primitive it was inside', sum.via === 'Button')
  check('the next component out, primitives skipped', JSON.stringify(sum.inside) === '["TodaySummary"]')
  check('only primitives → the innermost one', ctx.summarizeSources(['src/shared/ui/Card.tsx#Card']).name === 'Card')
  check('no stamps → null', ctx.summarizeSources([]) === null && ctx.summarizeSources(undefined) === null && ctx.summarizeSources(['junk']) === null)
  const pick = ctx.formatCapture({ kind: 'element', page, element: { ...element, sources: chain } })
  const pl = pick.split('\n')
  check('component line leads, right after the header', pl[1] === 'Component: NutritionCard (src/features/daily/components/summary/NutritionCard.tsx) · via Button · inside TodaySummary', pl[1])
  check('element label and short text kept', pl.includes('Element: button "Log food"') && pl.includes('Text: "Log food 420 kcal"'))
  check('box, data and where dropped when the component is known', !pick.includes('Box:') && !pick.includes('Data:') && !pick.includes('Where:'))
  check('shorter than the fallback block', pick.length < block.length, `${pick.length} vs ${block.length}`)
  const long = ctx.formatCapture({ kind: 'element', page, element: { tag: 'p', text: 'x'.repeat(200), sources: chain } })
  check('text cut short', /Text: "x{79}…"/.test(long))
  const q = ctx.formatCapture({ kind: 'selection', page, quote: 'Hi', element: { tag: 'p', sources: chain } })
  check('a quote names the component too', q.split('\n')[1].startsWith('Component: NutritionCard'))
}

console.log('\n16 · The build-time stamp transform')
{
  const src = [
    "import { Card } from '../ui/Card'",
    "import { Dialog } from '@headlessui/react'",
    "export function Alpha({ x }: { x: boolean }) {",
    "  const inner = () => <span>not a root</span>",
    "  if (x) return <Card title=\"a\">hi</Card>",
    "  return x ? <div className=\"a\"><b /></div> : <section />",
    "}",
    "const Beta = memo(() => <Dialog open />)",
    "export const Gamma = forwardRef(function Gamma(p, ref) { return (<ul ref={ref}><li /></ul>) })",
    "function helper() { return <div /> }",
    "const Delta = () => <><p /></>",
    "export default function Epsilon() { return <Ctx.Provider value={1}><i /></Ctx.Provider> }",
    "function Zeta() { return <div data-src=\"keep\" /> }",
    "function Eta() { return <Card<Period> value={p} /> }",
  ].join('\n')
  const out = stamps.stampComponentSources(ts, src, 'src/x/F.tsx')
  const has = (s) => out.includes(s)
  check('a local component root is stamped', has('<Card data-src="src/x/F.tsx#Alpha" title="a">'))
  check('both branches of a conditional', has('<div data-src="src/x/F.tsx#Alpha" className="a">') && has('<section data-src="src/x/F.tsx#Alpha" />'))
  check('children are left alone', has('<b />') && has('<li />'))
  check('a nested lowercase helper is not a component', has('<span>not a root</span>') && has('function helper() { return <div /> }'))
  check('library components are skipped', has('<Dialog open />'))
  check('forwardRef(function Name) is stamped', has('<ul data-src="src/x/F.tsx#Gamma" ref={ref}>'))
  check('fragments and member tags are skipped', has('<><p /></>') && has('<Ctx.Provider value={1}>'))
  check('an existing data-src is kept', has('<div data-src="keep" />') && !has('#Zeta'))
  check('after type arguments on a generic tag', has('<Card<Period> data-src="src/x/F.tsx#Eta" value={p} />'))
  check('line count unchanged (sourcemap lines hold)', out.split('\n').length === src.split('\n').length)
  check('nothing to stamp → null', stamps.stampComponentSources(ts, 'export const a = 1', 'src/a.tsx') === null)
}

console.log('\n17 · Numbered points in the description')
{
  const a = list.insertNumberedItem('', 0)
  check('button on an empty box → "1- "', a.text === '1- ' && a.caret === 3)
  const b = list.insertNumberedItem('Intro\nFix the chart', 10)
  check('button on a line of text numbers it', b.text === 'Intro\n1- Fix the chart' && b.caret === b.text.length, JSON.stringify(b))
  const c = list.insertNumberedItem('1- one', 6)
  check('button on an item starts the next one below', c.text === '1- one\n2- ' && c.caret === c.text.length)
  const d = list.insertNumberedItem('1- one\n', 7)
  check('button on the empty line after an item continues the count', d.text === '1- one\n2- ', JSON.stringify(d))
  const e = list.continueNumberedList('1- one', 6)
  check('Enter continues with the next number', e.text === '1- one\n2- ' && e.caret === 10)
  const f = list.continueNumberedList('1- one\n2- ', 10)
  check('Enter on an empty point ends the list', f.text === '1- one\n' && f.caret === 7, JSON.stringify(f))
  check('Enter on plain text → default behaviour', list.continueNumberedList('hello', 5) === null)
  check('Enter before the marker → default behaviour', list.continueNumberedList('1- one', 0) === null)
  const g = list.continueNumberedList('1- one\n2- two\n3- three', 6)
  check('Enter mid-list renumbers the rest', g.text === '1- one\n2- \n3- two\n4- three', JSON.stringify(g.text))
  const h = list.continueNumberedList('1- split here', 8)
  check('text after the caret moves into the new point', h.text === '1- split\n2-  here')
  const i = list.continueNumberedList('  9- indented', 13)
  check('indent and two digits kept', i.text === '  9- indented\n  10- ')
  const p = buildClaudePrompt([{ title: 'Fix Daily', description: 'Several things:\n1- Chart too bright\n2- Button too small\n3- ', page: null, category: 'bug', priority: 'high' }])
  check('points become separate numbered points under the request', p.includes('   1.1 Chart too bright\n   1.2 Button too small'), p)
  check('an empty point is dropped from the prompt', !p.includes('1.3'))
  check('the ask mentions numbered points', p.includes('per numbered point'))
  check('no mention without points', !buildClaudePrompt([{ title: 'A', description: 'x', page: null, category: 'bug', priority: 'low' }]).includes('numbered point'))
}

console.log('\n18 · Card dates and the Prompted flag')
{
  const now = new Date(2026, 8, 30, 12, 0)
  const at = (y, m, d, h, min) => new Date(y, m - 1, d, h, min).toISOString()
  check('card stamp en-GB, no year this year', rules.cardStamp(at(2026, 9, 29, 14, 5), now) === '29/09 14:05')
  check('year shown for another year', rules.cardStamp(at(2025, 1, 2, 3, 4), now) === '02/01/2025 03:04')
  check('bad stamp → empty', rules.cardStamp('nope', now) === '' && rules.cardStamp(null, now) === '')
  const done = { created_at: at(2026, 9, 29, 14, 5), status: 'done', completed_at: at(2026, 9, 30, 9, 12) }
  check('added + done', rules.cardTimeline(done, now) === 'Added 29/09 14:05 · Done 30/09 09:12')
  check('open → added only', rules.cardTimeline({ ...done, status: 'open' }, now) === 'Added 29/09 14:05')
  check('done before migration 114 → added only', rules.cardTimeline({ ...done, completed_at: undefined }, now) === 'Added 29/09 14:05')
  check('prompted + open waits for a check', rules.awaitingCheck({ status: 'open', prompted_at: 'x' }) && rules.awaitingCheck({ status: 'in_progress', prompted_at: 'x' }))
  check('done or never prompted does not', !rules.awaitingCheck({ status: 'done', prompted_at: 'x' }) && !rules.awaitingCheck({ status: 'open', prompted_at: null }) && !rules.awaitingCheck({ status: 'open' }))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
