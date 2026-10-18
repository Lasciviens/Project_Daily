#!/usr/bin/env node
/* Verification — the project rules (src/features/projects/projectModel.ts):
 * templates, a table block's columns and cells, the order of a block's
 * entries, a project's numbers, the list's filters, and where a block sits
 * on a wide page (projectBoard.blockTrack). Runs the real modules through
 * sucrase (no test framework). Run: node scripts/verify-project-model.cjs */
require('sucrase/register')
const M = require('../src/features/projects/projectModel')
const P = require('../src/features/projects/projectBoard')
const T = require('../src/features/projects/proseModel')

let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

console.log('Templates')
check('six templates, Blank last', eq(M.TEMPLATES.map(t => t.kind), ['hardware', 'software', 'home', 'learning', 'trip', 'blank']))
check('every template block is a known kind with a title', M.TEMPLATES.every(t => t.blocks.every(b => M.BLOCK_KINDS.includes(b.kind) && b.title.trim())))
check('every template table survives tableSettings unchanged (the database gets valid settings)', M.TEMPLATES.every(t => t.blocks
  .filter(b => b.kind === 'table')
  .every(b => eq(M.tableSettings(b.settings).columns, b.settings.columns) && (M.tableSettings(b.settings).groupBy ?? null) === (b.settings.groupBy ?? null))))
check('Hardware starts with Parts (In hand · To buy · Ordered, grouped), Log, Decisions, Guides and Links',
  eq(M.templateFor('hardware').blocks.map(b => b.title), ['Parts', 'Log', 'Questions and decisions', 'Guides', 'Links'])
  && eq(M.statusColumn(M.tableSettings(M.templateFor('hardware').blocks[0].settings)).options, ['In hand', 'To buy', 'Ordered']))
check('Blank starts empty', M.templateFor('blank').phases.length === 0 && M.templateFor('blank').blocks.length === 0)
check('an unknown kind falls back to Blank', M.templateFor('boat').kind === 'blank')
check('a template\'s summary names its blocks', M.TEMPLATES.filter(t => t.kind !== 'blank').every(t => t.blocks.every(b =>
  b.title.toLowerCase().split(' ').some(w => w.length > 2 && t.summary.toLowerCase().includes(w)))))

console.log('Table settings from the database')
{
  const s = M.tableSettings({
    columns: [
      { key: 'part', label: ' Part ', type: 'text' },
      { key: 'part', label: 'Again', type: 'text' },
      { key: 'BAD KEY', label: 'X', type: 'text' },
      { key: 'kind', label: 'Kind', type: 'colour' },
      { key: 'blank', label: '  ', type: 'text' },
      { key: 'state', label: 'Status', type: 'status', options: [' In hand', 'in hand', '', 'To buy', 7] },
    ],
    groupBy: 'nothing', currency: 'nok',
  })
  check('a repeated key, a bad key, an unknown type and a blank label are dropped; labels trimmed', eq(s.columns.map(c => c.key), ['part', 'state']) && s.columns[0].label === 'Part')
  check('choices are trimmed and unique (case-blind), blanks and non-text dropped', eq(s.columns[1].options, ['In hand', 'To buy']))
  check('a groupBy that names no column is dropped; a bad currency becomes NOK', s.groupBy === null && s.currency === 'NOK')
  check('rubbish settings → no columns', eq(M.tableSettings(null).columns, []) && eq(M.tableSettings([1]).columns, []) && eq(M.tableSettings({ columns: 'x' }).columns, []))
  check('at most 20 choices', M.cleanOptions(Array.from({ length: 30 }, (_, i) => `o${i}`)).length === 20)
  check('newColumnKey: from the label, unique', M.newColumnKey([{ key: 'price' }, { key: 'price_2' }], 'Price') === 'price_3'
    && M.newColumnKey([], 'Å tid!') === 'a_tid' && M.newColumnKey([], '***') === 'col')
}

console.log('Cells')
{
  const num = { key: 'q', label: 'Qty', type: 'number' }
  const money = { key: 'p', label: 'Price', type: 'money' }
  const date = { key: 'd', label: 'Date', type: 'date' }
  const link = { key: 'l', label: 'Link', type: 'link' }
  const st = { key: 's', label: 'Status', type: 'status', options: ['In hand', 'To buy'] }
  const chk = { key: 'c', label: 'Packed', type: 'check' }
  const text = { key: 't', label: 'Part', type: 'text' }
  check('a number takes a comma or point and spaces', eq(M.parseCell(num, '1 234,5'), { ok: true, value: 1234.5 }) && eq(M.parseCell(money, '199.999'), { ok: true, value: 200 }))
  check('not a number → its own error', eq(M.parseCell(num, 'ten'), { ok: false, error: 'Qty must be a number' }))
  check('an empty cell is null; a tick box is a boolean', eq(M.parseCell(num, '  '), { ok: true, value: null }) && eq(M.parseCell(chk, true), { ok: true, value: true }) && eq(M.parseCell(chk, ''), { ok: true, value: false }))
  check('a link gets https:// when it is a bare address; anything else is refused',
    eq(M.parseCell(link, 'github.com/x/y'), { ok: true, value: 'https://github.com/x/y' }) && M.parseCell(link, 'javascript:alert(1)').ok === false
    && M.parseCell(link, 'not a link').ok === false && eq(M.parseCell(link, 'http://a.no'), { ok: true, value: 'http://a.no' }))
  check('a choice must be one of the column\'s', eq(M.parseCell(st, 'To buy'), { ok: true, value: 'To buy' }) && M.parseCell(st, 'Lost').ok === false)
  check('a date is yyyy-MM-dd (DateInput\'s value)', eq(M.parseCell(date, '2026-10-14'), { ok: true, value: '2026-10-14' }) && M.parseCell(date, '14.10.2026').ok === false)
  check('text is trimmed and capped at 500', eq(M.parseCell(text, '  HX711 '), { ok: true, value: 'HX711' }) && M.parseCell(text, 'x'.repeat(600)).value.length === 500)
  check('shown: money with its currency, a date as DD.MM.YYYY, a link without its scheme, a tick as Yes',
    M.cellText(money, 1250, 'NOK') === '1 250 NOK' && M.cellText(date, '2026-10-14') === '14.10.2026'
    && M.cellText(link, 'https://www.github.com/x/') === 'github.com/x' && M.cellText(chk, true) === 'Yes' && M.cellText(chk, false) === '')
  check('a cell of the wrong shape shows nothing (never "NaN" or "[object Object]")',
    M.cellText(num, 'x') === '' && M.cellText(money, NaN) === '' && M.cellText(date, 5) === '' && M.cellText(text, null) === '')
  const settings = { columns: [num, text, st], groupBy: 's' }
  check('a row is named by its first text column', M.rowTitle(settings, { t: 'HX711', q: 1 }) === 'HX711' && M.rowTitle(settings, {}) === 'Untitled')
  const rows = [{ data: { t: 'a', s: 'To buy' } }, { data: { t: 'b' } }, { data: { t: 'c', s: 'In hand' } }, { data: { t: 'd', s: 'To buy' } }]
  check('groupRows: by the groupBy column in first-seen order, rows with none last',
    eq(M.groupRows(rows, settings).map(g => [g.group, g.rows.map(r => r.data.t)]), [['To buy', ['a', 'd']], ['In hand', ['c']], [null, ['b']]]))
  check('groupRows with no groupBy: one group', M.groupRows(rows, { columns: [] }).length === 1)
  check('statusCounts: every choice in order, empty ones kept', eq(M.statusCounts(rows, st), [{ option: 'In hand', count: 1 }, { option: 'To buy', count: 2 }]))
  check('moneyTotals: each money column\'s sum, columns with no amount left out',
    eq(M.moneyTotals([{ data: { p: 100.1 } }, { data: { p: 'x' } }, { data: { p: 49.9 } }], { columns: [money, { ...money, key: 'p2', label: 'Other' }] }).map(t => [t.column.key, t.total]), [['p', 150]]))
}

console.log('Entries')
{
  const e = (id, o) => ({ id, entry_date: null, state: null, sort_order: 0, created_at: '2026-10-01T10:00:00Z', ...o })
  const log = [e('a', { entry_date: '2026-10-12' }), e('b', { entry_date: '2026-10-14', created_at: '2026-10-14T08:00:00Z' }), e('c', { entry_date: '2026-10-14', created_at: '2026-10-14T09:00:00Z' })]
  check('a log is newest first (same day: the later one first)', eq(M.orderEntries('log', log).map(x => x.id), ['c', 'b', 'a']))
  const dec = [e('d1', { state: 'decided', entry_date: '2026-10-10' }), e('q2', { state: 'open', sort_order: 2 }), e('d2', { state: 'decided', entry_date: '2026-10-14' }), e('q1', { state: 'open', sort_order: 1 })]
  check('questions first in their order, then decisions newest first', eq(M.orderEntries('decisions', dec).map(x => x.id), ['q1', 'q2', 'd2', 'd1']))
  check('other blocks keep their own order', eq(M.orderEntries('links', [e('x', { sort_order: 2 }), e('y', { sort_order: 1 })]).map(x => x.id), ['y', 'x']))
  check('answering a question decides it today, unless it already has a day',
    eq(M.decide({ entry_date: null }, '2026-10-18'), { state: 'decided', entry_date: '2026-10-18' }) && M.decide({ entry_date: '2026-10-14' }, '2026-10-18').entry_date === '2026-10-14')
  check('nextSortOrder: after the last (0 for none)', M.nextSortOrder([]) === 0 && M.nextSortOrder([{ sort_order: 3 }, { sort_order: 1 }]) === 4)
  const items = [{ id: 'a', sort_order: 0 }, { id: 'b', sort_order: 1 }, { id: 'c', sort_order: 2 }]
  check('swapWith: the neighbour up or down, null at the ends', eq(M.swapWith(items, 'b', -1).map(x => x.id), ['b', 'a'])
    && eq(M.swapWith(items, 'b', 1).map(x => x.id), ['b', 'c']) && M.swapWith(items, 'a', -1) === null && M.swapWith(items, 'c', 1) === null && M.swapWith(items, 'z', 1) === null)
}

console.log('A project\'s numbers')
{
  const ph = (id, status, sort_order) => ({ id, name: id.toUpperCase(), status, sort_order, created_at: '2026-10-01' })
  const t = (id, status, phase, sort_order = 0) => ({ id, title: id, status, sort_order, created_at: '2026-10-01', project_phase_id: phase })
  const phases = [ph('p2', 'pending', 1), ph('p1', 'done', 0), ph('p3', 'pending', 2)]
  const tasks = [t('a', 'done', 'p1'), t('b', 'open', 'p3'), t('c', 'waiting', 'p2', 2), t('d', 'in_progress', 'p2', 1), t('e', 'cancelled', 'p2'), t('f', 'open', null)]
  const s = M.projectSummary(phases, tasks, 2)
  check('phases: 1 of 3 done; the current one is the first not done, by order (2nd)', s.phasesDone === 1 && s.phasesTotal === 3 && s.current.id === 'p2' && s.currentIndex === 2)
  check('tasks: a cancelled one doesn\'t count (1 of 5 done)', s.tasksDone === 1 && s.tasksTotal === 5)
  check('next: the first open task of the current phase, by order (waiting counts as open)', s.nextTask.id === 'd')
  check('next falls back to a later phase, then to a task in no phase',
    M.projectSummary(phases, [t('b', 'open', 'p3')]).nextTask.id === 'b' && M.projectSummary(phases, [t('f', 'open', null)]).nextTask.id === 'f'
    && M.projectSummary(phases, [t('a', 'done', 'p1')]).nextTask === null)
  check('open questions pass through', s.openQuestions === 2)
  check('progress line: the current phase, all done, or tasks when there are no phases',
    M.progressLine(s) === 'Phase 2 of 3 · P2'
    && M.progressLine(M.projectSummary([ph('p1', 'done', 0)], [])) === 'All 1 phase done'
    && M.progressLine(M.projectSummary([], [t('a', 'done', null), t('b', 'open', null)])) === '1 of 2 tasks done'
    && M.progressLine(M.projectSummary([], [])) === 'No phases yet')
  check('progress value: phases done, else tasks done, else 0',
    Math.abs(M.progressValue(s) - 1 / 3) < 1e-9 && M.progressValue(M.projectSummary([], [t('a', 'done', null), t('b', 'open', null)])) === 0.5 && M.progressValue(M.projectSummary([], [])) === 0)
  check('phaseTasks: a phase\'s tasks in their order; null = the ones in no phase',
    eq(M.phaseTasks(tasks, 'p2').map(x => x.id), ['e', 'd', 'c']) && eq(M.phaseTasks(tasks, null).map(x => x.id), ['f']))
}

console.log('The list')
{
  const p = (id, status, area, sort_order) => ({ id, status, area, sort_order, created_at: '2026-10-01' })
  const list = [p('a', 'active', 'work', 2), p('b', 'active', 'personal', 1), p('c', 'on_hold', 'personal', 0), p('d', 'active', undefined, 3)]
  check('one status, in the owner\'s order', eq(M.filterProjects(list, 'active', 'all').map(x => x.id), ['b', 'a', 'd']))
  check('an area narrows it; a project from before 162 is personal', eq(M.filterProjects(list, 'active', 'personal').map(x => x.id), ['b', 'd'])
    && eq(M.filterProjects(list, 'active', 'work').map(x => x.id), ['a']))
  check('statusTally counts within the area', eq(M.statusTally(list, 'personal'), { active: 2, on_hold: 1, completed: 0, archived: 0 }))
}

console.log('Where a block sits from the laptop up')
check('text pages and tables of more than three columns beside the plan; the rest in the side track',
  P.blockTrack('pages') === 'main' && P.blockTrack('table', 6) === 'main' && P.blockTrack('table', 3) === 'side'
  && ['log', 'decisions', 'links'].every(k => P.blockTrack(k) === 'side'))

console.log('Text pages (proseModel)')
{
  const parts = T.parseProse('# Flashing\n\nPlug in the board.\nThen wait.\n\n- one\n- two\n1. first\n2) second\n```\npio run -e display\n# not a heading\n```\n## Checks')
  check('headings, a paragraph that keeps its lines, bullets, steps and code in order', eq(parts.map(p => p.kind), ['heading', 'paragraph', 'bullets', 'steps', 'code', 'heading']))
  check('a paragraph keeps its line breaks; list items are trimmed', parts[1].text === 'Plug in the board.\nThen wait.' && eq(parts[2].items, ['one', 'two']) && eq(parts[3].items, ['first', 'second']))
  check('inside code nothing is read ("# not a heading" stays code)', parts[4].text === 'pio run -e display\n# not a heading' && parts[5].level === 2)
  check('an unclosed code block runs to the end', eq(T.parseProse('```\nx').map(p => p.kind), ['code']))
  const inl = T.parseInline('Run `pio run` then **flash**: see [the guide](https://x.no/a) or https://github.com/x/y.')
  check('inline: code, bold, a named link and a bare link (its trailing dot left out)', eq(inl.map(p => p.kind), ['text', 'code', 'text', 'bold', 'text', 'link', 'text', 'link', 'text'])
    && inl[5].url === 'https://x.no/a' && inl[7].url === 'https://github.com/x/y' && inl[7].text === 'github.com/x/y' && inl[8].text === '.')
  check('only http(s) links become links (javascript: stays text)', T.parseInline('[x](javascript:alert(1))').every(p => p.kind === 'text'))
  check('firstLine: the first real line, without its marks', T.firstLine('\n# **Stage 1** ready\nmore') === 'Stage 1 ready' && T.firstLine('```\ncode\n```') === 'code' && T.firstLine(null) === '')
}

console.log(`\nverify-project-model: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
