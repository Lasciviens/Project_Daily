#!/usr/bin/env node
/*
 * Verification — the assistant's guardrails (security audit 10.10.2026; rebuilt on the `claude` function in AI phase 4,
 * the old ai-proxy checks were removed with it in phase 5). Static checks on the `claude` function's tool part and its
 * migrations; the behaviour (a forged, another account's, an expired, a repeated Confirm) is in verify-claude-chat.cjs:
 *   - the assistant never writes by itself: one insert (a task, a food line) or one update (a food line's or a task's
 *     named fields, migration 205) per confirmed proposal, with the owner's own client;
 *   - a confirmed proposal writes no column that links a row to an outside account (the latest app_undo_links);
 *   - the browser reads its proposals and writes none; the phone's tools are reads;
 *   - the app's 'aiWrite' refresh reaches every table a confirmed proposal writes.
 *
 *   Run:  node scripts/verify-ai-confirm.cjs
 */
const fs = require('fs')
const path = require('path')
const sucrase = require('sucrase')
const REPO = path.join(__dirname, '..')

let ok = 0, bad = 0; const check = (n, c, d) => { if (c) { ok++; console.log('  ✓', n) } else { bad++; console.log('  ✗', n, d ?? '') } }

// The new assistant (claude function, migration 197): it never writes by itself. Static checks on its tool part and its
// migration; the behaviour (a forged, another account's, an expired, a repeated Confirm) is in verify-claude-chat.cjs.
function checkClaudeConfirm() {
  const tools = fs.readFileSync(`${REPO}/supabase/claude-src/chat-tools.ts`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const loop = fs.readFileSync(`${REPO}/supabase/claude-src/chat-loop.ts`, 'utf8').replace(/\/\/.*$/gm, '')
  const rules = fs.readFileSync(`${REPO}/supabase/claude-src/chat-rules.ts`, 'utf8')
  const store = fs.readFileSync(`${REPO}/supabase/claude-src/chat-store.ts`, 'utf8').replace(/\/\/.*$/gm, '')
  const mig = fs.readFileSync(`${REPO}/supabase/migrations/197_ai_chat.sql`, 'utf8').replace(/--.*$/gm, '')
  const migDir = `${REPO}/supabase/migrations`
  const latest = fs.readdirSync(migDir).filter(f => /^\d+_.*\.sql$/.test(f)).sort().map(f => fs.readFileSync(`${migDir}/${f}`, 'utf8'))
    .filter(t => /function public\.app_undo_links\(p_table text\)/.test(t)).pop() ?? ''
  const body = latest.slice(latest.indexOf('function public.app_undo_links(p_table text)'))
  const links = [...new Set([...body.slice(0, body.indexOf('$$;')).matchAll(/'([a-z_]+)'/g)].map(m => m[1]).filter(c => /_(id|area|href)$/.test(c) && !/^(tasks|time_blocks|schedule_blocks|user_[a-z_]+)$/.test(c)))]
  const apply = tools.slice(tools.indexOf('export async function applyProposal'))
  const written = [...apply.slice(apply.indexOf('const row'), apply.indexOf('const table')).matchAll(/\b([a-z_]+): /g)].map(m => m[1])
  // The changes (migration 205): the columns of the food line's patch and of the task's one update.
  const change = apply.slice(apply.indexOf('async function applyChange'))
  const patched = [...change.slice(change.indexOf('const patch'), change.indexOf("let q = db.from('food_log_entries').update(")).matchAll(/\{ ([a-z_]+): changes\./g)].map(m => m[1])
  const taskPatch = /db\.from\('tasks'\)\.update\(\{ title: changes\.title \}\)/.test(change) ? ['title'] : []
  const hits = [...written, ...patched, ...taskPatch].filter(c => links.includes(c))
  check(`the columns a confirmed proposal writes (${written.length} inserted, ${patched.length + taskPatch.length} changed) include none of the outside-account links Undo knows (${links.length})`, links.length >= 5 && written.length >= 15 && !hits.length, hits.join(', '))
  // 210's links from a task to the thing it plans (and 141's routine): never written by a confirmed proposal.
  const taskLinks = [...fs.readFileSync(`${migDir}/210_task_links.sql`, 'utf8').matchAll(/add column if not exists ([a-z_]+)/g)].map(m => m[1]).concat('hevy_routine_id')
  const linkHits = [...written, ...patched, ...taskPatch].filter(c => taskLinks.includes(c))
  check(`the columns a confirmed proposal writes include none of a task's links to the thing it plans (${taskLinks.length}, 210)`, taskLinks.length === 10 && !linkHits.length, linkHits.join(', '))
  // 211: a done plan's effects (the ledger), the server's notices and an Apple workout's Hevy link are written only by the
  // database — never by a confirmed proposal, and the assistant's code names none of them (a tick would fire an effect:
  // a confirmed change never writes a task's status, below).
  const m211 = fs.readFileSync(`${migDir}/211_linked_plans.sql`, 'utf8')
  const serverOnly = ['task_link_effects', 'notifications', "from('health_workouts')", 'notify(']
  const claudeSrc = fs.readdirSync(`${REPO}/supabase/claude-src`).map(f => fs.readFileSync(`${REPO}/supabase/claude-src/${f}`, 'utf8')).join('\n')
  const named = serverOnly.filter(n => claudeSrc.includes(n))
  check('the assistant never writes a plan\'s effect, a notification or an Apple workout\'s Hevy link (211: database-written only)',
    /create table if not exists public\.task_link_effects/.test(m211) && /create table if not exists public\.notifications/.test(m211)
    && /revoke all on public\.task_link_effects from anon, authenticated/.test(m211) && /revoke all on public\.notifications from anon, authenticated/.test(m211)
    // A new task starts open (an effect fires only on a tick); a change never names a status or a close.
    && !named.length && /status: 'open', priority: a\.priority/.test(apply) && ![...patched, ...taskPatch].includes('status')
    && ![...written, ...patched, ...taskPatch].some(c => ['completed_at', 'hevy_workout_id'].includes(c)), named.join(', '))
  check('a confirmed change names only a food line\'s title and four figures, or a task\'s title — never its day, meal, status or a link', JSON.stringify(patched) === JSON.stringify(['custom_title', 'calories', 'protein_g', 'carbs_g', 'fat_g']) && taskPatch.length === 1)
  const updates = change.match(/\.update\(/g) || []
  check('the only writes in the assistant\'s tool part are a confirmed proposal\'s: one insert, and two updates (a food line, a task), each filtered by the row AND the verified user; no delete or upsert; no table outside tasks and food_log_entries', (apply.match(/\.insert\(/g) || []).length === 1 && updates.length === 2 && (tools.match(/\.update\(/g) || []).length === 2 && !/\.(delete|upsert)\(/.test(tools) && !/\.(insert|update)\(/.test(tools.slice(0, tools.indexOf('export async function applyProposal'))) && /const table = tool === 'add_task' \? 'tasks' : 'food_log_entries'/.test(apply)
    && /\.update\(patch\)\.eq\('id', String\(a\.entry_id\)\)\.eq\('user_id', userId\)\.eq\('date', String\(a\.date\)\)\.gte\('date', window\.from\)\.lte\('date', window\.to\)\s*\.eq\('status', 'eaten'\)\.eq\('meal_slot', String\(a\.meal\)\)\.neq\('meal_slot', 'supplement'\)\s*\.is\('library_ingredient_id', null\)\.is\('recipe_id', null\)\.is\('supplement_schedule_id', null\)\s*\.eq\('custom_title', String\(before\.title\)\)/.test(change)
    && /\.update\(\{ title: changes\.title \}\)\.eq\('id', String\(a\.task_id\)\)\.eq\('user_id', userId\)\.eq\('title', String\(before\.title\)\)\.select\('id'\)/.test(change))
  check('a confirmed change is ONE update that is its own check (guardian 3): no read before it, every value it was proposed against in its filter (the four figures, null as null), and zero rows means "changed since", nothing written', !/\.select\('[^']*'\)\.eq\('id'/.test(change) && !/changeableFoodLine|maybeSingle/.test(change) && /for \(const key of FOOD_FIELDS\) q = before\[key\] === null \? q\.is\(key, null\) : q\.eq\(key, before\[key\] as number\)/.test(change) && /await q\.select\('id'\)/.test(change) && /data\.length === 0 \? \{ ok: false as const, message: CHANGED_SINCE \}/.test(change) && /const CHANGED_SINCE = 'It was changed since; nothing was changed\. Ask again\.'/.test(tools))
  // The card's Undo of a change (guardian 2): the browser writes the before-values back only while the row still holds what the change wrote.
  const api = fs.readFileSync(`${REPO}/src/features/ai/chat/chatApi.ts`, 'utf8')
  const undo = api.slice(api.indexOf('export async function restoreChangedRow'), api.indexOf('/** Deletes a chat'))
  check('Undo of a change is exact (guardian 2): its update is filtered by the row, the owner, EVERY changed column\'s written value and, for a food line, that it is still a one-off line; zero rows throws "It was changed since; nothing was put back."', /\.update\(patch\)\.eq\('id', id\)\.eq\('user_id', user\.id\)/.test(undo) && /for \(const \[column, value\] of written\) q = q\.eq\(column, value as string \| number\)/.test(undo) && /if \(tool === 'update_food'\) q = q\.is\('library_ingredient_id', null\)\.is\('recipe_id', null\)/.test(undo) && /await q\.select\('id'\)/.test(undo) && /data\.length !== 1\) throw new Error\(PUT_BACK_CHANGED\)/.test(undo) && /PUT_BACK_CHANGED = 'It was changed since; nothing was put back\.'/.test(api) && /update_food: \{ title: 'custom_title', calories: 'calories', protein_g: 'protein_g', carbs_g: 'carbs_g', fat_g: 'fat_g' \},\s*update_task: \{ title: 'title' \}/.test(api))
  check('a food of the owner\'s own list is linked only after its id is read back as the owner\'s', /db\.from\('recipe_ingredient_library'\)\.select\('id'\)\.eq\('id', ownFood\.id\)\.eq\('user_id', userId\)/.test(apply))
  const mig205 = fs.readFileSync(`${REPO}/supabase/migrations/205_ai_chat_fixes.sql`, 'utf8').replace(/--.*$/gm, '')
  check('the write tools are proposals only and the proposal kinds are exactly the four the database allows (197, widened by 205)', /WRITE_TOOL_NAMES = \['propose_add_task', 'propose_log_food'\]/.test(rules) && /FIX_TOOL_NAMES = \['propose_update_food', 'propose_update_task'\]/.test(rules) && /check \(tool in \('add_task', 'log_food'\)\)/.test(mig) && /check \(tool in \('add_task', 'log_food', 'update_food', 'update_task'\)\)/.test(mig205) && /PROPOSAL_TOOL_NAME: Readonly<Record<ProposalTool, string>> = \{ add_task: 'propose_add_task', log_food: 'propose_log_food', update_food: 'propose_update_food', update_task: 'propose_update_task' \}/.test(tools))
  check('a write tool can never be "on": its modes are ask and off only, and the model\'s tool run never calls applyProposal', /ALL_WRITE_TOOL_NAMES\.includes\(name\) \? \['ask', 'off'\] : \['on', 'off'\]/.test(rules) && /ALL_WRITE_TOOL_NAMES: readonly string\[\] = \[\.\.\.WRITE_TOOL_NAMES, \.\.\.FIX_TOOL_NAMES\]/.test(rules) && !/applyProposal/.test(tools.slice(0, tools.indexOf('export async function applyProposal'))))
  check('a card that is replaced by a newer one is only closed: the store marks it once (pending only), and Confirm refuses it', /status: 'replaced'/.test(store) && /\.eq\('status', 'pending'\)\.in\('id', \[\.\.\.ids\]\)/.test(store) && /proposal\.status !== 'pending'/.test(loop))
  check('applyProposal is called from one place only, the owner\'s Confirm (decideChatProposal), with the owner\'s own client', (loop.match(/applyProposal\(/g) || []).length === 1 && /applyProposal\(ctx\.userDb, ctx\.userId,/.test(loop))
  check('the browser can read its proposals and write none: one select policy, one select grant, no browser write', /grant select on public\.ai_chat_proposals to authenticated;/.test(mig) && !/grant [^;]*(insert|update|delete)[^;]* on public\.ai_chat_proposals to authenticated/.test(mig) && (mig.match(/create policy [^;]*on public\.ai_chat_proposals/g) || []).length === 1)
  // phase 4b: the owner's controls and the phone's tools
  const phone = fs.readFileSync(`${REPO}/supabase/claude-src/phone-ask.ts`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const mig198 = fs.readFileSync(`${REPO}/supabase/migrations/198_ai_chat_controls.sql`, 'utf8').replace(/--.*$/gm, '')
  const phoneTools = tools.slice(tools.indexOf('export const PHONE_TOOL_NAMES'), tools.indexOf('export async function applyProposal'))
  check('the settings rows are input read in one place (the store), never by a tool', /ai_tool_settings/.test(store) && !/ai_tool_settings|chat_instructions/.test(tools))
  check('the settings only ever narrow: a write tool is never "on" whatever a row says, and an unknown tool name is ignored (toolModes walks its own list)', /for \(const name of ALL_TOOL_ORDER\)/.test(rules) && /\['ask', 'off'\] : \['on', 'off'\]/.test(rules))
  check('the owner\'s words enter the prompt only as the second system block (escaped, framed), never in a message or a tool result', /ownerInstructionsBlock\(frozenInstructions\)/.test(loop) && loop.split('\n').filter(l => /ownerInstructions|frozenInstructions|ownerBlock/.test(l)).every(l => !/blocks\.push|type: 'text'|tool_result|messages\.push/.test(l)) && /escapeTagText\(text\)/.test(rules))
  check('the phone\'s tools are exactly six reads (the chat\'s own definitions), no write and no SQL tool, and the phone part touches no table but the ledger\'s', /PHONE_TOOL_NAMES: readonly string\[\] = \['get_day_plan', 'get_week_figures', 'get_food_day', 'find_text', 'get_about_me', 'get_transit'\]/.test(phoneTools) && !/propose_|ask_database|applyProposal/.test(phoneTools) && !/\.(insert|update|upsert|delete)\(/.test(phoneTools) && !/\.(insert|update|upsert|delete)\(|\.from\(/.test(phone))
  check('migration 198: the browser gets no write on the chat tables and no delete on the tool rows; the new tool table is owner-locked and audited', !/grant [^;]*on public\.ai_(conversations|messages|chat_proposals)/.test(mig198) && /grant select, insert, update on public\.ai_tool_settings to authenticated;/.test(mig198) && /owner_lock_apply\('public\.ai_tool_settings'\)/.test(mig198) && /trg_audit/.test(mig198))
  // phase 4c: the suggestions
  const sugRules = fs.readFileSync(`${REPO}/supabase/claude-src/suggest-rules.ts`, 'utf8')
  const sugStore = fs.readFileSync(`${REPO}/supabase/claude-src/suggest-store.ts`, 'utf8')
  const noteTool = tools.slice(tools.indexOf('const NOTE_SHORTCUT'), tools.indexOf('const GET_TRANSIT'))
  check('note_shortcut is no write tool and touches no table: it only calls the writer it is handed (the loop builds it with the verified user), and refuses without one', /kind: 'read'/.test(noteTool) && !/\.from\(|\.rpc\(|ctx\.db|userId/.test(noteTool) && /ctx\.noteIdea/.test(noteTool) && !/note_shortcut/.test(tools.slice(tools.indexOf('export const PHONE_TOOL_NAMES'), tools.indexOf('export async function applyProposal'))))
  check('the idea\'s key is made by the function, never read from the model: ideaKey / patternKey are the only sources of a key, and the writer\'s only caller passes one of them', /export async function ideaKey/.test(sugRules) && /export async function patternKey/.test(sugRules) && (loop.match(/addSuggestion\(/g) || []).length === 1 && /await ideaKey\(idea\)/.test(loop) && /await patternKey\(pattern\)/.test(fs.readFileSync(`${REPO}/supabase/claude-src/suggest-batch.ts`, 'utf8')))
  check('the suggestions store writes ideas through the one database function and never the table directly', /rpc\('ai_suggestion_add'/.test(sugStore) && !/from\('ai_suggestions'\)\.(insert|update|upsert|delete)/.test(sugStore) && /patternsError|ai_suggest_patterns/.test(sugStore))
  check('the weekly job reads no row of the owner\'s data: its part names no table but the ledger count, the idea list and its own runs', !/from\('(tasks|time_blocks|food_log_entries|hevy_|health_|recipes|diary|quick_guess)/.test(sugStore + fs.readFileSync(`${REPO}/supabase/claude-src/suggest-batch.ts`, 'utf8')))
}

function checkAiWriteGroup() {
  require('sucrase/register')
  const { INVALIDATION_GROUPS } = require(`${REPO}/src/shared/query/invalidate.ts`)
  const { qk } = require(`${REPO}/src/shared/query/keys.ts`)
  const { partialMatchKey } = require('@tanstack/query-core')
  const d = '2026-10-28'
  // The tables a confirmed proposal writes (applyProposal: a task, a food log line) and the keys a screen reads them under.
  const SCREENS = {
    tasks: [qk.tasks.day(d, d), qk.tasks.projects()],
    food_log_entries: [qk.foodLog.day(d), qk.mealPlan.dayNutrition(d), qk.health.cutDiary('2026-10-26', d), qk.supplements.facts('2026-10-26', d)],
  }
  // A change (205) touches the same two tables: a renamed task shows on the same screens.
  const tools = fs.readFileSync(`${REPO}/supabase/claude-src/chat-tools.ts`, 'utf8')
  const apply = tools.slice(tools.indexOf('export async function applyProposal'))
  const written = [...apply.matchAll(/'(tasks|food_log_entries)'/g)].map(m => m[1])
  const unmapped = [...new Set(written)].filter(t => !SCREENS[t])
  check(`every table a confirmed proposal writes (${[...new Set(written)].join(', ')}) has a screen key here`, written.length >= 1 && !unmapped.length, unmapped.join(', '))
  const roots = INVALIDATION_GROUPS.aiWrite
  const stale = Object.entries(SCREENS).flatMap(([t, keys]) => keys.filter(k => !roots.some(r => partialMatchKey(k, r))).map(k => `${t} ${JSON.stringify(k)}`))
  check("'aiWrite' refreshes every one of them", !stale.length, stale.join('; '))
}

checkClaudeConfirm()
checkAiWriteGroup()
console.log(`\n${ok} passed, ${bad} failed`)
process.exit(bad ? 1 : 0)
