### Problem

Two backlog items from CLAUDE.md:

1. **Command Bar (Cmd+K)** — no global keyboard shortcut for navigation or quick task creation. Users must click nav links to move between pages and open ToDoDrawer manually to add tasks.

2. **Routes widget — refresh + visual pass** — `RoutesTab` already has a refresh button wired up (`handleRefresh` with toast feedback, implemented). `DeparturesTab` has a minimal inline refresh (↻ icon, no toast). Visual consistency between the two tabs needs a review pass, particularly departure rows and line number badges.

---

### Solution

**Feature 1: Command Bar**

A `CommandBar` component mounted once in `Layout`. Triggered by `Cmd+K` / `Ctrl+K` globally. Uses HeadlessUI `Combobox` (already used in `StopSearchInput` — follow same pattern). Zustand `useUIStore` gets `isCommandBarOpen` / `openCommandBar` / `closeCommandBar` added. Results are grouped: "Go to" (8 pages), "Tasks" (fuzzy-matched from cached `['tasks']` query data), "Quick add" (when input starts with `add `). Selecting a nav result calls `useNavigate`. Selecting a task result navigates to the task's domain page. "Create task" result calls `useCreateTask` mutation with toast feedback. A small `⌘K` hint button in the Nav header opens it on click (also serves mobile users who have no keyboard shortcut).

**Feature 2: Routes widget**

`RoutesTab` already has a solid refresh button — the implementation is complete. Work needed is on `DeparturesTab`:
- Replace the bare ↻ icon button with the same styled accent button pattern from `RoutesTab` (solid `bg-accent-500`, `min-h-[44px] min-w-[44px]`, spinner animation, toast feedback on refresh).
- Visual pass on `DepartureRow`: tighten spacing, improve line badge readability, ensure time column aligns cleanly.

---

### Files affected

**Create:**
- `src/shared/components/CommandBar.tsx` — main component (~140 lines, split if needed)

**Modify:**
- `src/app/store.ts` — add `isCommandBarOpen`, `openCommandBar`, `closeCommandBar` to `UIState`
- `src/app/layout.tsx` — mount `<CommandBar />`, add `⌘K` hint button to Nav header, wire `openCommandBar` to it
- `src/features/home/components/ruter/DeparturesTab.tsx` — upgrade refresh button to match RoutesTab style + add toast feedback

**No DB changes. No new routes. No Edge Functions.**

---

### Tasks (ordered)

| # | Task | Agent | Parallel? | Notes |
|---|---|---|---|---|
| 1 | Add `isCommandBarOpen`, `openCommandBar`, `closeCommandBar` to `useUIStore` in `store.ts` | `forge` | No — others depend on this | Keep pattern consistent with existing `isToDoOpen` / `isAIOpen`. Closing command bar must not close ToDo/AI panels. |
| 2a | Build `CommandBar.tsx` | `forge` | After task 1 | Use HeadlessUI `Combobox`. Groups: "Go to" (static list of 8 routes), "Tasks" (read from `useQueryClient().getQueryData(['tasks', ...])` — no extra fetch), "Quick add" (input starts with `add ` → show single "Create task: X" result). `useNavigate` for navigation. `useCreateTask` + toast pattern for task creation. Global `keydown` listener for Cmd/Ctrl+K (add in `useEffect`, clean up on unmount). `Dialog`-style backdrop (dimmed overlay). Close on Escape (Combobox handles this) and on backdrop click. |
| 2b | Upgrade `DeparturesTab` refresh button | `flex` | Parallel with 2a | Replace the bare ↻ button in DeparturesTab with a styled button matching the RoutesTab pattern: `bg-accent-500 text-white rounded-lg min-h-[44px] min-w-[44px]`, `animate-spin` while loading, toast loading/success/error. Also do a visual pass on `DepartureRow` — line badge contrast, time column alignment. |
| 3 | Mount `CommandBar` in `Layout`, add `⌘K` hint button to Nav | `forge` | After task 2a | Add `<CommandBar />` after `<Toaster />` in `Layout`. In Nav right-actions area, add a small `⌘K` button (hidden on mobile if space is tight, always tappable at `min-h-[44px]`). Wire it to `openCommandBar`. |
| 4 | Build verification — `npm run build` must pass | `forge` | After all tasks | Fix any TypeScript errors. No new lint warnings. |

Tasks 2a and 2b can run in parallel after task 1 completes.

---

### Open questions

- **Task search scope**: `useQueryClient().getQueryData` only returns data that has already been fetched in the current session. For the command bar search this is acceptable — if the tasks cache is warm (ToDoDrawer was opened) results appear; if not, the "Tasks" group is empty and only "Go to" shows. No extra query needed.
- **Mobile trigger**: Cmd/Ctrl+K does not work on mobile. The `⌘K` Nav button is the mobile entry point. On very small screens the hint text can be icon-only (a search icon or `⌘` character).
- **Task result navigation**: clicking a task result navigates to the domain page (e.g. `/work` for domain `work`, `/daily` for `personal`). No deep-link to a specific task row — that is out of scope for this iteration.
