# AI rebuild on Claude — the plan

**Status: approved by the owner on 20.11.2026, with the changes in "The owner's decisions" below.** Phase 0 is done (`docs/integrations/anthropic.md`). Written 20.11.2026.

**The owner's ask (20.11.2026):** "Let's build Haiku then. Let's be careful and do it right. Note every single use of Gemini we do. I want a place to see every single detail with AI API. The cost, the usage, the stats, everything. I want to see how we configure, set up, use, manipulate AI in every way! I want to see the code, the explanation and everything. I want every single feature Anthropic gives us … so we use it as efficiently as we can. I want to use this AI and understand how this works. We will remove everything about Gemini. Do not try to adapt Haiku to Gemini's code. We will start from scratch. A better, more secure, more useful, more intelligent, and more controlled by myself version."

**What this plan decides:**
- the new AI layer is built fresh on Claude Haiku 5.5 (`claude-haiku-5-5`);
- every place Gemini is used today gets a Claude replacement;
- one new section, **Developer → AI**, shows how it all works and what it costs;
- Gemini is removed completely, part by part as each is rebuilt.

## The owner's decisions (20.11.2026)

1. **The AI page lives under the Developer page** ("Under developer page!").
2. **The Batch API is in scope,** for cheap jobs that can wait, such as weekly reports ("I do also want to use the batch API feature for cheap solution to use for weekly reports etc.").
3. **We run the agent loop ourselves:** "I want full control over tool execution, logging, error handling, and Supabase operations." Claude Haiku serves both the real-time requests and the batch jobs.
4. **The architecture is modular,** "so we can switch providers or try Managed Agents later if needed".
5. **Gemini has been switched off for months** and nothing depends on it: "You can remove whenever you want." So nothing is kept running for its sake.
6. **Nothing of the Gemini setup is copied:** "DO NOT COPY ANY OF GEMINI VERSION AI SETUP! Just get the idea what it does and then build it from scratch!"

Taken as proposed, since the owner named no change (each is a setting on the page, except the first):
- search by meaning becomes the database's own full-text search;
- the full text of requests and answers is logged, kept 30 days, owner-only;
- fixed safety rules in code, plus the owner's own editable instructions;
- a monthly budget of $5 to start, stopping when reached.

### The from-scratch rule

The old code (`ai-proxy`, `aiApi.ts`, the Kobo and phone AI calls) is read for one purpose only: to learn **what each feature does for the owner**. Nothing is carried over: no instruction text, no tool definition, no answer shape, no loop, no model chain, no caching trick. Each job's instructions, tools and answer shape are designed new, for Claude, from the feature's purpose. The one thing kept is knowledge about the owner's data that isn't Gemini's: which tables exist, which columns link a row to an outside account (they stay unwritable by the assistant), and which actions need a Confirm.

Words used below, once:
- **Token:** a piece of text, about ¾ of a word. Prices are per million tokens ($/M).
- **Prompt:** everything sent to the model in one request: the instructions, the conversation, the tool list, the data.
- **Tool:** a function the model may ask the app to run, such as "read today's tasks". The app runs it and sends back the result.
- **Cache:** the start of a prompt that repeats from one request to the next is stored at Anthropic for a few minutes. When it repeats, it costs a tenth.
- **Effort / thinking:** how much the model reasons before answering. More effort gives better answers to hard questions, but costs more and takes longer.

---

## 1. Every use of Gemini today

### Server (the Gemini key lives only here)

| Where | What it does | Model today |
|---|---|---|
| `supabase/functions/ai-proxy` (4,211 lines) — chat | **Ask AI**: a conversation where the model calls 28 tools to read and write your data:<br>• generic database tools: `db_query`, `db_insert`, `db_update`, `db_delete`, `db_aggregate`, `describe_database`, `run_read_query`;<br>• special tools: transit, media, health, shop, Hevy routines, calendar, day summary;<br>• `semantic_search`, `save_memory`. | `gemini-3.5-flash`, then three fallbacks |
| `ai-proxy` — surface `coach` | The **PT coach chat** (same loop, a training-focused prompt). | same |
| `ai-proxy` — surface `phone` | The phone's **brief** and **ask**: one answer, no tools. | `gemini-3.1-flash-lite` |
| `ai-proxy` — `responseSchema` mode (removed in 2a) | One-shot JSON answers. Used by the recipe editor (read a recipe from text, estimate macros) and Food's quick guess ("describe it", suggest options). | chain |
| `ai-proxy` — `fetchUrl` (removed in 2a) | Reads a recipe page server-side (with the SSRF guard), then parses it. | chain |
| `ai-proxy` — `itemFill` | The item screen's **✨ fill from a sentence**. | `gemini-3.1-flash-lite` first |
| `ai-proxy` — embeddings | **Search by meaning**: turns saved notes into numbers (`gemini-embedding-001`, 768 numbers each), and **Reindex AI search** on the Developer page. | embedding model |
| `ai-proxy` — `confirmAction` | Runs or cancels a write the assistant proposed, after you tap Confirm. | none (no AI call) |
| `supabase/functions/kobo-sync` → `handleAsk` | A question about a book passage, asked from the Kobo. At most 100 a day; answers saved in `book_ai_notes`. | `gemini-3.1-flash-lite`, `gemini-2.5-flash` |
| `supabase/functions/phone-gateway` → `ask`, `brief` | Forwards the iPhone shortcut's questions to `ai-proxy`, surface `phone`. | via ai-proxy |

### App screens

| Screen | Function | File |
|---|---|---|
| Ask AI panel: chat, photos, voice, Confirm / Cancel | `sendMessage`, `sendCoachMessage`, `settleAIAction` | `src/features/ai/components/AIPanel.tsx`, `src/features/ai/api/aiApi.ts` (695 lines) |
| Training → Coach: the PT assessment | `generatePTAssessment` → `invokeAI` | `src/features/training/api/ptCoachApi.ts`, `PTCoachTab.tsx` (shows the Gemini model name) |
| Recipe editor: from text, from a link, macros | `parseRecipeText`, `parseRecipeFromUrl`, `estimateRecipeMacros` | `src/features/recipes/components/RecipeModal.tsx` |
| Food → Quick guess | `describeGuess`, `suggestGuessOptions` | `src/features/recipes/hooks/useQuickGuess.ts` |
| Item screen ✨ | `fillItemFields` | `src/shared/components/plan-modal/useItemFill.ts`, `src/features/items/itemFill.ts` |
| Developer → Reindex AI search | `reindexAiSearch` | `src/features/developer/pages/DeveloperPage.tsx` |
| Kobo passage question (the prompt) | `buildAskPrompt` | `src/features/books/koboDevice.ts` |
| Settings → APIs and Subscriptions | the "Gemini API" entry and the `gemini` service | `src/features/settings/apiRegistry.ts`, `subscriptionRules.ts`, `SubscriptionBits.tsx` |

### Database

| Item | Migration | What it holds |
|---|---|---|
| `ai_usage_log` | 064 | Tokens per chat answer. Has data for 22.07–25.08.2026. |
| `ai_query_log` | 064 | Every data read the assistant ran. |
| `ai_memory` | 064 | Facts and preferences the assistant saved about you. |
| `ai_run_read_query()` | 064 | The assistant's read-only SQL, run with your own rights. |
| `ai_embeddings` (vector of 768) + `ai_semantic_search()` | 065 | Search by meaning. **Gemini-specific numbers.** |
| `ai_reviews` | 065 | Unused, empty. |
| `ai_pending_actions` | 140 | Writes waiting for your Confirm. |
| `ai_embeddings_follow_source` trigger | 140 | Drops a search copy when its row changes. |
| `book_ai_notes` | Kobo | Passage questions and answers. |
| `pt_assessments.model` | 051 | Which model wrote an assessment. |
| `service_subscriptions` value `gemini` | 115 | Gemini as a listed service. |

### Secrets, tests and docs

- **Secret:** `GEMINI_API_KEY` (Supabase secret), mentioned in `.env.example` and `docs/backend/environment.md`.
- **Harness:** the `ai-proxy` mock in `scripts/harness/functions.cjs`.
- **Checks:** `verify-ai-confirm`, `verify-item-fill`, `verify-secret-errors`, `verify-ssrf-guard`, `verify-supabase-keys`.
- **Docs:**
  - `docs/features/ai.md`, `docs/ai-cost-capability-analysis.md`;
  - `docs/backend/edge-functions.md`, `docs/backend/environment.md`, `docs/deploy-checklist.md`;
  - `docs/features/iphone.md`, `docs/features/settings.md`, `docs/kobo/REFERENCE.md`;
  - `README.md`, the guardian and deploy agent files.

**What you actually used** (`ai_usage_log`, 22.07–25.08.2026):
- 170 answers over 25 days.
- In August: about 101,000 tokens sent per answer, in about 4 steps each, with 65% of it cached.
- At Haiku 5.5 prices that month would cost about **$0.50–1.20**. It's a rough figure: Claude counts tokens differently from Gemini, and its thinking is billed as output.

---

## 2. The new design

### One server function, built fresh

A new edge function, **`claude`**, is the only place that holds `ANTHROPIC_API_KEY` and talks to Anthropic. Nothing is carried over from `ai-proxy`'s Gemini code (the from-scratch rule above).

**Built in separate parts** (the owner's decision 4), each in its own file under `supabase/claude-src/`. A small script (`scripts/build-claude-function.mjs`) joins them into the one file that is deployed (`supabase/functions/claude/index.ts`), because every function in this repo is deployed as one file. You read and change the parts; a check fails if the joined file is out of date.

The parts:
- **The provider part** is the only file that imports Anthropic's SDK. It turns our own neutral request ("these instructions, these tools, this conversation") into Anthropic's shape and the answer back. Another provider is another such file.
- **The loop part** runs an answer: call the model, run the tools it asks for, repeat. It knows no provider. Trying Managed Agents later means writing a second loop part, not changing the jobs.
- **The jobs part:** one small definition per job (its instructions, tools, answer shape and checks).
- **The tools part:** each tool, with its permission and what it may touch.
- **The ledger part:** logging, cost and budgets.
- **The guard part:** who may call, limits, and scrubbing of errors.

How each request goes:
1. The app (or the phone, or the Kobo) asks for a **job**, for example `item_fill`.
2. The function checks who is asking: your sign-in and the owner lock, or the phone's or Kobo's own secret.
3. It reads that job's settings from your database: model, effort, budget, and which tools are allowed.
4. It checks this month's spend against your budget.
5. It builds the prompt in a fixed order, so the cache works: tools, then fixed instructions, then live context, then the conversation.
6. It calls Claude's Messages API. If the model asks for a tool, the function runs it as you (never as anyone else), sends the result back, and repeats. A write is never done directly: it waits for your Confirm in the app.
7. Every call is written to your log: tokens, cost, time, tools used, the thinking summary, and the answer.

**Why we run the loop ourselves.** Anthropic also offers "Managed Agents", where they run the loop for you. We don't use it here:
- it keeps the session history at Anthropic;
- it bills extra for run time;
- it puts the conversation outside the database you control.

With our own loop, every step lands in your own log, where you can see it.

### Jobs

Each job has its own settings and its own log:

| Job | Kind | Replaces |
|---|---|---|
| `chat` | Conversation with tools | Ask AI |
| `coach_chat` | Conversation with training tools | PT coach chat |
| `coach_assessment` | One answer, fixed shape | PT assessment |
| `phone_brief` · `phone_ask` | One answer, no tools | Phone surface |
| `kobo_ask` | One answer | Kobo passage question |
| `item_fill` | One answer, fixed shape | ✨ |
| `recipe_from_text` · `recipe_from_link` · `recipe_macros` | One answer, fixed shape | Recipe editor |
| `quick_guess` · `quick_guess_options` | One answer, fixed shape | Quick guess |
| `weekly_report` (and later reports) | **Batch:** queued, answered within hours, at half price | new |

### Settings you control (stored in your database, edited on the AI page)

- **Per job:**
  - on or off;
  - the model: Haiku 5.5 by default, Sonnet 5.5 or Opus 5.5 as options;
  - effort: low, medium or high;
  - the longest answer;
  - a monthly budget in dollars. When it's reached, the job stops and says so.
- **Total monthly budget.** It's a wall, not a warning. You set it between $0 and $50; the $50 ceiling is in the function's code, so a stolen sign-in can't raise it further. The limit you set in Anthropic's Console is the outer wall.
- **Per tool:** read-only, ask first, or off. The model never changes these: they're not in its tool list. *Arrives with Ask AI (phase 4), when there are tools.*
- **Your own instructions:** a text the model gets after its fixed rules, such as "answer in short sentences" or "I train in the morning". The fixed safety rules stay in code. *Arrives with Ask AI (phase 4): a form fill like ✨ should not be steered by free text.*
- **Conversation log:** keep the full text of requests and answers (on or off), and for how many days (1–90). Text already saved stays until its days have passed.

Every stored setting is treated as input by the function: a model that isn't on its list, or a number outside its limits, is never used.

**Prices are not a setting** (changed 20.11.2026, for safety). The budget wall is worked out from the prices. If the browser could change a price, a stolen sign-in could set it to zero and switch the wall off. So the price table lives in the function's code, the AI page shows it with the date it was checked, and a price change is a reviewed code change that re-checks Anthropic's page.

### Search by meaning without Gemini

Anthropic has no model that turns text into search numbers ("embeddings"). The replacement:
- **Postgres full-text search,** built into your database: no outside service, no cost, nothing to re-index by hand.
- **Claude picks the search words,** including other words for the same thing.

`ai_embeddings` and its numbers are removed in the last phase.

---

## 3. Anthropic features: what we use and why

Checked against Anthropic's documentation on 20.11.2026: every price, limit and field is in `docs/integrations/anthropic.md`.

**Haiku 5.5's price** (per million tokens):

| | Request up to 100K tokens | Request over 100K tokens |
|---|---|---|
| Input | $0.10 | $0.50 |
| Output | $0.50 | $2.50 |

- A cached read costs 0.1× the input price.
- Writing to the cache costs 1.25× (kept 5 minutes) or 2× (kept 1 hour).

Haiku 5.5 has a 1M context window and up to 128K tokens of output. The function keeps every request under 100K tokens.

### Used from the start

| Feature | What it gives you |
|---|---|
| **Prompt caching** | The fixed part (tools + rules, about 7K tokens) costs a tenth on every step after the first. That's the biggest cost lever, since an answer sent ~100K tokens. |
| **Mid-conversation system messages** | Live context (today, the time, your data) goes in after the cached part, so it never breaks the cache. |
| **Structured outputs** (not used for now) | Anthropic can enforce an answer shape. Live (22.11.2026) ✨'s 21 optional fields hung for 90 s: every optional field doubles the grammar's states, and compiling it can take up to 180 s (cached 24 h after). So no job enforces a shape now: each writes its shape into its instructions and our own check holds every field, as it always did. A later job may enforce a very small shape with every field required (`docs/integrations/anthropic.md`, trap 16). |
| **Strict tool use** | A tool's input always matches its definition. Anthropic allows at most 20 such tools in one request, so the new tool set is small and sharp. |
| **Adaptive thinking + effort per job** | Low for form fills, medium for chat. The log shows a **summary of how it reasoned**, so you can see why it answered what it did. |
| **Vision** | Photos in the chat, as today. |
| **Context editing** (beta) | Old tool results inside a long answer are cleared before the next step, so a 4-step answer stops resending everything. That attacks the 100K-per-answer problem. Haiku 5.5 supports it (checked 20.11.2026). |
| **Task budgets** (beta) | A token ceiling per answer that the model paces itself to, instead of being cut off. |
| **Token counting** | The AI page can show what a prompt will cost before it's sent. |
| **Exact usage per call** | Every answer reports its input, cached, written and output tokens. The log stores them, and cost is worked out from the price table. |
| **Message Batches** | Jobs that can wait (weekly reports) are queued and answered within hours, usually within one, at **half price**. Results land in the same log. Anthropic keeps a batch's content 29 days, so the results stay downloadable. |
| **Refusal handling** | Haiku can decline a request its safety filters flag, and Anthropic offers no automatic fallback for it. You see a decline plainly. Optionally (your setting) our function retries it once on Sonnet 5.5. |

### Later, one at a time, each measured on your own questions

| Feature | What it would add |
|---|---|
| **Advisor tool** (beta) | Haiku asks Opus 5.5 or Sonnet 5.5 for advice on a hard question, mid-answer. Smarter answers at a small extra cost. |
| **Programmatic tool calling** | The model writes a small program that calls your tools and adds up the results, so thousands of rows never enter the conversation. "Average protein this month" gets cheap and exact. |
| **Tool search** | Tool definitions are loaded only when needed. |
| **Web search / web fetch** | Looking things up. For recipe links we keep our own guarded fetch. |
| **Citations** | Answers that point to the exact note or row they came from. |
| **PDF input** | For example, reading a body-composition report. |
| **Memory tool** | A more structured long-term memory than today's `ai_memory`. |

### Not used, and why

- **Managed Agents:** see "Why we run the loop ourselves" above.
- **Message threads:** the conversation would be kept at Anthropic for a while. Not needed at this size.
- **Fast mode:** only on Opus and Fable, at 2× the price.
- **Admin API / official cost reports:** they need an admin key that can manage your whole Anthropic organization, which is too powerful to keep on a server. Our own log has the exact usage per call, and Anthropic's Console shows the official bill.
- **Data residency** (`inference_geo`): Anthropic offers no EU option (checked 20.11.2026); the only other choice, "us", just costs 10% more.
- **Computer use, bash, text editor, MCP connector:** nothing in this app needs them.

---

## 4. The AI page (Developer → AI)

A new section on the **Developer** page (the owner's decision 1). Its tabs:
1. **Overview**
   - This month's cost, total and per job, against your budgets.
   - Answers, tokens, and how much the cache saved.
   - A chart per day.
2. **Calls**
   - Every call: time, job, model, tokens (input · cached · written · output), cost, duration, the tools it used, and how it ended.
   - Open one to see the request and the answer (if you keep them), the thinking summary, and each tool call with its input and result.
3. **Settings:** everything in §2's settings list.
4. **How it works:** read from the running function itself (it describes its own jobs, limits and prices), so the page shows what is deployed, not a copy.
   - The path of a request, step by step: app → function → Claude → tools → your database.
   - The fixed instructions of every job, with their version.
   - Every tool: its name, description, inputs, permission, and what it can read or write.
   - A link to each source file on GitHub.
   - A short glossary.
5. **Prices:** the price table the costs are worked out from, with the date it was checked and a worked example. Read-only (see "Prices are not a setting" in §2).
6. **Test bench**
   - Send any question with a model and effort you pick.
   - See the token count before sending, then the answer, its cost, its time and its thinking summary.

   This is where you learn how it behaves.
7. **Batches:** each queued batch job, its state (waiting, done, failed), its cost at the batch price, and its result. Start one by hand, or cancel one that waits.

The page follows the app's rules: phone layout first, dates as DD.MM.YYYY, and every action says its result.

---

## 5. Security, designed in

Written down before code, as `AGENTS.md` requires. For each input, what an attacker could do, and how that's designed out:

| Input | What could go wrong | How it's designed out |
|---|---|---|
| The API key | Leaked, then used by others | Only in Supabase secrets, never in the app, a URL or a log. Errors are scrubbed (`hideSecrets`). A spend limit is set in Anthropic's Console as the outer wall. |
| Who calls the function | A stranger, or a stolen phone or Kobo secret | `getUser` + `isAppUser` on every app call. The phone and Kobo use their own secrets, compared in constant time, each with a daily cap. |
| Your data the model reads | Text in a note, a recipe page or a calendar event that tells the model what to do (prompt injection) | Tool results go in as data. Writes never happen without your Confirm in the app. The model can't reach tokens, secrets or its own settings. Budgets cap the cost. |
| The model's answer | A wrong or harmful value in a form, or an address that opens somewhere else | Every field checked by our own code, allow-lists, never "fixed up". Links taken only from what you typed (as ✨ does today). |
| Tool calls | A write to another account, or a target built from stored data | Every query forced to your user id. Write targets built server-side at the moment of use. New link columns go into `AI_NO_WRITE`. |
| The device secret (Kobo, phone), stolen | Calls to the phone or Kobo actions from anywhere | The device function checks it in constant time and fixes the caller and job itself; `claude` runs only jobs whose `callers` names that device, answers 100 calls a day per device, and the ledger's caps and the budget wall bind too. The thief gets short, tool-less answers within those caps, and with the phone secret nothing the phone's deterministic actions did not already give (`tasks_today`, `sleep_stats`); no longer `ai-proxy`'s tools. |
| The server key `claude` receives from a device function | A request with a forged or guessed key, or a device function that is steered into naming another account | `x-claude-server-key` is compared with `sameSecret` against `claude`'s own service key (no key set: refused), before the body is read; a request that carries the header never falls through to the token path. The body names only the caller (from a fixed list of two), the job and its input; the account is `HEVY_USER_ID` from `claude`'s environment, never from the body. Holding the service key already means holding the database, so this adds no new power; the header name keeps it out of `Authorization`, which a gateway or a log could print. |
| A passage of a book, a calendar title, a note (Kobo, phone, coach) | Text that tells the model what to do | Each travels in its own escaped tag, the instructions say the tags are data, the jobs have no tools and write nothing, answers are plain text checked for length, the Kobo's saved note is the owner's own table. |
| The Test bench's pick | A model or effort outside the lists, a very long or costly request | `prepare` and `run.ts` check the pick against the code's lists; the text is ≤ 2000 characters; the worst case of the picked model is reserved like any call; `count` is free and refused at a rate cap. |
| The log | Personal data kept forever | Owner-locked, a retention you choose, and never readable by the model. |
| Settings | The model turning on its own tools | The settings tables are not in the model's tool list or catalog. |

A **guardian review** runs on every phase.

---

## 6. Phases — each its own PR

Gemini is off and stays off. Each phase deletes the Gemini code of what it rebuilds; the last leftovers go in phase 5.

| # | What | Old code removed |
|---|---|---|
| 0 | **Done (20.11.2026):** `docs/integrations/anthropic.md`: how we authenticate, the endpoints, the fields, prices, limits and traps, checked against Anthropic's documentation. | — |
| 1 | **Built 21.11.2026 (PR #619):** **Foundation:**<br>• the `claude` function in its separate parts: provider, loop, jobs, ledger, guard;<br>• the tables for calls and settings (migration 194);<br>• **Developer → AI**: Overview, Calls, Settings, Prices, and a first How it works;<br>• the first job, **✨ fill**, on Haiku. | the ✨ branch of `ai-proxy`, the Gemini entries in Settings |
| 2 | **One-shot jobs.** Split in steps, each its own PR:<br>• **2a built 22.11.2026:** recipes (`recipe_from_text`, `recipe_from_link` with AI last — code reads a page's schema.org Recipe and no model is asked —, `recipe_macros`) and quick guess (`quick_guess`, `quick_guess_options`); no enforced answer shape;<br>• **2b built 22.11.2026:** the PT assessment (`coach_assessment`; its decisions are code, `coachFacts.ts`);<br>• **2c built 22.11.2026:** the Kobo passage question (`kobo_ask`) and the phone's brief and ask (`phone_brief`, `phone_ask`), reaching `claude` through their own server functions with the service key (§5);<br>• **2d built 22.11.2026:** the Test bench (sixth view of Developer → AI) with the free token count and a thinking adaptive-vs-off comparison. | 2a: `ai-proxy`'s `responseSchema` and `fetchUrl` modes, `callGeminiStructured`, `aiApi.ts`'s structured calls. 2b–2c: the Gemini calls of `ptCoachApi.ts`, `kobo-sync` and `phone-gateway`, and the phone secret's way into `ai-proxy` |
| 3 | **Batch jobs:** the queue, the scheduled check, the Batches tab, and the first weekly report. What the report covers is asked when this phase starts. | — |
| 4 | **Ask AI from scratch:**<br>• a new tool set: at most 20, sharp, strict, each with your permission;<br>• live context through system messages;<br>• context editing, task budgets, the Confirm flow, photos;<br>• coach chat, phone ask;<br>• search with the database's full-text search, and memory. | the rest of `ai-proxy` and `aiApi.ts` |
| 5 | **The last of Gemini:**<br>• docs and checks;<br>• `GEMINI_API_KEY`;<br>• the tables `ai_embeddings` and `ai_reviews`.<br>Dropping a table needs your OK first. | everything left |
| 6 | Optional, one at a time and measured: advisor, programmatic tool calling, tool search, web search. | — |

Each phase gets tests, a guardian review, and a look on the phone layout before its PR.

### Next (found in phase 2a, not done yet)

- Thinking off for the jobs where it is measured safe (a form fill needs none): less cost and time. **The tool exists since 2d** (`ModelRequest.thinking: 'adaptive' | 'off'`, compared in the Test bench); no job turns it off yet, because nothing has been measured live.
- ✨ with an enforced shape that has **all fields required** (an empty value means "not given"; `cleanItemFill` compares an enum case-insensitively), tried with Diagnose's real call first.
- Retry a Haiku refusal once on Sonnet (the promise in section 3 is not built yet).
- ~~A token count before sending, in the Test bench (2d)~~ built (`{ action: 'count' }`); it cannot catch a grammar that will not compile.

---

## 7. Your steps

1. Create an Anthropic API account at console.anthropic.com, add billing, and **set a monthly spend limit** there.
2. Create an API key and add it in **Supabase → Project Settings → Edge Functions → Secrets** as `ANTHROPIC_API_KEY`. Never paste it in the chat.
3. Delete `GEMINI_API_KEY` there whenever you like: nothing uses it.

---

## 8. Using AI for less — approved by the owner on 20.11.2026

**The owner's ask (20.11.2026):** an "AI Optimization & Automation Discovery System". AI is for reasoning, deciding and interpreting. Whatever fixed logic, a reusable query, an existing tool or an automation can do reliably should not go through AI. The system watches new AI use, finds repeated or needless AI work, and **only suggests**: it never creates, switches on or changes anything by itself. "The ultimate goal is not to make AI perform more tasks. It is to make AI necessary for fewer tasks." The owner asked for criticism, and to split the work into phases.

**Status:** approved as written below (owner, 20.11.2026: "I trust on your judgement. Do whatever is best and includes my goal to minimize AI, maximize automation and tool. AI is useful to me when it needs to think. Also pre-defined stuff is also nice."). Decided with it: Ask AI keeps **one** read-only fallback tool for new questions, and everything else is fixed tools. Built in steps A–D below, not all at once.

### What already covers it (reuse)

| The ask | Already there, or already planned |
|---|---|
| Watch every AI call: tools, tokens, cost | The ledger `ai_calls` (phase 1): one row per call with job, tokens, cost, duration and the tools used. No second log is needed. |
| A registry of reusable, parameterised queries | Ask AI's new tool set (phase 4). A tool **is** a reviewed, named, parameterised query. The model no longer writes its own SQL for things a tool covers. |
| Matching a request to an existing query | The model picks a tool from the tools' descriptions, inside the call it makes anyway. That costs no extra call. |
| Background analysis at half price | The batch queue (phase 3). |
| A central list of suggestions | The Dev Requests drawer (`dev_requests`): it is already the app's backlog. |
| "Approved by the owner, then built separately" | The repo's own rule: only the owner approves, and everything ships through a reviewed PR. |

### What is new (small)

1. **Tool calls are logged by shape, not by content.** For each tool call: its name, which parameters it used, how many rows and bytes came back, and how long it took. No health, food or training values.
2. **One fallback tool for new questions,** read-only, with your own rights only. Each use is logged as a "fingerprint" (the query with its values removed). A fingerprint that comes back is the clearest sign that a named tool or an app feature is missing.
3. **`ai_suggestions`** — one row per idea, not per sighting:
   - kind: widget · chart · automation · notification · report · existing feature · new tool · cheaper setting;
   - what, why, and the saving worked out from the ledger (times seen × tokens per time);
   - the call it was first seen on, a counter, and a state: new · kept · dismissed · built.
   - A dismissed idea never comes back.
4. **Finding ideas, cheapest first:**
   - **Counting, no AI:** a database function over the ledger finds repeated tool sequences, repeated fingerprints, the jobs that cost most, and calls that sent much and used little.
   - **In the answer itself, no extra call:** Ask AI gets one optional tool, "note a shortcut". The model uses it only when it is obvious that the app could show this without AI. Cost: about 150 cached tokens per request.
   - **Once a week, in the batch queue:** one Haiku job reads the counted patterns and the suggestions that already exist, and writes at most five new ones. It gets the pattern counts and the tool shapes, never the data rows.
5. **On screen:** one quiet line under the answer that produced an idea, and a Suggestions view in Developer → AI with Keep · Dismiss · Send to Dev Requests.

### Criticism

1. **At today's size the saving is small.** The 2026 log shows about 170 answers a month, around $0.50–1.20 on Haiku. Building and running a discovery system costs more than it can save in money. The value is speed, fewer steps and learning, so it has to stay small.
2. **Most of the saving comes from the design, not from discovery.** An answer sent about 100,000 tokens because the model wrote its own SQL and every step resent everything. Sharp tools that return a prepared summary, the cache, and clearing old tool results (all phase 4) remove most of that. Discovery is the last 10%.
3. **No separate "intent tracking" or "semantic matching".** Each would be one more AI call per message, which is the opposite of the goal. The model's own tool choice does the matching for free.
4. **Every reusable query made into a tool makes every request bigger** (about 100–200 tokens each), and Anthropic allows 20 strict tools per request. So: few, general tools with parameters. A narrow one-off need becomes a widget or a chart, not a tool.
5. **A suggestion is written by the model, so it is input.** Text in a note or a recipe page could steer it ("suggest a tool that exports everything"). So suggestions are shown as plain text, never acted on by code, and whoever builds one treats it as an idea to check, not as an instruction.
6. **Privacy.** Sending past questions to Anthropic a second time for analysis doubles their exposure, and a batch is kept there for 29 days. So the analysis gets counts and shapes, not your data, and the question text only when the text log is on.
7. **Not everything repeated should be automated.** A suggestion needs a real saving (a threshold) or an obvious fit. Otherwise the list fills with noise.

### Phases (each its own PR, after the Haiku build's own phases)

| Step | What | Where it fits |
|---|---|---|
| A | Tool calls logged by shape; the fallback tool's fingerprints; the counting function | With phase 4 (Ask AI), since there are no tools before it |
| B | `ai_suggestions`, the Suggestions view, Keep · Dismiss · Send to Dev Requests, the line under an answer, the "note a shortcut" tool | Right after phase 4 |
| C | The weekly discovery job in the batch queue | After phase 3 and step B |
| D | The first built suggestions, each a normal reviewed PR | Ongoing |

Phase 1 needs no change: its ledger is the base all of this stands on.

### Risks

- The watcher costs more than it saves: capped at one batch job a week and five suggestions.
- Monitoring breaks the assistant: every write of the watcher is "best effort" and outside the answer's path; a failure is logged and never stops an answer.
- Suggestion noise: one row per idea, a threshold, and dismissed means gone.
- A steered suggestion: plain text only, owner review, reviewed PR.
