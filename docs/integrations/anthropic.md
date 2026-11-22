# Anthropic (Claude API)

Checked: 20.11.2026 against Anthropic's own documentation at `platform.claude.com/docs`, read that day. The pages: pricing, batch processing, rate limits, prompt caching, context editing, create a message, task budgets, mid-conversation system messages, token counting, effort, vision, structured outputs, models overview, and API and data retention. Request shapes were also checked against the TypeScript SDK's reference. **No live call has been made yet:** the owner adds the key first. Phase 1 (20.11.2026) built the `claude` function and its one job; "What phase 1 sends and reads" below says exactly which of the fields in this file it uses. The section "Not confirmed by a live call yet" lists what the first real call must confirm.

Claude is the model behind every AI feature of the app (the plan: `docs/features/ai-plan.md`). One edge function, `claude`, talks to it. The default model is **Claude Haiku 5.5** (`claude-haiku-5-5`): Anthropic's fastest and cheapest current model, with a 1M-token context window, up to 128K tokens of output, text and image input, and a knowledge cutoff of June 2026.

Words used here, once:
- **Token:** a piece of text, about ¾ of a word. Prices are per million tokens (MTok).
- **Prompt:** everything sent in one request: tools, instructions, conversation, data.
- **Cache:** the repeated start of a prompt, stored at Anthropic for a few minutes and billed at a tenth when it repeats.
- **Thinking:** the model's reasoning before it answers. It is billed as output.
- **Effort:** how much the model reasons and writes: `low`, `medium`, `high`, `xhigh`, `max`.
- **Beta:** a feature Anthropic may still change. It is switched on with an `anthropic-beta` header.

## How we authenticate

- **An API key** from the owner's own Anthropic account (console.anthropic.com → API keys). It is stored only as the Supabase secret `ANTHROPIC_API_KEY` (`docs/backend/environment.md`). Only the `claude` edge function reads it (`Deno.env.get`). The browser, the phone and the Kobo never see it.
- **Sent in a header, never in a URL.** We call through Anthropic's official TypeScript SDK, pinned to an exact version: `npm:@anthropic-ai/sdk@1.5.0` (released 04.11.2026). From 1.0.0 the SDK sends the key as `Authorization: Bearer <key>` and the API version header `anthropic-version: 2026-10-21`.
- **Errors never carry the key:** the function scrubs every outgoing error with `hideSecrets`, and `ANTHROPIC_API_KEY` is on its list (`verify-secret-errors`).
- **Who may call `claude`:**
  - the app: the platform's JWT check, then `auth.getUser` and the function's own `isAppUser` (the owner lock);
  - the phone gateway and the Kobo: their own secrets, compared in constant time (`sameSecret`), each with a daily cap.
- **The outer wall is in Anthropic's Console:** the owner sets a monthly spend limit there. Our own budget (in the app) stops earlier; the Console limit stops everything if our code is wrong.
- **Rate-limit tier:** a new account may start in an **Evaluation** tier with much lower limits (check Console → Limits); once the account is on the **Start** tier, for Haiku 5.5 that allows 4,000 requests a minute, 2,000,000 input tokens a minute and 400,000 output tokens a minute, with a $500 monthly cap. That is far more than one person uses.

## Models and prices

Per million tokens, in USD, from Anthropic's pricing page on 20.11.2026. The function keeps these in code (`supabase/claude-src/prices.ts`, with the date they were checked), not in a table the browser can write: the budget wall is worked out from them, so an editable price could switch the wall off. A price change is a pull request that re-reads the page. Cache-write prices for Sonnet 5.5 ($2.50 and $4) and Opus 5.5 ($5 and $8) were read from the page on 20.11.2026 too.

| Model | Input | Output | Cache read | Cache write, 5 min | Cache write, 1 h |
|---|---|---|---|---|---|
| **Claude Haiku 5.5**, prompt up to 100,000 tokens | $0.10 | $0.50 | $0.01 | $0.125 | $0.20 |
| **Claude Haiku 5.5**, prompt over 100,000 tokens | $0.50 | $2.50 | $0.05 | $0.625 | $1.00 |
| Claude Sonnet 5.5 (a stronger option) | $2.00 | $10.00 | $0.10 | $2.50 | $4.00 |
| Claude Opus 5.5 (the strongest option here) | $4.00 | $20.00 | $0.20 | $5.00 | $8.00 |

Anthropic's general rule is 1.25× the input price for a 5-minute write and 2× for a 1-hour write.

- **The 100,000-token line counts every input token of the request,** cache reads and cache writes included. Above it, the whole request costs 5×. Per the pricing page, only Haiku 5.5 has this higher price list; Sonnet 5.5 and Opus 5.5 include the full 1M window at the normal price. Our function prices it that way (`costOf`) and keeps every request under it (see Traps).
- **Batch API: half price.** Haiku 5.5 in a batch costs $0.05 input and $0.25 output (up to 100,000 tokens). The discount stacks with caching.
- **Thinking is billed as output.** `usage.output_tokens` is the total that is billed; `usage.output_tokens_details.thinking_tokens` says how much of it was thinking.
- **Where the request runs** (`inference_geo`): `"global"` is the default at the normal price; `"us"` costs 1.1×. **There is no EU option.**
- **Token counting** (`count_tokens`) is free.
- **Web search,** if we ever switch it on, costs $10 per 1,000 searches plus tokens. Web fetch costs tokens only.

## Endpoints we call

Base `https://api.anthropic.com`. All through the SDK.

| Endpoint | SDK call | Called by | When | Limits |
|---|---|---|---|---|
| `POST /v1/messages` | `client.messages.create` (`client.beta.messages.create` when a beta feature is on) | `claude` → every real-time job | each AI answer; a chat answer is several calls (one per tool round) | Start tier: 4,000 requests, 2M input tokens and 400K output tokens a minute. Cache reads don't count toward the input limit. |
| `POST /v1/messages/count_tokens` | `client.messages.countTokens` | `claude` → Diagnose step 2 (22.11.2026) and the Test bench's "Count tokens" (`{ action: 'count' }`, 22.11.2026: the request exactly as a run would send it, `thinking` and the picked model and effort included) | on those buttons | free; 5,000 requests a minute; the count is an estimate |
| `GET /v1/models` | `client.models.list({ limit: 1000 })` | `claude` → Diagnose step 1 | on the Diagnose button, once | free; one page, newest first |
| `POST /v1/messages/batches` | `client.messages.batches.create` | `claude` → batch jobs (weekly reports), from the batch phase | when a report is queued | 100,000 requests or 256 MB per batch; 1,000 batch requests a minute |
| `GET /v1/messages/batches/{id}` | `client.messages.batches.retrieve` | `claude` → the batch check (a scheduled job) | until `processing_status` is `ended` | most batches end within 1 hour; one that isn't done after 24 hours expires |
| `GET /v1/messages/batches/{id}/results` | `client.messages.batches.results` | the same | once ended | results stay 29 days; lines come in any order: match by `custom_id` |
| `POST /v1/messages/batches/{id}/cancel` | `client.messages.batches.cancel` | the AI page's Cancel | on the owner's tap | — |

## Fields we read and write

### What we send (`POST /v1/messages`)

| Field | Shape (Anthropic's docs, 20.11.2026) | What we put in it |
|---|---|---|
| `model` | text | the job's model, from the owner's settings: `claude-haiku-5-5` by default, `claude-sonnet-5-5` or `claude-opus-5-5` as options. Never a date suffix. |
| `max_tokens` | number | the job's longest answer. It is the hard ceiling: thinking counts toward it. |
| `system` | a list of text blocks; a block may carry `cache_control: { type: "ephemeral" }` | the job's fixed instructions, byte-identical on every call, with one cache mark on the last block. Never a date or any changing value. |
| `tools` | a list of `{ name, description, input_schema, strict: true }` | the job's tools, always in the same order, each with `additionalProperties: false` and `required`. At most 20 strict tools per request. |
| `messages` | a list of `{ role, content }`; `role` is `user`, `assistant`, or `system` | the conversation. Live context (today's date, the time, the owner's data and own instructions) goes in a `{ role: "system" }` message placed after a user message, so it never breaks the cache. |
| `messages[].content` blocks | `text`; `image` with `source: { type: "base64", media_type, data }`; `tool_use`; `tool_result` with `tool_use_id`, `content`, `is_error`; `thinking` (sent back unchanged) | photos from the chat as base64 (JPEG, PNG, GIF, WebP; up to 10 MB and 8000×8000 px each). Tool results as text. All results of one round go back in a single user message. |
| `thinking` | `{ type: "adaptive", display: "summarized" }` | always this. `display: "summarized"` returns a readable summary of the reasoning for the log; without it the text comes back empty. |
| `output_config.effort` | `"low"` … `"max"`; Haiku 5.5's default is `medium` | the job's effort from the settings: `low` for form fills, `medium` for chat. |
| `output_config.format` | `{ type: "json_schema", schema: { … } }` | **No job enforces a shape now** (phase 2a, 22.11.2026: every job writes its shape into its instructions and our check holds the answer; trap 16). The code keeps the field for a later job with a very small shape. The JSON comes back in a `text` block. |
| `output_config.task_budget` | `{ type: "tokens", total }`, at least 20,000; beta `task-budgets-2026-03-13` | chat jobs: a ceiling the model paces itself to. It is advice to the model: the API does not stop at it. |
| `context_management.edits` | `[{ type: "clear_tool_uses_20250919", trigger, keep, … }]`; beta `context-management-2025-06-27` | chat jobs: old tool results are cleared at Anthropic's side before the model reads the request, so a long answer doesn't resend everything. |

### What we read back

| Field | Shape | Where it goes |
|---|---|---|
| `id` | text (`msg_…`) | the call log (`ai_calls.provider_message_id`) |
| `model` | text | the log: the model that really answered |
| `content[]` | blocks: `text` · `thinking` (`thinking`, `signature`) · `tool_use` (`id`, `name`, `input`) | `text` → the answer, or the JSON for fixed-shape jobs (parsed, then every field checked by our own code). `thinking` → its summary to the log; the whole block is sent back unchanged in the next round. `tool_use` → the tool loop. |
| `stop_reason` | `end_turn` · `max_tokens` · `stop_sequence` · `tool_use` · `pause_turn` · `refusal` · `model_context_window_exceeded` | the loop's next step, and the log. Read before `content`. |
| `stop_details` | only on `refusal`: `{ type, category, explanation }` | the log, and a plain message to the owner |
| `usage.input_tokens` | number: the tokens after the last cache mark | the log and the cost |
| `usage.cache_read_input_tokens` | number | the log and the cost (cache read price) |
| `usage.cache_creation_input_tokens`, `usage.cache_creation.ephemeral_5m_input_tokens` / `.ephemeral_1h_input_tokens` | numbers | the log and the cost (cache write price) |
| `usage.output_tokens` | number: the billed total, thinking included | the log and the cost |
| `usage.output_tokens_details.thinking_tokens` | number, at most `output_tokens` | the log: how much of the output was thinking |
| `usage.service_tier` | `standard` · `priority` · `batch` | the log: a batch call is priced at half |
| `context_management.applied_edits[]` | `{ type, cleared_tool_uses, cleared_input_tokens }` | the log: what was cleared |
| response headers `anthropic-ratelimit-*`, `retry-after`, `request-id` | text | `request-id` to the log (it is what Anthropic's support asks for); `retry-after` decides the wait after a 429 |
| errors | HTTP status + `{ type: "error", error: { type, message } }`: 400 `invalid_request_error` · 401 `authentication_error` · 402 `billing_error` · 403 `permission_error` · 404 `not_found_error` · 413 `request_too_large` · 429 `rate_limit_error` · 500 `api_error` · 529 `overloaded_error` | the SDK's typed errors. Phase 1 does not retry any of them (`maxRetries: 0`): each ends the call with a plain message. Every outcome is logged. |

### Batches

| Field | Shape | Where it goes |
|---|---|---|
| request item | `{ custom_id, params }`; `custom_id` matches `^[a-zA-Z0-9_-]{1,64}$`; `params` is a normal Messages request | `custom_id` is our own batch item id (a uuid without anything personal in it) |
| batch `id`, `processing_status` | `in_progress` · `canceling` · `ended` | `ai_batches` |
| result line | `{ custom_id, result: { type, message } }`; `type` is `succeeded` · `errored` · `canceled` · `expired` | each line becomes a row in the call log, priced at the batch rate |

## Fields we deliberately don't use

| Field or feature | Why not |
|---|---|
| `temperature`, `top_p`, `top_k` | On API version `2026-10-21` any value returns a 400. Behaviour is steered by the instructions and by effort. |
| `fallbacks` (Anthropic retries a declined request on another model) | Not available for Haiku 5.5: a list of models returns a 400. A decline is shown plainly; our own function may retry once on Sonnet 5.5 if the owner turns that on. |
| `tool_choice: any` / a named tool | Fixed-shape answers use `output_config.format` instead. |
| assistant prefill (ending `messages` with a half-written answer) | Returns a 400 on Haiku 5.5. |
| `metadata.user_id` | It would send an identifier of the owner for no benefit here. |
| `inference_geo` | No EU option exists; `"us"` only adds 10%. Left at the default. |
| `speed: "fast"` | Only on Opus and Fable models, at a higher price. |
| `thread` (message threads) | It keeps the conversation at Anthropic. We send the conversation ourselves. |
| Managed Agents | Anthropic would run the loop and keep the session history. We run the loop, so every step is in the owner's own log (`docs/features/ai-plan.md`). |
| Files API, code execution, programmatic tool calling, web search, web fetch, advisor, citations, tool search, memory tool | Not in the first build. Each is a later, separate step, added only after it is measured on the owner's questions. Note: code execution and programmatic tool calling keep data at Anthropic for up to 30 days. |
| Admin API and the Usage and Cost API | They need an admin key that can manage the whole Anthropic organization: too powerful to keep on a server. Our own log has each call's exact usage; the Console shows the official bill. |

## What Anthropic keeps (privacy)

From Anthropic's "API and data retention" page, 20.11.2026:
- **Prompts and answers of normal requests are not kept by default.** (The exception is a group of "Covered Models", Fable and Mythos, which need 30-day retention. Haiku 5.5, Sonnet 5.5 and Opus 5.5 are not in it.)
- Content their safety systems flag may be kept for up to 2 years.
- **Batch requests are kept 29 days,** because the results must stay downloadable.
- Kept data is "never used for model training without your express permission".

What we send: the job's instructions, the conversation, and the data its tools return, which can include tasks, notes, health numbers and photos. Nothing is sent to any other AI provider.

## Traps

1. **The 100,000-token line is per request and counts cached tokens.** One token over it and the whole request costs 5×. The function estimates each request's size before sending. Above a safe margin it trims old tool results, or stops with a plain message. It never sends a request over the line silently.
2. **Thinking is on by default and billed as output.** It also counts toward `max_tokens`: a `max_tokens` set too low cuts the answer off mid-thought (`stop_reason: "max_tokens"`).
3. **The thinking text is empty unless asked for.** `display: "summarized"` returns a summary. A `thinking` block with empty text is still a real block: it must be sent back.
4. **History is append-only.** A `thinking` block stays valid only while everything before it is unchanged. Sending one back after changing `system`, `tools` or an earlier message returns a 400. So: instructions and tools are frozen for a conversation; new instructions go in as `{ role: "system" }` messages; old tool results are cleared with context editing (Anthropic's own, allowed way), never by rewriting history ourselves.
5. **A system message in `messages` has placement rules.** It cannot be first. It must come right after a user message, and then either be last or be followed by an assistant message. It cannot sit between a `tool_use` and its `tool_result` (400).
6. **Any byte change at the front breaks the cache.** The order is tools → system → messages. A date in the instructions, tools in a different order, or a changed `output_config.format` each throw the cache away. The cache also needs at least 512 tokens and lives 5 minutes (renewed on each read). Writing it costs 1.25×, so a prompt used once is slightly dearer with caching than without.
7. **Changing `effort` between requests of one conversation can also break the cache.** Each job has one effort.
8. **A decline is not an error.** `stop_reason: "refusal"` comes with HTTP 200 and is billed. With a fixed answer shape, the output "might not match your schema". Always read `stop_reason` first.
9. **A fixed answer shape has limits.** Every object needs `additionalProperties: false`. At most 24 optional fields and 16 fields with a union type (`["string", "null"]`). No `minimum`, `maximum`, `minLength` or `maxLength`, and only part of `pattern`. So the schema guarantees the shape; **our own code still checks every value** (ranges, lengths, allow-lists, links). The first use of a new schema is slower once (it is compiled, then cached 24 hours).
10. **A task budget is advice, not a wall.** "The API does not stop Claude at the budget." The walls are `max_tokens` per call, and our own limits per answer: a maximum number of tool rounds and the job's dollar budget.
11. **A batch's results come in any order,** and a batch can end with some lines `errored` or `expired`. Each line is handled on its own, matched by `custom_id`.
12. **Token counts are not comparable across providers.** The same text is more tokens for Claude than the numbers in the old Gemini log, so a cost estimate made from that log is rough. `count_tokens` itself is "an estimate".
13. **The spend limit has two faces.** A 429 can be too many requests (retry after `retry-after`) or a spend cap (`error_code` `enforced_spend_limit_reached`: don't retry, tell the owner). And a limit the owner set in the Console answers **HTTP 400** with error type `invalid_request_error` and a message that starts `You have reached your specified API usage limits` (rate-limits page, read 22.11.2026). `provider-anthropic.ts` tells that 400 apart by its message and files it as billing with the sentence "Your monthly spend limit in Anthropic's Console is reached…", not as a refused request; any other 400 stays a refused request.
14. **The SDK retries by itself** (2 times by default, on 429, 5xx and connection errors) and its default timeout is 10 minutes. The function sets `maxRetries: 0` and a 30-second timeout: a retry after a timeout could be a second bill that nobody reserved (the first request may still be generated and billed), so one request is one generation and one reservation. A failed call is shown with its plain message and the owner tries again.
15. **Images:** at most 8000×8000 px and 10 MB each, no animations. Tokens are about `⌈width/28⌉ × ⌈height/28⌉`, so a large photo costs up to a few thousand tokens. The app already shrinks photos before upload.
16. **An enforced answer shape can look like a hang (seen live, 22.11.2026).** ✨'s shape (21 optional fields) sent as `output_config.format` got no answer within 90 s, twice, while the same request without it answered in about a second. The cause is in the structured-outputs page: every optional parameter roughly doubles the grammar's states, so 21 optional fields make a very large grammar; compiling it "may take up to 180 seconds", and compiled grammars are cached for 24 hours from last use. `count_tokens` does **not** compile the grammar (it accepted the same request in 0.2 s), so Diagnose's step 2 cannot catch this. So no job enforces a shape for now: each writes its JSON Schema into its instructions (`enforceAnswerSchema: false`) and our own check (`cleanItemFill`, `cleanRecipe`, …) holds every field. A job that enforces a shape later must have **all fields required** (no optional ones; "not given" is an empty value) and be tried with Diagnose's real call, never with the token count.

## What Diagnose sends and reads (22.11.2026)

Added to find out why ✨ timed out live (`docs/features/ai.md` → Diagnose). Both calls go through the same SDK client, with the same key in the same header, `maxRetries: 0` and no logging; each takes its own time limit (20 s). The SDK's types were read from `@anthropic-ai/sdk@1.5.0` (`resources/models.d.ts`, `resources/messages/messages.d.ts`). **Not yet confirmed by a live call** (that is the point of the button).

- **`GET /v1/models`** (`client.models.list({ limit: 1000 })`). Sent: only `limit`. Read: `data[].id` (text, kept up to 1000 ids) to see whether `claude-haiku-5-5` is listed, and the length of the list. Not read: `display_name`, `created_at`, `capabilities`, `max_input_tokens`, `max_tokens`, `has_more`, the cursors. Only the first page is read: Anthropic lists few models, and a page of 1000 is the most it gives.
- **`POST /v1/messages/count_tokens`** (`client.messages.countTokens`). Sent: the body ✨ sends to `/v1/messages` without `max_tokens`: `model`, `system` (the cached instructions block), `messages`, `thinking`, `output_config` (`effort` and the `json_schema` format). Read: `input_tokens` (clamped to a whole number). A 400 means Anthropic refuses the request as built. `count_tokens` does not compile the grammar of `output_config.format` (confirmed live 22.11.2026: 0.2 s for a shape that then hung), so a pass here proves the request is accepted, not that a schema is compiled or cached; only a real call shows that.
- **A per-request time limit** goes to the SDK as `{ timeout }` in the request options (`RequestOptions.timeout`, in ms) on `messages.create`, `models.list` and `messages.countTokens`: 20 s for the free calls and the tiny answer, 90 s for ✨'s request during Diagnose; every other call gets 30 s up to a 2000-token answer limit, then 10 s more per further 1000, at most 100 s (`requestTimeoutMs`).
- The tiny answer and ✨'s Diagnose request are ordinary `POST /v1/messages` calls (sections below), so they are billed and logged like any call.

## What phase 1 sends and reads

Phase 1 is the `claude` function (`supabase/claude-src/`, joined into `supabase/functions/claude/index.ts`) and its one job, `item_fill` (the ✨ on the item screen). Only `provider-anthropic.ts` imports the SDK. This is what it really does, and the first live call has to confirm it.

**Sent** to `POST https://api.anthropic.com/v1/messages` (non-streaming, `client.messages.create`), through `npm:@anthropic-ai/sdk@1.5.0` with `baseURL` set outright (so the SDK reads no address from the environment), `timeout` 30 s by default (more for a job with a longer answer limit), `maxRetries` 0, `logLevel: 'off'` and `openTelemetry: false` (the SDK's debug log and tracing could print or send the owner's text):
- `model`: `claude-haiku-5-5`, or Sonnet 5.5 / Opus 5.5 when the owner's setting for the job names one (anything else is ignored);
- `max_tokens`: 2000 by default, 256–16000 from the settings;
- `system`: one text block, the job's fixed instructions, with `cache_control: { type: "ephemeral" }`: the same bytes every call, no date, no name;
- `messages`: one user message: `<now>` (weekday, date, time, zone, from the server's Oslo clock) and `<sentence>` (the owner's sentence with `&`, `<`, `>` written out, so it cannot close its tag);
- `thinking: { type: "adaptive", display: "summarized" }`;
- `output_config: { effort: "low" | "medium" | "high" }` and **no `format`** (since 22.11.2026, trap 16). The shape (21 optional fields, `additionalProperties: false`, no number or length limits, no link field) is written into the instructions instead.
- The key goes only in `Authorization: Bearer`; the SDK adds `anthropic-version: 2026-10-21`.
- Not sent: tools, `temperature`, `top_p`, `top_k`, prefill, streaming, betas, `context_management`, `task_budget`, images, `metadata`, `inference_geo`.

**Read back:** `content[]` (`text` joined; `thinking` kept as a summary for the owner's log; other blocks ignored), `stop_reason` (`end_turn` is the only good ending; `refusal` and `max_tokens` have their own outcomes; every other value is an error, never an answer), `stop_details` (a refusal's explanation, for the log), `usage` (`input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `cache_creation.ephemeral_5m_input_tokens` / `.ephemeral_1h_input_tokens`, `output_tokens`, `output_tokens_details.thinking_tokens`; each count is clamped to a whole number the ledger can hold), `model` (the model that answered), and the `request-id` header (via the SDK's `_request_id`). Errors are read by the SDK's typed classes and only single named fields (`status`, `requestID`, `apiMessage`, `type`, `errorCode`): a 401 or 403 is a key problem, a 402 or a 429 with `error.details.error_code` `enforced_spend_limit_reached` is billing, 429 is rate limit, 529 overloaded, 500 a provider fault, 400/404/413/422 a refused request, and a connection error or timeout is its own kind. The message the owner sees is our own fixed sentence; the provider's explanation goes only into the owner's call log, and only while the text log is on.

**Cost is reserved before each call.** The budget wall cannot count a call that has not finished, and a timed-out call may still be billed, so before sending, the function asks the database (`ai_reserve`) to hold the call's worst-case cost against the monthly budget: a prompt estimated at one token per character plus 1000 (for thinking's hidden system prompt; dense text such as digits and JSON comes close to one per character), every token at the dearest prompt price (a 1-hour cache write, long-prompt rule included), plus the whole `max_tokens` at the output price. Parallel requests each hold their own share under a lock. After the answer the row gets the real tokens and the real cost (from `prices.ts`). A failure that may have been billed (timeout, network error, 5xx, 529, an unknown fault) and a failed update both leave the row at the worst case; a refusal at the door (401, 402, 400, 429) costs 0.

## Phase 2b–2d additions (22.11.2026)

- **`thinking: { type: "disabled" }`** (SDK type `ThinkingConfigDisabled`, `@anthropic-ai/sdk@1.5.0`: `{ type: 'disabled' }`, no other field, so no `display`) is sent instead of the adaptive object only when the Test bench asks for thinking off (`ModelRequest.thinking: 'off'`). The request keeps `output_config.effort`. That Haiku 5.5 accepts disabled thinking together with `effort` low, medium and high is **not confirmed by a live call**; the Test bench's "Compare thinking" is the way to check. With thinking off the answer has no `thinking` block and `thinking_tokens` is 0.
- **`count_tokens` with the Test bench's request** carries `model`, `system`, `messages`, `thinking` and `output_config` (never `max_tokens`), exactly as `buildRequest` builds a run's request; it answers `input_tokens` only.
- **Device jobs** (`kobo_ask`, `phone_brief`, `phone_ask`) and `coach_assessment` send nothing new to Anthropic: one user message of tagged text, the cached instructions, adaptive thinking, low effort, no tools. `timeLimitMs` per job (Kobo 20 s, phone 18 s) goes to the SDK as the per-request `timeout` like every limit.

## Not confirmed by a live call yet

Everything about Anthropic's real behaviour is unconfirmed: no call has been made. Phase 1's tests (`scripts/verify-claude-function.cjs`) run the real SDK against a fake network, so they prove our code reads the shapes the docs and the SDK's types describe, not that Anthropic answers that way. The first real ✨ call must confirm:
- the exact `usage` object Haiku 5.5 returns, including `output_tokens_details.thinking_tokens` and the `cache_creation` breakdown;
- `display: "summarized"` returning readable text on Haiku 5.5;
- which image resolution tier Haiku 5.5 uses (the vision page doesn't say);
- task budgets on a non-streaming request (every example in the docs streams);
- context editing clearing tool results on Haiku 5.5 in practice (`applied_edits` in the answer);
- the header names carrying the request id;
- that a request with `thinking: adaptive` plus `output_config.format` (a small, all-required JSON schema) and `effort` together is accepted on Haiku 5.5 (the 21-optional-field schema is known to hang, trap 16);
- that the `cache_control` mark on the instructions is accepted below the 512-token minimum or above it, and what `usage` shows on the first and second call;
- what a timeout looks like on Anthropic's bill (billed or not), which decides whether the worst-case reservation is too careful;
- `error.details.error_code` `enforced_spend_limit_reached` on a real spend-limit 429;
- that `thinking: { type: "disabled" }` with `effort` is accepted on Haiku 5.5 (Test bench → Compare thinking);
- that a call from `kobo-sync` / `phone-gateway` with the service key in `x-claude-server-key` reaches `claude` through the platform with `verify_jwt = false` (new and legacy key formats).

## Log

### 20.11.2026 — first version, before any code
Written for the AI rebuild (`docs/features/ai-plan.md`, phase 0). Facts from Anthropic's documentation read that day; no live call yet.

### 22.11.2026: Confirmed live
The first live calls: the prompt cache hits (2,421 of 2,489 input tokens were read from the cache on the second call); `output_config.format` with ✨'s 21 optional fields hung (trap 16), and without it a call answers in about a second.

### 20.11.2026 — phase 1 built
The `claude` function and `item_fill`. Section "What phase 1 sends and reads" added; prices moved to code; `maxRetries` 0 and the cost reservation added after the security review. Still no live call.

### 22.11.2026: phase 2a reviewed
Phase 2a added the recipe jobs and Quick guess (`recipe_from_text`, `recipe_from_link`, `recipe_macros`, `quick_guess`, `quick_guess_options`), a page fetch by code (`page-fetch.ts`, `recipe-page.ts`) and a code step before the model. Review findings fixed: every page pattern made linear (a 2 MB page took minutes); a page read by code writes a zero-cost ledger row so the rate caps count it; a DNS runtime error other than "no lookup here" fails closed; the Console spend limit's 400 is billing (trap 13); the reservation counts one token per character plus 1000; a request's time limit follows the job's longest answer (30 s up to 2000 tokens, 10 s more per further 1000, at most 100 s: a 4000-token recipe gets 50 s); the answer reader accepts JSON followed by a note, a note and the object on one line, or a note and a code fence; ✨ gets the next 14 days and next week's Monday ready-made from code.
