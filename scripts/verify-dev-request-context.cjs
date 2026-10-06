#!/usr/bin/env node
/*
 * Verification — the requests backlog's pure logic:
 *   devRequestContext.ts  (picked-element / page-context blocks for the prompt)
 *   devRequestMarks.ts    (description = body + checkpoints + marks; friendly labels)
 *   checkpoints.ts        (older "- [ ]" checkpoint lines)
 *   outline.ts            (the numbered outline: points, sub-points, editing ops)
 *   pointText.ts / points.ts (points, reviews, re-check requests)
 *   devRequestRules.ts    (draft read-back from localStorage, drag-reorder plan)
 *   devRequestPrompt.ts   (the prompt for Claude)
 *   useFloatingWindow.ts  (keeping the composer window on screen)
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
const marks = require('../src/features/devRequests/devRequestMarks')
const cps = require('../src/features/devRequests/checkpoints')
const pt = require('../src/features/devRequests/pointText')
const pts = require('../src/features/devRequests/points')
const ol = require('../src/features/devRequests/outline')
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
check('stamp is DD.MM.YYYY HH:MM', /^\d{2}\.09\.2026 \d{2}:05$/.test(ctx.formatStamp(page.at)), ctx.formatStamp(page.at))
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

console.log('\n5 · Description = body + checkpoints + marks')
{
  const pick = { type: 'pick', capture: { kind: 'element', page, element } }
  const pageMark = { type: 'page', start: page, savedOn: null }
  const text = marks.appendMark(marks.appendMark('The chart gridlines\nare too bright', pick), pageMark)
  const p = marks.parseDescription(text)
  check('body is the user prose', p.body === 'The chart gridlines\nare too bright', JSON.stringify(p.body))
  check('two marks, pick then page', p.marks.length === 2 && p.marks[0].type === 'pick' && p.marks[1].type === 'page')
  check('a mark is one machine-readable line', text.split('\n').filter(l => l.startsWith('[[pick ')).length === 1)
  check('the pick reads back whole', p.marks[0].capture.element.name === 'Log food' && p.marks[0].capture.page.route === '/recipes?tab=today')
  check('compose(parse(x)) is stable', marks.composeDescription(p) === text)
  for (const body of ['hello', 'hello ', 'hello\n', 'a\n\nb\n\n', '']) {
    const t = marks.composeDescription({ body, checkpoints: [{ done: false, text: 'x' }], marks: [pick] })
    check(`typing keeps every keystroke (${JSON.stringify(body)})`, marks.parseDescription(t).body === body, JSON.stringify(marks.parseDescription(t).body))
  }
  check('no sections → text unchanged', marks.composeDescription(marks.parseDescription('Just words\n')) === 'Just words\n')
  check('a broken mark line is prose', marks.parseDescription('[[pick {nope]]').marks.length === 0 && marks.parseDescription('[[pick {nope]]').body === '[[pick {nope]]')
  check('a bracket mid-sentence is prose', marks.parseDescription('See [Picked] later').marks.length === 0)
  check('preview = prose, one line', marks.descriptionPreview(text) === 'The chart gridlines are too bright')
  check('preview from a pick when there is no prose', marks.descriptionPreview(marks.appendMark('', pick)) === 'Picked: Food › Today tab › Lunch row — “Log food”', marks.descriptionPreview(marks.appendMark('', pick)))
  check('preview empty for nothing', marks.descriptionPreview(null) === '' && marks.descriptionPreview(marks.appendMark('', pageMark)) === '')
  check('preview truncates', marks.descriptionPreview('x'.repeat(300), 20).length === 20)
  const saved = marks.descriptionForSave(marks.composeDescription({ body: '  Hi  ', checkpoints: [{ done: false, text: '' }, { done: true, text: 'Done one' }], marks: [] }))
  check('save folds checkpoints into points (a tick → Fixed) and trims', saved.startsWith('Hi\n\nDone one\n\n[[review ') && pts.pointsOf(saved)[1].state === 'fixed' && !saved.includes('- ['), JSON.stringify(saved))
  check('save leaves plain text trimmed', marks.descriptionForSave('  words \n') === 'words')
  const encoded = marks.encodePage(page, { ...page, route: '/training' })
  check('page mark keeps saved-on only when it differs', encoded.includes('savedOn') && !marks.encodePage(page, page).includes('savedOn'))
}

console.log('\n5b · Older plain-text blocks still read')
{
  const legacy = 'Gridlines too bright\n\n' + ctx.formatCapture({ kind: 'element', page, element }) + '\n\n' + ctx.formatPageContext(page)
  const p = marks.parseDescription(legacy)
  check('prose kept as the body', p.body === 'Gridlines too bright')
  check('two legacy marks', p.marks.length === 2 && p.marks.every(m => m.type === 'legacy'))
  check('legacy pick: page, route and label', p.marks[0].kind === 'pick' && p.marks[0].pageTitle === 'Food' && p.marks[0].route === '/recipes?tab=today' && p.marks[0].what === 'Log food', JSON.stringify(p.marks[0]))
  check('legacy page context: route', p.marks[1].kind === 'page' && marks.markRoute(p.marks[1]) === '/recipes?tab=today')
  check('legacy text is kept verbatim', marks.composeDescription(p).includes(ctx.formatCapture({ kind: 'element', page, element })))
  check('legacy friendly line', marks.markText(p.marks[0]) === 'Food — “Log food”', marks.markText(p.marks[0]))
  check('prose after an old block stays prose', marks.parseDescription('[Page context]\nPage: A · /a\n\nmore words').body === 'more words')
}

console.log('\n5c · What the user sees for a pick')
{
  const sources = ['src/shared/ui/Button.tsx#Button', 'src/features/training/components/program/CurrentProgramCard.tsx#CurrentProgramCard']
  const tpage = { ...page, route: '/training?tab=program', pageTitle: 'Training', tabs: ['Program'] }
  const m = { type: 'pick', capture: { kind: 'element', page: tpage, element: { tag: 'button', name: 'Missed sessions', trail: [], sources, area: 'page' } } }
  check('page › tab › component (humanized) — label', marks.markText(m) === 'Training › Program tab › Current program card — “Missed sessions”', marks.markText(m))
  check('no code in the friendly line', !/src\/|\.tsx|\?tab=/.test(marks.markText(m)))
  check('route with query for Go there', marks.markRoute(m) === '/training?tab=program')
  const card = { ...m, capture: { ...m.capture, element: { ...m.capture.element, trail: ['"Current program" card'] } } }
  check('a visible card heading wins over the component name', marks.markText(card) === 'Training › Program tab › Current program card — “Missed sessions”')
  const pop = { ...m, capture: { ...m.capture, element: { ...m.capture.element, area: 'popup "Log food"' } } }
  check('a popup is named', marks.markText(pop).includes('Log food popup'))
  const q = { type: 'pick', capture: { kind: 'selection', page, quote: 'Remaining protein', element: null } }
  check('a quote', marks.markLabel(q).kind === 'quote' && marks.markText(q).endsWith('— “Remaining protein”'))
  check('page mark', marks.markText({ type: 'page', start: tpage, savedOn: null }) === 'Written on Training › Program tab')
  check('humanize', marks.humanizeComponent('HTMLTodaySummary') === 'HTML today summary' && marks.humanizeComponent('WishQuickAdd') === 'Wish quick add')
  check('only picks, not the page mark', marks.pickMarks([m, { type: 'page', start: page, savedOn: null }]).length === 1)
  const full = marks.markPromptText(m)
  check('prompt detail: component + file', full.includes('Component: CurrentProgramCard (src/features/training/components/program/CurrentProgramCard.tsx) · via Button'), full)
  check('prompt detail: route with query', full.includes('[Picked on Training · /training?tab=program]'))
  check('prompt detail: page tabs and screen', full.includes('Page tabs: Program') && full.includes('Screen: 1469×680, desktop, light theme'))
  const withPop = marks.markPromptText({ type: 'pick', capture: { ...m.capture, page: { ...tpage, popups: ['Plan'] }, element: { ...m.capture.element, trail: ['"Schedule" card'] } } })
  check('prompt detail: popup and where even with a component', withPop.includes('Open popup: Plan') && withPop.includes('Where: page › "Schedule" card'), withPop)
  const junk = marks.parseDescription('[[pick {"page":{"route":"/x"},"element":{"tag":"b","tabs":[1,"A"]}}]]').marks[0]
  check('a stored pick with missing fields is made safe', junk && junk.capture.page.viewport.w === 0 && junk.capture.element.tabs.length === 1 && !!marks.markPromptText(junk))
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
  const text = marks.appendMark('Gridlines too bright', { type: 'pick', capture: { kind: 'element', page, element } })
  const p = buildClaudePrompt([
    { title: 'Low one', description: null, page: 'other', category: 'feature', priority: 'low' },
    { title: 'Urgent one', description: text, page: '/training', category: 'bug', priority: 'urgent', effort: 'small' },
  ])
  check('urgent first', p.indexOf('Urgent one') < p.indexOf('Low one'))
  check('picked context travels with the description', p.includes('[Picked on Food · /recipes?tab=today]'))
  check('the raw mark line never reaches the prompt', !p.includes('[[pick'))
  check('heading + meta line', p.includes('## Request 1 — Urgent one\nbug · urgent priority · effort small · page /training'), p)
  check('"other" page left out', !p.includes('page other'))
  check('empty list → empty prompt', buildClaudePrompt([]) === '')
  check('a blank line between items', /\n\n## Request 2 — Low one/.test(p))
  check('the words, then the captured block', p.includes('Gridlines too bright\n\n[Picked on Food'), p)
  check('captured blocks are explained once', p.includes('blocks give the route with its query'))
  const plain = buildClaudePrompt([{ title: 'A', description: 'words', page: null, category: 'bug', priority: 'low' }])
  check('no explanation without captured blocks', !plain.includes('blocks give the route'))
  check('one request: no "Request 1" label', plain.includes('## A\nbug · low priority\n\nwords'), plain)
  check('the rules end the prompt', /\n---\nHow to work:\n- Read CLAUDE\.md and docs\/design\/THEME\.md first\./.test(plain) && plain.trim().endsWith('edge-function deploys).'))
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

console.log('\n17 · Checkpoints')
{
  check('parse unticked', JSON.stringify(cps.parseCheckpointLine('- [ ] Fix chart')) === '{"done":false,"text":"Fix chart"}')
  check('parse ticked (x and X, * bullet)', cps.parseCheckpointLine('- [x] a').done && cps.parseCheckpointLine('* [X] a').done)
  check('an empty one while typing', cps.parseCheckpointLine('- [ ]').text === '' && cps.parseCheckpointLine('- [ ] ').text === '')
  check('not a checkpoint', cps.parseCheckpointLine('- plain') === null && cps.parseCheckpointLine('1- old') === null)
  check('line round trip', cps.checkpointLine({ done: true, text: 'a' }) === '- [x] a' && cps.checkpointLine({ done: false, text: '' }) === '- [ ]')
  const items = [{ done: true, text: 'A' }, { done: false, text: 'B' }, { done: false, text: '' }]
  check('progress counts real ones', cps.checkpointProgress(items) === '1/2 checkpoints done', cps.checkpointProgress(items))
  check('progress singular / none', cps.checkpointProgress([{ done: false, text: 'x' }]) === '0/1 checkpoint done' && cps.checkpointProgress([]) === '')
  check('tick', cps.setDone(items, 1, true)[1].done && !items[1].done)
  const ins = cps.insertAfter(items, 0)
  check('insert after', ins.at === 1 && ins.items.length === 4 && ins.items[1].text === '')
  check('insert at the end', cps.insertAfter(items, -1).at === 3)
  check('remove', cps.removeAt(items, 0)[0].text === 'B')
  const dup = [{ done: false, text: 'Same' }, { done: false, text: 'Other' }, { done: false, text: 'Same' }]
  check('the same checkpoint is found by text and occurrence', cps.findCheckpoint(dup, 'Same', cps.occurrenceOf(dup, 2)) === 2 && cps.findCheckpoint(dup, 'Nope') === -1)
  const d = marks.withCheckpoints('Intro\n- [ ] one\n- [ ] two', cps.setDone(marks.parseDescription('Intro\n- [ ] one\n- [ ] two').checkpoints, 1, true))
  check('a tick writes - [x] back', d === 'Intro\n\n- [ ] one\n- [x] two', JSON.stringify(d))
  check('old "1- " points stay text in the body', marks.parseDescription('1- old point').body === '1- old point')
  // Points are automatic now (every paragraph); an older "- [ ]" line is a point too and a ticked one reads as Fixed.
  const p = buildClaudePrompt([{ title: 'Fix Daily', description: 'Several things:\n\n- [ ] Chart too bright\n- [x] Button too small\n- [ ] ', page: null, category: 'bug', priority: 'high' }])
  check('old checkpoints become numbered points after the text', p.includes('1. Several things:\n2. Chart too bright\n3. [already fixed — leave as is] Button too small'), p)
  check('an empty checkpoint is dropped from the prompt', !p.includes('\n4.'))
  check('the ask mentions points and [already fixed]', p.includes('report per point (e.g. 1.2)') && p.includes('marked [already fixed]'))
  const old = buildClaudePrompt([{ title: 'Old', description: 'x\n1- Chart\n2- Button\n\n- [ ] New one', page: null, category: 'bug', priority: 'high' }])
  check('old "1- " lines are points of their own, checkpoints continue after', old.includes('2. Chart\n3. Button') && old.includes('4. New one'), old)
  check('no mention without points', !buildClaudePrompt([{ title: 'A', description: 'x', page: null, category: 'bug', priority: 'low' }]).includes('per point'))
}

console.log('\n18 · Card dates and the Prompted flag')
{
  const now = new Date(2026, 8, 30, 12, 0)
  const at = (y, m, d, h, min) => new Date(y, m - 1, d, h, min).toISOString()
  check('card stamp DD.MM.YYYY HH:MM', rules.cardStamp(at(2026, 9, 29, 14, 5), now) === '29.09.2026 14:05')
  check('year shown for another year', rules.cardStamp(at(2025, 1, 2, 3, 4), now) === '02.01.2025 03:04')
  check('bad stamp → empty', rules.cardStamp('nope', now) === '' && rules.cardStamp(null, now) === '')
  const done = { created_at: at(2026, 9, 29, 14, 5), status: 'done', completed_at: at(2026, 9, 30, 9, 12) }
  check('added + done', rules.cardTimeline(done, now) === 'Added 29.09.2026 14:05 · Done 30.09.2026 09:12')
  check('open → added only', rules.cardTimeline({ ...done, status: 'open' }, now) === 'Added 29.09.2026 14:05')
  check('done before migration 114 → added only', rules.cardTimeline({ ...done, completed_at: undefined }, now) === 'Added 29.09.2026 14:05')
  check('prompted + open waits for a check', rules.awaitingCheck({ status: 'open', prompted_at: 'x' }) && rules.awaitingCheck({ status: 'in_progress', prompted_at: 'x' }))
  check('done or never prompted does not', !rules.awaitingCheck({ status: 'done', prompted_at: 'x' }) && !rules.awaitingCheck({ status: 'open', prompted_at: null }) && !rules.awaitingCheck({ status: 'open' }))
}


console.log('\n19 · Pick links in the text')
{
  const water = { kind: 'element', page, element: { tag: 'h3', name: 'Water', text: 'Water', trail: ['"Water" card'], sources: ['src/features/recipes/components/WaterTracker.tsx#WaterTracker'] } }
  const btn = { kind: 'element', page, element: { tag: 'button', name: 'Log food', text: 'Log food', trail: ['"Nutrition" card'] } }
  check('label: a card\'s own heading names the card', marks.linkLabel(water) === 'Water card', marks.linkLabel(water))
  check('label: a control inside a card keeps its own name', marks.linkLabel(btn) === 'Log food', marks.linkLabel(btn))
  check('label: nothing but a component → the component', marks.linkLabel({ kind: 'element', page, element: { tag: 'div', sources: ['src/a/WaterTracker.tsx#WaterTracker'] } }) === 'Water tracker')
  check('label: a quote → the quote', marks.linkLabel({ kind: 'selection', page, quote: 'kcal left' }) === 'kcal left')

  const r1 = marks.insertPickLink('I want', water, null)
  const p1 = marks.parseDescription(r1.text)
  check('link goes at the end with a space before', p1.body === `I want [[@${r1.id}]] `, JSON.stringify(p1.body))
  check('caret lands after the link and its space', r1.caret === p1.body.length)
  check('the pick keeps its id and label', p1.marks.length === 1 && p1.marks[0].id === r1.id && p1.marks[0].label === 'Water card')
  const typed = r1.text.replace(`[[@${r1.id}]] `, `[[@${r1.id}]] to be red.`)
  const saved = marks.descriptionForSave(typed)
  const back = marks.parseDescription(saved)
  check('round trip keeps body, id and label', back.body === `I want [[@${r1.id}]] to be red.` && back.marks[0].id === r1.id && back.marks[0].label === 'Water card')
  check('plain text reads the link as its name', marks.plainText(back.body, back.marks) === 'I want Water card to be red.')
  check('preview reads the link as its name', marks.descriptionPreview(saved) === 'I want Water card to be red.')
  const segs = marks.bodySegments(back.body, back.marks)
  check('segments: text, link, text', segs.length === 3 && segs[1].type === 'ref' && segs[1].label === 'Water card' && segs[1].mark === back.marks[0])
  check('a linked pick is not a row', marks.unlinkedPicks(back.marks).length === 0)

  const mid = marks.insertPickLink('make red', btn, 5)
  check('inserted mid-text with spaces around', marks.parseDescription(mid.text).body === `make [[@${mid.id}]] red`, marks.parseDescription(mid.text).body)
  const two = marks.insertPickLink(saved, btn, null)
  check('a second pick gets another id', two.id !== r1.id && marks.parseDescription(two.text).marks.length === 2)

  const removed = marks.descriptionForSave(saved.replace(`[[@${r1.id}]]`, 'it'))
  check('deleting the link drops its pick on save', marks.parseDescription(removed).marks.length === 0, removed)
  const old = marks.descriptionForSave(`x\n\n${marks.encodePick(btn)}`)
  check('an older pick (no id) stays, as a row', marks.parseDescription(old).marks.length === 1 && marks.unlinkedPicks(marks.parseDescription(old).marks).length === 1)
  check('a missing link reads "missing link"', marks.bodySegments('a [[@zz9]] b', [])[1].label === 'missing link')

  const withPage = marks.appendMark(saved, { type: 'page', start: page, savedOn: null })
  check('the page mark is never a row', marks.unlinkedPicks(marks.parseDescription(withPage).marks).length === 0)
  const prompt = buildClaudePrompt([{ title: 'Water colour', description: withPage, page: 'food', category: 'improvement', priority: 'medium' }])
  check('prompt: the link reads “name” [1]', prompt.includes('I want “Water card” [1] to be red.'), prompt)
  check('prompt: footnote [1] carries the component and file', /\[1\] \[Picked on Food[^\n]*\n(.*\n)*.*WaterTracker/.test(prompt), prompt)
  check('prompt: explains the [n] links', prompt.includes('Footnote [n]'))
  check('prompt: no raw token leaks', !prompt.includes('[[@'))
}

console.log('\n20 · Points are automatic (paragraphs)')
{
  check('a blank line starts a point, one Enter does not', JSON.stringify(pt.splitPoints('A one\nstill A\n\nB\n\n\n  \nC')) === '["A one\\nstill A","B","C"]', JSON.stringify(pt.splitPoints('A one\nstill A\n\nB\n\n\n  \nC')))
  check('empty text → no points', pt.splitPoints('').length === 0 && pt.splitPoints('\n\n  \n').length === 0)
  check('an old "3- " line starts its own point, prefix dropped', JSON.stringify(pt.splitPoints('Intro\n1- a\ncontinued\n2- b')) === '["Intro","a\\ncontinued","b"]')
  const k = pt.pointKeys(['Fix it', 'fix   IT', 'Other'])
  check('key ignores case and spacing; a duplicate gets ~1', k[1] === `${k[0]}~1` && k[2] !== k[0], JSON.stringify(k))
  check('hash is stable', pt.hashText('abc') === pt.hashText('abc') && pt.hashText('abc') !== pt.hashText('abd'))
  const text = 'Weather card is too tall\non phones\n\nTransit times are wrong\n\nNews should be bigger'
  const list = pts.pointsOf(text)
  check('three points numbered 1–3', list.length === 3 && list.map(p => p.n).join() === '1,2,3' && list[0].text === 'Weather card is too tall\non phones')
  check('nothing reviewed yet', list.every(p => p.state === null) && pts.reviewProgress(list) === '')
  check('one paragraph is one point', pts.pointsOf('Just one thing\nwith two lines').length === 1)
}

console.log('\n21 · Reviews (Fixed / Not fixed) survive edits of other points')
{
  let text = 'A first\n\nB second\n\nC third'
  const [a, b, c] = pts.pointsOf(text)
  text = pts.setReview(text, a.key, { state: 'fixed' })
  text = pts.setReview(text, b.key, { state: 'not_fixed', note: 'still wrong on phones' })
  let list = pts.pointsOf(text)
  check('fixed + not fixed read back', list[0].state === 'fixed' && list[1].state === 'not_fixed' && list[1].review.note === 'still wrong on phones' && list[2].state === null)
  check('progress line', pts.reviewProgress(list) === '1 of 3 fixed · 1 not fixed', pts.reviewProgress(list))
  check('a review is one hidden line, not body text', marks.parseDescription(text).body === 'A first\n\nB second\n\nC third' && marks.descriptionPreview(text) === 'A first B second C third')
  // Edit point C and add a point D: A and B keep their reviews.
  const p0 = marks.parseDescription(text)
  const edited = marks.composeDescription({ ...p0, body: 'A first\n\nB second\n\nC third, reworded\n\nD new' })
  list = pts.pointsOf(edited)
  check('editing another point keeps A and B', list[0].state === 'fixed' && list[1].state === 'not_fixed' && list[2].state === null && list[3].state === null)
  const ownEdit = marks.composeDescription({ ...p0, body: 'A first, changed\n\nB second\n\nC third' })
  check('editing a point itself resets its review', pts.pointsOf(ownEdit)[0].state === null && pts.pointsOf(ownEdit)[1].state === 'not_fixed')
  check('save drops the orphaned review', marks.parseDescription(marks.descriptionForSave(ownEdit)).reviews.length === 1)
  check('reorder keeps reviews (keyed by text)', pts.pointsOf(marks.composeDescription({ ...p0, body: 'C third\n\nB second\n\nA first' }))[2].state === 'fixed')
  check('clearing a review', pts.pointsOf(pts.setReview(text, a.key, null))[0].state === null)
  check('an unknown key changes nothing', pts.setReview(text, 'nope', { state: 'fixed' }) === text)
  check('a later review line for the same key wins', marks.parseDescription(`x\n\n[[review {"k":"${a.key}","s":"fixed"}]]\n[[review {"k":"${a.key}","s":"not_fixed"}]]`).reviews.length === 1)
  check('a broken review line is prose', marks.parseDescription('[[review {"k":"x","s":"maybe"}]]').reviews.length === 0)
  check('compose(parse(x)) stable with reviews', marks.composeDescription(marks.parseDescription(text)) === text)
  const done = pts.setReview(pts.setReview(text, b.key, { state: 'fixed' }), c.key, { state: 'moved', to: 'r9' })
  check('all fixed or moved → resolved', pts.allResolved(pts.pointsOf(done)) && !pts.allResolved(pts.pointsOf(text)) && !pts.allResolved([]))
  check('reviewable once prompted, in progress or done', pts.isReviewable({ status: 'open', prompted_at: 'x' }) && pts.isReviewable({ status: 'done' }) && !pts.isReviewable({ status: 'open', prompted_at: null }))
}

console.log('\n22 · Older checkpoints read as points, ticks kept')
{
  const legacy = 'Intro words\n\n- [x] Old done\n- [ ] Old open'
  const list = pts.pointsOf(legacy)
  check('body + checkpoints = 3 points', list.length === 3 && list[1].text === 'Old done')
  check('a ticked checkpoint reads Fixed', list[1].state === 'fixed' && list[2].state === null)
  const folded = marks.foldCheckpoints(marks.parseDescription(legacy))
  check('fold: checkpoints become paragraphs, the tick a review', folded.body === 'Intro words\n\nOld done\n\nOld open' && folded.checkpoints.length === 0 && folded.reviews.length === 1)
  check('fold keeps the keys', JSON.stringify(pts.requestPoints(folded).map(p => [p.key, p.state])) === JSON.stringify(list.map(p => [p.key, p.state])))
  const cleared = pts.setReview(legacy, list[1].key, null)
  check('clearing a ticked one really clears (folded first)', pts.pointsOf(cleared)[1].state === null && !cleared.includes('- [x]'))
  const nf = pts.setReview(legacy, list[1].key, { state: 'not_fixed' })
  check('Not fixed overrides an old tick', pts.pointsOf(nf)[1].state === 'not_fixed')
  const pick = { kind: 'element', page, element: { tag: 'button', name: 'Log food', trail: ['"Nutrition" card'] } }
  const ins = marks.insertPickLink(legacy, pick, 0)
  check('a pick link inserted into folded text lands at the offset', marks.parseDescription(ins.text).body.startsWith(`[[@${ins.id}]] Intro words`) && marks.parseDescription(ins.text).checkpoints.length === 0, ins.text)
}

console.log('\n23 · Re-check requests')
{
  const water = { kind: 'element', page, element: { tag: 'h3', name: 'Water', trail: ['"Water" card'] } }
  const r = marks.insertPickLink('', water, null)
  let orig = marks.composeDescription({ ...marks.parseDescription(r.text), body: `[[@${r.id}]] should be red\n\nTransit is slow\n\nNews font` })
  orig = marks.appendMark(orig, { type: 'page', start: page, savedOn: null })
  const [p1, p2, p3] = pts.pointsOf(orig)
  orig = pts.setReview(orig, p1.key, { state: 'not_fixed', note: 'still blue\non dark' })
  orig = pts.setReview(orig, p2.key, { state: 'not_fixed' })
  orig = pts.setReview(orig, p3.key, { state: 'fixed' })
  const original = { id: 'orig1', title: 'Home tweaks', description: orig }
  const keys = pts.notFixedKeys(pts.pointsOf(orig))
  check('not fixed keys', keys.length === 2 && keys[0] === p1.key)
  const first = pts.collectForRecheck(null, original, [p1.key])
  const fp = marks.parseDescription(first.description)
  const fpts = pts.pointsOf(first.description)
  check('new re-check: one point with the original words + note', fpts.length === 1 && fpts[0].text === `[[@${r.id}]] should be red\nStill not fixed: still blue on dark`, JSON.stringify(fpts[0] && fpts[0].text))
  check('its pick is copied (Go there + footnotes work)', fp.marks.some(m => m.type === 'pick' && m.id === r.id && m.label === 'Water card'))
  check('the original page mark comes along', fp.marks.some(m => m.type === 'page'))
  check('back-reference to the original', fp.recheck && fp.recheck.of === 'orig1' && fp.recheck.title === 'Home tweaks' && fp.recheck.keys[0] === p1.key)
  const second = pts.collectForRecheck(first.description, original, [p1.key, p2.key])
  check('later points append; one already collected is skipped', second.added.length === 1 && second.added[0] === p2.key && pts.pointsOf(second.description).length === 2)
  check('no note → "Still not fixed."', pts.pointsOf(second.description)[1].text === 'Transit is slow\nStill not fixed.')
  check('the pick is not copied twice', marks.parseDescription(second.description).marks.filter(m => m.type === 'pick').length === 1)
  const clash = marks.composeDescription({ body: `mine [[@${r.id}]]`, checkpoints: [], marks: [{ type: 'pick', id: r.id, label: 'Other', capture: { kind: 'element', page, element: { tag: 'a', name: 'Other' } } }], recheck: { of: 'orig1', title: 'Home tweaks', keys: [] } })
  const renamed = pts.collectForRecheck(clash, original, [p1.key])
  const rp = marks.parseDescription(renamed.description)
  check('an id clash gets a new id, both spots kept', rp.marks.filter(m => m.type === 'pick').length === 2 && !pts.pointsOf(renamed.description)[1].text.includes(`[[@${r.id}]]`))
  const moved = pts.markMoved(orig, [p1.key, p2.key], 'fu1')
  const ml = pts.pointsOf(moved)
  check('original points read Moved with the follow-up id, note kept', ml[0].state === 'moved' && ml[0].review.to === 'fu1' && ml[0].review.note === 'still blue\non dark' && ml[1].state === 'moved')
  check('fixed + moved → the original can be closed', pts.allResolved(ml))
  check('progress counts moved', pts.reviewProgress(ml) === '1 of 3 fixed · 2 moved', pts.reviewProgress(ml))
  const reqs = [
    { id: 'a', status: 'done', description: first.description, created_at: '2026-10-01' },
    { id: 'b', status: 'open', description: first.description, created_at: '2026-10-02' },
    { id: 'c', status: 'open', description: 'x', created_at: '2026-10-03' },
  ]
  check('find the open re-check of an original', pts.findRecheck(reqs, 'orig1').id === 'b' && pts.findRecheck(reqs, 'zzz') === null)
  check('a done re-check is not reused', pts.findRecheck([reqs[0]], 'orig1') === null)
  check('title never stacks "Re-check: "', pts.recheckTitle('Re-check: Home tweaks') === 'Re-check: Home tweaks' && pts.recheckTitle('Home') === 'Re-check: Home')

  console.log('\n24 · Prompt with reviews and re-checks')
  const pr = buildClaudePrompt([{ title: 'Home tweaks', description: pts.setReview(orig, p2.key, null), page: 'home', category: 'bug', priority: 'high' }])
  check('a fixed point is one line marked [already fixed]', pr.includes('\n3. [already fixed — leave as is] News font'), pr)
  check('a not fixed point carries the note, lined up under it', pr.includes('   NOT FIXED after the last attempt: still blue on dark'), pr)
  check('numbers stay as on screen', pr.includes('\n1. “Water card” [1] should be red') && pr.includes('\n2. Transit is slow'))
  const pm = buildClaudePrompt([{ title: 'Home tweaks', description: moved, page: 'home', category: 'bug', priority: 'high' }])
  check('a moved point is skipped with a note', pm.includes('1. [moved to a separate re-check request — skip] “Water card” should be red') && !pm.includes('[1] [Picked'), pm)
  const prc = buildClaudePrompt([{ title: 'Re-check: Home tweaks', description: second.description, page: 'home', category: 'bug', priority: 'high' }])
  check('re-check prompt says it is a re-check, names the original', prc.includes('RE-CHECK: each point below was sent before in “Home tweaks” and the fix did not work'), prc)
  check('re-check: the words, then what is still wrong', prc.includes('1. “Water card” [1] should be red\n   Still not fixed after the first attempt: still blue on dark') && prc.includes('2. Transit is slow\n   Still not fixed after the first attempt.'), prc)
  check('re-check keeps the footnote', prc.includes('[1] [Picked on Food'))
  check('re-check rule once at the end', prc.includes('- For a RE-CHECK, first find what the earlier attempt changed'))
  check('a single unreviewed paragraph stays prose (no 1.1)', !buildClaudePrompt([{ title: 'A', description: 'one thing', page: null, category: 'bug', priority: 'low' }]).includes('1.1'))
  check('the raw review/recheck lines never reach the prompt', !prc.includes('[[recheck') && !pr.includes('[[review'))
}

console.log('\n25 · The outline: points and sub-points')
{
  const body = 'Water card should be red\n\n  Also in dark mode\n\n  And on phones\nline two\n\nTransit is slow\n\n  Times are UTC'
  const o = ol.parseOutline(body)
  check('five points with levels', o.length === 5 && o.map(p => p.level).join() === '0,1,1,0,1', JSON.stringify(o))
  check('labels 1, 1.1, 1.2, 2, 2.1', ol.outlineLabels(o).join() === '1,1.1,1.2,2,2.1')
  check('a line break stays inside its point', o[2].text === 'And on phones\nline two')
  check('serialize(parse(x)) is x', ol.serializeOutline(o) === body, JSON.stringify(ol.serializeOutline(o)))
  check('a sub-point first reads as a point', ol.parseOutline('  Lead\n\n  Sub')[0].level === 0 && ol.parseOutline('  Lead\n\n  Sub')[1].level === 1)
  check('tab indent counts too', ol.parseOutline('A\n\n\tB')[1].level === 1)
  const keepE = ol.parseOutline('A\n\n\n\n  \n\nB\n\n', { keepEmpty: true })
  check('keepEmpty keeps the rows being typed', keepE.length === 5 && keepE[1].text === '' && keepE[2].level === 1 && keepE[3].text === 'B' && keepE[4].text === '', JSON.stringify(keepE))
  check('…and serializes back the same', JSON.stringify(ol.parseOutline(ol.serializeOutline(keepE), { keepEmpty: true })) === JSON.stringify(keepE))
  check('without keepEmpty empty rows go', ol.parseOutline('A\n\n\n\n  \n\nB').length === 2)
  check('a blank line typed inside a point is not kept as one', ol.serializeOutline([{ level: 0, text: 'a\n\n\nb\n', tail: null }]) === 'a\nb')
  check('words before a point never start with spaces (no accidental sub-point)', ol.serializeOutline([{ level: 0, text: 'x', tail: null }, { level: 0, text: '   y', tail: null }]) === 'x\n\ny')
  check('labels: a sub-point under nothing is a point', ol.outlineLabels([{ level: 1 }, { level: 1 }, { level: 0 }]).join() === '1,1.1,2')
  const rc = ol.parseOutline('Water red\nStill not fixed: still blue')
  check('a re-check tail is split off', rc[0].text === 'Water red' && rc[0].tail === 'Still not fixed: still blue' && ol.tailNote(rc[0].tail) === 'still blue')
  check('…and kept in the full text (keys unchanged)', ol.pointFullText(rc[0]) === 'Water red\nStill not fixed: still blue')
  check('tail note without words', ol.tailNote('Still not fixed.') === '')
  // Keys hash the words, never the indent or the number.
  const flat = pts.pointsOf('Alpha\n\nBeta')
  const nested = pts.pointsOf('Alpha\n\n  Beta')
  check('indenting a point keeps its key (and its review)', flat[1].key === nested[1].key && nested[1].label === '1.1' && nested[1].level === 1)
  let text = pts.setReview('Alpha\n\nBeta', flat[1].key, { state: 'fixed' })
  text = marks.composeDescription({ ...marks.parseDescription(text), body: 'Alpha\n\n  Beta' })
  check('a review survives indenting', pts.pointsOf(text)[1].state === 'fixed')
  const saved = marks.descriptionForSave('Intro\n1- one\n2- two\n\n\n\n  sub\n\n')
  check('save writes a clean outline (old "1-" lines → points)', saved === 'Intro\n\none\n\ntwo\n\n  sub', JSON.stringify(saved))
  check('old paragraphs keep their keys after the save', JSON.stringify(pts.pointsOf('Intro\n1- one\n2- two\n\n  sub').map(p => p.key)) === JSON.stringify(pts.pointsOf(saved).map(p => p.key)))
}

console.log('\n26 · Editing the outline (Enter, Backspace, Tab, paste, links)')
{
  const P = (text, level = 0, tail = null) => ({ level, text, tail })
  const s1 = ol.splitPoint([P('Hello world', 1), P('x')], 0, 5)
  check('Enter splits at the caret, same level', s1.points.length === 3 && s1.points[0].text === 'Hello' && s1.points[1].text === ' world' && s1.points[1].level === 1 && s1.caret.index === 1 && s1.caret.offset === 0)
  const s2 = ol.splitPoint([P('Hello world')], 0, 2, 8)
  check('Enter replaces a selection', s2.points[0].text === 'He' && s2.points[1].text === 'rld')
  const s3 = ol.splitPoint([P('A'), P('', 1)], 1, 0)
  check('Enter on an empty sub-point makes it a point', s3.points.length === 2 && s3.points[1].level === 0)
  const s4 = ol.splitPoint([P('Words', 0, 'Still not fixed.')], 0, 0)
  check('Enter at the start adds a point above, the tail stays with its words', s4.points.length === 2 && s4.points[0].text === '' && s4.points[1].tail === 'Still not fixed.' && s4.caret.index === 1)
  const b1 = ol.joinWithPrevious([P('A'), P('B', 1)], 1)
  check('Backspace at the start of a sub-point outdents it', b1.points[1].level === 0 && b1.points.length === 2)
  const b2 = ol.joinWithPrevious([P('Abc'), P('def')], 1)
  check('Backspace at the start of a point joins it to the one above', b2.points.length === 1 && b2.points[0].text === 'Abc def' && b2.caret.index === 0 && b2.caret.offset === 4)
  const b3 = ol.joinWithPrevious([P('Abc'), P('')], 1)
  check('an empty point simply goes', b3.points.length === 1 && b3.points[0].text === 'Abc' && b3.caret.offset === 3)
  check('the first point has nothing to join', ol.joinWithPrevious([P('A')], 0) === null)
  check('two collected notes never merge', ol.joinWithPrevious([P('a', 0, 'Still not fixed.'), P('b', 0, 'Still not fixed.')], 1) === null)
  const d1 = ol.joinWithNext([P('Abc'), P('def', 1)], 0)
  check('Delete at the end pulls the next point in', d1.points.length === 1 && d1.points[0].text === 'Abc def')
  check('Tab makes a sub-point; never the first', ol.setLevel([P('A'), P('B')], 1, 1)[1].level === 1 && ol.setLevel([P('A')], 0, 1)[0].level === 0)
  const p1 = ol.pasteText([P('Start end')], 0, 6, 6, 'one\ntwo')
  check('paste: line breaks stay inside the point', p1.points.length === 1 && p1.points[0].text === 'Start one\ntwoend' && p1.caret.offset === 13)
  const p2 = ol.pasteText([P('Start end', 1), P('z')], 0, 6, 6, 'one\n\ntwo\n\n  three')
  check('paste: blocks become points, an indented one a sub-point', p2.points.length === 4 && p2.points[0].text === 'Start one' && p2.points[1].text === 'two' && p2.points[2].text === 'threeend' && p2.points[2].level === 1 && p2.caret.index === 2 && p2.caret.offset === 5, JSON.stringify(p2))
  const i1 = ol.insertIntoOutline([P('make red'), P('second', 1)], '[[@ab1]]', { index: 0, offset: 5 })
  check('a link goes into the point at the caret with spaces', i1.points[0].text === 'make [[@ab1]] red' && i1.caret.index === 0 && i1.caret.offset === 14)
  check('no caret → end of the last point', ol.insertIntoOutline([P('a'), P('b')], '[[@ab1]]', null).points[1].text === 'b [[@ab1]] ')
  const water = { kind: 'element', page, element: { tag: 'h3', name: 'Water', trail: ['"Water" card'] } }
  const r = marks.insertPickAt('First\n\n  Second', water, { index: 1, offset: 0 })
  const rp = marks.parseDescription(r.text)
  check('insertPickAt: link in the sub-point, outline kept', rp.body === `First\n\n  [[@${r.id}]] Second` && r.caret.index === 1 && r.caret.offset === `[[@${r.id}]] `.length, JSON.stringify(rp.body))
  check('insertPickAt keeps an empty row being typed', marks.parseDescription(marks.insertPickAt('A\n\n', water, { index: 0, offset: 1 }).text).body.endsWith('\n\n'))
}

console.log('\n27 · Prompt: sub-points and re-checks read clearly')
{
  const desc = 'Water card should be red\n\n  Also in dark mode\n\nTransit is slow'
  const [a, b, c] = pts.pointsOf(desc)
  let d = pts.setReview(desc, b.key, { state: 'not_fixed', note: 'dark still blue' })
  d = pts.setReview(d, c.key, { state: 'fixed' })
  const p = buildClaudePrompt([{ title: 'Home', description: d, page: '/home', category: 'bug', priority: 'high' }])
  check('main points "1.", sub-points "1.1" indented', p.includes('\n1. Water card should be red\n   1.1 Also in dark mode\n       NOT FIXED after the last attempt: dark still blue\n2. [already fixed — leave as is] Transit is slow'), p)
  check('a lone sub-point still numbers (not prose)', buildClaudePrompt([{ title: 'x', description: 'Main\n\n  Sub', page: null, category: 'bug', priority: 'low' }]).includes('1. Main\n   1.1 Sub'))
  const two = buildClaudePrompt([{ title: 'A', description: desc, page: null, category: 'bug', priority: 'high' }, { title: 'B', description: 'x', page: null, category: 'bug', priority: 'low' }])
  check('several requests: report per request and point', two.includes('report per request and point (e.g. Request 2 · 1.2)'))
  check('no unused rules', !p.includes('RE-CHECK') && !p.includes('Footnote'))
  check('point a unchanged', a.label === '1')
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
