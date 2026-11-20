# AI phase 1 — the function helper's notes

Progress notes for the `claude` edge function. Written 20.11.2026 while the work was in progress, so a new session can pick it up. Nothing here was called live: there is no Anthropic key in the build environment.

## 1. Done and checked

| File | What it is | What proved it |
|---|---|---|
| `supabase/claude-src/types.ts` | The shared shapes: request, answer, failure, job, ledger summary, `Describe` | `deno check` on the built file |
| `supabase/claude-src/prices.ts` | The price table and `costOf` | `deno check`. The numbers were read from Anthropic's pricing page on 20.11.2026 |
| `supabase/claude-src/guard.ts` | Model list, limits, `settingsFor` (clamps), the rate caps, the budget wall, `hideSecrets`, text trimming, the capped body reader | `deno check` |
| `supabase/claude-src/provider-anthropic.ts` | The only part that imports the SDK | `deno check`: the SDK's own types accept every option and field used |
| `supabase/claude-src/ledger.ts` | Reads settings and `ai_gate`, writes `ai_calls` | `deno check` against the real `SupabaseClient` type |
| `supabase/claude-src/job-item-fill.ts` | The ✨ job: new instructions, new JSON Schema, version `2026-11-20.1` | `deno check` |
| `supabase/claude-src/jobs.ts`, `run.ts`, `describe.ts`, `main.ts` | The job list, one run, the self-description, the entry point | `deno check` |
| `scripts/build-claude-function.mjs` | Joins the parts and the item form's rules into `supabase/functions/claude/index.ts` | It ran, and `--check` says "up to date" |
| `supabase/functions/claude/index.ts` | The generated file that deploys | `deno check` exits 0 |
| `supabase/functions/ai-proxy/index.ts` | ✨ removed: the `itemFill` action, its prompt, its `maxOutputTokens` argument and the `<item-fill-shared>` block | `diff` shows it is byte-identical to the file before commit `9bb93381` (the ✨ commit). `deno check` exits 0 |
| `scripts/sync-item-fill-shared.mjs` | Deleted: its picks are now inside the build script | — |
| `package.json`, `package-lock.json` | `@anthropic-ai/sdk` `1.5.0` as an exact dev dependency | Installed; the lead committed it |

"deno check" means: Deno read the code and found no type mistake. It does not run the code.

## 2. Written but not checked yet

- **The run flow has not been run once.** No test has executed `runJob`, the provider against a pretend network, or the entry point.
- `src/features/items/itemFill.ts`: the Gemini-format `ITEM_FILL_SCHEMA` is removed and the header comment updated. ESLint has not been run on it.
- ESLint has not been run on any new file.
- `scripts/verify-item-fill.cjs` still reads `ai-proxy`'s copy, so it fails right now.

## 3. Still to do, in order

1. Write `scripts/verify-claude-function.cjs`. Plan: load the generated file with sucrase through `new Function`, as `verify-secret-errors.cjs` does, with a fake `Deno`, a fake `createClient`, a fixed `Date`, the real SDK from `node_modules` and a fake `fetch`. Checks to write:
   - structure: only the provider part has the SDK import or an Anthropic field name; only `main.ts` has `Deno.`, `createClient(` or `console.`; the build is current; `claude` is not in `supabase/config.toml`;
   - who may call: 204 for OPTIONS, 405, 401, 403, 400 for a body over 16 KB or not a JSON object;
   - `describe`: the contract's values, no key in it, every listed file exists;
   - a normal run: one fetch to `https://api.anthropic.com/v1/messages`, the key only in the `authorization` header, the exact body, the checked fill, the ledger row and its cost;
   - hostile answers, `refusal`, `max_tokens`, 429, 529, 401, 400, a network error, a timeout;
   - forged settings rows are clamped; budget, job off, no key and the rate caps stop before any fetch;
   - cost maths: normal, cached, long prompt, batch, unknown model;
   - the text log: absent when off, trimmed when huge;
   - `hideSecrets`; unknown job names (`__proto__`, `constructor`);
   - the instructions' version is pinned to a hash of the instructions and schema;
   - the ledger row's keys are columns of migration 194.
2. Update `scripts/verify-item-fill.cjs`: read the `<item-fill-shared>` block from `supabase/functions/claude/index.ts`, take the schema from the job, drop the checks on `ai-proxy`'s prompt.
3. Cover the new function in `scripts/verify-secret-errors.cjs` (its loader must also strip the SDK import and hand in the SDK's names; `ai_gate` must answer in its fake database) and check `scripts/verify-supabase-keys.cjs` (it should pass as it is: the function carries the same block and names no legacy key).
4. Docs: `docs/backend/edge-functions.md`, `docs/backend/environment.md`, `.env.example`, `docs/deploy-checklist.md`, `docs/integrations/anthropic.md`, `.claude/rules/ai.md`, `.claude/rules/edge-functions.md`.
5. Run every command in section 6 and fix what fails.
6. Update this file, then report to the lead.

## 4. Decisions, and why

### Different from the contract

- **`Describe.prices.models[].longPromptPricing: boolean` is added.** Anthropic's pricing page (read 20.11.2026) says the higher long-prompt prices apply to Haiku 5.5 only: "Claude 4.6 and later models (except Claude Haiku 5.5) … include the full 1M token context window at standard pricing." The contract's `longPromptOverTokens` and `longPromptMultiplier` stay as they are. The app should show the long-prompt line only for a model whose `longPromptPricing` is true.
- **The rate caps are checked first**, before the job's input check and before the settings are read. A request over a cap answers `busy` and writes no row, also when its input is bad. Reason: `bad_input` rows are written to the ledger, so without this a flood of bad requests could fill it.
- **A request that names no known job** is written with `job: "unknown"` and `model: "none"` (the column's CHECK needs a valid job name).
- **When `ai_gate` cannot be read**, the answer is `{ ok: false, reason: "error", message }` with no `call` and no ledger row. Nothing is sent to the model.
- **`id` and `run_id` are made in the function** (`crypto.randomUUID()`), not by the database default, so the answer's `call` has them even if the ledger write fails.
- **`duration_ms` is the time of the call to the model.** It is 0 for a run stopped before the call.
- **A stop reason other than `end_turn`, `refusal` or `max_tokens`** (`pause_turn`, `tool_use`, `stop_sequence`, `model_context_window_exceeded`) is `reason: "error"`. It is never treated as an answer.

### Inside the contract

- **Settings:** a stored `enabled` or `log_text` that is neither `true` nor `false` counts as off. A missing row means the defaults. Numbers also parse from text ("5.00").
- **The provider client** is created with `baseURL: 'https://api.anthropic.com'`, `timeout: 30_000`, `maxRetries: 1`, `logLevel: 'off'` and `openTelemetry: false`. Reason: without `baseURL` and `logLevel` the SDK reads `ANTHROPIC_BASE_URL` and `ANTHROPIC_LOG` from the environment, and its debug log prints requests.
- **`hideSecrets`** takes the secret values as an argument (the API key and `serviceKey()`), and also hides anything shaped like `sk-ant-…`, `sb_secret_…` or a sign-in token (`eyJ….….…`). It names no legacy Supabase variable, so the rule "only `ai-proxy` names the legacy key" stays true.
- **`ledger.ts` imports the `SupabaseClient` type** (type only) from `npm:@supabase/supabase-js@2.118.0`. A hand-written interface made Deno fail with "Type instantiation is excessively deep". Only `main.ts` calls `createClient`.
- **`main.ts` passes `fetch` to the provider by name**, so a test that swaps `fetch` for the function swaps it for the SDK too.
- **The ✨ prompt:** the sentence goes in a `<sentence>` tag with `&`, `<` and `>` escaped, so it cannot close the tag. Today goes in a `<now>` tag as weekday, date and time. There is no table of coming days: working out "Tuesday" is left to the model.
- **The ✨ schema** has 21 optional fields, `additionalProperties: false`, no `required`, no `format`, no `pattern`, no number or length limits. The lists (`repeat`, `alerts`, …) are built from the item form's own constants.
- **Sonnet 5.5 and Opus 5.5 cache-write prices** are now read from the page: $2.50 / $4 and $5 / $8.

### SDK facts confirmed in `node_modules/@anthropic-ai/sdk` 1.5.0

- `index.d.ts`: `Anthropic` and every error class are named exports.
- `client.d.ts` → `ClientOptions`: `apiKey` ("Sent as `Authorization: Bearer <key>`"), `baseURL`, `timeout` (milliseconds), `maxRetries` (default 2), `fetch`, `logLevel` (`'off' | 'error' | 'warn' | 'info' | 'debug'`), `openTelemetry` (`false` disables the spans).
- `client.js`: the header `'anthropic-version': '2026-10-21'`; a retry on 408, 409, 429 and 5xx unless `x-should-retry` says otherwise; `retry-after-ms` and `retry-after` are obeyed.
- `resources/messages/messages.d.ts`: `MessageCreateParamsBase` has no `temperature`, `top_p` or `top_k`; `OutputConfig { effort, format }`; `JSONOutputFormat { type: 'json_schema', schema }`; `ThinkingConfigAdaptive { type, display }`; `Message { content, model, stop_reason, stop_details, usage }`; `Usage { input_tokens, cache_read_input_tokens, cache_creation_input_tokens, cache_creation { ephemeral_5m_input_tokens, ephemeral_1h_input_tokens }, output_tokens, output_tokens_details { thinking_tokens } }`; `StopReason`; `RefusalStopDetails { category, explanation }`.
- `core/error.d.ts`: `APIError` has `status`, `requestID`, `apiMessage`, `type`, `errorCode`. `APIConnectionTimeoutError` extends `APIConnectionError`. `OverloadedError` (529) extends `InternalServerError`. A 402 has no class of its own: it is an `APIError` with `type: 'billing_error'`.
- `resources/shared.d.ts`: a spend-limit 429 has `errorCode: 'enforced_spend_limit_reached'`.
- `internal/parse.d.ts`: a response carries `_request_id`, read from the `request-id` header.

## 5. Problems found and open questions

- **npm's newest SDK is 1.11.0.** The contract pins 1.5.0, and that is what is installed.
- **A call that times out may still be billed by Anthropic**, and the SDK tries once more. The ledger then shows an error with zero tokens. Streaming would fix this in a later phase.
- **The rate caps and the budget are read, then the row is written.** Requests sent at the same moment can all pass. Anthropic's Console limit is the outer wall.
- **These files mention the removed `sync-item-fill-shared` script or `ai-proxy`'s `itemFill`, and are not mine to change:** `docs/features/ai.md`, `docs/features/planning-calendar.md`, `docs/features/item-screen-plan.md`, `.claude/rules/planning.md`, `scripts/harness/functions.cjs`, `scripts/harness/mock-server.cjs`, `scripts/harness/README.md`.
- **No `src/` import has to change because of the removals:** nothing imports `ITEM_FILL_SCHEMA`.
- **Not confirmed by a live call:** everything about Anthropic's behaviour. See "Not confirmed by a live call yet" in `docs/integrations/anthropic.md`.

## 6. Commands

```
node scripts/build-claude-function.mjs            # rebuild supabase/functions/claude/index.ts
node scripts/build-claude-function.mjs --check    # exit 1 when it is stale
node scripts/verify-claude-function.cjs           # not written yet
node scripts/verify-item-fill.cjs                 # fails until step 2 is done
node scripts/verify-secret-errors.cjs
node scripts/verify-supabase-keys.cjs
node scripts/verify-owner-lock.cjs
npx eslint scripts/build-claude-function.mjs scripts/verify-claude-function.cjs src/features/items/itemFill.ts supabase/claude-src supabase/functions/claude
```

Type-check with Deno (the tool is in the session's scratchpad folder; `deno` on a machine that has it works the same):

```
deno check --node-modules-dir=none --no-lock supabase/functions/claude/index.ts
deno check --node-modules-dir=none --no-lock supabase/functions/ai-proxy/index.ts
```
