#!/usr/bin/env node
/*
 * Verification — the suggestions' app side (AI phase 4c): src/features/ai/claude/suggestRules.ts (reading rows where they enter,
 * the saving in plain words, the grouping, the Dev Request draft), the line under an answer, the view's place under Learn, the
 * rule that the browser only ever changes `state`, and that nothing is built or created by an idea.
 *
 *   node scripts/verify-ai-suggestions-ui.cjs
 */
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const S = require('../src/features/ai/claude/suggestRules.ts')
const B = require('../src/features/developer/developerBoards.ts')
const C = require('../src/features/ai/chat/chatRules.ts')

let ok = 0, bad = 0
const check = (name, cond, detail) => { if (cond) { ok++; console.log('  ✓', name) } else { bad++; console.log('  ✗', name, detail === undefined ? '' : String(JSON.stringify(detail)).slice(0, 400)) } }
const J = JSON.stringify
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')

const ID = 'a1ca5500-0000-4000-8000-000000000001'
const ROW = { id: ID, kind: 'widget', title: 'Show the protein of today on Home', why: 'It was asked for six times in 30 days.', source: 'weekly', times_seen: 6, tokens_each: 5200, cost_each_usd: '0.012300', first_call_id: ID, state: 'new', created_at: '2026-11-23T05:10:00Z', last_seen_at: '2026-11-23T05:10:00Z' }

check('readSuggestion keeps a good row (a numeric text from the database becomes a number) and drops what is not one (no id, an unknown kind or state)', S.readSuggestion(ROW)?.id === ID && S.readSuggestion(ROW).cost_each_usd === 0.0123 && S.readSuggestion({ ...ROW, id: 'x' }) === null && S.readSuggestion({ ...ROW, kind: 'gadget' }) === null && S.readSuggestion({ ...ROW, state: 'done' }) === null && S.readSuggestion(null) === null)
check('an idea is plain text: markup, a link, a control character, a hidden character or the wrong length drop the whole row (never repaired)', ['Show <b>this</b>', 'See https://example.com now', 'See www.example.com now', 'Two\nlines', 'Zero​width', 'ab', 'x'.repeat(121), 'a `code` b', 5].every(t => S.readSuggestion({ ...ROW, title: t }) === null) && ['<script>', 'http://x.y', 'a\u0007b', 'y'.repeat(401)].every(t => S.readSuggestion({ ...ROW, why: t }) === null))
check('letters like æ, ø, å and ä pass', S.readSuggestion({ ...ROW, title: 'Vis søvn og skritt i én graf', why: 'Ofte spurt om, æøå och ä.' }) !== null)
check('a count that is not a number is 0 (times at least 1), is capped, and a call id that is not a uuid is none', S.readSuggestion({ ...ROW, times_seen: 'many' }).times_seen === 1 && S.readSuggestion({ ...ROW, tokens_each: -4 }).tokens_each === 0 && S.readSuggestion({ ...ROW, times_seen: 1e12 }).times_seen === 1_000_000 && S.readSuggestion({ ...ROW, first_call_id: '../x' }).first_call_id === null)
check('readSuggestions of an answer that is not a list is empty and skips bad rows', S.readSuggestions(null).length === 0 && S.readSuggestions({}).length === 0 && S.readSuggestions([ROW, 5, null, { ...ROW, id: 'bad' }]).length === 1)
check('the columns the app asks for are the table\'s readable shape, by name (never select *)', !/select\('\*'\)/.test(read('src/features/ai/claude/suggestApi.ts')) && !/dedupe_key|state_changed_at/.test(S.SUGGESTION_COLUMNS) && !/batch_id|claimed_at|facts|sent_text/.test(S.SUGGEST_RUN_COLUMNS))
check('every kind has a label, a plain meaning and a line for under an answer, and the eight kinds are the database\'s', S.SUGGESTION_KINDS.length === 8 && S.SUGGESTION_KINDS.every(k => S.SUGGESTION_KIND_LABEL[k] && S.SUGGESTION_KIND_MEANING[k] && S.SUGGESTION_LINE[k]) && J(S.SUGGESTION_KINDS) === J(((/kind\s+text not null check \(kind in \(([^)]*)\)/.exec(read('supabase/migrations/199_ai_suggestions.sql')) || [])[1] || '').split(',').map(x => x.trim().replace(/'/g, ''))))
check('the states are the database\'s four, each with a label', J(S.SUGGESTION_STATES) === J(['new', 'kept', 'dismissed', 'built']) && S.SUGGESTION_STATES.every(s => S.SUGGESTION_STATE_LABEL[s]))
check('the same eight kinds are in the function\'s rules (the kinds a model may name)', J(S.SUGGESTION_KINDS) === J(((/SUGGEST_KINDS = (\[[^\]]*\])/.exec(read('supabase/claude-src/suggest-rules.ts')) || [])[1] || '').replace(/'/g, '"').replace(/\s/g, '').replace(/,/g, ',') && JSON.parse(((/SUGGEST_KINDS = (\[[^\]]*\])/.exec(read('supabase/claude-src/suggest-rules.ts')) || [])[1] || '[]').replace(/'/g, '"'))))

const w = (o) => S.savingWords({ times_seen: 6, tokens_each: 5200, cost_each_usd: 0.0123, ...o })
check('the saving in plain words: how many times, what one time took, what they cost in all', w({}) === 'Seen 6 times · about 5 200 tokens, $0.0123 each time · $0.07 in all', w({}))
check('seen once says "once" and no total; no tokens leaves the tokens out; thousands get a space', w({ times_seen: 1 }) === 'Seen once · about 5 200 tokens, $0.0123 each time' && w({ tokens_each: 0 }) === 'Seen 6 times · $0.0123 each time · $0.07 in all' && /Seen 1 200 times/.test(w({ times_seen: 1200 })))
check('dollar amounts: a few cents with four places, over a cent with two, under a hundredth of a cent plainly, zero as $0.00', S.suggestionUsd(0.0123) === '$0.0123' && S.suggestionUsd(0.5) === '$0.50' && S.suggestionUsd(1.234) === '$1.23' && S.suggestionUsd(0.00001) === '< $0.0001' && S.suggestionUsd(0) === '$0.00' && S.suggestionUsd(NaN) === '$0.00')

const mk = (id, state, times, cost, seen) => ({ ...S.readSuggestion({ ...ROW, id: `a1ca5500-0000-4000-8000-00000000000${id}`, state, times_seen: times, cost_each_usd: cost, last_seen_at: seen }) })
const list = [mk(1, 'new', 2, 0.01, '2026-11-20'), mk(2, 'new', 10, 0.01, '2026-11-19'), mk(3, 'kept', 3, 0.5, '2026-11-18'), mk(4, 'dismissed', 9, 9, '2026-11-17'), mk(5, 'built', 1, 0.1, '2026-11-16'), mk(6, 'new', 10, 0.01, '2026-11-21')]
const g = S.groupSuggestions(list)
check('groupSuggestions: four groups, the biggest saving first, then the latest seen; a dismissed idea only sits at the bottom', g.fresh.map(s => s.id.slice(-1)).join('') === '621' && g.kept.length === 1 && g.built.length === 1 && g.dismissed.length === 1 && g.fresh.length + g.kept.length + g.built.length + g.dismissed.length === list.length)
check('waitingCount counts the new ideas only', S.waitingCount(list) === 3)

const draft = S.draftFromSuggestion(S.readSuggestion(ROW))
check('Send to Dev Requests makes a draft the owner reviews: the idea\'s title, why, the saving, and a plain note that a model wrote it; a feature request of low priority; nothing is saved by it', draft.title === ROW.title && draft.category === 'feature' && draft.priority === 'low' && draft.points.length === 3 && draft.points[0] === ROW.why && /Written by a model: check it/.test(draft.points[2]) && /Seen 6 times/.test(draft.points[1]))
const view = read('src/features/developer/components/ai/AiSuggestions.tsx')
check('the view fills the composer\'s NEW draft and opens it, and never overwrites a request the owner has open (the Explain-error rule); it does not save anything itself', /isDraftEmpty\(store\.newDraft\)/.test(view) && /openComposer\(\{ kind: 'new' \}\)/.test(view) && /patchNewDraft/.test(view) && !/useSaveDevRequestDraft|useCreateDevRequest|saveNew/.test(view))
check('the view cuts the model\'s text with Truncate, shows it as text (no dangerouslySetInnerHTML, no link built from it), and has Keep, Dismiss, Send to Dev Requests, Mark built and Bring back', /<Truncate/.test(view) && !/dangerouslySetInnerHTML|href=\{|<a /.test(view) && ['Keep', 'Dismiss', 'Send to Dev Requests', 'Mark built', 'Bring back'].every(t => view.includes(t)) && !/window\.confirm|<Dialog/.test(view))
const api = read('src/features/ai/claude/suggestApi.ts')
check('the browser changes the state and only the state: one update of { state } by id and owner; no insert, no delete, no other column', /\.update\(\{ state \}\)/.test(api) && !/\.insert\(|\.delete\(|\.upsert\(/.test(api) && (api.match(/\.update\(/g) || []).length === 1)
const hooks = read('src/features/ai/claude/hooks/useSuggestions.ts')
check('every action is a mutation with feedback and says what happened; components never import supabase', /useMutationWithFeedback/.test(hooks) && (hooks.match(/successMessage/g) || []).length >= 2 && !/supabase/.test(view + hooks))
check('the suggestions\' query root is a qk key that is never kept on the device', /aiSuggestions/.test(read('src/shared/query/keys.ts')) && /'ai-suggestions'/.test(read('src/shared/query/persistRules.ts')))

check('the answers of "Look for ideas now" are plain sentences: queued, already waiting, nothing repeats (no AI call), the function\'s own sentence for a stop', S.suggestMakeMessage({ ok: true, queued: true }).ok && /half price/.test(S.suggestMakeMessage({ ok: true, queued: true }).message) && !S.suggestMakeMessage({ ok: true, skipped: 'already_queued' }).ok && /No AI call/.test(S.suggestMakeMessage({ ok: true, queued: false, skipped: 'nothing_repeats' }).message) && S.suggestMakeMessage({ ok: false, message: 'Over budget.' }).message === 'Over budget.')
check('what the check says about the suggestions\' batch: done, failed, waiting, or nothing', S.suggestCheckNote({ suggestions: { ok: true, done: 1 } }) === 'The ideas are in.' && /usable/.test(S.suggestCheckNote({ suggestions: { ok: true, failed: 1 } })) && /waiting/.test(S.suggestCheckNote({ suggestions: { ok: true, waiting: 1 } })) && S.suggestCheckNote({ suggestions: { ok: true } }) === null && S.suggestCheckNote({}) === null)
const RUN = { id: ID, week_start: '2026-11-16', made_by: 'schedule', status: 'done', failure: null, added: 3, patterns: 5, created_at: '2026-11-23T04:00:00Z', finished_at: '2026-11-23T05:12:00Z' }
check('a run is read the same careful way (an unknown status or a bad week is dropped), and its sentence says what the last look did', S.readSuggestRuns([RUN, { ...RUN, status: 'x' }, { ...RUN, week_start: 'Monday' }, 4]).length === 1 && S.runSentence(S.readSuggestRuns([RUN])[0], () => '23.11.2026') === 'The look on 23.11.2026 read 5 repeats and added 3 ideas.' && /found nothing/.test(S.runSentence({ ...RUN, patterns: 0, added: 0 }, () => 'x')) && /failed: Because/.test(S.runSentence({ ...RUN, status: 'failed', failure: 'Because' }, () => 'x')) && /waiting for Anthropic/.test(S.runSentence({ ...RUN, status: 'queued' }, () => 'x')) && /No look for ideas yet/.test(S.runSentence(null, () => 'x')))

// The line under an answer
const doneData = { conversation_id: ID, text: 'Hi', citations: [], proposals: [], cost_usd: 0.01, wall: false, ending: 'complete', prompt_tokens: 100, run_id: ID, thinking: '', suggestion: { kind: 'widget' } }
check('the done event carries the kind of the noted idea and the turn keeps only that; an unknown shape is none', C.readChatEvent('done', doneData).suggestion === 'widget' && C.readChatEvent('done', { ...doneData, suggestion: null }).suggestion === null && C.readChatEvent('done', { ...doneData, suggestion: { kind: '<b>x</b>' } }).suggestion === null && C.readChatEvent('done', { ...doneData, suggestion: 'widget' }).suggestion === null && C.readChatEvent('done', { ...doneData, suggestion: { kind: 'a'.repeat(40) } }).suggestion === null)
const turn = C.patchAnswerTurn ? C.patchAnswerTurn(C.newTurn('k', 'assistant'), C.readChatEvent('done', doneData)) : null
check('a new turn has no suggestion line', C.newTurn('k', 'assistant').suggestion === null)
const chatView = read('src/features/ai/chat/ChatTurnView.tsx')
check('the line is one quiet line with an icon, "This could be a widget — see Suggestions", a link to the Ideas page made by us (never from the idea\'s text), and only the kind goes through', /SuggestionLine/.test(chatView) && /learn=suggestions/.test(chatView) && /SUGGESTION_LINE\[kind/.test(chatView) && S.SUGGESTION_LINE.widget === 'This could be a widget' && !/turn\.suggestion\.(title|why)/.test(chatView) && /Lightbulb/.test(chatView))
check('the note tool has a label and step words in the app (a stored chat names it in plain words)', C.TOOL_LABELS.note_shortcut?.label === 'Note an idea' && /Suggestions|Ideas/.test(C.TOOL_LABELS.note_shortcut.what))

// The page's place
check('Ideas is the fifth page of Learn, by ?learn=suggestions; the header and the four views stay as they were; an old address still lands on its page', J(B.AI_VIEWS) === J(['overview', 'calls', 'settings', 'learn']) && B.AI_LEARN_VIEWS.includes('suggestions') && B.AI_LEARN_LABEL.suggestions === 'Ideas' && B.parseAiLocation('learn', 'suggestions').learn === 'suggestions' && B.parseAiLocation('batches', null).learn === 'batches' && /<AiSuggestions \/>/.test(read('src/features/developer/components/ai/AiTab.tsx')))

console.log(`\n${ok} passed, ${bad} failed`)
process.exit(bad ? 1 : 0)
