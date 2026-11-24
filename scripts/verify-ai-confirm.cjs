#!/usr/bin/env node
/*
 * Verification — the assistant's guardrails (security audit 10.10.2026; rebuilt on the `claude` function in AI phase 4,
 * the old ai-proxy checks were removed with it in phase 5). Static checks on the `claude` function's tool part and its
 * migrations; the behaviour (a forged, another account's, an expired, a repeated Confirm) is in verify-claude-chat.cjs:
 *   - the assistant never writes by itself: two inserts of a confirmed proposal, with the owner's own client;
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
  const mig = fs.readFileSync(`${REPO}/supabase/migrations/197_ai_chat.sql`, 'utf8').replace(/--.*$/gm, '')
  const migDir = `${REPO}/supabase/migrations`
  const latest = fs.readdirSync(migDir).filter(f => /^\d+_.*\.sql$/.test(f)).sort().map(f => fs.readFileSync(`${migDir}/${f}`, 'utf8'))
    .filter(t => /function public\.app_undo_links\(p_table text\)/.test(t)).pop() ?? ''
  const body = latest.slice(latest.indexOf('function public.app_undo_links(p_table text)'))
  const links = [...new Set([...body.slice(0, body.indexOf('$$;')).matchAll(/'([a-z_]+)'/g)].map(m => m[1]).filter(c => /_(id|area|href)$/.test(c) && !/^(tasks|time_blocks|schedule_blocks|user_[a-z_]+)$/.test(c)))]
  const apply = tools.slice(tools.indexOf('export async function applyProposal'))
  const written = [...apply.slice(apply.indexOf('const row'), apply.indexOf('const table')).matchAll(/\b([a-z_]+): /g)].map(m => m[1])
  const hits = written.filter(c => links.includes(c))
  check(`the columns a confirmed proposal writes (${written.length}) include none of the outside-account links Undo knows (${links.length})`, links.length >= 5 && written.length >= 15 && !hits.length, hits.join(', '))
  check('the only writes in the assistant\'s tool part are the two inserts of a confirmed proposal: no update, delete or upsert, and no table named outside tasks and food_log_entries', (apply.match(/\.insert\(/g) || []).length === 1 && !/\.(update|delete|upsert)\(/.test(tools) && !/\.insert\(/.test(tools.slice(0, tools.indexOf('export async function applyProposal'))) && /const table = tool === 'add_task' \? 'tasks' : 'food_log_entries'/.test(apply))
  check('the write tools are proposals only and the proposal tools are exactly the two the database allows', /WRITE_TOOL_NAMES = \['propose_add_task', 'propose_log_food'\]/.test(rules) && /check \(tool in \('add_task', 'log_food'\)\)/.test(mig))
  check('a write tool can never be "on": its modes are ask and off only, and the model\'s tool run never calls applyProposal', /\['ask', 'off'\] : \['on', 'off'\]/.test(rules) && !/applyProposal/.test(tools.slice(0, tools.indexOf('export async function applyProposal'))))
  check('applyProposal is called from one place only, the owner\'s Confirm (decideChatProposal), with the owner\'s own client', (loop.match(/applyProposal\(/g) || []).length === 1 && /applyProposal\(ctx\.userDb, ctx\.userId,/.test(loop))
  check('the browser can read its proposals and write none: one select policy, one select grant, no browser write', /grant select on public\.ai_chat_proposals to authenticated;/.test(mig) && !/grant [^;]*(insert|update|delete)[^;]* on public\.ai_chat_proposals to authenticated/.test(mig) && (mig.match(/create policy [^;]*on public\.ai_chat_proposals/g) || []).length === 1)
  // phase 4b: the owner's controls and the phone's tools
  const store = fs.readFileSync(`${REPO}/supabase/claude-src/chat-store.ts`, 'utf8').replace(/\/\/.*$/gm, '')
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
