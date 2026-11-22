'use strict'
// Ask AI (the `claude` function's chat action, migration 197) as the harness plays it: no model is asked. `chat`
// answers the server-sent events the real function streams (start, step, text, proposal, done / error) from the words of
// the message, and keeps the chat in the context's own tables like the function does (ai_conversations, ai_messages,
// ai_chat_proposals); `chat_confirm` decides a proposal and, on Confirm, adds the row to tasks / food_log_entries.
// Kept in step with the real function by hand: the events and rows are the contract's (src/features/ai/chat/chatRules.ts).
//
//   a message with "flowers" or "banana"  → two lookups' worth of steps and a proposal card
//   a message with "dentist"              → a find_text step and an answer with two citations
//   a message with "wall" or "long"       → the chat is full (the "start a new chat" wall)
//   a message with "refuse"               → a refusal after some streamed text (retract, then the error)
//   anything else                         → a short plain answer

const { randomUUID } = require('node:crypto')

const sse = (events) => events.map(e => `event: ${e.event}\ndata: ${JSON.stringify(e)}\n\n`).join('')
const FAKE_TOKENS = { input_tokens: 420, cache_read_tokens: 2610, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0, output_tokens: 230, thinking_tokens: 60 }

/** The answer for one message: the events, and the messages a stored chat would hold. */
function plan(text, store) {
  const lower = text.toLowerCase()
  const tasks = store.tables.tasks ?? []
  const diaryDay = '2026-11-20'
  if (/\b(wall|long)\b/.test(lower)) return { kind: 'wall' }
  if (/refus/.test(lower)) return { kind: 'refuse' }
  if (/flowers|banana|propose/.test(lower)) {
    const food = /banana/.test(lower)
    const proposal = food
      ? { tool: 'log_food', summary: 'Log "Banana" as snack on 22.11.2026: 105 kcal, protein 1.3 g, carbs 27 g, fat 0.4 g', args: { title: 'Banana', meal: 'snack', date: null, calories: 105, protein_g: 1.3, carbs_g: 27, fat_g: 0.4 } }
      : { tool: 'add_task', summary: 'Add task "Buy flowers" due 25.11.2026', args: { title: 'Buy flowers', description: '', due_date: '2026-11-25', priority: 'medium' } }
    return {
      kind: 'proposal', proposal,
      steps: [food ? 'Preparing a food line for you to confirm' : 'Preparing a task for you to confirm'],
      reply: food ? 'I have prepared a banana for your snack. It is saved only after you tap Confirm.' : 'I have prepared a task to buy flowers for Tuesday. It is saved only after you tap Confirm.',
      tool_name: food ? 'propose_log_food' : 'propose_add_task',
    }
  }
  if (/dentist|find|where/.test(lower)) {
    const task = tasks.find(t => /dentist|tannlege/i.test(String(t.title))) ?? tasks[0]
    const citations = [
      ...(task ? [{ kind: 'task', id: task.id, title: String(task.title), day: task.due_date ?? null }] : []),
      { kind: 'diary', id: randomUUID(), title: 'Diary', day: diaryDay },
    ]
    return { kind: 'find', citations, steps: ['Searching your tasks and diary'], reply: `I found a task about the dentist and a **diary line from 20.11.2026** that mentions walking past it.` }
  }
  return { kind: 'plain', reply: 'Hello! I can look up your plan, your week, your food and your own notes, and propose a task or a food line for you to confirm.' }
}

/** Writes the chat the way the function does: the conversation, the user message, the answer (and its proposal). */
function keepChat(store, body, p, text, costUsd) {
  const t = (n) => (store.tables[n] ??= [])
  const owner = store.ownerId
  let conversation = t('ai_conversations').find(c => c.id === body.conversation_id && c.user_id === owner)
  const now = new Date().toISOString()
  if (!conversation) {
    conversation = { id: randomUUID(), user_id: owner, created_at: now, updated_at: now, title: text.slice(0, 60), model: 'claude-haiku-5-5', effort: 'medium', thinking: 'adaptive', tools_hash: 'a'.repeat(64), system_hash: 'b'.repeat(64), tool_names: ['get_day_plan', 'get_week_figures', 'get_food_day', 'find_text', 'ask_database', 'propose_add_task', 'propose_log_food'], status: 'open', message_count: 0, last_prompt_tokens: 0, cost_usd: 0 }
    t('ai_conversations').push(conversation)
  }
  const seq0 = conversation.message_count
  const callId = randomUUID()
  t('ai_calls').push({
    id: callId, user_id: owner, created_at: now, run_id: randomUUID(), step: 1, job: 'chat', caller: 'app', mode: 'live', provider: 'anthropic', model: 'claude-haiku-5-5', served_model: 'claude-haiku-5-5', effort: 'medium',
    outcome: 'ok', stop_reason: 'end_turn', error: null, request_id: `req_harness_chat_${seq0}`, ...FAKE_TOKENS, long_prompt: false, cost_usd: costUsd, duration_ms: 2100,
    instructions_version: '2026-11-22.1', tools: [], request: null, response: null, thinking: null,
  })
  const toolUse = p.kind === 'proposal' ? [{ type: 'tool_use', id: `toolu_${seq0}`, name: p.tool_name, input: {} }] : p.kind === 'find' ? [{ type: 'tool_use', id: `toolu_${seq0}`, name: 'find_text', input: {} }] : []
  t('ai_messages').push({ id: randomUUID(), conversation_id: conversation.id, user_id: owner, seq: seq0 + 1, role: 'user', content: [{ type: 'text', text }], digest: 'c'.repeat(64), call_id: null, meta: {}, created_at: now })
  t('ai_messages').push({ id: randomUUID(), conversation_id: conversation.id, user_id: owner, seq: seq0 + 2, role: 'assistant', content: [...toolUse, { type: 'text', text: p.reply }], digest: 'd'.repeat(64), call_id: callId,
    meta: { message_id: `msg_${seq0}`, cost_usd: costUsd, ...(p.citations ? { citations: p.citations } : {}) }, created_at: now })
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
  const p = plan(text, store)
  if (p.kind === 'wall') return stream([{ event: 'error', reason: 'wall', message: 'This chat is full. Start a new chat: it keeps working at its best when it is short.', conversation_id: body.conversation_id ?? undefined }])
  if (p.kind === 'refuse') return stream([{ event: 'start', conversation_id: randomUUID(), is_new: true }, { event: 'text', t: 'Let me think about ' }, { event: 'retract' }, { event: 'error', reason: 'declined', message: 'The model declined to answer this one. Try asking it in other words.' }])
  const costUsd = p.kind === 'plain' ? 0.0004 : 0.0021
  const { conversation, card } = keepChat(store, body, p, text, costUsd)
  const events = [{ event: 'start', conversation_id: conversation.id, is_new: conversation.message_count === 2 }]
  for (const label of p.steps ?? []) events.push({ event: 'step', name: 'tool', label })
  const words = p.reply.split(/(?<= )/)
  for (const w of words) events.push({ event: 'text', t: w })
  if (card) events.push({ event: 'proposal', ...card })
  events.push({ event: 'done', conversation_id: conversation.id, text: p.reply, citations: p.citations ?? [], proposals: card ? [card] : [], rounds: p.steps ? 2 : 1, cost_usd: costUsd, wall: false, run_id: randomUUID(), ending: 'complete' })
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
  if (proposal.tool === 'add_task') (store.tables.tasks ??= []).push({ id, user_id: owner, title: proposal.args.title, description: null, domain: 'personal', section: 'backlog', status: 'open', priority: proposal.args.priority, due_date: proposal.args.due_date, source_type: 'ai', created_at: now, updated_at: now })
  else (store.tables.food_log_entries ??= []).push({ id, user_id: owner, date: now.slice(0, 10), meal_slot: proposal.args.meal, status: 'eaten', custom_title: proposal.args.title, quantity: 1, unit: 'serving', calories: proposal.args.calories, protein_g: proposal.args.protein_g, carbs_g: proposal.args.carbs_g, fat_g: proposal.args.fat_g, created_at: now })
  Object.assign(proposal, { status: 'confirmed', decided_at: now, result_id: id })
  return { ok: true, status: 'confirmed', summary: proposal.summary, result_id: id, tool: proposal.tool }
}

/** The chat job as `describe` lists it (Developer → AI → How it works), with its seven tools. */
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
  ].map(([name, what]) => ({ name, what })),
  features: ['Our own loop: read tools run side by side, at most 5 requests per answer', 'Writes are proposals only'], sourceFiles: ['supabase/claude-src/chat-loop.ts', 'supabase/claude-src/chat-tools.ts'],
}

/** Two stored chats for the seed: an older answered one (with a citation) and a newer one with a card waiting for the tap. */
function chatSeed(owner, taskId, at) {
  const c1 = '00c4a700-0000-4000-8000-000000000001', c2 = '00c4a700-0000-4000-8000-000000000002'
  const p1 = '00c4a700-0000-4000-8000-0000000000a1'
  const conv = (id, title, days, over = {}) => ({ id, user_id: owner, created_at: at(days, '09:10'), updated_at: at(days, '09:12'), title, model: 'claude-haiku-5-5', effort: 'medium', thinking: 'adaptive', tools_hash: 'a'.repeat(64), system_hash: 'b'.repeat(64), tool_names: CHAT_JOB_ABOUT.tools.map(t => t.name), status: 'open', message_count: 4, last_prompt_tokens: 3400, cost_usd: 0.0031, ...over })
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
    ai_chat_proposals: [{ id: p1, user_id: owner, conversation_id: c2, tool_use_id: 'toolu_s2', tool: 'add_task', args: { title: 'Buy flowers', description: '', due_date: null, priority: 'medium' }, summary: 'Add task "Buy flowers" due 25.11.2026', status: 'pending', created_at: at(-1, '09:11'), expires_at: new Date(Date.now() + 86_400_000).toISOString(), decided_at: null, result_id: null }],
  }
}

module.exports = { chatAnswer, confirmAnswer, CHAT_JOB_ABOUT, chatSeed }
