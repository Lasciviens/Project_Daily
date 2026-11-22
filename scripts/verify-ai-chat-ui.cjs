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
  check('text after a lookup starts a new paragraph, text within a request does not; a step is listed once', t.text === 'Let me look.\n\nYou have two things.' && t.steps.length === 1 && t.streaming === true, t)
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
console.log(`\n${ok} passed, ${bad} failed`)
process.exit(bad ? 1 : 0)
