# AI layer — cost & capability reference (as shipped)

> **Status: SHIPPED.** Written 21/07/2026; phases 1–4 are all live — client `aiApi.ts` plus a redeployed `ai-proxy`,
> with migrations `064` (`ai_usage_log`, `ai_query_log`, `ai_memory`, the `ai_run_read_query` RPC) and `065`
> (pgvector, `ai_embeddings`, `ai_semantic_search()`, `ai_reviews`) applied.
> **This is a reference, not a plan.** Read it before any `ai-proxy` / `aiApi.ts` cost or capability work.
> **Deferred by decision:** explicit `cachedContent` (only if `ai_usage_log.cached_tokens` shows implicit misses
> dominate) · embed-on-write freshness (reindex is manual — Developer → "Reindex AI search") · a dedicated Food
> "add by photo" button (the chat vision path + `parseFoodPhoto` already cover it) · nightly `daily_rollups`.

## 1. Cost model

The **only materially non-zero bill is Gemini tokens**, and within that, uncached input-prefix re-billing dominated.
Everything else rides free tiers with large headroom at single-user scale — Supabase free tier, edge functions
(500K invocations/month), GitHub Pages, and every third-party API (TMDB / EnTur / Open Food Facts / Kassalapp / Hevy
/ Google). **Don't go optimising them.**

## 2. The caching contract (the measured driver)

Baking live context into `systemInstruction` (`${SYSTEM_PROMPT}\n---\nLIVE DATA:\n${context}`) made Gemini's implicit
prefix cache (~90% off a repeated byte-identical prefix, ~1,024-token minimum on Flash) **structurally unable to
hit**, so a **~7,270-token fixed block** (system prompt ~3,270 + serialized `TOOLS` ~4,000) was billed at full price
**on every turn of every tool loop** — a 4-tool answer re-shipped ~29k fixed tokens.

The shipped contract, which must not regress:

- `systemInstruction` is **byte-identical forever**; tool declarations are **byte-identical per surface** (serialize
  `TOOLS` deterministically, stable key order).
- Live context rides as `contents[0]` (`prependContext` in `aiApi.ts`), not in the system prompt.
- **Never interpolate dates, timestamps or any volatile value into `SYSTEM_PROMPT`** — an instant cache-buster. The
  current date belongs in the context turn.
- `buildContext` is skipped for clearly transit-only questions (conservative client-side `TRANSIT_RE` gate); the
  model can always pull more via `db_query`, so a misclassification is recoverable.
- **`ai_usage_log.cached_tokens`** (← `usageMetadata.cachedContentTokenCount`) is the **proof metric** and the
  documented trigger for escalating to explicit `cachedContent`.

## 3. The tool layer

**`db_query`** stays the generic "any table, any filter" read.

**`db_aggregate`** exists because without it, "average protein this month" forces 30–90 rows into context plus
in-head arithmetic — token-expensive *and* unreliable. Shape: enum'd ops only (`sum|avg|min|max|count`), never
expressions; the same filter grammar as `db_query`; group columns validated against `DB_CATALOG`; a hard cap of
**≤366 groups**; `user_id` forced server-side; rows reduced server-side in JS so only the summary reaches the model
(~80 tokens out / ~50 back replaces 1k–10k-token dumps). **This one tool is what makes "no pre-written query per
scenario" true for analytics, not just lookups.**

**Hot-path RPCs** (`get_day_summary` / `ai_day_summary`-class) are capped at **~3–5**. Beyond that, use
`db_aggregate` — otherwise you re-enter the pre-write-every-scenario trap.

**`semantic_search`**: `vector(768)` from `gemini-embedding-001` (Matryoshka-truncated); the **hnsw cosine index
means no manual normalisation**; vector `limit ≤ 8`; `user_id` filtered inside the vector query. It returns
`{source_table, source_id, snippet, score}` and the model then `db_query`s the live row by id — **embeddings locate,
live SQL answers; never use a similarity hit as the factual value of anything current-state.**

**Decision ladder the system prompt teaches:**

```
current value / list?          → db_query
average / trend / compare?     → db_aggregate
"the whole day/week picture"?  → hot-path RPC tool
"that thing I wrote/saved…"?   → semantic_search → db_query by id
write?                         → db_insert/update/delete (+ the confirm rules)
external world?                → special tools (transit / calendar / media / …)
```

## 4. `run_read_query` — the opt-in read-only live-SQL hatch

Raw SQL was rejected as the *primary* path because ai-proxy's normal ops run under the **service role (RLS
bypassed)**. The hatch instead builds a **user-JWT client** and calls a **SECURITY INVOKER** RPC
(`ai_run_read_query`), so it runs as `authenticated` and RLS applies; the RPC sets `transaction_read_only = on` plus
a 5 s `statement_timeout` and wraps the query in `LIMIT 500` before `jsonb_agg`. The system prompt only reaches for
it when the user asks for a raw/custom query `db_query` can't express (or literally says "live sql").

**The security boundary is the DATABASE, not the text guard.** An adversarial review proved regex SQL parsing is
bypassable (`FROM/**/tbl`, `FROM "tbl"`), so containment rests on RLS + the read-only transaction + **migration 044
already revoking the OAuth-token tables from `authenticated`** + the hard row cap.

The edge guard is a best-effort UX filter that fails closed: strip comments first, reject quoted identifiers,
`SELECT`/`WITH`-only, single statement, block `pg_` / `information_schema` / other schemas, check every `FROM`/`JOIN`
target (including comma-joined lists) against the catalog allow-list, and recognise CTEs only as `name AS (` so a
SELECT-list alias isn't mistaken for one. Verified: 8/8 of the review's bypass corpus rejected, 5/5 legitimate
queries pass. **The broad DML-keyword regex was deliberately REMOVED — do not re-add it**: it false-rejected reads
containing words like "update" in a string literal; write-prevention is the read-only transaction's job.

Honest residual risk: the model could read one of the user's own non-secret, non-catalog rows. `statement_timeout` is
best-effort (Postgres doesn't re-arm the timer mid-statement) — the reliable bounds are the 500-row cap and the
role's own default timeout. Every `db_query` / `run_read_query` is logged to `ai_query_log` with the exact SQL, the
substrate for later promoting hot queries into the UI.

## 5. Tool slicing, model routing, batch

- **Slicing is deliberate and narrow: ONLY the bounded shop surface is sliced (5 tools); coach and general keep the
  FULL tool set.** Slicing an open training+nutrition+schedule conversation that creates tasks, plans time blocks and
  logs food would weaken the assistant. Measure before slicing anything else.
- **Model routing changes only the *starting* model** of the existing fallback chain
  (`SURFACE_MODEL.shop = gemini-2.5-flash`); a 503 still falls through the whole chain — no new plumbing.
- **Batch API: never interactive.** Reserved for the embeddings backfill (50% off) and future bulk enrichment; not
  worth it for one daily briefing.

## 6. Security invariants (none relaxed)

1. Allow-list only (`DB_CATALOG`); token/secret/auth tables unreachable. `db_aggregate` validates the table AND every
   column/op against the catalog; ops are enum'd, never expressions.
2. Every op force-scoped to `user_id` server-side — the model never supplies it.
3. No raw SQL from the model on the default path.
4. `security definer` RPCs pin `set search_path = public` and take `p_user` injected by the edge function from auth,
   never from the model.
5. Announce before create/update/delete; **explicit user confirmation before ANY delete**.
6. `semantic_search` returns only the caller's rows (user_id filter inside the vector query).
7. Limits: 16-turn loop cap · `db_aggregate` ≤366 groups · vector `limit ≤ 8`.

## 7. Architectures evaluated (so they aren't re-litigated)

- **(C) AI-generated raw SQL** — rejected as the primary path (service-role RLS bypass, injection surface,
  silent wrong-JOIN errors); shipped only as the opt-in read-only hatch in §4.
- **(D) named-metric registry** — the pre-write-every-scenario trap; capped at 3–5 hot RPCs.
- **(E) frontend-executed query plans** — latency ×N inside a 16-turn loop; rejected for chat. (Note: the app's own
  UI already *is* this layer for known views.)
- **(F) RAG-first** — embeddings are STALE copies, useless for "how many kcal today"; a complement only.
- **(G) precomputed rollups** — staleness; the natural substrate for a future weekly review, not needed for v1.

## 8. Already right — do not churn

`DB_CATALOG` stays behind `describe_database` (on-demand, not in the prompt) · `thinking_level: MINIMAL` in the loop
with the request body built **per model** (thinking tokens are not the leak) · structured mode sends no tools · the
daily briefing is once/day + localStorage-cached · the weekly review is client-side lazy+cached the same way (no
cron) · `plan_trip`'s one-shot resolve-in-tool latency design.

## 9. Pricing appendix (July 2026 — MEDIUM confidence, verify on live billing)

| Model | In $/M | Out $/M |
|---|---|---|
| gemini-3.5-flash (default) | ~1.50 | ~9.00 |
| gemini-3.1-flash-lite | ~0.25 | ~1.50 |
| gemini-2.5-flash | ~0.30 | ~2.50 |
| gemini-2.5-flash-lite | ~0.10 | ~0.40 |

(The chain's tail is ≈15–22× cheaper than the default.)

Mechanics (HIGH confidence): implicit cache ~90% off a repeated prefix, no code needed once the prefix is stable ·
explicit `cachedContent` gives the same discount plus an hourly storage fee with a ~32k floor — fallback only ·
Batch 50% off, async ≤24 h · **no "developer discount" tier exists** (the "Developer API" is just the AI-Studio
product name) · AI-Studio vs Vertex per-token parity (Vertex sells SLA/compliance, not savings) ·
grounding-with-Search ~5k free prompts/month · embeddings $0.15/M (batch $0.075/M).

## 10. Open caveat

The `gemini-embedding-001` request shape was confirmed **from docs, not a live call** — verify it on the first
Developer → "Reindex AI search" run before trusting semantic search.
