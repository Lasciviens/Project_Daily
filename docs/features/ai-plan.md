# AI rebuild on Claude — the plan

**Status: a plan, waiting for the owner's go. No code yet.** Written 20.11.2026.

**The owner's ask (20.11.2026):** "Let's build Haiku then. Let's be careful and do it right. Note every single use of Gemini we do. I want a place to see every single detail with AI API. The cost, the usage, the stats, everything. I want to see how we configure, set up, use, manipulate AI in every way! I want to see the code, the explanation and everything. I want every single feature Anthropic gives us … so we use it as efficiently as we can. I want to use this AI and understand how this works. We will remove everything about Gemini. Do not try to adapt Haiku to Gemini's code. We will start from scratch. A better, more secure, more useful, more intelligent, and more controlled by myself version."

**What this plan decides:**
- the new AI layer is built fresh on Claude Haiku 5.5 (`claude-haiku-5-5`);
- every place Gemini is used today gets a Claude replacement;
- one new page, **AI**, shows how it all works and what it costs;
- Gemini is then removed completely.

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
| `ai-proxy` — `responseSchema` mode | One-shot JSON answers. Used by the recipe editor (read a recipe from text, estimate macros) and Food's quick guess ("describe it", suggest options). | chain |
| `ai-proxy` — `fetchUrl` | Reads a recipe page server-side (with the SSRF guard), then parses it. | chain |
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

A new edge function, **`claude`**, is the only place that holds `ANTHROPIC_API_KEY` and talks to Anthropic. Nothing is carried over from `ai-proxy`'s Gemini code. It is deleted at the end.

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

### Settings you control (stored in your database, edited on the AI page)

- **Per job:**
  - on or off;
  - the model: Haiku 5.5 by default, Sonnet 5.5 or Opus 5.5 as options;
  - effort: low, medium or high;
  - the longest answer;
  - a monthly budget in dollars. When it's reached, the job stops and says so.
- **Total monthly budget.** It's a wall, not a warning.
- **Per tool:** read-only, ask first, or off. The model never changes these: they're not in its tool list.
- **Your own instructions:** a text the model gets after its fixed rules, such as "answer in short sentences" or "I train in the morning". The fixed safety rules stay in code.
- **Conversation log:** keep the full text of requests and answers (on or off), and for how many days.

### Search by meaning without Gemini

Anthropic has no model that turns text into search numbers ("embeddings"). The replacement:
- **Postgres full-text search,** built into your database: no outside service, no cost, nothing to re-index by hand.
- **Claude picks the search words,** including other words for the same thing.

`ai_embeddings` and its numbers are removed in the last phase.

---

## 3. Anthropic features: what we use and why

Checked against Anthropic's API reference for Claude Haiku 5.5. Prices and limits are confirmed live in `docs/integrations/anthropic.md` before any code.

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
| **Structured outputs** | ✨, recipes, quick guess and the PT assessment always come back in the exact shape the app expects. Every field is still checked by our code. |
| **Strict tool use** | A tool's input always matches its definition. |
| **Adaptive thinking + effort per job** | Low for form fills, medium for chat. The log shows a **summary of how it reasoned**, so you can see why it answered what it did. |
| **Vision** | Photos in the chat, as today. |
| **Context editing** (beta) | Old tool results inside a long answer are cleared before the next step, so a 4-step answer stops resending everything. That attacks the 100K-per-answer problem. Its support on Haiku 5.5 is confirmed in phase 0; if it's missing, our own loop trims old results the same way. |
| **Task budgets** (beta) | A token ceiling per answer that the model paces itself to, instead of being cut off. |
| **Token counting** | The AI page can show what a prompt will cost before it's sent. |
| **Exact usage per call** | Every answer reports its input, cached, written and output tokens. The log stores them, and cost is worked out from the price table. |
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
| **Message Batches** | Half price for jobs that can wait hours, such as a weekly review, if you ever want one. |
| **Memory tool** | A more structured long-term memory than today's `ai_memory`. |

### Not used, and why

- **Managed Agents:** see "Why we run the loop ourselves" above.
- **Message threads:** the conversation would be kept at Anthropic for a while. Not needed at this size.
- **Fast mode:** only on Opus and Fable, at 2× the price.
- **Admin API / official cost reports:** they need an admin key that can manage your whole Anthropic organization, which is too powerful to keep on a server. Our own log has the exact usage per call, and Anthropic's Console shows the official bill.
- **Data residency** (`inference_geo`): checked in `docs/integrations/anthropic.md`, to see whether an EU option exists for Haiku 5.5.
- **Computer use, bash, text editor, MCP connector:** nothing in this app needs them.

---

## 4. The AI page

A new page, **AI**, in the menu. Its tabs:
1. **Overview**
   - This month's cost, total and per job, against your budgets.
   - Answers, tokens, and how much the cache saved.
   - A chart per day.
2. **Calls**
   - Every call: time, job, model, tokens (input · cached · written · output), cost, duration, the tools it used, and how it ended.
   - Open one to see the request and the answer (if you keep them), the thinking summary, and each tool call with its input and result.
3. **Settings:** everything in §2's settings list.
4. **How it works:**
   - The path of a request, as a diagram: app → function → Claude → tools → your database.
   - The fixed instructions of every job, with their version.
   - Every tool: its name, description, inputs, permission, and what it can read or write.
   - A link to each source file on GitHub.
   - A short glossary.
5. **Prices:** the price table the costs are worked out from, with the date it was checked. You can edit it when Anthropic changes prices.
6. **Test bench**
   - Send any question with a model and effort you pick.
   - See the token count before sending, then the answer, its cost, its time and its thinking summary.

   This is where you learn how it behaves.

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
| The log | Personal data kept forever | Owner-locked, a retention you choose, and never readable by the model. |
| Settings | The model turning on its own tools | The settings tables are not in the model's tool list or catalog. |

A **guardian review** runs on every phase.

---

## 6. Phases — each its own PR, after your go

| # | What | Gemini |
|---|---|---|
| 0 | `docs/integrations/anthropic.md`: how we authenticate, the endpoints, the fields we read and write, prices and limits checked live. | runs as today |
| 1 | **Foundation:**<br>• the `claude` function core: caching, logging, cost, budgets, refusals;<br>• the tables for calls, settings and prices;<br>• the **AI page**: Overview, Calls, Settings, Prices, and a first How it works;<br>• the first job, **✨ fill** on Haiku. | runs everything else |
| 2 | One-shot jobs: recipes, quick guess, PT assessment, Kobo passage, phone brief. Test bench. | chat only |
| 3 | **Ask AI from scratch:**<br>• a new tool set: fewer, sharper, strict, each with your permission;<br>• live context through system messages;<br>• context editing, task budgets, the Confirm flow, photos;<br>• coach chat, phone ask. | none in use |
| 4 | Search without embeddings (Postgres full-text), memory. | — |
| 5 | **Remove Gemini everywhere:**<br>• code, docs, settings rows;<br>• `GEMINI_API_KEY`;<br>• the tables `ai_embeddings` and `ai_reviews`.<br>Dropping a table needs your OK first. | gone |
| 6 | Optional, one at a time and measured: advisor, programmatic tool calling, tool search, web search. | — |

Each phase gets tests, a guardian review, and a look on the phone layout before its PR.

---

## 7. Your steps

1. Create an Anthropic API account at console.anthropic.com, add billing, and **set a monthly spend limit** there.
2. Create an API key and add it in **Supabase → Project Settings → Edge Functions → Secrets** as `ANTHROPIC_API_KEY`. Never paste it in the chat.
3. After phase 5, delete `GEMINI_API_KEY` there too.

---

## 8. Decisions needed before phase 1

1. **Search by meaning:** Postgres full-text search (recommended: no outside service, free), or a separate embedding service (Voyage AI, another provider and key).
2. **Keep the full text** of requests and answers in the log? Recommended: yes, kept 30 days, owner-only. Otherwise only tokens and costs are logged.
3. **Instructions:** fixed rules in code, shown on the AI page, plus your own editable instructions (recommended), or every prompt editable.
4. **Where the AI page lives:** its own page in the menu (recommended), or a tab on Developer.
5. **Budget:** a monthly total to start with, for example $5, stopping when reached.
6. **While rebuilding:** keep Gemini running for the jobs not yet moved (recommended: nothing stops working), or switch Gemini off now and live without those AI features until each phase lands.
