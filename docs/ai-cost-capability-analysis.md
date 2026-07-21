# AI Cost + Capability Analysis — target architecture and migration plan

> Written 2026-07-21. Technical reference for future AI-layer work. Companion to the
> four research passes run this session (Gemini pricing mechanics, ai-proxy token audit,
> 2026 Gemini capability scan, app-specific AI feature ideation). Everything quantified
> here was measured against the real code (`char count ÷ 4 ≈ tokens`) or researched with
> sources; confidence flags are stated where numbers could not be verified against
> Google's primary pricing page (403 from the sandbox).
>
> **The brief this answers:** reduce AI spend WITHOUT reducing capability — capability
> must go UP at the same time. Live data access during chat is mandatory, but we cannot
> pre-write a query for every possible question. Compare all data-access approaches,
> pick one, plan the migration.

---

## 1. Current state and problems

### What exists (verified in code)

| Piece | Where | Role |
|---|---|---|
| `ai-proxy` edge function | `supabase/functions/ai-proxy/index.ts` (~99 KB) | Gemini tool-loop (≤16 turns), 4-model fallback chain, structured mode, fetchUrl mode |
| Generic DB tool layer | `DB_CATALOG` + `db_query/insert/update/delete` + `describe_database` | AI reads/writes ~40 allow-listed tables, always `user_id`-scoped, no raw SQL |
| Special tools | transit, calendar, media, health, shop, Hevy routines (~20 declarations) | Things generic CRUD can't express |
| Client prompt assembly | `src/features/ai/api/aiApi.ts` | `SYSTEM_PROMPT` (~3,270 tok) + `buildContext()` live-data dump baked into the system prompt |
| Coach chat | `coachContext.ts` (~1,800+ tok 30-day JSON) | Same baking pattern |
| One-shot surfaces | daily briefing, PT assessment, recipe extraction | No tool loop; already lean |

### The problems, ranked by measured cost impact

**P1 — The cache-buster (the single biggest cost driver).**
`aiApi.ts:268` bakes volatile live data INTO the system prompt:

```ts
const systemWithContext = `${SYSTEM_PROMPT}\n\n---\nLIVE DATA:\n${context}`
```

Gemini's implicit caching (automatic, ~90% discount on a repeated byte-identical
prefix, min ~1,024 tokens on Flash) can never hit, because the prefix changes with
every message. Result: the ~7,270-token fixed block (system ~3,270 + serialized
`TOOLS` ~4,000) is billed at FULL price on **every turn of every tool loop**. A
4-tool-call answer re-ships ~29k fixed-overhead tokens. This is where the money goes.

**P2 — All ~20 tools on every surface.** `callGemini` always sends the full `TOOLS`
array (`index.ts:674`, `baseBody = { tools: TOOLS }`). Shop chat uses ~5 of them
(~900 tok needed vs ~4,000 sent); coach chat needs ~4. Multi-turn, so re-billed per turn.

**P3 — Context sent even when useless.** `buildContext()` (~300–1,500 tok of
tasks/media/schedule/workouts) is prepended unconditionally — including transit-only
questions where the prompt itself tells the model to call `plan_trip` directly.
(Long-flagged in CLAUDE.md as an unshipped win; confirmed still unshipped.)

**P4 — Default model is the most expensive in the chain.** `MODEL_CHAIN` starts at
`gemini-3.5-flash` (~$1.50/M input, ~$9/M output — MEDIUM confidence). The chain's tail,
`gemini-2.5-flash-lite` (~$0.10/$0.40), is ~15–22× cheaper. Falling back on a 503
currently makes calls *cheaper*, which is backwards as a default for simple surfaces.

**P5 — Capability gaps (why "the current AI feels insufficient").** No multimodal
input (message content is plain text, `index.ts` `parts:[{text}]`), no semantic recall
("the recipe I saved last month" is impossible — `db_query` only does exact/ilike),
no aggregation primitive (any "average/trend/compare" question forces the model to pull
row dumps into context and do arithmetic in-head — expensive AND error-prone), no
scheduled analysis beyond the daily briefing.

### What is already RIGHT (do not churn)

- `DB_CATALOG` is **on-demand** (behind `describe_database`), not in the prompt. Correct.
- The tool loop already runs `thinking_level: MINIMAL` on 3.x (`index.ts:682`), built
  per-model (the 2.5-tier 400 bug is fixed). Thinking tokens are NOT the main leak.
- Structured mode (`callGeminiStructured`) sends no tools. Lean.
- The daily briefing is once/day + localStorage-cached. Low impact.
- The one-shot `plan_trip` latency design (resolve-in-tool, no investigate-first turns).

---

## 2. Goals and constraints

1. **Capability strictly up**: photo input, semantic recall, real aggregation, weekly
   cross-domain review. "Cheaper but dumber" is explicitly rejected.
2. **Cost down**: attack P1–P4; target ≥60–80% reduction in billed input tokens per
   interaction (mechanically achievable from caching + tool scoping + context gating alone).
3. **Live data access stays mandatory** — and must NOT require pre-writing a query per
   scenario. The generic layer is the answer; it gets *stronger*, not replaced.
4. **No security regression**: allow-list, `user_id` force-scoping, no DDL, no raw SQL
   from the model, confirm-before-delete stay non-negotiable.
5. Single-user scale today, but nothing that collapses if usage 10×es.

---

## 3. Cost sources — full inventory

For each: why it exists · how to measure · how to reduce · what reducing loses · compensation.

| Source | Why | Measure | Reduce | Loss | Compensation |
|---|---|---|---|---|---|
| **LLM input tokens** | Prefix re-billed uncached (P1/P2/P3) | Gemini `usageMetadata` per response (log it — see §12 T8) | Stable prefix → implicit cache; tool slices; context gating | None if done right | — |
| **LLM output tokens** | Answers + thinking | same | Already MINIMAL thinking in loop; keep answers concise via prompt | Over-terse answers | Per-surface style rules |
| **Model tier** | 3.5-flash default everywhere | which model served (already reported) | Route simple surfaces to cheaper models | Quality dips on hard tasks | Routing + escalation (§8) |
| **Embeddings** (future) | Semantic recall corpus | rows × avg tokens × $0.15/M (batch $0.075/M) | Batch API for backfill (50% off); embed-on-write after | None | — |
| **DB queries** | Supabase free tier | Dashboard usage | Nothing to do — free tier headroom is large single-user | — | — |
| **Edge functions** | Free tier: 500K invocations/mo | Dashboard | Non-issue at this scale | — | — |
| **Storage/transfer** | Supabase free 1 GB / GH Pages free | Dashboard | health_metrics grows ~hourly-grain now (post-wipe); fine for years | — | Archive/prune old raw jsonb if ever needed |
| **Background jobs** | crons (google-health-sync 15min) | invocation logs | Already sized (research: >15min gains nothing) | — | — |
| **Logging** | `app_error_logs`, `audit_logs` | row counts | 30-day audit sweep already exists | — | — |
| **3rd-party APIs** | TMDB/EnTur/OFF/Kassalapp/Hevy/Google | all free tiers | — | — | — |
| **Scale-up risk** | tokens scale linearly with users | usageMetadata sums | The same fixes (cache/scoping) scale linearly too | — | Batch + explicit cache become worth it at volume |

**Bottom line:** the ONLY materially non-zero bill is Gemini tokens, and within that,
uncached input-prefix re-billing (P1) dominates. Everything else in the stack rides
free tiers with large headroom at single-user scale.

---

## 4. Alternative architectures for live data access

The core tension: chat must reach ANY of the user's data on demand, but we can't
pre-author a query per question, and we must not dump whole tables into context.

| Option | What it is | Gains | Losses/risks | Verdict |
|---|---|---|---|---|
| **A. Status quo** (generic CRUD tools + baked context) | what we have | works today | P1–P5; row-dumps for analytics | Baseline, not acceptable |
| **B. Cache-aligned tool-first** (keep generic CRUD; fix prompt assembly; add `db_aggregate`; per-surface tool slices) | evolution of A | ≥60–80% input-cost cut; analytics without row dumps; zero security change | none functional; small refactor risk | ✅ **CHOSEN** |
| **C. AI-generated raw SQL** | model writes SQL, we execute | maximal flexibility, no per-scenario code | runs under service role → RLS bypass; injection surface; wrong-JOIN silent errors; validation layer ≈ rebuilding the structured layer anyway | ❌ Rejected — risk buys nothing B doesn't give |
| **D. Semantic/metric layer** (named metrics registry: "protein_today", "sleep_avg_7d"…) | curated metric catalog the AI calls by name | precise, cheap, self-documenting | it's exactly the "pre-write every scenario" trap — unbounded authoring burden | Partial adopt: ship a FEW hot metrics as SQL RPCs (§7.3), never as the primary path |
| **E. Frontend-executed queries** (AI returns a query plan; browser runs it under the user's own JWT/RLS) | true RLS enforcement | extra round-trips per tool call (browser↔edge↔browser), latency ×N in a 16-turn loop; complex protocol | ❌ Rejected for chat; NOTE: the app's own UI already IS this layer for known views |
| **F. RAG/embeddings-first** (retrieve chunks, no live queries) | great recall | embeddings are STALE copies — "how many kcal today" needs live SQL, not similarity | Adopt as a COMPLEMENT for fuzzy recall only (§7.4), never for current-state questions |
| **G. Precomputed summaries** (nightly aggregate tables / materialized views) | cheap reads for AI + briefing | staleness (yesterday's rollup ≠ "today so far"); more moving parts | Partial adopt later: a nightly `daily_rollups` table is the natural substrate for the weekly review; not needed for v1 |

**Decision: B, with D/F/G as targeted complements.** The generic structured layer
(`db_query` + new `db_aggregate`) remains the universal answer to "any question, no
pre-written SQL"; hot paths get RPCs; fuzzy memory gets embeddings; periodic analysis
gets precomputed rollups. Raw SQL generation and frontend query execution are rejected.

---

## 5–6. Gains, losses, and compensation (chosen architecture)

| Change | Gain | Loss | Compensation |
|---|---|---|---|
| Stable prefix (context out of system prompt) | ~90% off ~7.3k tok/turn once cache hits | Cache only hits when calls repeat within Google's implicit-cache window; sporadic use may miss | Even on a miss we bill the same as today — strictly ≤ current cost. If billing shows misses dominate, explicit `cachedContent` is the deterministic fallback (storage fee noted, MEDIUM conf ~$1–4.5/M-tok/h) |
| Context gating (skip live dump for transit/simple) | 300–1,500 tok/req | Model may lack context it silently used before (e.g. "plan after my last meeting" asked in "simple" mode) | Misclassification safety: the model can ALWAYS pull data via `db_query`; gate errs toward including context when intent is ambiguous; keep a one-line date/time header always |
| Per-surface tool slices | ~3k tok/turn on shop/coach | A surface can't use an unlisted tool (user asks shop-AI a calendar question) | `general` slice remains the superset default; slices only for surfaces with a hard persona (shop, coach); measure before slicing more |
| Model routing (cheap default for simple surfaces) | ~15–22× on routed calls | Quality regression risk on routed surfaces | Explicit picker already exists; escalation rule (§8); route ONLY surfaces with structurally simple jobs (shop parsing, classification) — general chat stays 3.5-flash |
| `db_aggregate` tool | Analytics answers without row dumps (both cheaper AND more correct — SQL does the math, not the model) | New tool = new attack surface | Same guardrails as db_query: allow-listed tables/columns, enum'd ops, forced user_id, LIMIT on group count |
| Photo→log (vision) | Biggest UX capability jump; ~1k tok/image ≈ negligible | Estimation accuracy on plates is genuinely rough | UI presents result as EDITABLE prefill (same as barcode flow), never auto-saves; label photos are near-exact |
| Embeddings/pgvector | Fuzzy recall works at all | New infra; corpus staleness; embed cost | Batch backfill at 50%; embed-on-write triggers keep it fresh; scope v1 to 4 text-rich tables |
| Weekly review (scheduled) | Cross-domain insight (training×nutrition×sleep) — the Fitbit payoff | One more cron + table | Reuses briefing pattern exactly; Batch-eligible if ever needed |

---

## 7. Live data access design (the core)

### 7.1 Prompt assembly — the fix for P1

```
BEFORE (every request, cache-hostile):
  systemInstruction = SYSTEM_PROMPT + "LIVE DATA:" + volatile dump
  tools             = ALL TOOLS

AFTER (cache-aligned):
  systemInstruction = SYSTEM_PROMPT          ← byte-identical forever
  tools             = TOOL_SLICES[surface]   ← byte-identical per surface
  contents[0]       = { role:'user', parts:[{ text:
                        "CONTEXT (auto-attached, not typed by the user):\n" + dump }] }
  contents[1..]     = real chat history
```

Rules: never interpolate timestamps/dates into `SYSTEM_PROMPT` (instant cache-buster —
current date goes in the context part); serialize `TOOLS` deterministically (stable key
order); one shared const per slice.

### 7.2 The universal query layer (already ours) + `db_aggregate`

`db_query` stays the generic "any table, any filter" read. What it cannot do is
aggregate — today "average protein this month" → model pulls 30–90 rows into context
and averages them itself (token-expensive, arithmetic-unreliable). New tool:

```jsonc
// db_aggregate — SQL does the math; the model never sees raw rows
{
  "table": "food_log_entries",          // must be in DB_CATALOG (any access level)
  "metrics": [                          // enum'd ops only — no expressions
    { "op": "sum|avg|min|max|count", "column": "protein_g", "as": "avg_protein" }
  ],
  "filters": { "status": "eaten", "date": { "gte": "2026-07-01" } },  // same grammar as db_query
  "group_by": ["date"],                 // optional; columns validated against catalog
  "order_by": "date", "limit": 100      // hard cap ≤ 366 groups
}
```

Implementation: build a PostgREST aggregate select (`select=date,protein_g.avg()` —
supported since PostgREST v12/13, verify the hosted flag; else a single generic
`SECURITY DEFINER` RPC that assembles the aggregate from validated identifiers —
identifiers checked against DB_CATALOG, values parameterized, `user_id` forced, so it
is NOT raw SQL). Either way the model sends ~80 tokens and receives ~50, replacing
row dumps of 1k–10k tokens. **This one tool is what makes "no pre-written query per
scenario" true for analytics, not just lookups.**

### 7.3 Hot-path RPCs (semantic layer, deliberately tiny)

Only for questions asked near-daily where one call should return a composed picture:

```sql
-- get_day_summary(p_date): one row the AI reads instead of 5 tool calls
create or replace function ai_day_summary(p_user uuid, p_date date)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'tasks_open',   (select count(*) from tasks where user_id=p_user and due_date=p_date and status not in ('done','cancelled')),
    'kcal_eaten',   (select coalesce(sum(calories),0) from food_log_entries where user_id=p_user and date=p_date and status='eaten'),
    'protein_g',    (select coalesce(sum(protein_g),0) from food_log_entries where user_id=p_user and date=p_date and status='eaten'),
    'blocks',       (select count(*) from time_blocks where user_id=p_user and date=p_date),
    'workout_done', exists(select 1 from hevy_workouts where user_id=p_user and start_time::date=p_date));
$$;
```

Cap this catalog at ~3–5 functions (day summary, week training load, sleep window).
Anything beyond → `db_aggregate`. This keeps D's precision without D's authoring trap.

### 7.4 Semantic recall (complement, not substitute)

```sql
create extension if not exists vector;
create table ai_embeddings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_table text not null,      -- 'recipes' | 'pt_assessments' | 'dev_requests' | 'work_notes'
  source_id text not null,
  content text not null,           -- the embedded text (title + body, chunked if long)
  embedding vector(768) not null,  -- gemini-embedding-001, Matryoshka-truncated to 768
  updated_at timestamptz not null default now(),
  unique (user_id, source_table, source_id)
);
create index on ai_embeddings using hnsw (embedding vector_cosine_ops);
```

- Backfill via **Batch API** (50% off — this is the one place batch genuinely pays here).
- Freshness: embed-on-write from the API layer (or a 15-min cron sweep of `updated_at`).
- New tool `semantic_search(query, sources?, limit≤8)` → embed the query server-side →
  cosine top-k → return `{source_table, source_id, snippet, score}` — the model then
  `db_query`s the live row by id. **Embeddings locate; live SQL answers.** Never use
  similarity results as the factual value of anything current-state.

### 7.5 Decision ladder the system prompt teaches

```
current value / list?          → db_query
average / trend / compare?     → db_aggregate
"the whole day/week picture"?  → hot-path RPC tool
"that thing I wrote/saved…"?   → semantic_search → db_query by id
write?                         → db_insert/update/delete (+ confirm rules, unchanged)
external world?                → special tools (transit/calendar/media/…)
```

---

## 8. Model and tool strategy

| Surface | Start model | thinking_level | Tool slice | Rationale |
|---|---|---|---|---|
| General chat | gemini-3.5-flash | MINIMAL (as today) | full | Quality-critical, unpredictable questions |
| Coach chat | 3.5-flash | MINIMAL loop / consider MEDIUM final | coach (db_query, db_aggregate, semantic_search, 2× hevy) | Reasoning quality matters |
| Shop chat | **2.5-flash / 3.1-flash-lite** | MINIMAL | shop (5 tools) | Structurally simple; 5–15× cheaper |
| Structured extraction | 3.5-flash | MINIMAL (as today) | none | responseSchema does the discipline |
| Briefing / PT assessment | 3.5-flash | MEDIUM (quality ↑, 1×/day so cost ≈ 0) | none | Capability-up lever, nearly free |
| Weekly review (new) | 3.5-flash | HIGH | none (context pre-gathered) | 1×/week; depth is the point |

Escalation: user picker already overrides; add prompt rule — if a cheap-routed surface
detects it's out of depth, say so; the UI hint "retry with a stronger model" is enough
at single-user scale (no auto-escalation machinery needed yet).

Fallback chain: unchanged for reliability; routing only changes the *starting* model
(existing `model` param mechanism — zero new plumbing).

Batch API: interactive = never. Reserved for: embeddings backfill (real win),
future bulk enrichment jobs. Not worth it for the single daily briefing.

---

## 9. Security and authorization (invariants — none relaxed)

1. Allow-list only (`DB_CATALOG`); token/secret/auth tables unreachable. `db_aggregate`
   validates table AND every column/op against the catalog; ops are enum'd, never expressions.
2. Every op force-scoped to `user_id` server-side (model never supplies it).
3. No raw SQL from the model — option C rejected; the RPC variant of db_aggregate builds
   SQL from validated identifiers + parameterized values only.
4. `security definer` RPCs: `set search_path = public`, `p_user` injected by the edge
   function from auth, never from the model.
5. Write guardrails unchanged: announce before create/update/delete; explicit user
   confirmation before ANY delete.
6. `semantic_search` returns only the caller's rows (user_id filter in the vector query).
7. Timeouts/limits: db_aggregate `limit ≤ 366` groups; vector `limit ≤ 8`; existing
   16-turn loop cap stays.

---

## 10. Recommended final architecture

```
Client (aiApi.ts)
  ├─ surface tag ('general'|'coach'|'shop'|…)
  ├─ STABLE SYSTEM_PROMPT (no interpolation)          ─┐ cache-aligned prefix
  └─ context as contents[0] user part (gated by need)  ─┘
        │
ai-proxy (edge)
  ├─ TOOL_SLICES[surface] (deterministic serialization)
  ├─ MODEL routing table + existing fallback chain + per-model thinking
  ├─ tools: db_query · db_insert/update/delete · db_aggregate (NEW)
  │         · hot-path RPC tools (≤5) · semantic_search (NEW) · special tools
  ├─ vision: image parts accepted → structured extraction (photo→food/label/receipt)
  └─ usageMetadata logging → ai_usage_log (measure everything)
        │
Postgres
  ├─ DB_CATALOG-governed tables (unchanged)
  ├─ ai_day_summary()-class RPCs (≤5)
  ├─ ai_embeddings (pgvector, 768-dim)  ← batch backfill + embed-on-write
  └─ (later) daily_rollups for the weekly review
Scheduled
  ├─ daily briefing (existing) · weekly review (new, cron + table)
```

---

## 11. Migration plan

**Phase 1 — cost core (no schema, no manual steps, one PR):**
stable prefix + context-as-first-message · context gating · TOOL_SLICES ·
model routing for shop · usageMetadata logging (needs tiny `ai_usage_log` migration or
reuse app_error_logs-style insert). Verify: token counts in the log drop; behavior parity
on a scripted question set (transit, food lookup, task create, shop add).

**Phase 2 — analytics capability:** `db_aggregate` + prompt ladder (§7.5) +
`ai_day_summary` RPC. Verify: "average protein last 2 weeks" answers with ONE tool call
and zero row dumps; numbers cross-checked against the Food UI.

**Phase 3 — vision:** image part end-to-end (client capture → edge → Gemini) + photo→food
structured extraction prefilling FoodLogModal (editable, never auto-saved). Reuses the
barcode UX contract.

**Phase 4 — memory + proactive:** pgvector migration + batch backfill + `semantic_search`
tool · weekly review cron + surface. (Explicit `cachedContent` only if Phase-1 billing
data shows implicit misses dominate.)

Rollback: each phase is independent; Phase 1 keeps a `legacy_prompt` escape flag for one
release in case cache-alignment regresses answer quality anywhere.

---

## 12. Prioritized tasks

| # | Task | Phase | Size |
|---|---|---|---|
| T1 | Stable prefix: context → `contents[0]`; de-interpolate SYSTEM_PROMPT | 1 | S |
| T2 | Context gating (transit/simple heuristic; always-keep date line) | 1 | S |
| T3 | TOOL_SLICES per surface + deterministic serialization | 1 | S |
| T4 | Shop routing → cheaper start model | 1 | S |
| T5 | `ai_usage_log` + usageMetadata capture (the measurement backbone) | 1 | S |
| T6 | `db_aggregate` tool (validation + PostgREST-aggregate or RPC builder) | 2 | M |
| T7 | `ai_day_summary` RPC + tool + prompt ladder | 2 | S |
| T8 | Vision pipeline + photo→food prefill | 3 | M |
| T9 | pgvector + batch backfill + `semantic_search` | 4 | M–L |
| T10 | Weekly review cron + table + Home surface | 4 | M |

Manual-apply steps (user): migrations for T5/T9/T10; redeploy `ai-proxy` at each phase.

---

## 13. Key implementation sketches

**T1 (aiApi.ts):**
```ts
// BEFORE: const systemWithContext = `${SYSTEM_PROMPT}\n\n---\nLIVE DATA:\n${context}`
const contents: Message[] = needsContext(userText)
  ? [{ role: 'user', content: `CONTEXT (auto-attached):\n${await buildContext()}` },
     { role: 'model', content: 'Noted.' }, ...messages]
  : [{ role: 'user', content: `Today: ${todayLine()}` },
     { role: 'model', content: 'Noted.' }, ...messages]
return invokeAI(contents, SYSTEM_PROMPT, model, surface)   // system prompt now constant
```

**T3 (ai-proxy):**
```ts
const TOOL_SLICES: Record<Surface, AnyRecord[]> = {
  general: TOOLS,
  shop:    pick(TOOLS, ['get_shop_categories','create_shop_category','create_shop_item',
                        'ask_clarifying_question','db_query']),
  coach:   pick(TOOLS, ['db_query','db_aggregate','semantic_search',
                        'update_hevy_routine','create_hevy_routine']),
}
const baseBody = { tools: TOOL_SLICES[surface] ?? TOOLS }
```

**T5 (migration):**
```sql
create table ai_usage_log (
  id bigint generated always as identity primary key,
  user_id uuid not null, surface text not null, model text not null,
  prompt_tokens int, cached_tokens int, output_tokens int, tool_turns int,
  created_at timestamptz not null default now());
-- cached_tokens comes from usageMetadata.cachedContentTokenCount → this column is
-- the PROOF of whether Phase 1 worked, and the trigger for explicit caching if not.
```

**T8 (vision request part, edge):**
```ts
parts: [{ inline_data: { mime_type: 'image/jpeg', data: base64 } },
        { text: 'Identify foods and estimate per-item grams + macros.' }]
// + responseSchema → the same editable-prefill contract as the barcode flow
```

---

## Appendix — pricing snapshot (July 2026, MEDIUM confidence, verify on live billing)

| Model | In $/M | Out $/M |
|---|---|---|
| gemini-3.5-flash (current default) | ~1.50 | ~9.00 |
| gemini-3.1-flash-lite | ~0.25 | ~1.50 |
| gemini-2.5-flash | ~0.30 | ~2.50 |
| gemini-2.5-flash-lite | ~0.10 | ~0.40 |

Mechanics (HIGH confidence): implicit cache ~90% off repeated prefix, ≥~1k tok, no code
needed once prefix is stable · explicit cachedContent same discount + hourly storage fee,
~32k floor — fallback only · Batch API 50% off, async ≤24h, useless interactively ·
no "developer discount" tier exists (the "Developer API" is just the AI-Studio product
name) · AI-Studio vs Vertex per-token parity (Vertex adds SLA/compliance, not savings)
· grounding-with-Search ~5k free prompts/mo · embeddings $0.15/M (batch $0.075/M).
