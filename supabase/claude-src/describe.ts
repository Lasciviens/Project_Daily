// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · what it says about itself
//
//  The answer to `{ action: 'describe' }`, shown on Developer → AI. It is built
//  from the same constants and job definitions the function runs on, so the
//  page shows what this code does, not what a document says it does. The words
//  for the owner (the steps, the parts, the safety rules) are written here.
// ─────────────────────────────────────────────────────────────────────────────

import type { Describe, JobDefinition, ProviderInfo } from './types.ts'
import {
  BATCH_MULTIPLIER, LONG_PROMPT_MULTIPLIER, WEB_SEARCH_MAX_USES, WEB_SEARCH_USD_EACH, LONG_PROMPT_OVER_TOKENS, MODEL_PRICES, PRICES_CHECKED_ON, PRICES_SOURCE,
} from './prices.ts'
import { DEFAULTS, EFFORTS, LIMITS, MODELS } from './guard.ts'
import { JOB_LIST } from './jobs.ts'
import { describeChatTools, describePhoneTools } from './chat-tools.ts'
import { CHAT_JOB_NAME, CHAT_LIMITS } from './chat-rules.ts'

/** The function's parts, in the order they are joined (scripts/build-claude-function.mjs has the same list). */
const DESCRIBE_PARTS: Describe['parts'] = [
  { name: 'types', file: 'supabase/claude-src/types.ts', what: 'The shapes the parts hand to each other: a request, an answer, a job, a ledger summary. Nothing in it belongs to a provider.' },
  { name: 'prices', file: 'supabase/claude-src/prices.ts', what: 'The price table, and the sum that turns token counts into dollars.' },
  { name: 'guard', file: 'supabase/claude-src/guard.ts', what: 'The fixed rules: the model list, the limits, how your settings are checked, the budget wall, and the filter that takes secrets out of messages.' },
  { name: 'photos', file: 'supabase/claude-src/image-rules.ts', what: 'Checks a photo before it goes anywhere: one of three types, bytes that really are that kind of picture, its size read from its own header, at most 1600 px on the long side and about 1 MB. A photo is never stored.' },
  { name: 'answer reader', file: 'supabase/claude-src/answer-reader.ts', what: "How every job takes an answer apart: it finds the JSON object in the model's text and checks each value. A value that fails is dropped, never repaired." },
  { name: 'page fetch', file: 'supabase/claude-src/page-fetch.ts', what: 'Reads a web page the owner pasted a link to, with code: https only, private addresses and redirects into them refused, a time limit and a size limit.' },
  { name: 'recipe rules', file: 'supabase/claude-src/recipe-rules.ts', what: "What a recipe is as the recipe editor holds it, the one check every recipe passes through, and the one sentence that says which language recipes keep." },
  { name: 'recipe page', file: 'supabase/claude-src/recipe-page.ts', what: "Reads the recipe a page describes as schema.org data (so no model is needed), and the words a page shows." },
  { name: 'provider', file: 'supabase/claude-src/provider-anthropic.ts', what: "The only part that uses Anthropic's SDK. It turns a request into Anthropic's shape, and the answer or the error back." },
  { name: 'ledger', file: 'supabase/claude-src/ledger.ts', what: "The database calls: your settings and usage are read with your own rights, and each call is written to the log with the server's." },
  { name: 'item form rules', file: 'src/features/items/itemFill.ts', what: "The item form's own field rules, copied in when the function is built. The app runs the same check again on the answer." },
  { name: 'job: item_fill', file: 'supabase/claude-src/job-item-fill.ts', what: 'The ✨ job: its instructions, its answer shape and its check.' },
  { name: 'jobs: recipes', file: 'supabase/claude-src/job-recipes.ts', what: 'The recipe editor\'s three jobs: read a pasted recipe, read a recipe from a link, estimate the nutrition of the ingredients.' },
  { name: 'jobs: quick guess', file: 'supabase/claude-src/job-quick-guess.ts', what: 'The quick guess jobs of Food: guess a meal from a description, and suggest the options of a preset.' },
  { name: 'jobs: photos', file: 'supabase/claude-src/job-photo.ts', what: 'The two jobs that look at a photo: a quick guess from a photo of food, and reading a receipt (paid amount, currency, day, store, items, warranty).' },
  { name: 'jobs: Dev Requests', file: 'supabase/claude-src/job-dev-drafts.ts', what: 'Tidy up a dictated Dev Request, and explain a logged error in plain words (with the secrets taken out first, by code).' },
  { name: 'jobs: short texts', file: 'supabase/claude-src/job-text-features.ts', what: 'Write my week (Work), improve a Shop ad, and ideas for a place wish (a job that may use web search).' },
  { name: 'job: tidy a thing', file: 'supabase/claude-src/job-shop-tidy.ts', what: "Shop's Tidy up info: a cleaner name, brand, model and one of your own categories for a thing, in the store's own words. It may search the web (at most 2) and can touch nothing else: no link, picture, price or date." },
  { name: 'job: coach assessment', file: 'supabase/claude-src/job-coach.ts', what: "The PT coach's daily assessment: it explains the verdicts the app's own rules reached (recovery, volume, the one lift to focus on). The model decides none of them." },
  { name: 'jobs: devices', file: 'supabase/claude-src/job-device.ts', what: "The Kobo's question about a passage and the phone's free question: short plain answers for a small screen, started only by the two device functions. (The phone's morning brief is no AI job: its gateway builds it with Home's fixed rules.)" },
  { name: 'job: weekly report', file: 'supabase/claude-src/job-weekly-report.ts', what: "The weekly report's instructions and its check: five fixed headings, a length limit, no link or markup. A batch job: it is never run live." },
  { name: 'week facts', file: 'supabase/claude-src/week-facts.ts', what: "AI last: every number of the weekly report (training, health, food, tasks and time) is worked out here by code, for the Oslo week Monday to Sunday, with every difference against the week before and every duration already written (\"+3 286 steps a day, +55 %\", \"6 h 47 min\"). The model only reads the prepared text." },
  { name: 'week data', file: 'supabase/claude-src/week-data.ts', what: "Reads the week's rows with the server's rights, each query naming your user id, and hands them to the figures." },
  { name: 'report store', file: 'supabase/claude-src/report-store.ts', what: "The weekly reports' table: add, claim and finish a report, so one check works on a report at a time and its push goes once." },
  { name: 'job: test bench', file: 'supabase/claude-src/job-test-bench.ts', what: 'The Test bench: any question with a model, effort and thinking you pick, from the code\'s lists.' },
  { name: 'job: diagnose', file: 'supabase/claude-src/job-diagnose.ts', what: 'The tiny question of Diagnose: "Reply with the word OK.", with no answer shape.' },
  { name: 'chat rules', file: 'supabase/claude-src/chat-rules.ts', what: "Ask AI's fixed rules: its instructions, the limits of a chat (5 requests per answer, the 90 000-token wall), the permission of each tool, the date line, and the hashes that freeze a chat's tools and instructions." },
  { name: 'suggest rules', file: 'supabase/claude-src/suggest-rules.ts', what: "The suggestions' fixed rules (phase 4c): what an idea may be (a kind from a list, plain text, no link or markup, at most one in an answer, five a week), the key that makes one row per idea, the check of the counted patterns, and the check of the weekly answer. Nothing is created, switched on or changed by an idea." },
  { name: 'suggest store', file: 'supabase/claude-src/suggest-store.ts', what: "The suggestions' tables: the one function that writes an idea (a dismissed idea never returns, a full list and a flood are refused), the counting of repeats in the ledger, and the weekly batch's bookkeeping." },
  { name: 'chat tools', file: 'supabase/claude-src/chat-tools.ts', what: "Ask AI's nine tools: six that read (a day's list as Today holds it, the week's prepared figures, a day's food, a search of your own words, your saved notes about yourself, and one read-only database question as the last resort) two that only propose a write, and one that only records an idea in your Suggestions list (it changes nothing). Code checks every value the model sends." },
  { name: 'job: weekly suggestions', file: 'supabase/claude-src/job-suggest-weekly.ts', what: "The weekly suggestions' instruction: one small model reads the counted repeats (tool shapes, counts and costs, never your data) and proposes at most five ideas for needing AI less." },
  { name: 'jobs', file: 'supabase/claude-src/jobs.ts', what: 'The fixed list of jobs, looked up by name.' },
  { name: 'chat store', file: 'supabase/claude-src/chat-store.ts', what: "The stored chats: conversations, messages (only ever added to, with a hash chain) and the proposals waiting for your Confirm." },
  { name: 'chat loop', file: 'supabase/claude-src/chat-loop.ts', what: "Ask AI's own loop: the walls, the stored history checked before it is replayed, each request reserved and ledgered, the tools run side by side, the citations checked, and your Confirm or Cancel of a proposal." },
  { name: 'phone ask', file: 'supabase/claude-src/phone-ask.ts', what: "The phone's question with its read-only tools (the ones your Ask AI settings leave on): one round of tool calls, then the answer, never streamed, under 19 seconds, every round reserved and ledgered, nothing stored, no proposals." },
  { name: 'run', file: 'supabase/claude-src/run.ts', what: 'One request from start to finish, in the order of the steps on this page.' },
  { name: 'batch', file: 'supabase/claude-src/batch.ts', what: 'The weekly report\'s two steps: queue one request at half price (Monday 05:00, so Sunday is complete), and read it back when it has ended (every 15 minutes while one is queued), correcting the ledger to the real cost; the push waits for 07:00 and goes once.' },
  { name: 'suggest batch', file: 'supabase/claude-src/suggest-batch.ts', what: "The weekly suggestions' two steps: count the repeats and queue one request at half price (Monday, after the report), and read it back when it has ended, writing at most five checked ideas." },
  { name: 'diagnose', file: 'supabase/claude-src/diagnose.ts', what: 'The Diagnose button\'s four checks: the network and key, the shape of ✨\'s request, a tiny answer, and ✨\'s own request with a longer time limit.' },
  { name: 'describe', file: 'supabase/claude-src/describe.ts', what: 'This description: where the page you are reading comes from.' },
  { name: 'main', file: 'supabase/claude-src/main.ts', what: 'The entry point: it checks who is asking, reads the request, creates the database clients and hands over to the run.' },
]

/** The path of one request, in order. `part` names the part that does the step. */
const DESCRIBE_STEPS: Describe['steps'] = [
  { title: 'Who is asking', part: 'main', text: 'The app sends your sign-in token with the request. The function asks whose token it is and checks that account against the owner list. From here on the only user id used is that verified one. The Kobo and the phone cannot hold a token: their own server functions check their device secret first, then call this function with a value derived from the server key (an HMAC) in a header, compared in constant time. That path may only run a job, as "kobo" or "phone", for the owner account read from this function\'s own environment, and only a job whose list of callers names that device.' },
  { title: 'What is asked', part: 'main', text: `The request must be a small piece of JSON (at most ${LIMITS.requestMaxBytes / 1024} KB; a request to a job that reads a photo may be up to ${LIMITS.imageRequestMaxBytes / 1024 / 1024} MB, the photo checked by the photos part) that names an action: "describe" answers with what this page shows, "run" runs a job, "count" gives the Test bench's token count for free, "diagnose" runs the four checks of the Diagnose button.` },
  { title: 'Rate limits', part: 'guard', text: `The function asks the ledger how many calls you made in the last minute and today. At ${LIMITS.callsPerMinute} in a minute or ${LIMITS.callsPerDay} in a day it answers "busy" and writes nothing.` },
  { title: 'Which job', part: 'jobs', text: 'The job is looked up by its name in a fixed list in the code, and the job checks what you sent. A request cannot add a job or change one.' },
  { title: 'Your settings', part: 'guard', text: "Your settings for the job are read with your own database rights, and every value is checked again: a model or an effort that is not on the list becomes the job's default, a thinking setting that is not \"adaptive\" or \"off\" becomes adaptive, and a number is held inside the limits." },
  { title: 'Switch and key', part: 'run', text: "The master switch (all AI off), a job that is switched off, and a server with no API key each stop the request here, the devices' requests too. Each is written to the ledger with zero tokens." },
  { title: 'Reserving the cost', part: 'ledger', text: "Before anything is sent, the most this call could cost (a generous guess of its prompt, plus its whole answer limit) is held against your monthly budget and the job's budget, in one step in the database under a lock. Calls that arrive at the same moment each hold their own share, so none can slip past the wall. If what is left cannot cover it, nothing is sent." },
  { title: 'Code before the model', part: 'run', text: 'AI last: a job may have work that code does better, and it is done before anything is reserved or sent. Reading a recipe link is one: the page is fetched by code and, when it carries its recipe as structured data, code alone answers. That is not an AI call: nothing is reserved and no model is asked, but a finished zero-cost ledger row (\'Read by code, no AI\') is written so the rate caps count it; the reply says it came from the page.' },
  { title: 'Building the request', part: 'run', text: "The request has two parts. First the job's fixed instructions: always the same bytes, so the provider can cache them. Then the part that changes, such as today's date and your text, which travels as data inside a tag." },
  { title: 'Calling the model', part: 'provider', text: "The provider part turns the request into Anthropic's shape and sends it with Anthropic's official SDK: the key in a header and a time limit. There is no automatic retry: one request is one generation, so one reservation covers one possible bill. It turns the answer back into text, a summary of the model's thinking, how it ended and the token counts." },
  { title: 'Checking the answer', part: 'run', text: "An answer the model declined, or one cut off at its length limit, is not used. Otherwise the job checks it value by value with its own code. A value that fails is dropped, never repaired." },
  { title: 'Writing the ledger', part: 'ledger', text: 'The reserved row gets its real numbers: the tokens, the cost (worked out from the price table in this code), the time it took and how it ended. A call whose bill is unknown, such as a timeout, stays charged at the reserved worst case. While you keep the text log on, the request, the answer and the thinking summary are kept too.' },
  { title: 'Batch jobs (the weekly report)', part: 'batch', text: 'A job that can wait is queued at half price (the Message Batches API): on Monday at 05:00 a timer asks this function, with a value derived from a secret it shares with the timer, to work out the week with code, reserve the worst case at the batch price, and queue one request. Another timer asks every 15 minutes while a report is queued; when the batch has ended, this function reads the one result line (found by its id), checks the text, saves the report, corrects the ledger row to the real cost; the push is held until 07:00 and sent once. A batch that failed, expired or was cancelled keeps its worst case in the ledger and the report says why. Nothing is retried in a loop.' },
  { title: 'Ask AI (the chat)', part: 'chat loop', text: "The chat is the one job with a loop of its own. The app asks for a chat answer (streamed as server-sent events). The function checks the stored history (numbers and hash chain) and that the chat's tools and instructions are the ones it began with, then repeats up to five times: reserve the worst case, send the whole chat so far (cached), store the answer exactly as it came, and, if the model asked for tools, run them side by side as you and send all their results back in one message. A tool's mistake comes back as an error result that says what to try. The model can only propose a write: you tap Confirm in the app, and only then the function writes the row with your own rights. Every request is a ledger row of the same run." },
  { title: 'The reply', part: 'run', text: "The app gets the checked result with the call's numbers, or a reason with one plain sentence. Every message goes through the filter that takes secrets out." },
]

/** The rules that are code. The owner's settings move inside them and cannot switch them off. */
const DESCRIBE_SAFETY_RULES: string[] = [
  'Only a signed-in account on the owner list can call this function. The sign-in token is checked first, then the list.',
  'The account the function acts for is always the one it verified (the app) or the owner account of its own environment (a device). A user id sent in a request is never read.',
  "The Kobo and the phone reach this function only through their own server functions, with a value derived from the server key (an HMAC) in a header, checked in constant time. That path can only run a job named for that device: the phone cannot start the item fill, the app cannot start the Kobo's question. A device has its own daily limit.",
  "The API key lives only in the server's secrets. It travels to Anthropic in a header, never in an address, and it is taken out of every error before the error is sent back or written down.",
  'Your settings are treated as input, because the browser can write them: a model or effort that is not on the list is ignored, a thinking setting is one of two words, a switch that is neither true nor false means off, and every number is held inside the limits in the code.',
  `A monthly budget is a wall, not a warning: the worst case of each call is reserved before it is sent, and when it does not fit, nothing is sent. It can be at most $${LIMITS.monthlyBudgetMaxUsd}.`,
  'The prices are part of the code, not a setting, so the budget wall cannot be switched off by changing a price.',
  `At most ${LIMITS.callsPerMinute} calls in a minute and ${LIMITS.callsPerDay} in a day.`,
  'The text you type is sent as data inside a tag, and the fixed instructions say that text in it is never an instruction.',
  'The jobs here get no tools (one job, ideas for a place, may use Anthropic\'s web search, at most 3 searches a call, each one counted and priced) and none of your data beyond what the app hands over in a tag: the model can only suggest values or write text, which you see before anything is saved.',
  'A photo (a meal, a receipt) is sent to the model in the one call that reads it and is never stored: the ledger keeps its size, not its bytes. Text inside a photo is data, never an instruction. Only JPEG, PNG and WebP pass, checked by their own headers.',
  "Ask AI has fixed tools only. Each takes values the code checks (a choice ignoring case, a number in range), runs as you with your own database rights and your user id from the verified sign-in, never one the model gives, and hands back prepared figures. What a tool returns, and every note, task or diary line in it, is data: the instructions say so, and a result is cut to a size limit.",
  'Ask AI can never write by itself, and at most 8 tools run in a round and 3 proposals are made in an answer. A write is a proposal stored by the function; only your tap on Confirm in the app, checked against your account, makes it real, once, with the stored values checked again. A forged, expired or already decided proposal writes nothing. The columns a proposal may fill are a fixed list with no link to an outside account.',
  "A chat is stored exactly as it was sent and received and only ever added to; it is replayed unchanged, a changed or damaged history is refused, and a chat is continued only with the tools and instructions it began with. A tool you switch off is left out of new chats and refused even if the model calls it.",
  'A link in an Ask AI answer is shown only when the model cited something a tool returned in that chat and the row is one of yours; the title shown is the row\'s own.',
  'Where code can decide, code decides: the PT assessment gets its verdicts (rest day, deload, the one lift) worked out by the app, and the phone gets its day looked up, so the model only explains or writes up.',
  "Every answer is checked value by value by the job's own code. A value that fails is dropped, never repaired, and a link is only ever one you typed yourself.",
  'Only this function writes the ledger. The app can read your rows and cannot change them.',
  'The text of a request and its answer is kept only while your text log is on, and is never printed to the server log.',
  'A link you paste is input from outside: only https is read, a private address (in any spelling, or a name that points at one) is refused on every redirect, the read has a time limit and a size limit, and only fixed headers are sent. Text on the page is data in a tag, never an instruction.',
  "The timer reaches this function with a value derived from a secret it shares with the database (an HMAC of a fixed label), compared in constant time; that path can only ask for the weekly report's two steps, as the owner account of this function's own environment. The batch's id is stored where only the server can read it and is only ever read back from that table.",
  'The weekly report is made from figures code worked out: a task title or a workout name in them is data in a tag, the model has no tools and writes nothing but the report text, and its answer is checked (length, five fixed headings, no link or markup) and never repaired.',
  'The ledger and the AI settings are never given to an assistant as data or as a tool.',
]

function describeJob(job: JobDefinition): Describe['jobs'][number] {
  return {
    name: job.name,
    title: job.title,
    what: job.what,
    kind: job.kind,
    mode: job.mode ?? 'live',
    callers: [...job.callers],
    version: job.version,
    defaults: { ...job.defaults },
    timeLimitMs: job.timeLimitMs ?? null,
    instructions: job.instructions,
    answerSchema: job.answerSchema,
    tools: job.name === CHAT_JOB_NAME
      ? describeChatTools().map(t => ({ name: t.name, what: `${t.kind === 'read' ? 'Reads (code prepares the answer)' : 'Only PROPOSES a write: nothing is saved until you tap Confirm'}. ${t.what} Fields, all required: ${t.fields.join(', ')}.` }))
      : job.name === 'phone_ask' ? describePhoneTools() : (job.tools ?? []).map(t => ({ ...t })),
    features: [
      'Prompt caching: the instructions are one cached block',
      ...(job.answerSchema ? [job.enforceAnswerSchema
        ? 'Structured output: Anthropic holds the answer to a JSON Schema'
        : 'A fixed answer shape, written into the instructions as a JSON Schema and checked by our own code'] : []),
      job.pickable ? 'Thinking: adaptive or off, as the request picks' : `Thinking: adaptive by default (${job.defaults.effort} effort); you can switch it off for this job in Settings`,
      'A summary of the thinking, kept in the text log',
      ...(job.extraFeatures ?? []),
    ],
    sourceFiles: [...job.sourceFiles],
  }
}

export function describeFunction(configured: boolean, provider: ProviderInfo): Describe {
  return {
    configured,
    provider,
    models: MODELS.map(m => ({ ...m })),
    efforts: [...EFFORTS],
    limits: {
      monthlyBudgetMaxUsd: LIMITS.monthlyBudgetMaxUsd,
      callsPerMinute: LIMITS.callsPerMinute,
      callsPerDay: LIMITS.callsPerDay,
      maxOutputTokens: { ...LIMITS.maxOutputTokens },
      logDays: { ...LIMITS.logDays },
      requestMaxBytes: LIMITS.requestMaxBytes,
      imageRequestMaxBytes: LIMITS.imageRequestMaxBytes,
      benchTextMax: LIMITS.benchTextMax,
      deviceCallsPerDay: { ...LIMITS.deviceCallsPerDay },
    },
    defaults: { ...DEFAULTS },
    prices: {
      checkedOn: PRICES_CHECKED_ON,
      source: PRICES_SOURCE,
      longPromptOverTokens: LONG_PROMPT_OVER_TOKENS,
      longPromptMultiplier: LONG_PROMPT_MULTIPLIER,
      batchMultiplier: BATCH_MULTIPLIER,
    webSearchUsdEach: WEB_SEARCH_USD_EACH,
    webSearchMaxUses: WEB_SEARCH_MAX_USES,
      models: MODEL_PRICES.map(p => ({ ...p })),
    },
    chat: {
      tools: describeChatTools().map(t => ({ name: t.name, kind: t.kind, what: t.what, defaultMode: t.defaultMode, chats: t.chats })),
      limits: {
        ownerInstructionsMax: CHAT_LIMITS.ownerInstructionsMax, imagesPerMessage: CHAT_LIMITS.imagesPerMessage, imagesPerChat: CHAT_LIMITS.imagesPerChat,
        imageBase64Max: CHAT_LIMITS.imageBase64Max, photoLongSide: 1568,
      },
    },
    jobs: JOB_LIST.map(describeJob),
    steps: DESCRIBE_STEPS,
    parts: DESCRIBE_PARTS,
    safetyRules: DESCRIBE_SAFETY_RULES,
  }
}
