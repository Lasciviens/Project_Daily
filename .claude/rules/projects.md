---
paths:
  - "src/features/projects/**"
  - "supabase/migrations/*project*"
  - "scripts/db-tests/project-blocks/**"
---
# Projects rules

Background: `docs/features/projects.md`.

- A project's tasks are `tasks` rows with `project_id` / `project_phase_id` — never a table of their own; tick, edit and delete them through `useTaskActions`. A new one is undated, Backlog, Google off, its domain the project's area (`createProjectTask`).
- `project_items` is the record of the old items (162 copied them into tasks): never read or write it again.
- What a project's numbers are (current phase, next task, tasks done, open questions) comes from `projectModel.projectSummary`; open/done from `todo/taskRules` (`verify-task-model`).
- A table block's settings and rows are JSON from the database: read them through `tableSettings` / `parseCell` / `cellText`, and the block renders inside its `ErrorBoundary`.
- Text pages and log text render through `proseModel` / `ProseText` — never as HTML.
- Secondary facts (dates, Done when, a log entry's text, a link's note) wait behind a `HoverPeek` or a disclosure (owner, 18.10.2026: "no unneeded information directly but when clicked").
- A new block kind: `project_blocks.kind`'s check (a migration), `BLOCK_KINDS` and its body in `BlockCard`, the entry form in `ProjectEntryEntityModal`, the assistant's `DB_CATALOG`.
