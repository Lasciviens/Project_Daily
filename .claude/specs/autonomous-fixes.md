### Problem
Several small-to-medium correctness, security, mobile UX, and performance issues have been identified across the codebase that do not require user decisions to resolve.

### Solution
Two PRs. PR-1 batches all quick, low-risk fixes (touch targets, staleTime, security hardening, console.log cleanup, swapTaskOrder rollback). PR-2 is the medium work-page feature (waiting_for inline edit).

---

## PR-1: Quick fixes — branch `claude/quick-fixes`

All tasks below are independent and can run in parallel on the same branch. One commit per logical group, then a single `npm run build` before pushing.

---

### Task 1 — security: news-proxy image domain allowlist
**Agent:** guardian
**File:** `supabase/functions/news-proxy/index.ts`

Current state: the GET image-proxy path only checks `protocol === 'https:'` and relies on CORS. CORS is not a server-side access control — any server-side caller (curl, another Edge Function) can hit this endpoint without an Origin header and the function will proxy any HTTPS URL on the internet.

Fix: extract image-serving domains from `ALLOWED_FEED_DOMAINS` (or a separate `ALLOWED_IMAGE_DOMAINS` list) and block requests whose hostname is not on the list. The function already has the pattern in the POST path — mirror it.

```ts
// Derive allowed image domains from the same feed allowlist + known CDNs
const ALLOWED_IMAGE_DOMAINS = [
  'www.vg.no', 'vgc.no', 'akamaized.net',       // VG
  'ichef.bbci.co.uk', 'news.bbci.co.uk',          // BBC
  'www.cnnturk.com', 'i.cnnturk.com',             // CNN Türk
]
// In the GET handler, after parsedUrl is constructed:
if (!ALLOWED_IMAGE_DOMAINS.some(d => parsedUrl.hostname === d || parsedUrl.hostname.endsWith('.' + d))) {
  return new Response(JSON.stringify({ error: 'Image domain not allowed' }), { status: 403, ... })
}
```

Note: this is an Edge Function — deploy manually via Supabase Dashboard after the PR merges. Add a comment in the file.

---

### Task 2 — correctness: swapTaskOrder onError rollback
**Agent:** debug
**File:** `src/features/todo/hooks/useTodos.ts`

Current state: `useSwapTaskOrder` calls `swapTaskOrder(id1, id2)` which does two independent Supabase `.update()` calls in `Promise.all`. If the second call fails after the first succeeds, the sort order is left in a corrupt state. The hook has no `onError` handler.

Fix 1 (in `tasksApi.ts`): after the `Promise.all`, check both results for errors and throw if either failed. This doesn't make it transactional but at least surfaces the error:
```ts
const [r1, r2] = await Promise.all([...])
if (r1.error) throw r1.error
if (r2.error) throw r2.error
```

Fix 2 (in `useTodos.ts`): add `onError` to `useSwapTaskOrder` that re-invalidates the query so the UI snaps back to the server state:
```ts
onError: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
```

---

### Task 3 — touch target: ItemRow priority dot
**Agent:** flex
**File:** `src/features/projects/components/ItemRow.tsx` (line 143–147)

Current state:
```tsx
<button
  onClick={cyclePriority}
  className={`w-2 h-2 rounded-full flex-shrink-0 ${PRIORITY_DOT[item.priority]}`}
```
The button is 8×8px — far below the 44px minimum.

Fix: wrap in a tap-target container, keep the visual dot size:
```tsx
<button
  onClick={cyclePriority}
  className="min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0 lg:min-w-0 lg:min-h-0 lg:w-4 lg:h-4"
  title={`Priority: ${item.priority} — click to change`}
>
  <span className={`w-2 h-2 rounded-full ${PRIORITY_DOT[item.priority]}`} />
</button>
```

---

### Task 4 — touch target / semantic: PhaseCard header div → button
**Agent:** flex
**File:** `src/features/projects/components/PhaseCard.tsx` (line 49–54)

Current state: the phase header is a `<div onClick>` with no keyboard role, no min-h guarantee, and no focus style.

Fix: change to `<button>` (type="button") with `min-h-[44px]` and `w-full text-left`. Move the `onMouseEnter/onMouseLeave` to a wrapping div if the hover state is still needed for the desktop delete button. The inner `+ item` and `✕` buttons already use `e.stopPropagation()` so nesting buttons is fine (they are siblings in the flex row, not nested).

```tsx
<button
  type="button"
  className="w-full flex items-center gap-2 px-4 py-2.5 min-h-[44px] cursor-pointer select-none hover:bg-ink-50 transition-colors text-left"
  onClick={() => setOpen(o => !o)}
  onMouseEnter={() => setHovered(true)}
  onMouseLeave={() => setHovered(false)}
>
```

Note: `<button>` cannot contain `<button>` per HTML spec. The `+ item` and delete buttons are siblings inside the same flex row — the parent `<button>` wraps them all. This is invalid HTML. Correct approach: keep the header as a `<div role="button" tabIndex={0}>` with `onKeyDown` for Enter/Space, or restructure so the toggle target is a narrow `<button>` on the left and action buttons remain outside. Recommended: use `<div role="button" tabIndex={0} onKeyDown={e => (e.key==='Enter'||e.key===' ') && setOpen(o=>!o)}>` + `min-h-[44px]` to satisfy both accessibility and HTML validity.

---

### Task 5 — touch target: DayTimeline selected-block action buttons
**Agent:** flex
**File:** `src/features/daily/components/DayTimeline.tsx` (lines 470–492)

Current state: the +30m, +1d, ✎, ✕ buttons inside selected blocks use `text-[10px] px-1.5 py-0.5` — roughly 22–24px tall.

These buttons live inside absolutely-positioned timeline blocks which can be short (heightPx ≥ 56px when selected, enforced at line 373). On mobile, blocks are too small to fit 44px buttons without overflowing the block.

Fix: add `min-h-[44px]` on mobile with desktop override:
```tsx
className="min-h-[44px] md:min-h-0 text-[10px] px-1.5 py-0.5 rounded bg-white/90 hover:bg-white border border-current"
```
Apply to all four action buttons (+30m, +1d, ✎, ✕).

---

### Task 6 — touch target: AIPanel suggestion buttons
**Agent:** flex
**File:** `src/features/ai/components/AIPanel.tsx` (line 107–114)

Current state: `className="w-full text-left text-sm px-3 py-2 rounded-lg ..."` — `py-2` = 8px top+bottom padding + ~20px line-height ≈ 36px total. Fails the 44px rule.

Fix: replace `py-2` with `min-h-[44px] py-2 flex items-center`:
```tsx
className="w-full text-left text-sm px-3 py-2 min-h-[44px] flex items-center rounded-lg bg-cream-100 hover:bg-cream-200 text-ink-700 transition-colors duration-150"
```

---

### Task 7 — touch target: ProjectDetail type filter chips
**Agent:** flex
**File:** `src/features/projects/components/ProjectDetail.tsx` (lines 150–176)

Current state: both the "all" button and TYPE_FILTERS buttons use `py-0.5` — roughly 26–28px total height.

Fix: add `min-h-[44px] flex items-center` to both button classNames. The `lg:` modifier pattern is already used across this codebase (see ItemRow, PhaseCard) — apply `lg:min-h-0` if the design is intentionally compact on desktop. The chips are in a `flex-wrap` row so they will wrap correctly on mobile.

---

### Task 8 — performance: useTasksBySection missing staleTime
**Agent:** debug
**File:** `src/features/todo/hooks/useTodos.ts` (line 31–35)

Current state: `useTasksBySection` has no `staleTime`, so TanStack Query treats the data as immediately stale and refetches on every window focus. This is the hottest query — it backs the ToDoDrawer which mounts/unmounts frequently.

Fix:
```ts
export function useTasksBySection(section: string) {
  return useQuery({
    queryKey: ['tasks', 'section', section],
    queryFn: () => fetchTasksBySection(section),
    staleTime: 30_000, // 30 s — tasks don't change sub-second
  })
}
```

---

### Task 9 — cleanup: console.log audit
**Agent:** debug

Running `grep -r "console\.log" src/` returned zero matches. Running the same against `supabase/` also returned zero. **No stray logs found — this task is a no-op. Skip.**

---

## PR-2: Medium feature — waiting_for inline edit
**Branch:** `claude/work-waiting-for-edit`
**Agent:** forge (scaffold) + flex (touch targets)

### Problem
`WorkTaskCard` displays `Waiting: {task.waiting_for || '…'}` as a read-only pill when `task.status === 'waiting'`. There is no UI to set or update this text. Dragging a card to the Waiting column leaves `waiting_for` as null.

### Files affected
- `src/features/work/components/WorkTaskCard.tsx` — add inline edit on pill click
- `src/features/work/components/WorkKanban.tsx` — when a card is dropped into the waiting column with no `waiting_for`, prompt for the value
- `src/features/work/pages/WorkPage.tsx` — `onStatusChange` already accepts `waitingFor?: string` and passes it through; verify nothing else is needed

### Behaviour spec
1. Clicking the "Waiting: …" pill puts the text into an inline `<input>` in place of the pill.
2. The input is auto-focused. Pressing Enter or blurring saves via `onStatusChange(task.id, 'waiting', value)`. Pressing Escape cancels.
3. An empty save clears `waiting_for` (sets to null / empty string).
4. Toast feedback: loading → success/error (the `onStatusChange` path already calls `updateTask` in WorkPage; update WorkPage's handler to wrap with toast if not already done).
5. Min-h-[44px] on the input and the pill button.
6. On drop into Waiting column (in WorkKanban): if the task has no `waiting_for`, call `onStatusChange(id, 'waiting', '')` — the card will render the editable pill immediately which prompts the user to fill it in. No modal needed.

### Tasks (ordered)

| # | Task | Agent | Parallel? |
|---|---|---|---|
| 1 | Add local edit state + inline input to WorkTaskCard pill | forge | start |
| 2 | Review touch targets on the new input/pill | flex | after 1 |
| 3 | Verify WorkPage `onStatusChange` wraps with toast correctly | debug | parallel with 1 |
| 4 | `npm run build` + commit | — | after 1,2,3 |

---

## Execution order

```
[Now]
  PR-1 branch: tasks 1–8 can all run in parallel (different files, no deps)
  PR-2 branch: task P2-1 first, then P2-2 and P2-3 in parallel, then build

[After build passes on each branch]
  Commit + push + draft PR
```

### Open questions
- `news-proxy` domain allowlist: VG and BBC image CDN hostnames may need expanding — guardian should check the actual img src values in the feed XML before finalising the list.
- `waiting_for` inline edit: should clearing the text snap the card back to `open`? Current spec says no (it stays `waiting` with a blank value). Confirm before shipping PR-2.
