# Anthropic (Claude API)

Checked: 20.11.2026 against Anthropic's own documentation at `platform.claude.com/docs`, read that day. The pages: pricing, batch processing, rate limits, prompt caching, context editing, create a message, task budgets, mid-conversation system messages, token counting, effort, vision, structured outputs, models overview, and API and data retention. Request shapes were also checked against the TypeScript SDK's reference. **No live call has been made yet:** the owner adds the key first. The section "Not confirmed by a live call yet" lists what the first real call must confirm.

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
- **Rate-limit tier:** a new account starts on the **Start** tier. For Haiku 5.5 that allows 4,000 requests a minute, 2,000,000 input tokens a minute and 400,000 output tokens a minute, with a $500 monthly cap. That is far more than one person uses.

## Models and prices

Per million tokens, in USD, from Anthropic's pricing page on 20.11.2026. The app keeps these in a table the owner can edit (`ai_prices`); the cost of every call is worked out from that table.

| Model | Input | Output | Cache read | Cache write, 5 min | Cache write, 1 h |
|---|---|---|---|---|---|
| **Claude Haiku 5.5**, prompt up to 100,000 tokens | $0.10 | $0.50 | $0.01 | $0.125 | $0.20 |
| **Claude Haiku 5.5**, prompt over 100,000 tokens | $0.50 | $2.50 | $0.05 | $0.625 | $1.00 |
| Claude Sonnet 5.5 (a stronger option) | $2.00 | $10.00 | $0.10 | — | — |
| Claude Opus 5.5 (the strongest option here) | $4.00 | $20.00 | $0.20 | — | — |

"—" means not read from the pricing page that day. Anthropic's general rule is 1.25× the input price for a 5-minute write and 2× for a 1-hour write.

- **The 100,000-token line counts every input token of the request,** cache reads and cache writes included. Above it, the whole request costs 5×. Our function keeps every request under it (see Traps).
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
| `POST /v1/messages/count_tokens` | `client.messages.countTokens` | `claude` → the Test bench's "what will this cost" | before a test question is sent | free; 5,000 requests a minute; the count is an estimate |
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
| `output_config.format` | `{ type: "json_schema", schema: { … } }` | jobs with a fixed answer shape (✨, recipes, quick guess, the PT assessment). The JSON comes back in a `text` block. |
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
| errors | HTTP status + `{ type: "error", error: { type, message } }`: 400 `invalid_request_error` · 401 `authentication_error` · 402 `billing_error` · 403 `permission_error` · 404 `not_found_error` · 413 `request_too_large` · 429 `rate_limit_error` · 500 `api_error` · 529 `overloaded_error` | the SDK's typed errors. 429 (unless it is the spend cap), 500 and 529 are retried by the SDK; the rest end the call with a plain message. Every outcome is logged. |

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
13. **A 429 can mean two things:** too many requests (retry after `retry-after`), or the monthly spend cap (don't retry: tell the owner).
14. **The SDK retries by itself** (2 times by default, on 429, 5xx and connection errors) and its default timeout is 10 minutes. An edge function has a much shorter life, so the function sets its own timeout and retry count, and every retry is visible in the log.
15. **Images:** at most 8000×8000 px and 10 MB each, no animations. Tokens are about `⌈width/28⌉ × ⌈height/28⌉`, so a large photo costs up to a few thousand tokens. The app already shrinks photos before upload.

## Not confirmed by a live call yet

The first real calls (phase 1's ✨ and the Test bench) must confirm these, and this file's Log records the result:
- the exact `usage` object Haiku 5.5 returns, including `output_tokens_details.thinking_tokens` and the `cache_creation` breakdown;
- that the cache really hits on the second call of a job (`cache_read_input_tokens` above zero);
- `display: "summarized"` returning readable text on Haiku 5.5;
- which image resolution tier Haiku 5.5 uses (the vision page doesn't say);
- task budgets on a non-streaming request (every example in the docs streams);
- context editing clearing tool results on Haiku 5.5 in practice (`applied_edits` in the answer);
- the header names carrying the request id.

## Log

### 20.11.2026 — first version, before any code
Written for the AI rebuild (`docs/features/ai-plan.md`, phase 0). Facts from Anthropic's documentation read that day; no live call yet.
