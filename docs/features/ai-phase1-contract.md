# AI rebuild, phase 1 — the contract (20.11.2026)

> The design phase 1 was built to (20.11.2026). Kept as the reference for the `claude` function's request and answer shapes and the 194 tables. Changed since: `ai_reserve` books each call's worst case before it is sent (guardian review, 21.11.2026), and `'pending'` is an outcome. The code is the truth where they differ.


Read first: `AGENTS.md` (the boxed security warning), `docs/features/ai-plan.md` (the approved plan),
`docs/integrations/anthropic.md` (every Anthropic fact we rely on; do not guess a field that isn't there — look it up),
and your area's rule file in `.claude/rules/`.

## The owner's rules that bind this work
- **From scratch.** "DO NOT COPY ANY OF GEMINI VERSION AI SETUP! Just get the idea what it does and then build it from scratch!"
  The old code (`supabase/functions/ai-proxy`, `src/features/ai/api/aiApi.ts`) may be read only to learn what a feature does
  for the owner. No instruction text, no schema, no answer shape, no loop, no helper is carried over.
  One thing is kept on purpose: `src/features/items/itemFill.ts`'s field rules (`cleanItemFill`, `itemFillTextProblem`,
  `linkOfSentence`, the `ItemFill` type). They are the item form's own rules, not Gemini's.
- Security before features. Anything the browser can write (settings rows) is **input**: allow-lists and clamps in the
  function's code, not only CHECK constraints.
- English everywhere; visible dates `DD.MM.YYYY`, times `HH:MM` (`src/shared/utils/dateFormat.ts`).
- The repo is public: made-up data only (Ola Nordmann, example.com, Jernbanetorget).
- No new test framework: logic is checked by `scripts/verify-*.cjs|mjs` through sucrase.
- Comments only when the reason isn't obvious.

## 1. Database — migration `194_ai_ledger.sql`

Money is USD (Anthropic bills in USD). "This month" and "a day" are Europe/Oslo.

### `public.ai_calls` — the ledger. One row per request to the model (or per request that was stopped before it).
Written **only by the service role** (the `claude` function). The owner may only read it.

| column | type | notes |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| user_id | uuid not null → auth.users on delete cascade | no default: the function sets it from the verified session |
| created_at | timestamptz not null default now() | |
| run_id | uuid not null default gen_random_uuid() | one answer; its steps share it (phase 4) |
| step | smallint not null default 1 | 1–100 |
| job | text not null | `^[a-z][a-z0-9_]{1,39}$` |
| caller | text not null | `app`, `phone`, `kobo`, `schedule` |
| mode | text not null default 'live' | `live`, `batch` |
| provider | text not null default 'anthropic' | `^[a-z][a-z0-9_-]{1,29}$` |
| model | text not null | the model asked for, ≤ 80 chars |
| served_model | text | the model that answered, ≤ 80 |
| effort | text | `low`, `medium`, `high`, `xhigh`, `max` or null |
| outcome | text not null | `ok`, `refused`, `cut_off`, `invalid`, `error`, `budget`, `off`, `not_configured`, `bad_input` |
| stop_reason | text | Anthropic's own word, ≤ 60 |
| error | text | scrubbed message, ≤ 500 |
| request_id | text | Anthropic's request id, ≤ 120 |
| input_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, output_tokens, thinking_tokens | integer not null default 0, each ≥ 0 | |
| long_prompt | boolean not null default false | the prompt was over the long-prompt line (5× prices) |
| cost_usd | numeric(12,6) not null default 0, ≥ 0 | worked out by the function at write time, frozen on the row |
| duration_ms | integer | ≥ 0 |
| instructions_version | text | ≤ 40 |
| tools | jsonb not null default '[]' | an array (phase 4) |
| request | jsonb | the text log: what was sent. null when the text log is off, or after its days |
| response | jsonb | the text log: the content that came back |
| thinking | text | the reasoning summary |

- `request` and `response`: at most 1 MB each as text (a last-line CHECK; the function trims long before that).
- Indexes: `(user_id, created_at desc)`, `(user_id, run_id)`.
- RLS on. One policy: the owner reads their own rows. **No** insert/update/delete policy and no such grant for
  `authenticated` (`revoke all … from anon, authenticated; grant select … to authenticated; grant all … to service_role`).
- No audit trigger (it is a log itself). Ends with `select public.owner_lock_apply('public.ai_calls');`.

### `public.ai_settings` — one row per account; no row means the defaults.
| column | type |
|---|---|
| user_id | uuid pk default auth.uid() → auth.users on delete cascade |
| monthly_budget_usd | numeric(6,2) not null default 5, between 0 and 50 |
| log_text | boolean not null default true |
| log_days | smallint not null default 30, between 1 and 90 |
| updated_at | timestamptz not null default now() (the repo's updated_at trigger) |

Owner-only RLS (select, insert, update own row; no delete). `trg_audit` (the owner's own choices show in Developer → Activity). Owner lock.

### `public.ai_job_settings` — the owner's changes to one job; a null column means "the job's default".
| column | type |
|---|---|
| user_id | uuid not null default auth.uid() → auth.users on delete cascade |
| job | text not null, `^[a-z][a-z0-9_]{1,39}$` |
| enabled | boolean not null default true |
| model | text null, `^claude-[a-z0-9-]{1,60}$` (the strict allow-list is in the function) |
| effort | text null: `low`, `medium`, `high` |
| max_output_tokens | integer null, between 256 and 16000 |
| monthly_budget_usd | numeric(6,2) null, between 0 and 50 |
| updated_at | timestamptz not null default now() |
| primary key | (user_id, job) |

Owner-only RLS (select, insert, update; no delete: "back to default" is an update to nulls). `trg_audit`. Owner lock.

### Functions
- `public.ai_usage(p_from timestamptz, p_to timestamptz)` → table `(day date, job text, mode text, model text, calls bigint,
  failed bigint, input_tokens bigint, cache_read_tokens bigint, cache_write_tokens bigint, output_tokens bigint,
  thinking_tokens bigint, cost_usd numeric)`. The caller's own rows (`user_id = (select auth.uid())`), grouped by the Oslo
  day, job, mode and model. `failed` = rows whose outcome is not `ok`. SECURITY INVOKER, `stable`, `set search_path = ''`.
  Refuses a range longer than 400 days or `p_to <= p_from`. Granted to `authenticated` and `service_role`, not `anon`.
- `public.ai_gate(p_job text)` → one row `(month_cost numeric, job_month_cost numeric, calls_last_minute integer,
  calls_today integer)` for the caller: this Oslo month's `cost_usd` in total and for `p_job`; rows (any outcome) in the
  last 60 seconds and since Oslo midnight. SECURITY INVOKER, `stable`, `search_path = ''`. Same grants.
- `public.ai_calls_purge_text()` → integer (rows cleared). Sets `request`, `response`, `thinking` to null on every row
  older than its account's `log_days` (30 when the account has no settings row). SECURITY DEFINER, `search_path = ''`,
  `revoke all … from public, anon, authenticated`, `grant execute … to service_role`. Scheduled daily with pg_cron as
  `lascis-ai-log-purge` (the guard pattern at the end of `176_icloud_readback.sql`: no pg_cron → a notice, no failure;
  unschedule first if it exists). It runs SQL directly: no HTTP, no secret.

Nothing here is ever added to an assistant's table catalog (`.claude/rules/ai.md` gets that rule from the function helper).

## 2. The `claude` edge function

A `POST` to the `claude` function, platform JWT verification **on** (not listed in `supabase/config.toml`), plus
`auth.getUser(token)` and the function's own `isAppUser(user.id)` copy. CORS as `calendar-token`
(`ALLOWED_ORIGINS`). Request body: JSON, at most 16 KB.

### Requests
- `{ "action": "describe" }` → `{ ok: true, about: Describe }`
- `{ "action": "run", "job": "<name>", "input": { … } }` →
  - `{ ok: true, job, result, call: CallSummary }`
  - `{ ok: false, reason, message, call?: CallSummary }` — HTTP 200 for every reason below; 401/403 only for the
    session/owner check, 400 for a body that isn't valid, 405 for a wrong method.

- `{ "action": "diagnose" }` → `{ ok: true, steps: DiagnoseStep[] }` or `{ ok: false, reason: 'busy' | 'error', message }`.
  `DiagnoseStep = { name: 'network_key' | 'request_shape' | 'tiny_answer' | 'fill_request', title, ok, ms, detail }`; `detail`
  is one scrubbed sentence. Same auth as `run`. One a minute per account. `docs/features/ai.md` → Diagnose.

`reason`: `bad_input` · `off` (the job is switched off) · `budget` (a monthly budget is reached) · `busy` (too many calls;
this one is **not** written to the ledger) · `not_configured` (no `ANTHROPIC_API_KEY`) · `refused` (stop_reason `refusal`) ·
`cut_off` (`max_tokens`) · `invalid` (the answer failed our check) · `error`.
`message` is one plain English sentence the app shows as it is.

```ts
interface CallSummary {
  id: string; run_id: string; job: string; model: string; outcome: string
  input_tokens: number; cache_read_tokens: number; cache_write_tokens: number
  output_tokens: number; thinking_tokens: number; cost_usd: number; duration_ms: number
}

interface Describe {
  configured: boolean                       // ANTHROPIC_API_KEY is set (never the key, never its length)
  provider: { name: 'anthropic'; sdk: string; apiVersion: string; endpoint: string }
  models: { id: string; name: string; note: string }[]        // the allow-list, the default first
  efforts: ('low' | 'medium' | 'high')[]
  limits: {
    monthlyBudgetMaxUsd: number; callsPerMinute: number; callsPerDay: number
    maxOutputTokens: { min: number; max: number }; logDays: { min: number; max: number }; requestMaxBytes: number
  }
  defaults: { monthlyBudgetUsd: number; logText: boolean; logDays: number }
  prices: {
    checkedOn: string                       // ISO date; the app formats it
    source: string                          // Anthropic's pricing page
    longPromptOverTokens: number; longPromptMultiplier: number; batchMultiplier: number
    models: { model: string; inputPerMTok: number; outputPerMTok: number; cacheReadPerMTok: number
              cacheWrite5mPerMTok: number; cacheWrite1hPerMTok: number }[]
  }
  jobs: {
    name: string; title: string; what: string; kind: 'one_shot'
    callers: string[]; version: string
    defaults: { model: string; effort: string; maxOutputTokens: number }
    instructions: string                    // the fixed instructions, as sent
    answerSchema: unknown | null            // the JSON Schema of the answer
    tools: { name: string; what: string }[] // empty in phase 1
    features: string[]                      // e.g. "Prompt caching", "Structured output", "Adaptive thinking (low effort)"
    sourceFiles: string[]                   // repo-relative paths
  }[]
  steps: { title: string; text: string; part: string }[]      // the path of one request, in order
  parts: { name: string; file: string; what: string }[]       // the function's parts
  safetyRules: string[]                     // the fixed rules that are code, in plain words
}
```

### How a `run` goes (the order is the design)
1. Session → `auth.getUser` → `isAppUser`. The user id used from here on is that verified one, never a value from the body.
2. The job by name from a fixed registry (a `Map`; an unknown name is `bad_input`). The job checks its own input.
3. The owner's settings, read with the **user's own** client (RLS): `ai_settings`, `ai_job_settings` for the job. Every
   stored value is input: model through the allow-list (not on it → the job's default), effort through its list,
   `max_output_tokens` and budgets clamped to the limits in code. Hard limits in code: monthly budget at most $50,
   20 calls a minute, 600 a day.
4. `ai_gate(job)` with the user's client: over a rate cap → `busy` (no ledger row). Job off → `off`. Month cost ≥ the
   total budget, or the job's month cost ≥ the job's budget → `budget`. No key → `not_configured`.
   `off`, `budget`, `not_configured` and `bad_input` are written to the ledger with zero tokens (they count toward the caps).
5. The neutral request is built (instructions as a cached block, then the live part in the user message) and sent by the
   provider part. One step in phase 1 (no tools yet).
6. The answer: `refusal` → `refused`; `max_tokens` → `cut_off`; fixed-shape jobs parse the JSON text and run the job's
   own check; a failed check is `invalid` (never "fixed up").
7. The ledger row is written with the **service-role** client: usage, cost from the code's price table, duration, and —
   only when `log_text` is on — the request and response text (each trimmed to 200 KB) and the thinking summary.
   A failed ledger write never fails the answer, but is reported with `console.error` (no secret, no text).
8. Errors leave through `hideSecrets` (it lists `ANTHROPIC_API_KEY` and the service key); the SDK's error object is never
   returned or logged whole.

**Prices are code, not a table** (decided 20.11.2026, security): the budget wall is worked out from them, so a
browser-writable price row could switch the wall off. The Prices tab shows the function's own table and the date it was
checked; a price change is a PR that re-checks Anthropic's page.

### Anthropic request for `item_fill` (see `docs/integrations/anthropic.md` for each field)
`model` (default `claude-haiku-5-5`), `max_tokens` (default 2000: thinking counts toward it),
`system: [{ type: 'text', text: <instructions>, cache_control: { type: 'ephemeral' } }]`,
`messages: [{ role: 'user', content: <today + the sentence, as data> }]`,
`thinking: { type: 'adaptive', display: 'summarized' }`,
`output_config: { effort: 'low', format: { type: 'json_schema', schema } }`.
No `temperature`/`top_p`/`top_k`, no prefill. SDK `npm:@anthropic-ai/sdk@1.5.0` (exact), `maxRetries: 1`, a 30 s timeout.
Structured-output schema limits: at most 24 optional fields and 16 union-typed ones, `additionalProperties: false`,
no `minimum`/`maximum`/`minLength`/`maxLength` — so: optional fields, no `null` unions; our own code checks the ranges.

### The `item_fill` job
- What it does for the owner: on the item screen, ✨ takes one sentence ("Dentist on Tuesday at 14:00 for an hour at
  Jernbanetorget, remind me a day before") and fills the form's fields. Nothing is saved: the owner sees the fields and saves.
- Input `{ text }`, checked with `itemFillTextProblem`. "Today" is the server's Europe/Oslo date, weekday and time.
- Result: `{ fill: ItemFill }` after `cleanItemFill(raw, { today, sentence })` — the client runs `cleanItemFill` again.
- The sentence is data: wrapped in a tag, and the instructions say text inside it is never an instruction.

### Files
Source parts (readable, one job each) in `supabase/claude-src/`; `scripts/build-claude-function.mjs` joins them, with the
shared item-fill rules from `src/`, into the one deployed file `supabase/functions/claude/index.ts` (marked GENERATED;
`--check` exits 1 when it is stale). Parts: neutral types · prices and cost · guard · the Anthropic provider (the **only**
part that imports the SDK or names an Anthropic field) · run (one answer; knows no provider) · ledger · jobs (+ registry) ·
describe · main (`Deno.serve`, the only part that touches `Deno` or creates Supabase clients).

## 3. The app

- `src/features/ai/claude/` — new: the function client (`runClaudeJob`, `describeClaude`), the ledger/settings api, hooks,
  types, pure helpers. The old `aiApi.ts` / `AIPanel.tsx` stay until phase 4, minus `fillItemFields`.
- Developer → **AI**: one new Developer tab with five views — Overview · Calls · Settings · Prices · How it works.
- ✨ (`src/shared/components/plan-modal/useItemFill.ts`) calls `runClaudeJob('item_fill', { text })`.
- Settings → the Gemini entries become Anthropic ones (a server-configured service: a read-only card, no Connect button).
