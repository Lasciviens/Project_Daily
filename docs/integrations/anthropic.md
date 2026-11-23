# Anthropic (Claude API)

Checked: 20.11.2026 against Anthropic's own documentation at `platform.claude.com/docs`, read that day. The pages: pricing, batch processing, rate limits, prompt caching, context editing, create a message, task budgets, mid-conversation system messages, token counting, effort, vision, structured outputs, models overview, and API and data retention. Request shapes were also checked against the TypeScript SDK's reference. **Live calls have been made since** (22.11.2026, Developer → AI → Diagnose and ✨): the network and the key work, a tiny answer takes about a second, and ✨'s request with its 21-optional-field answer shape did not finish in 90 s while the same request without the shape answered in about a second (trap 16). Phase 1 (20.11.2026) built the `claude` function and its one job; "What phase 1 sends and reads" below says exactly which of the fields in this file it uses. The section "Not confirmed by a live call yet" lists what no live call has shown yet.

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
| `id` | text (`msg_…`) | not kept: the call log keeps the request id Anthropic sends in its response header instead (`ai_calls.request_id`), which is what its support asks for |
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
| batch `id`, `processing_status` | `in_progress` · `canceling` · `ended` | `ai_reports.batch_id` (server-only) and the timer's check |
| result line | `{ custom_id, result: { type, message } }`; `type` is `succeeded` · `errored` · `canceled` · `expired` | the ledger row of the report, corrected to the real cost at the batch rate |

### What phase 3 sends and reads (the weekly report, 22.11.2026)

SDK `@anthropic-ai/sdk@1.5.0`, checked against its `.d.ts` (`resources/messages/batches.d.ts`), not yet against a live batch.

- **Create:** `client.messages.batches.create({ requests: [{ custom_id, params }] })` → `POST /v1/messages/batches`. One request per batch. `custom_id` is the ledger row's id (a uuid, within `^[a-zA-Z0-9_-]{1,64}$`), unique per submission, so a re-made report is never answered by an earlier batch's line. `params` is exactly the live request (`anthropicRequest`: `model`, `max_tokens`, the cached `system` block, the `messages`, adaptive `thinking`, `output_config.effort`), with **no `output_config.format`**. Read from the answer: `id` only, checked against `^[A-Za-z0-9_-]{1,100}$`.
- **Status:** `client.messages.batches.retrieve(id)` → `GET /v1/messages/batches/{id}`. Read: `processing_status` (`in_progress`, `canceling`, `ended`; anything else is an unknown answer). `request_counts`, `created_at`, `ended_at`, `expires_at` and `results_url` are not used by our code (the SDK reads `results_url` itself).
- **Results:** `client.messages.batches.results(id)` → the SDK retrieves the batch again and streams its `results_url` (`.jsonl`) as `MessageBatchIndividualResponse` lines. Read per line: `custom_id` (compared exactly with the ledger row's id; lines are in any order), `result.type` (`succeeded` → `result.message` goes through the same `anthropicAnswer` as a live answer; `errored` → `result.error.error.type` and `.message`, one scrubbed line for the ledger; `canceled`, `expired`). At most 50 lines are read.
- **Price:** the batch price is half of the live price (`BATCH_MULTIPLIER` 0.5, stacking with the long-prompt rule); the ledger row is reserved at half the live worst case and corrected from the real `usage` at half the live price. `usage.service_tier` is not read.
- **Not used:** `cancel`, `list`, `delete` (a waiting batch is read, not cancelled, in this phase), the `user_profile_id` and `workspace_id` headers.
- **Traps:** results come in any order (found by `custom_id`); a batch ends within 24 hours or its requests `expire`; results are kept 29 days (we read them within hours and save the text ourselves); a `results()` call on a batch that is not ended throws (we ask the status first); a batch costs nothing for `errored`, `canceled` or `expired` lines, but our ledger keeps the reserved worst case for them (the owner's rule: the safe side).

## What phase 4a sends and reads (Ask AI, 22.11.2026)

Checked against Anthropic's pages re-read on 22.11.2026 for this phase (saved in the session's `docs/` folder) and against the SDK's own types (`@anthropic-ai/sdk` 1.5.0 `.d.ts`). The chat uses `client.beta.messages.stream()` (+ `finalMessage()`), `maxRetries: 0`.

| What | Value | Why |
|---|---|---|
| Beta headers | `context-management-2025-06-27`, `thinking-binding-controls-2026-08-01` | context editing; the strict thinking check (trap 4) |
| `cache_control` | on the last tool, the fixed system block, the owner's instructions (a second system block, empty in 4a, so left out), and top-level `{type:"ephemeral"}` for the messages (automatic) | at most 4 marks; 5-minute TTL (a 1-hour TTL only if the ledger shows gaps of 5–60 minutes) |
| `tools[]` | **not strict** (no `strict` field), flat, every property listed in `required` as a hint, `additionalProperties: false`, no `minimum`/`maximum`/`format`/`pattern`; "" or "any" means "not given"; our code (`checkedArgs`) checks every value: object shape, no extra field, every field present, type, length, number range, a choice matched ignoring case. A bad input is an `is_error` result that says what to fix. | a strict tool makes Anthropic compile a grammar on the first request with that tool set, up to 180 s, longer than an edge function lives (trap 16, seen live 22.11.2026: trap 29) |
| `tool_choice` | omitted (auto); `{type:"none"}` for the last allowed round | forced choices lose the messages cache and drop the thinking block |
| `thinking` | `{type:"adaptive", display:"summarized", block_binding:{prefix_mismatch_behavior:"error"}}` | |
| `output_config.effort` | `medium`, frozen for the whole chat | changing effort in a conversation loses the messages cache |
| `max_tokens` | at least 6000 | thinking counts toward it |
| `context_management` | `clear_tool_uses_20250919`, trigger 40 000 input tokens, keep 4, `clear_at_least` 10 000 | the default trigger is 100 000 (Haiku's 5× line); clearing invalidates cached prefixes, so each clear must free enough |
| `diagnostics.previous_message_id` | the id of the chat's previous answer (null the first time) | stable, no header; the answer's `diagnostics.cache_miss_reason` (`model_changed`, `system_changed`, `tools_changed`, `messages_changed`, `previous_message_not_found`, `unavailable`) is stored with the answer and shown in Developer → AI → Calls |
| `search_result` blocks | in `tool_result.content`, `citations: {enabled: true}` on every one (all results of a request must agree: switching loses the system cache) | cited text costs no tokens; a text block's `citations[].type === "search_result_location"` carries `source`, `search_result_index`, `cited_text`; each `source` is input and is checked against what a tool returned and against the owner's own row |
| `count_tokens` | with the same `context_management`, `tools`, `thinking`; free | the "start a new chat" wall near 90 000 tokens |

What it reads back: `content` blocks stored **exactly as received** (thinking with `signature`, `tool_use`, text with `citations`), `stop_reason` (`end_turn`, `tool_use`, `max_tokens`, `refusal`; anything else is an error), `stop_details`, `usage`, `diagnostics.cache_miss_reason`, `context_management.applied_edits[].cleared_tool_uses / cleared_input_tokens`, the message `id`. Streaming events are read by the SDK; only our own two small deltas (text pieces, a tool being called) leave the provider part.

## What phase 4b sends and reads (Ask AI controls, 23.11.2026)

Checked against the docs saved for phase 4 (`vision`, `prompt caching`, `preserved thinking`), not yet by a live call.

- **The owner's own words** are a second `system` text block with its own `cache_control` after the fixed block (the layout was already built: at most 4 marks in all: the last tool, the fixed block, the words, the automatic one). Omitted when empty, so a chat without words sends exactly the 4a request.
- **A photo** is a `{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }` block in the user turn, before the text (Anthropic's advice), stored and replayed unchanged: with `prefix_mismatch_behavior: "error"` a changed earlier message would make every later thinking block a 400, which is why a photo is never replaced by a stub. Tokens: roughly ⌈w/28⌉ × ⌈h/28⌉ (≤ 4 784 on Haiku 5.5); the first image in a conversation loses the messages cache for that request. No Files API.
- **No tools at all** (every tool switched off): the request has no `tools` and no `tool_choice` (an empty `tools` list is not sent).
- **The phone's question** uses the chat's `chatRound` with a tool list of four, thinking `disabled`, effort `low`, `tool_choice: none` on the second request; it sets no `diagnostics` previous id and keeps no conversation. The SDK streams internally; nothing is streamed to the phone.

## Fields we deliberately don't use

| Field or feature | Why not |
|---|---|
| Tool search | 20 tools are about 4K cached tokens, about $0.00004 a request: loading definitions on demand would cost more than it saves (research, 22.11.2026). |
| Programmatic tool calling | Keeps data up to 30 days, not available with strict tools, a 4-minute timeout, about 8% dearer. |
| `eager_input_streaming`, task budgets, threshold compaction, the memory tool, message threads, forced `tool_choice`, server-side fallbacks | Not now (task budgets count earlier turns and act like a refusal when too small; threshold compaction needs ≥ 50 000 tokens; fallbacks are not on Haiku 5.5). |
| `output_config.format` together with tools while thinking is off | Not combined: the chat's tools are not strict, and our own check holds their inputs. |
| `strict: true` on the chat's tools | Dropped 22.11.2026: the grammar compile can take up to 180 s (trap 29). Strict returns only if a live Diagnose chat step shows the first request answers within seconds, and then only with the tool set frozen. |
| IP allowlist in the Console | Supabase's edge egress addresses are not fixed. |
| Web search / fetch for the chat | `place_ideas` (PR #628) uses web search, so web search stays enabled in the Console; the chat does not use it. |


| Field or feature | Why not |
|---|---|
| `temperature`, `top_p`, `top_k` | On API version `2026-10-21` any value returns a 400. Behaviour is steered by the instructions and by effort. |
| `fallbacks` (Anthropic retries a declined request on another model) | Not available for Haiku 5.5: a list of models returns a 400. A decline is shown plainly. **A retry on Sonnet 5.5 is not built** (owner-critic round, 22.11.2026): it waits for a real refusal to look at, and Settings does not offer it. |
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
4. **History is append-only, and a changed prefix does not always give a 400 (corrected 22.11.2026).** A `thinking` block is bound to the messages before it. On Haiku 5.5 a block that fails the check is **not** always refused: it can reach the model and be billed (preserved-thinking → prefix checks). Only with the beta header `thinking-binding-controls-2026-08-01` and `thinking.block_binding.prefix_mismatch_behavior: "error"` does a failing block always give a 400; the chat sends both, so a changed history is an error, never a billed guess. Thinking blocks may be left out only as the oldest, the newest or all of them, never one in the middle. Context editing and compaction never count against the check. So: instructions and tools are frozen for a conversation (the chat stores their hashes); the date and other news go in the newest user message; old tool results are cleared with context editing (Anthropic's own way), never by rewriting history ourselves.
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

17. **Haiku 5.5 keeps every earlier turn's thinking in context (billed as input), and shows no progress updates** (`display: "updates"` gives nothing). A long chat therefore grows faster than its visible text: the wall at 90 000 tokens (`CHAT_LIMITS.wallTokens`) is measured on the prompt, not on the words.
18. **If strict tools ever come back: their limits are combined across the whole request.** At most 24 optional parameters in total over every strict schema, 16 union types; "Schema is too complex" and a 180-second compile timeout are the failures. The grammar cache is lost when the **set** of tools changes (a changed name or description alone keeps it); a choice's letter case may vary in the model's answer. After any change to the tool list, try a real call in Diagnose: `count_tokens` does not compile the grammar (trap 16). The chat has zero optional parameters, so it is far from the limit.
19. **Forced `tool_choice` works on Haiku 5.5, but the answer then has no thinking block, and changing `tool_choice` loses the messages cache.** The chat forces nothing, except that its last allowed round (the fifth, or the one after the prompt nears the wall) says `none`: that round **loses the messages cache** (the whole chat is written to the cache again at 1.25×), a deliberate, rare cost that guarantees an answer in words.
20. **Tool use adds a hidden system prompt on Haiku 5.5:** 286 tokens with `auto`/`none`, 406 with `any`/`tool`.
21. **Context editing's default trigger is 100 000 input tokens, and clearing invalidates cached prefixes.** So the chat triggers at 40 000 and asks for `clear_at_least` 10 000: a clear that frees little would cost the cache for nothing.
22. **After tool results, Haiku 5.5 can ignore a user's words placed in a system message as a prompt injection.** Text that others can edit, and anything stored, goes only inside a `tool_result` block; the owner's own words are the user message; the app's date line and notices are separate text blocks in the user message (never mixed with the owner's words).
23. **Tools are fixed per conversation.** Turning one off for a single request is `tool_choice: none`; adding or removing one mid-conversation needs the `inline-tools-2026-09-15` beta blocks, which the chat does not use: a new tool list is a new chat.
24. **Vision on Haiku 5.5** is the high-resolution tier: a long edge up to 2 576 px, at most 4 784 tokens an image; the first image in a conversation loses the messages cache. Photos come in 4b (shrunk to 1 200–1 568 px in the browser).
25. **Caching:** the lookback is 20 blocks (a run of tool calls and results counts as one block); parallel requests hit the cache only after the first one's response has started; `max_tokens: 0` warms the cache (not with streaming). Cache diagnostics are stable (no beta header) and supported on Haiku 5.5.
26. **Compaction:** the threshold trigger needs at least 50 000 tokens; on-demand compaction (`compact-2026-09-04`) supports Haiku. Not used: the chat ends at the wall instead.
27. **A refusal can arrive after partial output, also while streaming, and Haiku 5.5 has no server-side fallback.** The chat takes the streamed text back (a `retract` event), stores nothing of the round, and says it was declined.
28. **Token-efficient tool use needs no header now.** Code execution (1 550 free hours a month, then $0.05 an hour) and programmatic tool calling (data kept up to 30 days) are not used.
29. **A stream can open and then say nothing (seen live, 22.11.2026), and the SDK's `timeout` does not cover that.** The owner asked for a task; the function started the stream, then nothing for 134 s until Supabase stopped it ("WallClockTime"); the ledger row stayed "In flight" and the panel showed a session error. The SDK's `timeout` limits only the wait for the response headers; once headers are in, a silent stream waits for ever. The likely cause was the strict tools' grammar compile (trap 16/18), so strict is gone from the chat. Whatever the cause, the provider part now has its own clocks (`chatRound`): no stream event in 45 s (`CHAT_LIMITS.firstEventMs`), or no event for 30 s once the stream has started (`idleMs`; every event starts it again, so a long answer that keeps streaming is never cut), stops the round with our own `AbortController`, raced against the SDK; and the whole answer has 110 s (`answerDeadlineMs`), under Supabase's 150 s, which stays the hard limit even for a stream that is still going. A stopped round is a `timeout` failure: its ledger row is finished as `error` with the worst case held (the bill is unknown), nothing of the round is stored (the person's question and earlier rounds stay), the streamed text is retracted, and the app gets "No answer — Anthropic took too long. Try again." Not confirmed: whether `message_start` arrives before a grammar compile ends (then the first-event clock would not catch a compile; the 30 s idle clock and the 110 s limit still do).
30. **A PDF is a `document` block, and its length is a token count, not a page count (checked 23.11.2026, Anthropic's PDF support, token counting and vision pages, and the SDK 1.5.0 types).** Sent as `{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }` (`DocumentBlockParam` with `Base64PDFSource`; the SDK also has `url`, `file`, plain-text and content sources, none used here), placed before the question's text like a photo. **Haiku 5.5 is on the supported-models list** of the PDF page and the token-counting page ("all active models support PDF processing"). Limits on the first-party API: 128 MB a request, **600 pages (100 when the request's context window is under 1M tokens; Haiku 5.5 has 1M)**, a standard PDF with **no password or encryption**; both limits count the whole payload. Each page is converted to an image AND its text is extracted: **1,500–3,000 text tokens a page plus at most 1,568 image tokens a page on every model**, standard prices, no PDF fee. A dense PDF can fill the context before the page limit. **`count_tokens` accepts a base64 PDF with the same requirements (a `url` or `file` source is refused there), is free and has its own rate limit (Start 5,000 a minute), but it returns an `invalid_request_error` for any server tool, web search included**: so the app counts the prompt WITHOUT the search tool and the reservation adds the search loop itself (`run.ts`, `worstCostOf`). The count is "an estimate" that "might differ by a small amount", so the reservation holds a quarter more. Our limits (`image-rules.ts`): `%PDF-` as the first five bytes (the magic bytes, not the file name or type), no `/Encrypt` entry, at most about 1 MB (1.4 million base64 characters, inside the 1.5 MB body of a request that carries a photo), and at most **32,000 prompt tokens** by Anthropic's own count (a receipt is one to four pages, about 4,500 tokens a page at the most; a real 3–4 page invoice with a terms page reaches 16,000). The most the reservation can then hold is about $0.22: 32,000 × 1.25 over three rounds plus 75,000 search-result tokens is past the 100,000-token long-prompt line, so Haiku's long-prompt price applies to that worst case. A count that is missing, zero or negative fails closed. Nothing in the function reads a PDF's pages: no parser or library. The PDF is sent in that one call and is never stored (the ledger keeps its size only). A PDF Anthropic cannot read answers 400 `invalid_request_error` at the count and reaches the owner as "That PDF could not be read".

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
- Not sent (phase 1; the image and web search additions are in their own section below): tools, `temperature`, `top_p`, `top_k`, prefill, streaming (the function waits for the whole answer: ✨'s answers are short and come in about a second, so streaming would add code for nothing visible; reconsidered with the chat in phase 4), betas, `context_management`, `task_budget`, images, `metadata`, `inference_geo`.

**Read back:** `content[]` (`text` joined; `thinking` kept as a summary for the owner's log; other blocks ignored), `stop_reason` (`end_turn` is the only good ending; `refusal` and `max_tokens` have their own outcomes; every other value is an error, never an answer), `stop_details` (a refusal's explanation, for the log), `usage` (`input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `cache_creation.ephemeral_5m_input_tokens` / `.ephemeral_1h_input_tokens`, `output_tokens`, `output_tokens_details.thinking_tokens`; each count is clamped to a whole number the ledger can hold), `model` (the model that answered), and the `request-id` header (via the SDK's `_request_id`). Errors are read by the SDK's typed classes and only single named fields (`status`, `requestID`, `apiMessage`, `type`, `errorCode`): a 401 or 403 is a key problem, a 402 or a 429 with `error.details.error_code` `enforced_spend_limit_reached` is billing, 429 is rate limit, 529 overloaded, 500 a provider fault, 400/404/413/422 a refused request, and a connection error or timeout is its own kind. The message the owner sees is our own fixed sentence; the provider's explanation goes only into the owner's call log, and only while the text log is on.

**Cost is reserved before each call.** The budget wall cannot count a call that has not finished, and a timed-out call may still be billed, so before sending, the function asks the database (`ai_reserve`) to hold the call's worst-case cost against the monthly budget: a prompt estimated at one token per character plus 1000 (for thinking's hidden system prompt; dense text such as digits and JSON comes close to one per character), every token at the dearest prompt price (a 1-hour cache write, long-prompt rule included), plus the whole `max_tokens` at the output price. Parallel requests each hold their own share under a lock. After the answer the row gets the real tokens and the real cost (from `prices.ts`). A failure that may have been billed (timeout, network error, 5xx, 529, an unknown fault) and a failed update both leave the row at the worst case; a refusal at the door (401, 402, 400, 429) costs 0.

## Phase 2b–2d additions (22.11.2026)

- **The request as sent is kept in the text log** (`request.sent_to_provider`, shown in a call's detail as "Sent to the provider, as built"): the model, `max_tokens`, the cache mark on the instructions, `thinking`, `output_config` and the time limit. The instructions and the owner's text are named by their length there (the log already holds them), and the key is never in a body: it travels in a header.
- **Thinking is a per-job setting** (migration 195, `ai_job_settings.thinking`: null, `adaptive` or `off`; default adaptive until a job's answers are measured to be as good without it). Anything stored that is not the word `off` is adaptive. The Test bench's own pick still wins for its one run.
- **Prompt caching is marked on every job**, although a job's instructions (1–3k tokens) may be under the model's minimum cacheable prefix, where the mark does nothing. An unused mark costs about $0.00003 a call, so there is no per-job switch (owner-critic round, 22.11.2026; Diagnose and the ledger's cached/written columns show whether a job's instructions are cached).

- **`thinking: { type: "disabled" }`** (SDK type `ThinkingConfigDisabled`, `@anthropic-ai/sdk@1.5.0`: `{ type: 'disabled' }`, no other field, so no `display`) is sent instead of the adaptive object only when the Test bench asks for thinking off (`ModelRequest.thinking: 'off'`). The request keeps `output_config.effort`. That Haiku 5.5 accepts disabled thinking together with `effort` low, medium and high is **not confirmed by a live call**; the Test bench's "Compare thinking" is the way to check. With thinking off the answer has no `thinking` block and `thinking_tokens` is 0.
- **`count_tokens` with the Test bench's request** carries `model`, `system`, `messages`, `thinking` and `output_config` (never `max_tokens`), exactly as `buildRequest` builds a run's request; it answers `input_tokens` only.
- **Device jobs** (`kobo_ask`, `phone_ask`) and `coach_assessment` send nothing new to Anthropic: one user message of tagged text, the cached instructions, adaptive thinking, low effort, no tools. `timeLimitMs` per job (Kobo 20 s, phone 18 s) goes to the SDK as the per-request `timeout` like every limit.

## Image input and web search (22.11.2026)

Added for the AI features the owner picked (`docs/features/ai-plan.md` → section 9). Checked against the SDK's own types, `@anthropic-ai/sdk@1.5.0` (`resources/messages/messages.d.ts`) and `deno check`; **no live call yet** (listed below).

**Image input** (`quick_guess_photo`, `receipt_read`). Sent: the user message's `content` becomes a list: one `{ type: 'image', source: { type: 'base64', media_type, data } }` block per photo, **first**, then the `{ type: 'text', text }` block with the job's tagged words. `media_type` is one of `image/jpeg`, `image/png`, `image/webp` (the SDK also allows `image/gif`: refused here). Read: nothing new. Fields deliberately unused: the `url` and `file` sources (the function never fetches a picture and has no Files API), `cache_control` on an image (a photo is never the same twice).
- Limits (ours, `image-rules.ts`): at most 1.4 million base64 characters (about 1 MB), at most 1600 px on the long side (the browser sends at most 1280 px, JPEG 85 %, about 150–400 KB), at least 16 px; the type, the bytes and the size are checked from the file's own header (JPEG start-of-frame marker, PNG IHDR, WebP VP8 / VP8L / VP8X). A request that carries a photo may be 1.5 MB, every other request 16 KB (`main.ts` reads up to the image limit, then refuses a larger body for any job without `acceptsImage`; a device request keeps 16 KB).
- Cost: Anthropic's tokens for an image are about `⌈width/28⌉ × ⌈height/28⌉` (trap 15 above; `width × height / 750` is an older rule of thumb). A 1280 × 960 photo is 46 × 35 = **1,610 tokens**, about $0.00016 on Haiku 5.5. The reservation (`worstCostOf`) adds the photo's tokens, worked out from its header, at the dearest prompt price (the one-hour cache write), so a bigger photo reserves more. The photo is never stored: the text log keeps only its type and its length in base64 characters.
- Text inside a photo is data, never an instruction: both photo jobs say so in their instructions.

**Web search** (`place_ideas`, the one job with a tool). Sent: `tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]`. The SDK has three versions of the tool (`web_search_20250305`, `_20260209`, `_20260318`; the last two add dynamic filtering through code execution and `response_inclusion`); the first is the plain one and needs nothing else, so it is the one used. Anthropic runs the searches on its side inside the one request (no tool loop in our code, nothing passes through it); a long search turn can end with `stop_reason: 'pause_turn'`, an ending this code does not handle (an error, never an answer). Read: `usage.server_tool_use.web_search_requests` (the number of searches; `text` blocks are joined, `server_tool_use` and `web_search_tool_result` blocks are ignored). Fields deliberately unused: `allowed_domains` / `blocked_domains` (the instructions ask for official tourism pages; a domain list would go stale), `user_location` (the place is in the question, not the owner's position), `strict`, `defer_loading`.
- Price: **$10 per 1,000 searches ($0.01 each)** plus the tokens of what the searches bring back (billed as input). `prices.ts`: `WEB_SEARCH_USD_EACH = 0.01`, `WEB_SEARCH_MAX_USES = 3` (no job may ask for more), `WEB_SEARCH_RESULT_TOKENS = 25_000` a search in the reservation. The reservation is the search loop's worst case: n searches are n + 1 rounds, each reading the prompt again with the results so far, so it holds `(n + 1) × prompt + n(n + 1) / 2 × 25,000` tokens at the one-hour write price, counted as ONE prompt for the long-prompt line (for n = 3 that is 150,000 tokens plus four prompts, so Haiku's ×5 applies: about $0.19 held for a call that really costs a few cents). The ledger records the real cost afterwards. A call's cost is its tokens plus the searches Anthropic reports (the long-prompt multiplier does not apply to a search); a count over the cap is still billed as reported. The ledger row's `tools` holds `[{ name: 'web_search', searches: n }]` (the count, never what was found). Developer → AI shows it: the cost breakdown has a line "N searches × $0.01" (added after the tokens, never multiplied), the call's Tools section says "Searched the web N times", and the Prices page lists the price of a search (`describe` → `prices.webSearchUsdEach`, `webSearchMaxUses`). The tool is switched on only for a job whose definition names it (`tools`), whatever its `prepare` returns.
- Results are data too: the instructions say text in a page or a result never instructs; the answer's lines are checked by code (a line with a link is dropped).
- Web search has to be enabled for the Anthropic organization (Console → Privacy); if it is not, the request fails with an error that the ledger shows.

## PDF input and the receipt job (23.11.2026)

`receipt_read` takes a photo or a PDF (one of them), bought or sold, product lines and may search the web. Facts: trap 30 (PDF) above and the image and web-search section. **What it sends:** the user message's content is `[document | image, text]` (`'Read the PDF.'` or `'Read the photo.'`) with the fixed cached instructions and `tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }]`. **Before it:** for a PDF, `POST /v1/messages/count_tokens` with the same body but no tool and no answer limit (free); the run is stopped when the count fails, is missing or zero, or is over 32,000, and otherwise the reservation holds the counted tokens plus a quarter, repeated for each round a 2-search call may take, at the one-hour write price (`worstCostOf`'s `imageTokens`). **Read back:** nothing new (`text` blocks; `usage.server_tool_use.web_search_requests`). **Fields deliberately unused:** the `url` and `file` document sources and the Files API (a receipt is sent once, never stored), `citations` and `title` on the document, `cache_control` on it, `allowed_domains` / `blocked_domains` and `user_location` on the search (a store's site can be anywhere). **`shop_tidy` (23.11.2026) sends nothing new:** one user message of tagged text, the cached instructions, adaptive thinking, low effort, and the same `web_search_20250305` tool with `max_uses: 2`; it reads the same `text` blocks and `usage.server_tool_use.web_search_requests`. **Not confirmed by a live call yet:** that Haiku 5.5 answers a real receipt PDF as the docs describe, the real token count of a one-page receipt PDF, and the search loop's real cost on this job; Diagnose's real call is the way to see it. Checked 23.11.2026 against the pages above, fetched that day.

## The learning layer (23.11.2026, migration 204)

- **One-shot jobs:** learned knowledge (past cases, approved notes) goes in the user message as `search_result` blocks (`{type, source, title, content: [{type: 'text', text}]}`, SDK 1.5.0's `SearchResultBlockParam`, no `citations` config) before the live text, after the cached system block; the system block then gains one rule line (`LEARN_RULE`). The text log keeps the blocks; `sent_to_provider` lists their sources, titles and lengths. No new header or beta.
- **Ask AI:** `search_docs` and `get_about_me` (the learned notes that are on) return `search_result` blocks inside a `tool_result`; a citation of them is never shown (only task and diary sources are, `SOURCE_PATTERN`).
- **Batches:** every batch (the self-test, the weekly report, the suggestions) is deleted right after its results are read, and on an error path cancelled first (`POST /v1/messages/batches/{id}/cancel`) when it has not ended. The weekly self-test sends one batch of many requests (custom ids `<ledger row id>-<n>`, at most 64 characters), reads up to the plan's size of result lines (`batchResults(…, maxLines)`, at most 5000), then `DELETE /v1/messages/batches/{id}` (`client.messages.batches.delete`; Anthropic deletes an ended batch and its results; the answer is `{ id, type: 'message_batch_deleted' }`). A replay sends no web search.
- **Retry once:** a second `POST /v1/messages` with the same request and our check's sentence appended (`<check_error>`).
- Not confirmed live: a `search_result` block in a one-shot user message on Haiku 5.5, and the batch delete's answer shape (both typed against the SDK and tested with a fake network only).

## Not confirmed by a live call yet

Most of Anthropic's real behaviour is still unconfirmed. What the live calls of 22.11.2026 showed (above): the network and key work, and requests with adaptive thinking, an effort and the cache mark on the instructions were answered (a tiny answer, ✨ without an answer shape). Phase 1's tests (`scripts/verify-claude-function.cjs`) run the real SDK against a fake network, so they prove our code reads the shapes the docs and the SDK's types describe, not that Anthropic answers that way. No live call has yet confirmed:
- the exact `usage` object Haiku 5.5 returns, including `output_tokens_details.thinking_tokens` and the `cache_creation` breakdown;
- `display: "summarized"` returning readable text on Haiku 5.5;
- which image resolution tier Haiku 5.5 uses (the vision page doesn't say), and the real token count of a 1280 px photo (`count_tokens` with an image block would tell, free);
- that `web_search_20250305` is accepted on Haiku 5.5 together with adaptive thinking and `effort`, that the organization has web search switched on, what `usage.server_tool_use` looks like, and how often a search turn ends in `pause_turn`;
- task budgets on a non-streaming request (every example in the docs streams);
- context editing clearing tool results on Haiku 5.5 in practice (`applied_edits` in the answer);
- the header names carrying the request id;
- that a request with `thinking: adaptive` plus `output_config.format` (a small, all-required JSON schema) and `effort` together is accepted on Haiku 5.5 (the 21-optional-field schema is known to hang, trap 16);
- that the `cache_control` mark on the instructions is accepted below the 512-token minimum or above it, and what `usage` shows on the first and second call;
- what a timeout looks like on Anthropic's bill (billed or not), which decides whether the worst-case reservation is too careful;
- `error.details.error_code` `enforced_spend_limit_reached` on a real spend-limit 429;
- that `thinking: { type: "disabled" }` with `effort` is accepted on Haiku 5.5 (Test bench → Compare thinking);
- that the chat's tools (8, not strict, no optional field) answer quickly on the first request (Developer → AI → Learn → How it works → Diagnose, the fifth step, sends the chat's real first request with a 120 s limit and reports the time to the first event), that `thinking.block_binding` and `diagnostics` are accepted on Haiku 5.5 together with the two beta headers, and that a `search_result` citation comes back as `search_result_location` (phase 4a; try it with a real chat before relying on any of it);
- that a call from `kobo-sync` / `phone-gateway` with the derived credential (HMAC of the service key, not the key) in `x-claude-server-key` reaches `claude` through the platform with `verify_jwt = false` (new and legacy key formats).

## Log

### 23.11.2026: the learning layer (migration 204)
Knowledge as `search_result` blocks in one-shot calls, two read tools that return them in Ask AI, a many-request batch with `maxLines`, the batch delete right after the results are read, and one retry on our own check's refusal. See "The learning layer".

### 23.11.2026: phase 4b (Ask AI controls)
The owner's words as a second cached system block, photos as base64 image blocks stored in the message, a coach tool set, no `tools` field when all are off, and `phone_ask` with the owner's read tools (one round). No new endpoint, header or beta.

### 22.11.2026: the chat's tools are not strict, and a deadline
Live, the first chat request hung until Supabase's wall clock (trap 29). Dropped `strict` from the chat's tools (trap 16), added the first-event and round clocks, and Diagnose's fifth step (the chat's real first request, 120 s, a call of its own because the four checks plus it would pass 150 s). Reading `message_start` timing and a first Diagnose chat step on the real account is the owner's next check.

### 22.11.2026: phase 4a (Ask AI)
The chat on Claude: the section "What phase 4a sends and reads", trap 4 corrected (a changed prefix may not give a 400; the strict binding makes it always give one), traps 17–28 added from the docs re-read, Fields we deliberately don't use extended. Nothing of the new request is confirmed by a live call yet (a real strict-tool call, the cache layout's `usage`, a `diagnostics` answer, an `applied_edits` answer, a citation on a `search_result_location`): Diagnose does not yet try the chat's request; see "Not confirmed" below. 

### 20.11.2026 — first version, before any code
Written for the AI rebuild (`docs/features/ai-plan.md`, phase 0). Facts from Anthropic's documentation read that day; no live call yet.

### 22.11.2026: Confirmed live
The first live calls: the prompt cache hits (2,421 of 2,489 input tokens were read from the cache on the second call); `output_config.format` with ✨'s 21 optional fields hung (trap 16), and without it a call answers in about a second.

### 20.11.2026 — phase 1 built
The `claude` function and `item_fill`. Section "What phase 1 sends and reads" added; prices moved to code; `maxRetries` 0 and the cost reservation added after the security review. Still no live call.

### 22.11.2026: phase 2a reviewed
Phase 2a added the recipe jobs and Quick guess (`recipe_from_text`, `recipe_from_link`, `recipe_macros`, `quick_guess`, `quick_guess_options`), a page fetch by code (`page-fetch.ts`, `recipe-page.ts`) and a code step before the model. Review findings fixed: every page pattern made linear (a 2 MB page took minutes); a page read by code writes a zero-cost ledger row so the rate caps count it; a DNS runtime error other than "no lookup here" fails closed; the Console spend limit's 400 is billing (trap 13); the reservation counts one token per character plus 1000; a request's time limit follows the job's longest answer (30 s up to 2000 tokens, 10 s more per further 1000, at most 100 s: a 4000-token recipe gets 50 s); the answer reader accepts JSON followed by a note, a note and the object on one line, or a note and a code fence; ✨ gets the next 14 days and next week's Monday ready-made from code.

### 22.11.2026: image input and web search
Added image blocks (two photo jobs) and the web search tool (one job); section "Image input and web search" above. Types checked with `deno check`; not run live.
