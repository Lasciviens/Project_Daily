# AI phase 1 — the app helper's working notes

Saved 20.11.2026, mid-work, so a new session can pick up. The contract is `docs/features/ai-plan.md` plus the build contract the lead keeps in the repo. This file is working notes, not the feature's description: that goes in `docs/features/ai.md` when the work is done.

## 1. Done and checked

Only one check has run so far: `npx tsc --noEmit -p tsconfig.app.json`, clean, after the files in this list were written. Nothing has been looked at in a browser yet.

- `src/features/ai/claude/types.ts` — the contract's shapes (`Describe`, `CallSummary`, the reasons, the ledger rows).
- `src/features/ai/claude/claudeApi.ts` — `runClaudeJob`, `describeClaude`, `ClaudeJobError`.
- `src/features/ai/claude/ledgerApi.ts` — `ai_usage`, the `ai_calls` page and one call with its text, `ai_settings` and `ai_job_settings` read and upsert, with the missing-table guard for migration 194.
- `src/features/ai/claude/hooks/useClaude.ts` — one hook per read and per write.
- `src/shared/query/keys.ts` (`qk.claude`, `qk.aiCalls`), `invalidate.ts` (groups `aiLedger`, `aiSettings`), `persistRules.ts` (`ai-calls` in `NEVER_KEPT`).
- `src/features/developer/developerBoards.ts` — the five views' boards, `parseAiView`, and `anthropic` in the Connections board.
- `src/features/developer/pages/DeveloperPage.tsx` — the AI tab (lazy), one header width for every tab.
- `src/features/developer/components/ai/` — `AiTab`, `AiOverview`, `AiCostChart`, `AiCalls`, `AiCallRows`, `AiSettingsView`, `AiJobSettingsCard`, `AiPrices`, `aiBits`, `aiGlossary`.
- `src/shared/components/SegmentedControl.tsx` — new `fit` and `label` options.
- `src/features/ai/api/aiApi.ts` — `fillItemFields` removed.
- `src/features/settings/apiRegistry.ts`, `subscriptionRules.ts`, `components/SubscriptionBits.tsx` — Gemini became Anthropic.
- `src/features/developer/components/ConnectionsTab.tsx` — the read-only Anthropic card.
- `src/features/developer/components/activityLogMeta.ts` — names for `ai_settings` and `ai_job_settings` in Activity.

## 2. Written but not checked yet

Edited after the last `tsc` run, so not even type-checked:

- `src/features/ai/claude/ledgerRules.ts` — `logParts` now marks short values (`block`), `jobTitleOf`, `modelNameOf`.
- `src/features/developer/components/ai/AiCallDetail.tsx` — draws short logged values as a list, long ones as text blocks.
- `src/features/developer/components/ai/AiHowItWorks.tsx` — a job's features as a list instead of chips.
- `src/shared/components/plan-modal/useItemFill.ts` — calls `runClaudeJob('item_fill', { text })`; `fillFailureText`.
- `src/shared/components/plan-modal/UnifiedPlanModal.tsx` — changelog entry v26 (a comment only).
- `scripts/verify-query-persist.cjs` — expects `ai-calls`; not run yet.
- `scripts/harness/claude.cjs` — the `claude` function mock (`claudeMock`); written, not wired into `functions.cjs`, never run.

## 3. Still to do, in order

1. **Harness.**
   - `scripts/harness/functions.cjs`: add `claude: claudeMock()` from `claude.cjs`; reword the `ai-proxy` comment (it no longer answers ✨).
   - `scripts/harness/seed.cjs`: `tables.ai_calls` (about 14 rows over 9 days with `callRow` from `claude.cjs`: mostly `ok`, one each of `refused`, `cut_off`, `invalid`, `error`, `budget`, `off`, `bad_input`, `not_configured`; two on `claude-sonnet-5-5`; the newest with `request` / `response` / `thinking`, the two oldest with them null), `tables.ai_settings` (one row: 5, true, 30), `tables.ai_job_settings` (one row for `item_fill`, own budget 1).
   - `scripts/harness/rpc.cjs`: `ai_usage(p_from, p_to)` grouped by Oslo day, job, mode and model from the context's `ai_calls`.
   - `scripts/harness/README.md`: the `functions` option's example names `claude`, not `ai-proxy`'s itemFill; add AI to the data table.
2. **The pure check:** write `scripts/verify-ai-ledger-ui.cjs` (sucrase, the shape of `scripts/verify-subscriptions.cjs`) for `ledgerRules.ts`: `formatUsd` rounding, `osloMonthRange` across a month end and both clock changes (March 2026 is 743 hours, October 745), `totalsByJob` / `totalsByDay`, `budgetProgress` tones, numeric strings through `num`, an unknown outcome, `readRunAnswer` with an unknown reason, `sourceUrl` and `priceSourceUrl` refusing odd input.
3. **Checks that read my files:** `scripts/verify-feature-boards.cjs` (the Connections checks hard-code the card list: add `anthropic`; add the four AI boards to "every layout is valid" and check they are as wide as `LIST_DETAIL_BOARD` at every step), `scripts/verify-page-board.cjs` (the Developer page's line says "every tab is the same list + detail board": now "one cap for every tab and view (sectionsWidthRem)"), `scripts/verify-layout-shift.cjs`, `scripts/verify-api-registry.cjs`, `scripts/verify-subscriptions.cjs`, `scripts/verify-no-personal-data.cjs`, `scripts/verify-truncate-and-motion.cjs`, `scripts/verify-bundle-budget.mjs` (after a build).
4. **Look at it** on the harness at 402×874, 874×402 and 1469×680: the five views, an opened call, ✨ on the item screen (a fill, and the `not_configured` sentence). Fix what is squashed, overlapping or wrapping.
5. **Docs:** `docs/features/ai.md` (a section for the Claude layer's app side; mark the rest as the old assistant), `docs/features/developer.md` (the AI tab), `docs/features/settings.md` (the Anthropic card; Gemini out of the lists), `docs/features/README.md`, `docs/design/THEME.md` (`SegmentedControl`'s `fit`).
6. **Before reporting:** `tsc`, `eslint`, `npm run build`, the bundle budget, the new check and every check touched.

## 4. Decisions, and why

### Where the contract or the brief is not followed to the letter

- **✨ shows the function's own sentence for every reason,** not only `off`, `budget`, `busy`, `not_configured` and `refused`. The contract says the message is "one plain English sentence the app shows as it is", and the function's sentences for `cut_off` ("Raise the longest answer for this job…") and `error` say what to do. Only a failure with no sentence at all says "Couldn't fill the fields — try again in a moment".
- **A read-only Anthropic card was added on Settings → Subscriptions.** Gemini never had a card there. The brief says "server-configured: a read-only card, never a Connect button", and `AGENTS.md` puts every integration's status on that page. It shows "Key set" or "Key not set" from `describe` and links to Developer → AI. Its text is the same whatever the answer, so nothing moves when it lands.
- **The glossary is the app's own text** (`aiGlossary.ts`): `Describe` has no glossary field.
- **The text log is drawn generically** (`logParts`): the contract does not fix the shape of `ai_calls.request` and `response`. It reads the function's current shape (`model`, `effort`, `instructions`, `user_text`, `answer_schema`; `text`) and any other object, list or string.
- **A `service_subscriptions` row saved with the service `gemini`** now shows the plain word "gemini" as its label: the known-services list has `anthropic` instead. No stored data is changed.

### How the five views are built

- **The view switch sits under the page's bar,** in `?view=` (Overview has no parameter). In the bar it would add a row to Activity, Errors and Memory on a phone. It is a `SegmentedControl` with the new `fit` option: with equal shares "How it works" made five segments 520 px wide. Not yet seen at 402 px: it sits in a `scroll-x` box in case it is too wide.
- **Every view has the list + detail tabs' tracks** (two from the laptop, three from 1920, then it stops), so the header keeps one width on every tab and view (`sectionsWidthRem`).
- **The AI tab loads on demand** (`lazyPart`, `SkeletonTab`): the chart library would otherwise go into the Developer page's first download (budget 400 kB).
- **Overview:** the budget bar is green, amber from 80 % and red at the budget — tones, never the accent. "Over" is cost at or past the budget, the function's own wall, so a budget of $0 reads as reached. The cost-per-job list shows every job the function has, also with no calls, so its length does not depend on usage. "Cache saved" is the saving on reads minus the extra cost of writes, and can be below zero right after the first call. The chart has one bar per Oslo day from the 1st to today.
- **Calls:** 50 a page with Newer / Older under the list; two filters (job, outcome), both plain equality reads. The list never downloads the text columns; a call's text is read when it is opened. The page's own pattern: a row opens in place on a phone and in the pane from the laptop.
- **Settings:** one Save per card, enabled only when something changed and is valid. An empty number field is "Default" (null in the database), with the default in the placeholder. A stored model or effort the function no longer offers stays visible as "(not offered — the default is used)".
- **Prices:** one block per model, side by side where they fit, instead of a six-column table that cannot fit a phone.
- **How it works:** the instructions and the answer schema are closed until opened (Headless UI `Disclosure`); source files link to GitHub only when the path is a plain repo path (`sourceUrl`).
- **Money:** two decimals from a dollar up and for whole cents, four below a dollar, six in a call's detail and the worked example.
- **Security:** a call's text is drawn as a text node in a `<pre>`, never as HTML or a link. The price source is a link only for an https address on one of Anthropic's own hosts (exact host match). The calls' query root is never kept on the device; the month's numbers, the settings and `describe` hold no text and are kept.

## 5. Problems and open questions

- `verify-api-registry` needs `supabase/functions/claude/` to exist (it does now) and, once committed, the entry's `since` (`20.11.2026`) to equal the first commit day of `supabase/functions/claude/index.ts`. If that file is first committed on another day, change `since`.
- `src/features/items/itemFill.ts` still exports `ITEM_FILL_SCHEMA` (the function helper's file). Nothing in `src/` imports it.
- The Developer page keeps its "Reindex AI search" button: it belongs to the old assistant, which stays until phase 4.
- The registry entry's `usedIn` points ✨ at `/daily`: the item screen has no address of its own.
- Not decided with the owner: whether the AI tab should come first on the Developer page. It is last now.

## 6. Commands

Start the app on the mock backend (leave it running):

```sh
VITE_SUPABASE_URL=https://mock.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=mock-publishable \
VITE_TMDB_API_KEY=mock VITE_GOOGLE_CLIENT_ID=mock-client.apps.googleusercontent.com \
npx vite --port 5191 --strictPort --host 127.0.0.1
```

The page: `http://127.0.0.1:5191/Project_Daily/#/developer?tab=ai` (then `&view=calls`, `settings`, `prices`, `how`). In a Playwright script: `installMocks(context, { tables, functions })` and the session in localStorage `sb-mock-auth-token` (`SESSION` from `scripts/harness/mock-server.cjs`); `scripts/audit-cls.mjs` shows the exact calls. A stopped ✨: `functions: { claude: claudeMock({ stop: 'not_configured' }) }` from `scripts/harness/claude.cjs`.

The checks:

```sh
npx tsc --noEmit -p tsconfig.app.json
npx eslint src scripts/harness scripts/verify-ai-ledger-ui.cjs
npm run build
node scripts/verify-bundle-budget.mjs
node scripts/verify-ai-ledger-ui.cjs
node scripts/verify-query-persist.cjs
node scripts/verify-feature-boards.cjs
node scripts/verify-page-board.cjs
node scripts/verify-layout-shift.cjs
node scripts/verify-api-registry.cjs
node scripts/verify-subscriptions.cjs
node scripts/verify-no-personal-data.cjs
```
