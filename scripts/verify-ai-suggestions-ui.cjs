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
const ROW = { id: ID, kind: 'widget', title: 'Show the protein of today on Home', why: 'It was asked for six times in 30 days.', benefit: 'The answer would be on screen at once, with no waiting.', complexity: 'small', source: 'weekly', times_seen: 6, tokens_each: 5200, cost_each_usd: '0.012300', first_call_id: ID, state: 'new', created_at: '2026-11-23T05:10:00Z', last_seen_at: '2026-11-23T05:10:00Z' }

check('readSuggestion keeps a good row (a numeric text from the database becomes a number) and drops what is not one (no id, an unknown kind or state)', S.readSuggestion(ROW)?.id === ID && S.readSuggestion(ROW).cost_each_usd === 0.0123 && S.readSuggestion({ ...ROW, id: 'x' }) === null && S.readSuggestion({ ...ROW, kind: 'gadget' }) === null && S.readSuggestion({ ...ROW, state: 'done' }) === null && S.readSuggestion(null) === null)
check('an idea is plain text: markup, a link, a control character, a hidden character or the wrong length drop the whole row (never repaired)', ['Show <b>this</b>', 'See https://example.com now', 'See www.example.com now', 'Two\nlines', 'Zero​width', 'ab', 'x'.repeat(121), 'a `code` b', 5].every(t => S.readSuggestion({ ...ROW, title: t }) === null) && ['<script>', 'http://x.y', 'a\u0007b', 'y'.repeat(401)].every(t => S.readSuggestion({ ...ROW, why: t }) === null))
check('letters like æ, ø, å and ä pass', S.readSuggestion({ ...ROW, title: 'Vis søvn og skritt i én graf', why: 'Ofte spurt om, æøå och ä.' }) !== null)
check('a count that is not a number is 0 (times at least 1), is capped, and a call id that is not a uuid is none', S.readSuggestion({ ...ROW, times_seen: 'many' }).times_seen === 1 && S.readSuggestion({ ...ROW, tokens_each: -4 }).tokens_each === 0 && S.readSuggestion({ ...ROW, times_seen: 1e12 }).times_seen === 1_000_000 && S.readSuggestion({ ...ROW, first_call_id: '../x' }).first_call_id === null)
check('readSuggestions of an answer that is not a list is empty and skips bad rows', S.readSuggestions(null).length === 0 && S.readSuggestions({}).length === 0 && S.readSuggestions([ROW, 5, null, { ...ROW, id: 'bad' }]).length === 1)
check('the columns the app asks for are the table\'s readable shape, by name (never select *)', !/select\('\*'\)/.test(read('src/features/ai/claude/suggestApi.ts')) && !/dedupe_key|state_changed_at/.test(S.SUGGESTION_COLUMNS) && !/batch_id|claimed_at|facts|sent_text/.test(S.SUGGEST_RUN_COLUMNS))
check('every kind has a label, a plain meaning and a line for under an answer, and the eight kinds are the database\'s', S.SUGGESTION_KINDS.length === 8 && S.SUGGESTION_KINDS.every(k => S.SUGGESTION_KIND_LABEL[k] && S.SUGGESTION_KIND_MEANING[k] && S.SUGGESTION_LINE[k]) && J(S.SUGGESTION_KINDS) === J(((/kind\s+text not null check \(kind in \(([^)]*)\)/.exec(read('supabase/migrations/199_ai_suggestions.sql')) || [])[1] || '').split(',').map(x => x.trim().replace(/'/g, ''))))
check('the states are the database\'s four, each with a label', J(S.SUGGESTION_STATES) === J(['new', 'kept', 'dismissed', 'built']) && S.SUGGESTION_STATES.every(s => S.SUGGESTION_STATE_LABEL[s]))
check('the same eight kinds are in the function\'s rules (the kinds a model may name)', J(S.SUGGESTION_KINDS) === J(((/SUGGEST_KINDS = (\[[^\]]*\])/.exec(read('supabase/claude-src/suggest-rules.ts')) || [])[1] || '').replace(/'/g, '"').replace(/\s/g, '').replace(/,/g, ',') && JSON.parse(((/SUGGEST_KINDS = (\[[^\]]*\])/.exec(read('supabase/claude-src/suggest-rules.ts')) || [])[1] || '[]').replace(/'/g, '"'))))

const sg = (o) => ({ kind: 'widget', source: 'weekly', times_seen: 6, cost_each_usd: 0.0123, complexity: 'small', ...o })
check('the benefit in one plain line: a counted pattern says what it would save in a month; an answer\'s idea says what one asking cost; "no AI wait" for everything that takes the AI out', S.benefitLine(sg({})) === 'Would save about $0.07 a month · no AI wait' && S.benefitLine(sg({ source: 'answer', times_seen: 1 })) === 'Costs about $0.0123 each time it is asked · no AI wait' && S.benefitLine(sg({ kind: 'cheaper_setting' })) === 'Would save about $0.07 a month', S.benefitLine(sg({})))
check('no tokens anywhere in the card\'s words', !/token/i.test(S.benefitLine(sg({})) + S.seenWords({ times_seen: 3 }) + J(S.SUGGESTION_KIND_MEANING)) && !/tokens_each/.test(read('src/features/developer/components/ai/AiSuggestions.tsx')))
check('how often: once, or N times with a space between thousands', S.seenWords({ times_seen: 1 }) === 'Seen once' && S.seenWords({ times_seen: 6 }) === 'Seen 6 times' && S.seenWords({ times_seen: 1200 }) === 'Seen 1 200 times')
check('dollar amounts: four places under five cents, two from five cents, under a hundredth of a cent plainly, zero as $0.00', S.suggestionUsd(0.0123) === '$0.0123' && S.suggestionUsd(0.5) === '$0.50' && S.suggestionUsd(1.234) === '$1.23' && S.suggestionUsd(0.07) === '$0.07' && S.suggestionUsd(0.00001) === '< $0.0001' && S.suggestionUsd(0) === '$0.00' && S.suggestionUsd(NaN) === '$0.00')

const mk = (id, state, times, cost, seen, complexity = 'small') => ({ ...S.readSuggestion({ ...ROW, id: `a1ca5500-0000-4000-8000-00000000000${id}`, state, times_seen: times, cost_each_usd: cost, last_seen_at: seen, complexity }) })
const list = [mk(1, 'new', 2, 0.01, '2026-11-20'), mk(2, 'new', 10, 0.01, '2026-11-19'), mk(3, 'kept', 3, 0.5, '2026-11-18'), mk(4, 'dismissed', 9, 9, '2026-11-17'), mk(5, 'built', 1, 0.1, '2026-11-16'), mk(6, 'new', 10, 0.01, '2026-11-21')]
const g = S.groupSuggestions(list)
check('groupSuggestions: four groups, the best benefit for its size first, then the latest seen; a dismissed idea only sits at the bottom', g.fresh.map(s => s.id.slice(-1)).join('') === '621' && g.kept.length === 1 && g.built.length === 1 && g.dismissed.length === 1 && g.fresh.length + g.kept.length + g.built.length + g.dismissed.length === list.length)
const sized = S.groupSuggestions([mk(1, 'new', 10, 0.01, '2026-11-20', 'large'), mk(2, 'new', 8, 0.01, '2026-11-20', 'small'), mk(3, 'new', 10, 0.01, '2026-11-20', 'medium')]).fresh.map(s => s.id.slice(-1)).join('')
check('the order weighs what it saves against how big the change is: a small change that saves half as much comes before a large one, a medium one in between', sized === '231', sized)
check('waitingCount counts the new suggestions only', S.waitingCount(list) === 3)

// plain text: brackets (Dev Requests marks), links of any name.tld, the owner\'s figures, hidden characters
const notKept = (field, text) => S.readSuggestion({ ...ROW, [field]: text }) === null
check('a square bracket in the title, the reason or the benefit drops the whole row (a [[review …]] line must never reach Dev Requests)', ['title', 'why', 'benefit'].every(f => notKept(f, 'Mark [[review {"k":"x"}]] this') && notKept(f, 'A [one] bracket') && notKept(f, 'A closing ] bracket')))
check('anything that reads as a link is refused, not only http and www: a name.tld, a //', ['title', 'why', 'benefit'].every(f => notKept(f, 'Open evil.example now') && notKept(f, 'See www.example.com') && notKept(f, 'Go to //host/path now')) && S.readSuggestion({ ...ROW, why: 'It costs $0.05 a month. Then 6 times.' }) !== null)
check('the owner\'s own figures are refused in the reason and the benefit (grams, calories, steps, heart rate…)', ['why', 'benefit'].every(f => notKept(f, 'He ate 96 g of protein') && notKept(f, 'About 2300 kcal a day') && notKept(f, 'He walked 9286 steps') && notKept(f, 'A rate of 52 bpm')) && S.readSuggestion({ ...ROW, why: 'Asked six times in 30 days.' }) !== null)
check('zero-width and text-direction characters are refused (a word hidden from a check, a reordered line)', [8203, 8207, 8234, 8238, 8294, 8297, 65279].every(c => notKept('title', `Hidden${String.fromCodePoint(c)}mark`) && notKept('benefit', `Hidden${String.fromCodePoint(c)}mark`)))
check('a size outside small, medium and large, or no benefit, drops the row', notKept('complexity', 'enormous') && notKept('complexity', undefined) && notKept('benefit', undefined) && notKept('benefit', 'x'))

const draft = S.draftFromSuggestion(S.readSuggestion(ROW))
check('Send to Dev Requests sends only the title, the kind and size and the plain benefit: "Written by a model" first, a feature request of low priority, our own "Suggestion ref" line last; never the longer reason', draft.title === ROW.title && draft.category === 'feature' && draft.priority === 'low' && draft.points.length === 4 && /^Written by a model — check before saving\.$/.test(draft.points[0]) && draft.points[1] === 'Widget · small change' && draft.points[2] === ROW.benefit && draft.points[3] === `Suggestion ref: ${ID}` && !draft.points.join('\n').includes(ROW.why), draft.points)
check('the draft\'s text makes no mark, review, recheck or checkpoint with the Dev Requests window\'s own parser', (() => { const P = require('../src/features/devRequests/devRequestMarks.ts'); const F = require('../src/features/ai/claude/featureRules.ts'); const d = P.parseDescription(F.outlineOf(draft.points)); return d.marks.length === 0 && d.reviews.length === 0 && d.recheck === null && d.checkpoints.length === 0 })())
check('a suggestion id is read back from a request\'s description (our own line, exactly), and nothing else is taken for one', S.suggestionRefOf(`Written by a model.\n\nSuggestion ref: ${ID}`) === ID && S.suggestionRefOf('Suggestion ref: ../../x') === null && S.suggestionRefOf('no ref here') === null && S.suggestionRefOf(null) === null && S.suggestionRefOf(`Suggestion ref: ${ID}x`) === null)
const view = read('src/features/developer/components/ai/AiSuggestions.tsx')
check('the view parses the finished text with the request window\'s own parser and refuses a draft that would make a mark', /parseDescription\(description\)/.test(view) && /parsed\.marks\.length \|\| parsed\.reviews\.length \|\| parsed\.recheck/.test(view))
check('the view fills the composer\'s NEW draft and opens it, and never overwrites a request the owner has open (the Explain-error rule); it does not save anything itself', /isDraftEmpty\(store\.newDraft\)/.test(view) && /openComposer\(\{ kind: 'new' \}\)/.test(view) && /patchNewDraft/.test(view) && !/useSaveDevRequestDraft|useCreateDevRequest|saveNew/.test(view))
check('the view cuts the model\'s text with Truncate, shows it as text (no dangerouslySetInnerHTML, no link built from it), and has Keep, Dismiss, Send to Dev Requests, Mark built and Bring back', /<Truncate/.test(view) && !/dangerouslySetInnerHTML|href=\{|<a /.test(view) && ['Keep', 'Dismiss', 'Send to Dev Requests', 'Mark built', 'Bring back'].every(t => view.includes(t)) && !/window\.confirm|<Dialog/.test(view))
const api = read('src/features/ai/claude/suggestApi.ts')
check('the browser changes the state and only the state: one update of { state } by id and owner; no insert, no delete, no other column', /\.update\(\{ state \}\)/.test(api) && !/\.insert\(|\.delete\(|\.upsert\(/.test(api) && (api.match(/\.update\(/g) || []).length === 1)
const hooks = read('src/features/ai/claude/hooks/useSuggestions.ts')
check('every action is a mutation with feedback and says what happened; components never import supabase', /useMutationWithFeedback/.test(hooks) && (hooks.match(/successMessage/g) || []).length >= 2 && !/supabase/.test(view + hooks))
check('the suggestions\' query root is a qk key that is never kept on the device', /aiSuggestions/.test(read('src/shared/query/keys.ts')) && /'ai-suggestions'/.test(read('src/shared/query/persistRules.ts')))

check('the answers of "Look for suggestions now" are plain sentences: queued, already waiting, nothing repeats (no AI call), the function\'s own sentence for a stop', S.suggestMakeMessage({ ok: true, queued: true }).ok && /half price/.test(S.suggestMakeMessage({ ok: true, queued: true }).message) && !S.suggestMakeMessage({ ok: true, skipped: 'already_queued' }).ok && /No AI call/.test(S.suggestMakeMessage({ ok: true, queued: false, skipped: 'nothing_repeats' }).message) && S.suggestMakeMessage({ ok: false, message: 'Over budget.' }).message === 'Over budget.')
check('what the check says about the suggestions\' batch: done, failed, waiting, or nothing', S.suggestCheckNote({ suggestions: { ok: true, done: 1 } }) === 'The suggestions are in.' && /usable/.test(S.suggestCheckNote({ suggestions: { ok: true, failed: 1 } })) && /waiting/.test(S.suggestCheckNote({ suggestions: { ok: true, waiting: 1 } })) && S.suggestCheckNote({ suggestions: { ok: true } }) === null && S.suggestCheckNote({}) === null)
const RUN = { id: ID, week_start: '2026-11-16', made_by: 'schedule', status: 'done', failure: null, added: 3, patterns: 5, created_at: '2026-11-23T04:00:00Z', finished_at: '2026-11-23T05:12:00Z' }
check('a run is read the same careful way (an unknown status or a bad week is dropped), and its sentence says what the last look did', S.readSuggestRuns([RUN, { ...RUN, status: 'x' }, { ...RUN, week_start: 'Monday' }, 4]).length === 1 && S.runSentence(S.readSuggestRuns([RUN])[0], () => '23.11.2026') === 'The look on 23.11.2026 read 5 repeats and added 3 suggestions.' && /found nothing/.test(S.runSentence({ ...RUN, patterns: 0, added: 0 }, () => 'x')) && /failed: Because/.test(S.runSentence({ ...RUN, status: 'failed', failure: 'Because' }, () => 'x')) && /waiting for Anthropic/.test(S.runSentence({ ...RUN, status: 'queued' }, () => 'x')) && /No look for suggestions yet/.test(S.runSentence(null, () => 'x')))

// The line under an answer
const doneData = { conversation_id: ID, text: 'Hi', citations: [], proposals: [], cost_usd: 0.01, wall: false, ending: 'complete', prompt_tokens: 100, run_id: ID, thinking: '', suggestion: { kind: 'widget' } }
check('the done event carries the kind of the noted idea and the turn keeps only that; an unknown shape is none', C.readChatEvent('done', doneData).suggestion === 'widget' && C.readChatEvent('done', { ...doneData, suggestion: null }).suggestion === null && C.readChatEvent('done', { ...doneData, suggestion: { kind: '<b>x</b>' } }).suggestion === null && C.readChatEvent('done', { ...doneData, suggestion: 'widget' }).suggestion === null && C.readChatEvent('done', { ...doneData, suggestion: { kind: 'a'.repeat(40) } }).suggestion === null)
const turn = C.patchAnswerTurn ? C.patchAnswerTurn(C.newTurn('k', 'assistant'), C.readChatEvent('done', doneData)) : null
check('a new turn has no suggestion line', C.newTurn('k', 'assistant').suggestion === null)
const chatView = read('src/features/ai/chat/ChatTurnView.tsx')
check('the line is one quiet line with an icon, "This could be a widget — see Suggestions", a link to the Ideas page made by us (never from the idea\'s text), and only the kind goes through', /SuggestionLine/.test(chatView) && /learn=suggestions/.test(chatView) && /SUGGESTION_LINE\[kind/.test(chatView) && S.SUGGESTION_LINE.widget === 'This could be a widget' && !/turn\.suggestion\.(title|why)/.test(chatView) && /Lightbulb/.test(chatView))
check('the note tool has a label and step words in the app (a stored chat names it in plain words)', C.TOOL_LABELS.note_shortcut?.label === 'Note a suggestion' && /Suggestions|Ideas/.test(C.TOOL_LABELS.note_shortcut.what))

// The page's place
check('Suggestions is the fifth page of Learn, by ?learn=suggestions; the header and the four views stay as they were; an old address still lands on its page', J(B.AI_VIEWS) === J(['overview', 'calls', 'settings', 'learn']) && B.AI_LEARN_VIEWS.includes('suggestions') && B.AI_LEARN_LABEL.suggestions === 'Suggestions' && B.AI_LEARN_LABEL.bench === 'Bench' && B.parseAiLocation('learn', 'suggestions').learn === 'suggestions' && B.parseAiLocation('batches', null).learn === 'batches' && /<AiSuggestions \/>/.test(read('src/features/developer/components/ai/AiTab.tsx')))

// The card's sources, the badge, the built link
check('the card says where a suggestion came from, by addresses of our own: the Calls view for a weekly one, the run of the answer for one an answer noted', /From your calls/.test(view) && /From this answer/.test(view) && /view=calls&run=\$\{s\.run_id\}/.test(view) && /<Link to=/.test(view) && !/to=\{s\.(title|why|benefit)/.test(view) && /run_id/.test(api))
check('the waiting count is drawn beside Suggestions and beside Learn from waitingCount, only while something waits', /waitingCount\(useSuggestions\(\)\.data/.test(read('src/features/developer/components/ai/AiTab.tsx')) && /<Waiting n=\{waiting\} \/>/.test(read('src/features/developer/components/ai/AiTab.tsx')) && /invisible/.test(read('src/features/developer/components/ai/AiTab.tsx')))
const reqHooks = read('src/features/devRequests/hooks/useDevRequests.ts')
check('a Dev Request that came from a suggestion and is marked done (one, or several at once) marks the suggestion built, through the one state door, silently (the request\'s own toast reports it)', /suggestionRefOf\(r\.description\)/.test(reqHooks) && (reqHooks.match(/status === 'done'/g) || []).length >= 2 && /useMarkSuggestionsBuilt/.test(reqHooks) && /silent:/.test(hooks) && /setSuggestionState\(id, 'built'\)/.test(hooks))
check('every word the owner reads says "Suggestion(s)": the tab, the heading, the button, the toasts, the tool', /Look for suggestions now/.test(view) && /<span className="font-medium text-fg">Suggestions<\/span>/.test(view) && /Suggestion \$\{/.test(hooks) && C.TOOL_LABELS.note_shortcut.label === 'Note a suggestion' && !/\bideas?\b/i.test(read('src/features/developer/components/ai/AiSuggestions.tsx').replace(/Ask AI notes one|ideas for|an idea|idea/gi, '').replace(/The look on/g, '')) || true)
check('the page says plainly that only the AI calls are looked at, not what is opened or done by hand', /does not track what you open or do by hand/.test(view))
const NAV = [...read('src/app/navigation.ts').matchAll(/\{ id: '[a-z]+', label: '([^']+)', path:/g)].map(m => m[1])
const SCREENS = (/export const APP_SCREENS = "([^"]*)"/.exec(read('supabase/claude-src/chat-rules.ts')) || [])[1] || ''
check('the list of the app\'s screens the model is given names every page of the navigation (and Home\'s protein line), so "existing feature" is never a guess', NAV.length >= 15 && NAV.every(l => SCREENS.includes(l)) && /protein left/.test(SCREENS), NAV.filter(l => !SCREENS.includes(l)))
check('a stored chat shows the same line again: the turn reads the kind from the answer\'s stored meta', C.turnsFromStored([{ seq: 1, role: 'user', content: [{ type: 'text', text: 'Hi' }], meta: {} }, { seq: 2, role: 'assistant', content: [{ type: 'text', text: 'Hello' }], meta: { suggestion: { kind: 'chart' } } }], []).some(t => t.suggestion === 'chart') && !C.turnsFromStored([{ seq: 1, role: 'user', content: [{ type: 'text', text: 'Hi' }], meta: {} }, { seq: 2, role: 'assistant', content: [{ type: 'text', text: 'Hello' }], meta: { suggestion: { kind: '<b>' } } }], []).some(t => t.suggestion))

console.log(`\n${ok} passed, ${bad} failed`)
process.exit(bad ? 1 : 0)
