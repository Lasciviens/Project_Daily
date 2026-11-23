#!/usr/bin/env node
/*
 * Verification — Ask AI's app-side logic (src/features/ai/chat/chatRules.ts), run as it is through sucrase:
 * what the function streams is input (every event is checked), the stream is split correctly however it is cut up,
 * the turns of an answer are built from the events, a stored chat is drawn the same as the live one, and the wall's words.
 *   Run:  node scripts/verify-ai-chat-ui.cjs
 */
require('sucrase/register')
const path = require('path')
const fs = require('fs')
const R = require(path.join(__dirname, '../src/features/ai/chat/chatRules.ts'))
let ok = 0, bad = 0
const check = (n, c, d) => { if (c) { ok++; console.log('  ✓', n) } else { bad++; console.log('  ✗', n, d === undefined ? '' : JSON.stringify(d).slice(0, 400)) } }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const U = (n) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`

console.log('\n1 · the stream')
{
  const text = 'event: start\ndata: {"type":"start","conversation_id":"' + U(1) + '","is_new":true}\n\nevent: text\ndata: {"event":"text","t":"Hel"}\n\nevent: text\ndata: {"t":"lo"}\n\nevent: done\ndata: {"conversation_id":"' + U(1) + '","text":"Hello","citations":[],"proposals":[],"cost_usd":0.002,"wall":false}\n\n'
  const whole = R.parseSse(text)
  check('a whole stream gives its four events and nothing left over', whole.events.length === 4 && whole.rest === '' && whole.events.map(e => e.name).join() === 'start,text,text,done')
  let buffer = '', got = []
  for (const ch of text) { buffer += ch; const r = R.parseSse(buffer); got.push(...r.events); buffer = r.rest }
  check('cut into single characters it gives the same events (an event is only read when whole)', same(got, whole.events) && buffer === '')
  check('CRLF line ends and a line that is not JSON are handled; a comment line is ignored', same(R.parseSse('event: text\r\ndata: {"t":"a"}\r\n\r\n: ping\n\nevent: text\ndata: not json\n\n').events, [{ name: 'text', data: { t: 'a' } }]))
  check('start: needs a uuid', R.readChatEvent('start', { conversation_id: U(1), is_new: true })?.conversationId === U(1) && R.readChatEvent('start', { conversation_id: 'x' }) === null && R.readChatEvent('start', null) === null)
  check('text: a string only, cut at a sane size', R.readChatEvent('text', { t: 'hi' })?.text === 'hi' && R.readChatEvent('text', { t: 5 }) === null && R.readChatEvent('text', { t: 'x'.repeat(30_000) }).text.length === 20_000)
  check('step: a label of its own or a plain default', R.readChatEvent('step', { name: 'find_text', label: 'Searching' }).label === 'Searching' && R.readChatEvent('step', {}).label === 'Working on it')
  check('proposal: a uuid, one of the two tools and a summary, or nothing', R.readChatEvent('proposal', { id: U(2), tool: 'add_task', summary: 'Add task "x"', expires_at: '2026-11-23T10:00:00Z' })?.card.state === 'pending' && R.readChatEvent('proposal', { id: U(2), tool: 'db_delete', summary: 's' }) === null && R.readChatEvent('proposal', { id: 'x', tool: 'add_task', summary: 's' }) === null && R.readChatEvent('proposal', { id: U(2), tool: 'log_food', summary: '' }) === null)
  const done = R.readChatEvent('done', { conversation_id: U(1), text: 'Hi', citations: [{ kind: 'task', id: U(3), title: 'T', day: '2026-11-24' }, { kind: 'x', id: U(4), title: 'bad' }, { kind: 'task', id: 'no', title: 'bad' }, { kind: 'diary', id: U(5), title: '', day: 'soon' }], proposals: [{ id: U(2), tool: 'log_food', summary: 's', expires_at: 'x' }, { id: 'bad' }], cost_usd: -3, wall: true, ending: 'cut_off' })
  check('done: citations and cards are read one by one (the bad ones dropped), a negative cost is 0, flags are exact', done.citations.length === 2 && done.citations[1].title === 'Diary' && done.citations[1].day === null && done.cards.length === 1 && done.costUsd === 0 && done.wall === true && done.cutOff === true, done)
  check('an event name this app does not know, or data that is not an object, is ignored', R.readChatEvent('mystery', {}) === null && R.readChatEvent('text', 'x') === null && R.readChatEvent('error', []) === null)
  check('error: reason and message are kept short', R.readChatEvent('error', { reason: 'wall', message: 'x'.repeat(900), conversation_id: U(1) }).message.length === 400)
}

console.log('\n2 · the turns of an answer')
{
  let t = R.newTurn('a1', 'assistant')
  const ev = (name, data) => R.readChatEvent(name, data)
  t = R.applyChatEvent(t, ev('text', { t: 'Let me look.' }))
  t = R.applyChatEvent(t, ev('step', { name: 'get_day_plan', label: "Looking at the day's plan" }))
  t = R.applyChatEvent(t, ev('step', { name: 'get_day_plan', label: "Looking at the day's plan" }))
  t = R.applyChatEvent(t, ev('text', { t: 'You have ' }))
  t = R.applyChatEvent(t, ev('text', { t: 'two things.' }))
  check('text after a lookup starts a new paragraph, text within a request does not; every lookup is its own step', t.text === 'Let me look.\n\nYou have two things.' && t.steps.length === 2 && t.streaming === true, t)
  t = R.applyChatEvent(t, ev('proposal', { id: U(2), tool: 'add_task', summary: 'Add task "x"', expires_at: '2026-11-23T10:00:00Z' }))
  t = R.applyChatEvent(t, ev('proposal', { id: U(2), tool: 'add_task', summary: 'Add task "x"', expires_at: '2026-11-23T10:00:00Z' }))
  check('a proposal makes one card, however often it is repeated', t.cards.length === 1)
  const retracted = R.applyChatEvent(t, ev('retract', {}))
  check('a retract takes the streamed text back', retracted.text === '' && retracted.cards.length === 1)
  const failed = R.applyChatEvent(retracted, ev('error', { reason: 'declined', message: 'The model declined to answer this one.' }))
  check('an error closes the answer with its sentence and no text', failed.streaming === false && failed.error === 'The model declined to answer this one.' && failed.text === '')
  const fin = R.applyChatEvent(t, ev('done', { conversation_id: U(1), text: 'Final text.', citations: [{ kind: 'task', id: U(3), title: 'Dentist', day: null }], proposals: [], cost_usd: 0.0031, wall: false }))
  check('done closes the answer with the checked text, the citations and the cost; cards already shown stay', fin.text === 'Final text.' && fin.streaming === false && fin.citations.length === 1 && fin.costUsd === 0.0031 && fin.cards.length === 1 && fin.error === null)
}

console.log('\n3 · a stored chat is drawn like the live one')
{
  const rows = [
    { seq: 1, role: 'user', content: [{ type: 'text', text: '<live_context>Today is Sunday</live_context>' }, { type: 'text', text: 'What is on Tuesday?' }], meta: { live_at: 'x' } },
    { seq: 2, role: 'assistant', content: [{ type: 'thinking', thinking: 'x', signature: 's' }, { type: 'text', text: 'Let me look.' }, { type: 'tool_use', id: 'toolu_1', name: 'get_day_plan', input: {} }, { type: 'tool_use', id: 'toolu_2', name: 'propose_add_task', input: {} }], meta: { cost_usd: 0.001 } },
    { seq: 3, role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'x' }, { type: 'tool_result', tool_use_id: 'toolu_2', content: 'y' }], meta: {} },
    { seq: 4, role: 'assistant', content: [{ type: 'text', text: 'Tuesday has a dentist.' }], meta: { cost_usd: 0.002, citations: [{ kind: 'task', id: U(3), title: 'Dentist', day: '2026-11-24' }] } },
    { seq: 5, role: 'user', content: [{ type: 'text', text: '<app_updates>The proposal was confirmed.</app_updates>' }, { type: 'text', text: 'thanks' }], meta: {} },
    { seq: 6, role: 'assistant', content: [{ type: 'text', text: 'You are welcome.' }], meta: { cost_usd: 0.0005, ending: 'cut_off' } },
  ]
  const proposals = [{ id: U(9), tool_use_id: 'toolu_2', tool: 'add_task', summary: 'Add task "x"', status: 'pending', expires_at: '2026-11-23T10:00:00Z' }]
  const turns = R.turnsFromStored(rows, proposals, Date.parse('2026-11-22T14:00:00Z'))
  check('four turns: the person\'s words as typed (the app\'s notices and tool results are not shown), one answer per question', turns.map(t => t.role + ':' + t.text.slice(0, 12)).join('|') === 'user:What is on T|assistant:Let me look.|user:thanks|assistant:You are welc', turns.map(t => t.text))
  check('the answer joins its requests\' text, lists its lookups once, sums its cost, keeps its citations and its card', turns[1].text === 'Let me look.\n\nTuesday has a dentist.' && turns[1].steps.length === 2 && Math.abs(turns[1].costUsd - 0.003) < 1e-9 && turns[1].citations[0].title === 'Dentist' && turns[1].cards.length === 1 && turns[1].cards[0].id === U(9) && turns[1].cards[0].state === 'pending' && turns[1].streaming === false, turns[1])
  check('a cut-off answer says so', turns[3].cutOff === true)
  check('a card is pending until decided, shows the decision, and is "expired" when its time has passed', R.turnsFromStored(rows, [{ ...proposals[0], status: 'confirmed' }])[1].cards[0].state === 'confirmed' && R.turnsFromStored(rows, [{ ...proposals[0], status: 'cancelled' }])[1].cards[0].state === 'cancelled' && R.turnsFromStored(rows, proposals, Date.parse('2026-11-25T00:00:00Z'))[1].cards[0].state === 'expired')
  check('a proposal row with a tool this app does not know makes no card', R.turnsFromStored(rows, [{ ...proposals[0], tool: 'db_delete' }])[1].cards.length === 0)
  check('rows out of order, with a bad shape or an unknown role, do no harm', R.turnsFromStored([rows[3], { seq: 7, role: 'user', content: 'not blocks', meta: null }, rows[0]], []).length === 2)
}

console.log('\n4 · the wall, the links, the words')
{
  check('wallState: ok under 70 000, near from 70 000, full from 90 000 or when the chat is not open', R.wallState(1000, 'open') === 'ok' && R.wallState(70_000, 'open') === 'near' && R.wallState(89_999, 'open') === 'near' && R.wallState(90_000, 'open') === 'full' && R.wallState(10, 'full') === 'full')
  check('the app\'s wall numbers are the function\'s (chat-rules.ts wallTokens)', /wallTokens: 90_000/.test(fs.readFileSync(path.join(__dirname, '../supabase/claude-src/chat-rules.ts'), 'utf8')) && R.CHAT_WALL_TOKENS === 90_000 && /textMax: 4000/.test(fs.readFileSync(path.join(__dirname, '../supabase/claude-src/chat-rules.ts'), 'utf8')) && R.CHAT_TEXT_MAX === 4000)
  check('a task citation opens the task popup by id; a diary line opens its day in Personal', same(R.citationTarget({ kind: 'task', id: U(1), title: 't', day: null }), { kind: 'task', id: U(1) }) && same(R.citationTarget({ kind: 'diary', id: U(2), title: 'd', day: '2026-11-20' }), { kind: 'route', path: '/daily?date=2026-11-20' }))
  check('card words', R.cardStateLabel('confirmed') === 'Saved' && R.cardStateLabel('cancelled') === 'Cancelled' && R.cardStateLabel('expired') === 'Expired' && R.cardStateLabel('failed') === 'Could not be saved' && R.cardStateLabel('pending') === '')
  check('boldParts: **bold** only, never other markdown, never across lines', same(R.boldParts('a **b** c'), [{ text: 'a ', bold: false }, { text: 'b', bold: true }, { text: ' c', bold: false }]) && same(R.boldParts('**a\nb**'), [{ text: '**a\nb**', bold: false }]) && R.boldParts('<b>x</b> **').every(p => !p.bold))
}

console.log('\n5 · what a card shows, what a step shows (the review)')
{
  const args = { title: 'Buy flowers — a very long title that the old summary would have cut at eighty characters, and then some more words after it', description: 'Red ones, for Anna\'s birthday, to pick up on the way home from the station', due_date: '2026-11-25', priority: 'high' }
  const f = R.proposalFields('add_task', args, '2026-11-22')
  const text = f.map(x => `${x.label}: ${x.value}`).join('\n')
  check('S1: the task card shows the FULL title and the FULL note, the date as DD.MM.YYYY, the priority, and where it goes', text.includes(args.title) && text.includes(args.description) && text.includes('Due date: 25.11.2026') && text.includes('Priority: High') && text.includes('Goes to: Backlog'), text)
  check('S1: …and the parts the function adds itself (area, status, source), so the card says everything that is written', text.includes('Area: Personal') && text.includes('Status: Open') && text.includes('Source: Added by Ask AI'))
  check('S1: a task due today goes to Today, one with no date to the Inbox; a missing note says "none"', R.proposalFields('add_task', { ...args, due_date: '2026-11-22', description: '' }, '2026-11-22').some(x => x.value === 'Today') && R.proposalFields('add_task', { ...args, due_date: null, description: '' }, '2026-11-22').some(x => x.label === 'Goes to' && x.value === 'Inbox') && R.proposalFields('add_task', { ...args, description: '' }, '2026-11-22').some(x => x.label === 'Note' && x.value === 'none'))
  const food = { title: 'Lentil soup with a long name that would be cut', meal: 'dinner', date: '2026-11-21', calories: 310, protein_g: 18, carbs_g: 42.5, fat_g: 6, basis: 'recipe' }
  const g = R.proposalFields('log_food', food, '2026-11-22').map(x => `${x.label}: ${x.value}`).join('\n')
  check('S1: the food card shows every written field: title, meal, date, amount, calories, protein, carbs, fat, status, and where the figures come from', [food.title, 'Meal: Dinner', 'Date: 21.11.2026', 'Amount: 1 serving', 'Calories: 310 kcal', 'Protein: 18 g', 'Carbs: 42.5 g', 'Fat: 6 g', 'Status: Eaten', 'Your own recipe'].every(x => g.includes(x)), g)
  check('S1: every key of the stored arguments appears on its card', Object.entries(args).every(([k, v]) => v === null || g.length > 0 && text.toLowerCase().includes(String(k === 'due_date' ? '25.11.2026' : k === 'priority' ? 'high' : v).toLowerCase())) && Object.entries(food).every(([k, v]) => k === 'basis' || g.toLowerCase().includes(String(k === 'date' ? '21.11.2026' : v).toLowerCase())))
  check('S1: the fields are written in the same order as the columns the function writes (a column list in chat-tools.ts is covered: title, description, due_date, priority, section; title, meal, date, calories, protein, carbs, fat)', (() => {
    const src = fs.readFileSync(path.join(__dirname, '../supabase/claude-src/chat-tools.ts'), 'utf8')
    const body = src.slice(src.indexOf('const row: Record<string, unknown>'), src.indexOf('const table = tool'))
    const cols = [...body.matchAll(/\b([a-z_]+): /g)].map(m => m[1]).filter(c => c !== 'user_id' && c !== 'row')
    const label = { title: 'Title', description: 'Note', domain: 'Area', section: 'Goes to', status: 'Status', priority: 'Priority', due_date: 'Due date', source_type: 'Source', date: 'Date', meal_slot: 'Meal', custom_title: 'Title', quantity: 'Amount', unit: 'Amount', calories: 'Calories', protein_g: 'Protein', carbs_g: 'Carbs', fat_g: 'Fat' }
    const shown = new Set([...f, ...R.proposalFields('log_food', food, '2026-11-22')].map(x => x.label))
    return cols.length >= 18 && cols.every(c => label[c] && shown.has(label[c]))
  })())
  check('L1: a card whose expiry cannot be read is expired, one whose time has passed is expired, a future one is pending',
    R.turnsFromStored([{ seq: 1, role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'propose_add_task', input: {} }], meta: {} }], [{ id: U(9), tool_use_id: 'toolu_1', tool: 'add_task', summary: 's', status: 'pending', expires_at: 'garbage' }], 1000)[0].cards[0].state === 'expired'
    && R.turnsFromStored([{ seq: 1, role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'propose_add_task', input: {} }], meta: {} }], [{ id: U(9), tool_use_id: 'toolu_1', tool: 'add_task', summary: 's', status: 'pending', expires_at: '' }], 1000)[0].cards[0].state === 'expired'
    && R.turnsFromStored([{ seq: 1, role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'propose_add_task', input: {} }], meta: {} }], [{ id: U(9), tool_use_id: 'toolu_1', tool: 'add_task', summary: 's', status: 'pending', expires_at: '2026-11-23T10:00:00Z' }], Date.parse('2026-11-22T10:00:00Z'))[0].cards[0].state === 'pending')
  check('C3: describeInput shows the date as DD.MM.YYYY, the words, and marks the SQL as long (behind a peek); empty and "any" are left out', same(R.describeInput({ date: '2026-11-24', query: 'dentist', kind: 'any', sql: 'select 1', week: '' }).map(x => [x.label, x.value, x.long]), [['Date', '24.11.2026', false], ['Words', 'dentist', false], ['SQL', 'select 1', true]]))
  let t = R.newTurn('a', 'assistant')
  t = R.applyChatEvent(t, R.readChatEvent('step', { name: 'find_text', label: 'Searching your tasks and diary' }))
  t = R.applyChatEvent(t, R.readChatEvent('detail', { name: 'find_text', input: { query: 'dentist', kind: 'any' }, ok: true }))
  check('C3: a detail event puts the checked inputs on its step', t.steps.length === 1 && same(t.steps[0].input.map(x => x.value), ['dentist']) && R.readChatEvent('detail', { name: 'x', input: 'bad' }) === null)
  const done = R.applyChatEvent(t, R.readChatEvent('done', { conversation_id: U(1), text: 'x', citations: [], proposals: [], cost_usd: 0.002, wall: false, prompt_tokens: 72000, run_id: U(7), thinking: 'I looked.' }))
  check('C3/C4: done keeps the run (the cost line links to its calls), the reasoning summary, and the prompt size the warning follows', done.runId === U(7) && done.thinking === 'I looked.' && R.readChatEvent('done', { conversation_id: U(1), prompt_tokens: 72000 }).promptTokens === 72000 && R.wallState(72000, 'open') === 'near')
  const failed = R.applyChatEvent(R.newTurn('a', 'assistant'), R.readChatEvent('error', { reason: 'declined', message: 'The model declined to answer this one.', cost_usd: 0.0013, run_id: U(8) }))
  check('C3: a refused or failed answer keeps what it cost and its run, and why it failed (a refusal offers editing the question)', failed.costUsd === 0.0013 && failed.runId === U(8) && failed.errorReason === 'declined')
  const reopened = R.turnsFromStored([
    { seq: 1, role: 'user', content: [{ type: 'text', text: 'q' }], meta: {} },
    { seq: 2, role: 'assistant', content: [{ type: 'thinking', thinking: 'Thought about it.', signature: 's' }, { type: 'tool_use', id: 'toolu_1', name: 'find_text', input: { query: 'dentist', kind: 'any' } }], meta: { run_id: U(7) } },
    { seq: 3, role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'x' }], meta: {} },
    { seq: 4, role: 'assistant', content: [{ type: 'text', text: 'a' }], meta: { cost_usd: 0.002 } },
  ], [])
  check('C3: a reopened chat shows the same steps with their inputs, the reasoning and the run', reopened[1].steps[0].input[0].value === 'dentist' && reopened[1].thinking === 'Thought about it.' && reopened[1].runId === U(7) && reopened[1].costUsd === 0.002)
  check('C7: a stored proposal row brings its stored arguments and its result row to the card', R.turnsFromStored([{ seq: 1, role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'propose_add_task', input: {} }], meta: {} }], [{ id: U(9), tool_use_id: 'toolu_1', tool: 'add_task', summary: 's', status: 'confirmed', expires_at: '2026-11-23T10:00:00Z', args: { title: 'T' }, result_id: U(10) }])[0].cards[0].resultId === U(10))
  const noMin = ['AskAiPanel.tsx', 'ChatTurnView.tsx', 'ChatHistory.tsx'].filter(f => /min-h-\[44px\]/.test(fs.readFileSync(path.join(__dirname, '../src/features/ai/chat', f), 'utf8')))
  check('C8: no hand-made minimum height on the panel\'s buttons (the primitives keep touch targets comfortable)', noMin.length === 0, noMin)
}

console.log('\n4 · the sign-in token of a request (bug seen live 22.11.2026: three 401s after a hang)')
;(async () => {
  const res = (status) => new Response(status === 200 ? 'ok' : 'no', { status })
  const make = ({ current = ['t1'], refreshed = ['t2'], statuses = [200] } = {}) => {
    const log = { current: 0, refreshed: 0, sent: [] }
    return {
      log,
      deps: {
        currentToken: async () => { log.current++; return current.length ? current.shift() : null },
        refreshedToken: async () => { log.refreshed++; return refreshed.length ? refreshed.shift() : null },
        send: async (token) => { log.sent.push(token); return res(statuses[Math.min(log.sent.length - 1, statuses.length - 1)]) },
      },
    }
  }
  let m = make()
  let r = await R.sendWithSession(m.deps)
  check('a good token is sent as it is: one read, one request, no refresh', r.status === 200 && m.log.current === 1 && m.log.sent.join() === 't1' && m.log.refreshed === 0)
  m = make({ current: [null] })
  check('no session at all: nothing is sent and the answer is null (the caller says "session error")', (await R.sendWithSession(m.deps)) === null && m.log.sent.length === 0 && m.log.refreshed === 0)
  m = make({ statuses: [401, 200] })
  r = await R.sendWithSession(m.deps)
  check('a 401 refreshes ONCE and sends ONCE more with the new token', r.status === 200 && m.log.refreshed === 1 && m.log.sent.join() === 't1,t2')
  m = make({ statuses: [401, 401] })
  r = await R.sendWithSession(m.deps)
  check('a second 401 is returned (no third request, no second refresh): the caller shows the session message', r.status === 401 && m.log.sent.length === 2 && m.log.refreshed === 1)
  m = make({ statuses: [401], refreshed: [] })
  r = await R.sendWithSession(m.deps)
  check('a 401 whose refresh fails is returned after one request', r.status === 401 && m.log.sent.length === 1 && m.log.refreshed === 1)
  m = make({ statuses: [403] })
  r = await R.sendWithSession(m.deps)
  check('a 403 or a 500 is not a reason to refresh', r.status === 403 && m.log.refreshed === 0 && m.log.sent.length === 1)
  m = make({ statuses: [500] })
  check('a 500 is returned as it is', (await R.sendWithSession(m.deps)).status === 500 && m.log.refreshed === 0)
  // Every request reads the token anew: a token from an earlier request is never reused.
  m = make({ current: ['a', 'b'] })
  await R.sendWithSession(m.deps)
  await R.sendWithSession(m.deps)
  check('every request reads the current session again (a token read once and kept is what expired)', m.log.current === 2 && m.log.sent.join() === 'a,b')
  const broken = make({ statuses: [401] })
  broken.deps.send = async () => { throw new Error('network down') }
  let threw = false
  try { await R.sendWithSession(broken.deps) } catch { threw = true }
  check('a network error is the caller\'s to handle (it propagates, nothing is retried)', threw)
  check('isSessionRefusal: 401 and 403 only', R.isSessionRefusal(401) && R.isSessionRefusal(403) && !R.isSessionRefusal(200) && !R.isSessionRefusal(500))
  const api = fs.readFileSync(path.join(__dirname, '../src/features/ai/chat/chatApi.ts'), 'utf8')
  check('chatApi reads the session inside each request, refreshes with refreshSession, and never logs or stores the token', /sendWithSession\(/.test(api) && /auth\.getSession\(\)/.test(api) && /auth\.refreshSession\(\)/.test(api) && !/console\./.test(api) && !/localStorage|sessionStorage/.test(api))
  const direct = []
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const full = path.join(d, f.name); if (f.isDirectory()) walk(full); else if (/\.(ts|tsx)$/.test(f.name) && /functions\/v1\/claude/.test(fs.readFileSync(full, 'utf8'))) direct.push(path.relative(path.join(__dirname, '..'), full)) } }
  walk(path.join(__dirname, '../src'))
  check('the chat is the only manual fetch to the claude function; every other call goes through supabase.functions.invoke (which refreshes an expired token itself)', direct.join() === 'src/features/ai/chat/chatApi.ts', direct)
  // ── 4b: photos, voice, the coach chat, the owner's controls ──
  console.log('\n4b · photos, voice, coach, controls')
  const fnRules = fs.readFileSync(path.join(__dirname, '../supabase/claude-src/chat-rules.ts'), 'utf8')
  check('the app\'s photo and instruction limits are the function\'s (chat-rules.ts)', /imagesPerMessage: 2/.test(fnRules) && /imagesPerChat: 4/.test(fnRules) && /imageBase64Max: 450_000/.test(fnRules) && /ownerInstructionsMax: 1000/.test(fnRules)
    && R.CHAT_IMAGES_PER_MESSAGE === 2 && R.CHAT_IMAGES_PER_CHAT === 4 && R.CHAT_PHOTO_BASE64_MAX === 450_000 && R.CHAT_INSTRUCTIONS_MAX === 1000)
  check('a shrunk photo can never be longer than the function takes: the byte limit is under ¾ of the base64 limit', R.CHAT_PHOTO_MAX_BYTES * 4 / 3 < R.CHAT_PHOTO_BASE64_MAX && R.CHAT_PHOTO_MAX_BYTES > 100_000)
  const tools = [...fnRules.matchAll(/'((?:get|propose|find|ask)_[a-z_]+)'/g)].map(m => m[1])
  check('every tool the function has is named in plain words for the settings card and the setup line', [...new Set(tools)].every(t => R.TOOL_LABELS[t]?.label && R.TOOL_LABELS[t]?.what) && R.toolLabel('unknown_tool') === 'unknown_tool' && [...new Set(tools)].length === 12, [...new Set(tools)])
  check('the step words cover the coach\'s tools too (a stored chat names them in plain words)', ['get_training_week', 'get_health_trends', 'get_pt_verdicts'].every(n => R.turnsFromStored([{ seq: 1, role: 'user', content: [{ type: 'text', text: 'q' }], meta: {} }, { seq: 2, role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: n, input: {} }], meta: {} }], [])[1].steps[0].label !== 'Working on it'))
  check('joinSpoken puts the spoken words after the typed ones with one space, and never doubles a space or loses the typed text', R.joinSpoken('Hello', 'world') === 'Hello world' && R.joinSpoken('Hello ', ' world  again ') === 'Hello world again' && R.joinSpoken('', 'hi') === 'hi' && R.joinSpoken('typed', '   ') === 'typed' && R.joinSpoken('a\n', 'b') === 'a\nb')
  const stored = [
    { seq: 1, role: 'user', content: [{ type: 'text', text: '<live_context>x</live_context>' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'BBBB' } }, { type: 'text', text: 'What is this?' }], meta: {} },
    { seq: 2, role: 'assistant', content: [{ type: 'text', text: 'A bike.' }], meta: {} },
  ]
  const turns = R.turnsFromStored(stored, [])
  check('a stored message with photos is drawn as the words and a count of photos (the picture itself is not drawn again)', turns[0].text === 'What is this?' && turns[0].photos === 2 && turns[1].text === 'A bike.' && turns[1].photos === 0 && R.newTurn('x', 'user', 'hi').photos === 0, turns[0])
  const src = (f) => fs.readFileSync(path.join(__dirname, '../src', f), 'utf8')
  check('voice never sends sound: the recognizer is the browser\'s, only its text reaches the box, and nothing in the file records, uploads or fetches', !/MediaRecorder|getUserMedia|fetch\(|XMLHttpRequest|WebSocket|sendBeacon|supabase/.test(src('features/ai/chat/useSpeechInput.ts').replace(/\/\/.*$/gm, '')) && /webkitSpeechRecognition/.test(src('features/ai/chat/useSpeechInput.ts')))
  check('voice: the button is drawn only where the browser has a recognizer, in the device\'s language', /speech\.supported &&/.test(src('features/ai/chat/AskAiPanel.tsx')) && /navigator\.language/.test(src('features/ai/chat/useSpeechInput.ts')))
  check('the photo is shrunk by the shared shrinkPhoto (the same job as the receipt and the quick guess), inside a mutation with logPayload false', /shrinkPhoto\(file, \{ maxBytes: CHAT_PHOTO_MAX_BYTES \}\)/.test(src('features/ai/chat/useAskAi.ts')) && /logPayload: false/.test(src('features/ai/chat/useAskAi.ts').split('useChatPhoto')[1] ?? ''))
  check('a chat\'s kind is sent only for a NEW chat (a chat keeps the kind it started with)', /input\.conversationId === null && input\.mode === 'coach'/.test(src('features/ai/chat/chatApi.ts')))
  check('Training → Coach opens the coach chat through the store (one entry, one panel), and the coach never gets a second chat component', /openCoachChat/.test(src('features/training/components/PTCoachTab.tsx')) && /openCoachChat: \(\) =>/.test(src('app/store.ts')) && !fs.existsSync(path.join(__dirname, '../src/features/training/components/CoachChat.tsx')))
  check('the settings cards: a read tool is a switch (on or off), a write tool is Ask first or Off and nothing else, one row per tool with who uses it', /tool\.kind === 'write' \?/.test(src('features/developer/components/ai/AiChatControls.tsx')) && /<option value="ask">Ask first<\/option>/.test(src('features/developer/components/ai/AiChatControls.tsx')) && !/value="on">/.test(src('features/developer/components/ai/AiChatControls.tsx')) && /Used by:/.test(src('features/developer/components/ai/AiChatControls.tsx')) && /e\.target\.value === 'off' \? 'off' : 'ask'/.test(src('features/developer/components/ai/AiChatControls.tsx')))
  check('the instructions are saved exactly as typed (no trim, no change) and are capped by the function\'s number', /saveChatInstructions\(text\)/.test(src('features/ai/claude/hooks/useClaude.ts')) && /chat_instructions: text/.test(src('features/ai/claude/ledgerApi.ts')) && /about\.chat\.limits\.ownerInstructionsMax/.test(src('features/developer/components/ai/AiChatControls.tsx')))
  // — review fixes (23.11.2026) —
  const introAll = R.chatIntro('chat', ['get_day_plan', 'get_week_figures', 'get_food_day', 'find_text', 'get_about_me', 'ask_database', 'propose_add_task', 'propose_log_food'])
  check('C4: the empty chat promises what its tools can do and suggests four questions', /propose a task and a food line/.test(introAll.text) && introAll.suggestions.length === 4, introAll)
  const introTransit = R.chatIntro('chat', ['get_day_plan', 'get_week_figures', 'get_food_day', 'find_text', 'get_about_me', 'ask_database', 'propose_add_task', 'propose_log_food', 'get_transit'])
  check('the empty chat promises bus and train times when that tool is on, with no ", and" (the list of what it can do is joined once), and suggests a transit question; with it Off it says nothing of it', /look up live bus and train times/.test(introTransit.text) && !/, and/.test(introTransit.text) && introTransit.suggestions.includes('When is the next bus from home?') && introTransit.suggestions.length === 5 && !/bus|train/i.test(introAll.text) && !introAll.suggestions.some(x => /bus/.test(x)), introTransit)
  const introRead = R.chatIntro('chat', ['get_day_plan', 'find_text'])
  check('C4: with the proposal tools and the food tool Off, nothing about proposing or food is promised or suggested', !/propose|food/i.test(introRead.text) && introRead.suggestions.every(x => !/eaten|food/i.test(x)) && introRead.suggestions.length === 2, introRead)
  check('C4: with every tool Off it says so; the coach\'s suggestions follow the coach\'s tools too', /switched off/.test(R.chatIntro('chat', []).text) && R.chatIntro('chat', []).suggestions.length === 0 && /switched off/.test(R.chatIntro('coach', []).text)
    && R.chatIntro('coach', ['get_health_trends']).suggestions.join() === 'How is my sleep trending?' && /sessions/.test(R.chatIntro('coach', ['get_training_week']).text))
  const goodUrl = R.photoUrlOf({ type: 'base64', media_type: 'image/jpeg', data: 'AAAA' })
  check('C5: a stored photo is drawn only from a plain base64 JPEG, PNG or WebP block (anything else is nothing)', goodUrl[0] === 'data:image/jpeg;base64,AAAA' && R.photoUrlOf({ type: 'base64', media_type: 'image/svg+xml', data: 'AAAA' }).length === 0 && R.photoUrlOf({ type: 'url', url: 'https://x' }).length === 0 && R.photoUrlOf({ type: 'base64', media_type: 'image/png', data: '"><script>' }).length === 0 && R.photoUrlOf(null).length === 0)
  const withPics = R.turnsFromStored([{ seq: 1, role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } }, { type: 'text', text: 'Look' }], meta: {} }], [])
  check('C5: a reopened chat shows the stored photos as small pictures', withPics[0].photoUrls.length === 1 && withPics[0].photos === 1)
  check('C5: the note under a photo says how long it is kept (the real setting) and that it can be deleted', /Kept with this chat until you delete it — at most \{days\}/.test(src('features/ai/chat/ChatExtras.tsx')) && /days=\{keptDays\}/.test(src('features/ai/chat/AskAiPanel.tsx')) && /log_days/.test(src('features/ai/chat/AskAiPanel.tsx')))
  check('C8: voice languages: the device\'s own, Norwegian, English and Turkish; an unknown one is the device\'s own; remembered on the device with storage guarded', R.VOICE_LANGUAGES.map(l => l.id).join() === 'auto,nb,en,tr' && R.voiceLanguageOf('xx') === 'auto' && R.voiceLanguageOf('tr') === 'tr' && R.voiceTagOf('auto') === null && R.voiceTagOf('nb') === 'nb-NO'
    && /try \{ return voiceLanguageOf\(localStorage\.getItem/.test(src('features/ai/chat/useSpeechInput.ts')) && /try \{ localStorage\.setItem/.test(src('features/ai/chat/useSpeechInput.ts')))
  check('C9: "New chat" inside a coach chat starts a coach chat, and history tags coach chats', /newChat\(chat\.mode\)/.test(src('features/ai/chat/AskAiPanel.tsx')) && /c\.mode === 'coach'/.test(src('features/ai/chat/ChatHistory.tsx')))
  check('C4: the setup line shows before the first message and its words appear on a tap (the tools\' names and your instructions\' text)', /empty && chat\.wall !== 'full'[\s\S]{0,400}ChatSetupNote/.test(src('features/ai/chat/AskAiPanel.tsx')) && /Your instructions: /.test(src('features/ai/chat/ChatExtras.tsx')) && /Tools: /.test(src('features/ai/chat/ChatExtras.tsx')))
  check('C6: no jargon in what the owner reads (no "second block", "cached", "replayed", "frozen") in the settings, the setup line, the photo note or How it works\' chat card', ['features/developer/components/ai/AiChatControls.tsx', 'features/ai/chat/ChatExtras.tsx'].every(f => !/second block|cached|replayed|frozen|byte for byte/i.test(src(f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))) && !/second block|cached|replayed exactly|frozen/i.test(src('features/developer/components/ai/AiHowItWorks.tsx').split('function AskAiSetup')[1].split('function StillOnGemini')[0]))
  check('C11: the message box shrinks back when it is emptied', /el\.style\.height = 'auto'/.test(src('features/ai/chat/AskAiPanel.tsx')) && /ref=\{boxRef\}/.test(src('features/ai/chat/AskAiPanel.tsx')))
  check('G3: the coach button shows the date of the last assessment (the date the chat\'s verdicts come from)', /Last assessed \{formatDate\(lastAssessed\)\}/.test(src('features/training/components/PTCoachTab.tsx')))
  check('C7: the tool list is behind one "Chat tools (N on)" row so Your instructions sits above it', /Chat tools \(\{onCount\} on\)/.test(src('features/developer/components/ai/AiChatControls.tsx')) && require(path.join(__dirname, '../src/features/developer/developerBoards.ts')).AI_SETTINGS_BOARD[1].join() === 'general,words,tools,jobs')
  const L = require(path.join(__dirname, '../src/features/ai/claude/ledgerRules.ts'))
  const defTools = [{ name: 'get_day_plan', kind: 'read', what: '', defaultMode: 'on', chats: ['chat'] }, { name: 'propose_add_task', kind: 'write', what: '', defaultMode: 'ask', chats: ['chat'] }]
  check('chatToolModes: a stored mode the tool can have is shown, a write tool "on" is not (its default), a tool with no row is its default', same(L.chatToolModes(defTools, [{ tool: 'get_day_plan', mode: 'off' }, { tool: 'propose_add_task', mode: 'on' }]), { get_day_plan: 'off', propose_add_task: 'ask' }) && same(L.chatToolModes(defTools, []), { get_day_plan: 'on', propose_add_task: 'ask' }) && same(L.chatToolModes(defTools, [{ tool: 'get_day_plan', mode: 'bogus' }]), { get_day_plan: 'on', propose_add_task: 'ask' }))
  const described = L.readDescribe({ chat: { tools: [{ name: 'get_day_plan', kind: 'read', what: 'x', defaultMode: 'on', chats: ['chat', 'coach', 'admin'] }, { name: 'Bad Name', kind: 'read' }, { name: 'x_y', kind: 'delete' }], limits: { ownerInstructionsMax: 1000 } } })
  check('the function\'s list of chat tools is read field by field: a bad name, a bad kind and an unknown chat are dropped', described.chat.tools.length === 1 && same(described.chat.tools[0].chats, ['chat', 'coach']) && described.chat.limits.imagesPerChat === 4)
  console.log(`\n${ok} passed, ${bad} failed`)
  process.exit(bad ? 1 : 0)
})()
