'use strict'
// Ask AI (the `claude` function's chat action, migration 197) as the harness plays it: no model is asked. `chat`
// answers the server-sent events the real function streams (start, step, text, proposal, done / error) from the words of
// the message, and keeps the chat in the context's own tables like the function does (ai_conversations, ai_messages,
// ai_chat_proposals); `chat_confirm` decides a proposal and, on Confirm, adds the row to tasks / food_log_entries.
// Kept in step with the real function by hand: the events and rows are the contract's (src/features/ai/chat/chatRules.ts).
//
//   a message with "flowers" or "banana"  → two lookups' worth of steps and a proposal card
//   a message with "dentist"              → a find_text step and an answer with two citations
//   a message with "protein"              → a plain answer that also noted an idea (the quiet line under it: "This could be a widget")
//   a message with "wall" or "long"       → the chat is full (the "start a new chat" wall)
//   a message with "refuse"               → a refusal after some streamed text (retract, then the error)
//   anything else                         → a short plain answer

const { randomUUID } = require('node:crypto')

const sse = (events) => events.map(e => `event: ${e.event}\ndata: ${JSON.stringify(e)}\n\n`).join('')
const FAKE_TOKENS = { input_tokens: 420, cache_read_tokens: 2610, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0, output_tokens: 230, thinking_tokens: 60 }

/** The answer for one message: the events, and the messages a stored chat would hold. */
function plan(text, store, mode) {
  const lower = text.toLowerCase()
  const tasks = store.tables.tasks ?? []
  const diaryDay = '2026-11-20'
  if (/\b(wall|long)\b/.test(lower)) return { kind: 'wall' }
  if (/refus/.test(lower)) return { kind: 'refuse' }
  if (/flowers|banana|propose/.test(lower)) {
    const food = /banana/.test(lower)
    const proposal = food
      ? { tool: 'log_food', summary: 'Log "Banana" as snack: 90 kcal, protein 1 g, carbs 23 g, fat 0.3 g (your own saved preset)', args: { title: 'Banana', meal: 'snack', date: new Date().toISOString().slice(0, 10), calories: 90, protein_g: 1, carbs_g: 23, fat_g: 0.3, basis: 'preset' } }
      : { tool: 'add_task', summary: 'Add task "Buy flowers" due 25.11.2026', args: { title: 'Buy flowers', description: 'For Anna\'s birthday on Saturday', due_date: '2026-11-25', priority: 'medium' } }
    return {
      kind: 'proposal', proposal,
      steps: [food ? 'Preparing a food line for you to confirm' : 'Preparing a task for you to confirm'],
      reply: food ? 'I have prepared a banana for your snack. It is saved only after you tap Confirm.' : 'I have prepared a task to buy flowers for Tuesday. It is saved only after you tap Confirm.',
      tool_name: food ? 'propose_log_food' : 'propose_add_task',
    }
  }
  // The coach chat (4b): its own tools and its own words.
  if (mode === 'coach') {
    return { kind: 'coach', steps: ["Looking at the week's training"], tool_name: 'get_training_week', reply: 'This week you trained **3 times**: Push on Monday, Pull on Wednesday and Legs on Friday. Your last assessment (from 21.11.2026) said **technique day**, so keep Friday light.' }
  }
  if (/dentist|find|where/.test(lower)) {
    const task = tasks.find(t => /dentist|tannlege/i.test(String(t.title))) ?? tasks[0]
    const citations = [
      ...(task ? [{ kind: 'task', id: task.id, title: String(task.title), day: task.due_date ?? null }] : []),
      { kind: 'diary', id: randomUUID(), title: 'Diary', day: diaryDay },
    ]
    return { kind: 'find', citations, steps: ['Searching your tasks and diary'], reply: `I found a task about the dentist and a **diary line from 20.11.2026** that mentions walking past it.` }
  }
  if (/protein/.test(lower)) return { kind: 'plain', suggestion: { kind: 'widget' }, reply: 'Today you are at **96 g** of protein, against a target of **140 g**.' }
  return { kind: 'plain', reply: 'Hello! I can look up your plan, your week, your food and your own notes, and propose a task or a food line for you to confirm.' }
}

/** Writes the chat the way the function does: the conversation, the user message, the answer (and its proposal). */
function keepChat(store, body, p, text, costUsd, runId) {
  const t = (n) => (store.tables[n] ??= [])
  const owner = store.ownerId
  let conversation = t('ai_conversations').find(c => c.id === body.conversation_id && c.user_id === owner)
  const now = new Date().toISOString()
  if (!conversation) {
    const coach = body.mode === 'coach'
    // The tools a new chat starts with: the owner's switches (ai_tool_settings), like the function; a write tool only ask or off.
    const off = new Set((t('ai_tool_settings') ?? []).filter(r => r.user_id === owner && r.mode === 'off').map(r => r.tool))
    const all = coach ? ['get_day_plan', 'get_about_me', 'get_training_week', 'get_health_trends', 'get_pt_verdicts', 'note_shortcut'] : ['get_day_plan', 'get_week_figures', 'get_food_day', 'find_text', 'get_about_me', 'ask_database', 'propose_add_task', 'propose_log_food', 'note_shortcut']
    const words = String((store.tables.ai_settings ?? [])[0]?.chat_instructions ?? '')
    conversation = { id: randomUUID(), user_id: owner, created_at: now, updated_at: now, title: text.slice(0, 60), model: 'claude-haiku-5-5', effort: 'medium', thinking: 'adaptive', tools_hash: 'a'.repeat(64), system_hash: 'b'.repeat(64), tool_names: all.filter(n => !off.has(n)), mode: coach ? 'coach' : 'chat', owner_instructions: words, status: 'open', message_count: 0, last_prompt_tokens: 0, cost_usd: 0, deleted_at: null }
    t('ai_conversations').push(conversation)
  }
  const seq0 = conversation.message_count
  const callId = randomUUID()
  t('ai_calls').push({
    id: callId, user_id: owner, created_at: now, run_id: runId, step: 1, job: 'chat', caller: 'app', mode: 'live', provider: 'anthropic', model: 'claude-haiku-5-5', served_model: 'claude-haiku-5-5', effort: 'medium',
    outcome: 'ok', stop_reason: 'end_turn', error: null, request_id: `req_harness_chat_${seq0}`, ...FAKE_TOKENS, long_prompt: false, cost_usd: costUsd, duration_ms: 2100,
    instructions_version: '2026-11-22.1', tools: [], request: null, response: null, thinking: null,
  })
  const toolUse = p.kind === 'proposal' || p.kind === 'coach' ? [{ type: 'tool_use', id: `toolu_${seq0}`, name: p.tool_name, input: {} }] : p.kind === 'find' ? [{ type: 'tool_use', id: `toolu_${seq0}`, name: 'find_text', input: {} }] : []
  t('ai_messages').push({ id: randomUUID(), conversation_id: conversation.id, user_id: owner, seq: seq0 + 1, role: 'user', content: [...(Array.isArray(body.images) ? body.images.slice(0, 2).map(i => ({ type: 'image', source: { type: 'base64', media_type: i.media_type, data: i.data } })) : []), { type: 'text', text }], digest: 'c'.repeat(64), call_id: null, meta: {}, created_at: now })
  t('ai_messages').push({ id: randomUUID(), conversation_id: conversation.id, user_id: owner, seq: seq0 + 2, role: 'assistant', content: [...toolUse, { type: 'text', text: p.reply }], digest: 'd'.repeat(64), call_id: callId,
    meta: { message_id: `msg_${seq0}`, cost_usd: costUsd, run_id: runId, ...(p.citations ? { citations: p.citations } : {}) }, created_at: now })
  let card = null
  if (p.kind === 'proposal') {
    card = { id: randomUUID(), tool: p.proposal.tool, summary: p.proposal.summary, expires_at: new Date(Date.now() + 86_400_000).toISOString() }
    t('ai_chat_proposals').push({ id: card.id, user_id: owner, conversation_id: conversation.id, tool_use_id: `toolu_${seq0}`, tool: p.proposal.tool, args: p.proposal.args, summary: card.summary, status: 'pending', created_at: now, expires_at: card.expires_at, decided_at: null, result_id: null })
  }
  Object.assign(conversation, { message_count: seq0 + 2, last_prompt_tokens: 3030, cost_usd: Number(conversation.cost_usd) + costUsd, updated_at: now })
  return { conversation, card }
}

function chatAnswer(body, store, opts = {}) {
  const stream = (events) => ({ status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' }, body: sse(events) })
  if (opts.configured === false) return stream([{ event: 'error', reason: 'not_configured', message: 'AI is not set up yet: the server has no API key for it.' }])
  if ((store.tables.ai_settings ?? [])[0]?.ai_enabled === false) return stream([{ event: 'error', reason: 'off', message: 'All AI is switched off in Developer → AI → Settings.' }])
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) return stream([{ event: 'error', reason: 'bad_input', message: 'Write a message of 1 to 4000 characters.' }])
  const known = (store.tables.ai_conversations ?? []).find(c => c.id === body.conversation_id && c.user_id === store.ownerId)
  const p = plan(text, store, known ? known.mode : body.mode === 'coach' ? 'coach' : 'chat')
  if (p.kind === 'wall') return stream([{ event: 'error', reason: 'wall', message: 'This chat is full. Start a new chat: it keeps working at its best when it is short.', conversation_id: body.conversation_id ?? undefined }])
  if (p.kind === 'refuse') return stream([{ event: 'start', conversation_id: randomUUID(), is_new: true }, { event: 'text', t: 'Let me think about ' }, { event: 'retract' }, { event: 'error', reason: 'declined', message: 'The model declined to answer this one. Try asking it in other words.', cost_usd: 0.0013, run_id: randomUUID() }])
  const costUsd = p.kind === 'plain' ? 0.0004 : 0.0021
  const runId = randomUUID()
  const { conversation, card } = keepChat(store, body, p, text, costUsd, runId)
  const events = [{ event: 'start', conversation_id: conversation.id, is_new: conversation.message_count === 2 }]
  const toolName = p.kind === 'find' ? 'find_text' : p.kind === 'proposal' || p.kind === 'coach' ? p.tool_name : 'tool'
  const toolInput = p.kind === 'find' ? { query: 'dentist', kind: 'any' } : p.kind === 'proposal' ? { title: p.proposal.args.title } : {}
  for (const label of p.steps ?? []) { events.push({ event: 'step', name: toolName, label }); events.push({ event: 'detail', name: toolName, input: toolInput, ok: true }) }
  const words = p.reply.split(/(?<= )/)
  for (const w of words) events.push({ event: 'text', t: w })
  if (card) events.push({ event: 'proposal', ...card })
  events.push({ event: 'done', conversation_id: conversation.id, text: p.reply, citations: p.citations ?? [], proposals: card ? [card] : [], rounds: p.steps ? 2 : 1, cost_usd: costUsd, wall: false, run_id: runId, ending: 'complete', prompt_tokens: 3030, suggestion: p.suggestion ?? null, thinking: 'The question names a topic, so I looked it up with the search tool and read what it returned.' })
  return stream(events)
}

function confirmAnswer(body, store) {
  const owner = store.ownerId
  const proposal = (store.tables.ai_chat_proposals ?? []).find(x => x.id === body.proposal_id && x.user_id === owner)
  if (!proposal) return { ok: false, reason: 'not_found', message: 'That proposal was not found.' }
  if (proposal.status !== 'pending') return { ok: false, reason: 'already_decided', message: `That proposal was already ${proposal.status}.` }
  const now = new Date().toISOString()
  if (body.decision === 'cancel') { Object.assign(proposal, { status: 'cancelled', decided_at: now }); return { ok: true, status: 'cancelled', summary: proposal.summary, result_id: null, tool: proposal.tool } }
  const id = randomUUID()
  if (typeof body.title === 'string') proposal.args = { ...proposal.args, title: body.title.trim() }
  if (typeof body.date === 'string') proposal.args = { ...proposal.args, [proposal.tool === 'add_task' ? 'due_date' : 'date']: body.date === '' ? null : body.date }
  if (!String(proposal.args.title).trim()) return { ok: false, reason: 'bad_input', message: 'The title must be 1 to 200 characters.' }
  if (proposal.tool === 'add_task') (store.tables.tasks ??= []).push({ id, user_id: owner, title: proposal.args.title, description: null, domain: 'personal', section: 'backlog', status: 'open', priority: proposal.args.priority, due_date: proposal.args.due_date, source_type: 'ai', created_at: now, updated_at: now })
  else (store.tables.food_log_entries ??= []).push({ id, user_id: owner, date: now.slice(0, 10), meal_slot: proposal.args.meal, status: 'eaten', custom_title: proposal.args.title, quantity: 1, unit: 'serving', calories: proposal.args.calories, protein_g: proposal.args.protein_g, carbs_g: proposal.args.carbs_g, fat_g: proposal.args.fat_g, created_at: now })
  Object.assign(proposal, { status: 'confirmed', decided_at: now, result_id: id })
  return { ok: true, status: 'confirmed', summary: proposal.summary, result_id: id, tool: proposal.tool, date: proposal.tool === 'log_food' ? now.slice(0, 10) : null }
}

function deleteAnswer(body, store, deleted) {
  const c = (store.tables.ai_conversations ?? []).find(x => x.id === body.conversation_id && x.user_id === store.ownerId)
  if (!c || (deleted ? c.deleted_at : !c.deleted_at)) return { ok: false, reason: 'not_found', message: 'That chat was not found.' }
  c.deleted_at = deleted ? new Date().toISOString() : null
  return { ok: true, id: c.id, title: c.title }
}

/** The chat job as `describe` lists it (Developer → AI → How it works), with its eight tools. */
const CHAT_JOB_ABOUT = {
  name: 'chat', title: 'Ask AI', kind: 'conversation', mode: 'live', callers: ['app'], version: '2026-11-22.1',
  what: "The assistant chat: you ask, it looks things up with its tools and answers. It can only PROPOSE a task or a food line: nothing is saved until you tap Confirm in the app.",
  defaults: { model: 'claude-haiku-5-5', effort: 'medium', maxOutputTokens: 6000 }, timeLimitMs: null,
  instructions: 'You are Ask AI, the assistant inside Lasci\'s Board … (the fixed instructions, shown in full by the real function)', answerSchema: null,
  tools: [
    ['get_day_plan', 'Reads (code prepares the answer). One day\'s tasks and scheduled blocks.'], ['get_week_figures', 'Reads (code prepares the answer). The prepared figures of one week.'],
    ['get_food_day', 'Reads (code prepares the answer). One day\'s food and water against the targets.'], ['find_text', 'Reads (code prepares the answer). Finds your own tasks and diary lines by words.'],
    ['ask_database', 'Reads (code prepares the answer). The last resort: one read-only SQL query.'], ['propose_add_task', 'Only PROPOSES a write: nothing is saved until you tap Confirm. A new task.'],
    ['propose_log_food', 'Only PROPOSES a write: nothing is saved until you tap Confirm. One food line.'],
    ['get_about_me', 'Reads (code prepares the answer). Your own saved notes about yourself.'],
  ].map(([name, what]) => ({ name, what })),
  features: ['Our own loop: read tools run side by side, at most 5 requests per answer', 'Writes are proposals only'], sourceFiles: ['supabase/claude-src/chat-loop.ts', 'supabase/claude-src/chat-tools.ts'],
}

/** Two stored chats for the seed: an older answered one (with a citation) and a newer one with a card waiting for the tap. */
function chatSeed(owner, taskId, at) {
  const c1 = '00c4a700-0000-4000-8000-000000000001', c2 = '00c4a700-0000-4000-8000-000000000002'
  const p1 = '00c4a700-0000-4000-8000-0000000000a1'
  const conv = (id, title, days, over = {}) => ({ id, user_id: owner, created_at: at(days, '09:10'), updated_at: at(days, '09:12'), title, model: 'claude-haiku-5-5', effort: 'medium', thinking: 'adaptive', tools_hash: 'a'.repeat(64), system_hash: 'b'.repeat(64), tool_names: CHAT_JOB_ABOUT.tools.map(t => t.name), status: 'open', message_count: 4, last_prompt_tokens: 3400, cost_usd: 0.0031, deleted_at: null, ...over })
  const msg = (conversation, seq, role, content, days, meta = {}) => ({ id: `00c4a7ff-0000-4000-8000-${String(seq).padStart(4, '0')}${conversation.slice(-8)}`, conversation_id: conversation, user_id: owner, seq, role, content, digest: String(seq).repeat(64).slice(0, 64), call_id: null, meta, created_at: at(days, '09:11') })
  return {
    ai_conversations: [conv(c2, 'Add a task to buy flowers', -1, { message_count: 4 }), conv(c1, 'Where did I write about the dentist?', -3)],
    ai_messages: [
      msg(c1, 1, 'user', [{ type: 'text', text: 'Where did I write about the dentist?' }], -3),
      msg(c1, 2, 'assistant', [{ type: 'tool_use', id: 'toolu_s1', name: 'find_text', input: {} }], -3, { cost_usd: 0.001 }),
      msg(c1, 3, 'user', [{ type: 'tool_result', tool_use_id: 'toolu_s1', content: 'x' }], -3),
      msg(c1, 4, 'assistant', [{ type: 'text', text: 'You have **one task** about the dentist.' }], -3, { cost_usd: 0.0021, citations: [{ kind: 'task', id: taskId, title: 'Dentist', day: null }] }),
      msg(c2, 1, 'user', [{ type: 'text', text: 'Add a task to buy flowers on Tuesday' }], -1),
      msg(c2, 2, 'assistant', [{ type: 'tool_use', id: 'toolu_s2', name: 'propose_add_task', input: {} }], -1, { cost_usd: 0.001 }),
      msg(c2, 3, 'user', [{ type: 'tool_result', tool_use_id: 'toolu_s2', content: 'x' }], -1),
      msg(c2, 4, 'assistant', [{ type: 'text', text: 'I have prepared a task to buy flowers. It is saved only after you tap Confirm.' }], -1, { cost_usd: 0.0021 }),
    ],
    ai_chat_proposals: [{ id: p1, user_id: owner, conversation_id: c2, tool_use_id: 'toolu_s2', tool: 'add_task', args: { title: 'Buy flowers', description: 'For Anna\'s birthday on Saturday', due_date: '2026-11-25', priority: 'medium' }, summary: 'Add task "Buy flowers" due 25.11.2026', status: 'pending', created_at: at(-1, '09:11'), expires_at: new Date(Date.now() + 86_400_000).toISOString(), decided_at: null, result_id: null }],
  }
}

module.exports = { chatAnswer, confirmAnswer, deleteAnswer, CHAT_JOB_ABOUT, chatSeed }
