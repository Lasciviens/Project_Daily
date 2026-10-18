# Projects

> Rebuilt 18.10.2026 (migration 162). Owner: "the project page should be able to work with every kind of project" — the kitchen scale's plan (`docs/kitchen-scale/README.md`: a status line, a dated log, parts tables, decisions, open questions, guides, links) didn't fit the old page of phases and software-typed "items".

## The model

A project is a **header**, a **plan** and a few general **blocks**. A template only decides what a new project starts with; every phase and block can be renamed, moved or removed afterwards. The rules live in `src/features/projects/projectModel.ts` (`verify-project-model`).

- **Header** (`projects`): name, kind (the template: hardware, software, home, learning, trip, blank), area (personal | work), status (Active, On hold, Done, Archived), a **status line** — where it stands, one line — with the time it last changed (`status_line_at`, set by the database), start and target days, one main link, a description and notes.
- **Plan** (`project_phases`): phases in order, each with **Done when** (its finish line), a target day and its done time (`done_at`, set when it is marked done, cleared on reopen). The current phase is the first one not done.
- **Tasks are tasks.** A project's tasks are rows of the one `tasks` table with `project_id` and `project_phase_id` — not a table of their own. A new one is undated, in Backlog, not on Google, with the project's area as its domain (a trigger sets it for every writer, the assistant too); it is on no day until the owner gives it one (its editor is the normal task sheet), and like every undated open task it shows in the Tasks tab's "No date" group. Ticking it in Daily, Work or the Tasks tab ticks it here, and the other way round. Deleting a project deletes its tasks (Undo brings them back); deleting a phase keeps its tasks in the project, under "Other tasks". Moving a project between Personal and Work moves its tasks' domain (a trigger).
- **Blocks** (`project_blocks`) hold **entries** (`project_entries`):

  | Block | An entry is | Shown |
  |---|---|---|
  | Table | a row: one value per column (text, number, money, date, link, choice, tick box) | a choice column splits it ("In hand · To buy"); a group column heads its rows ("Boards", "Weighing"); money columns are summed. Wide: a table; narrow: each row's name and choice, the rest on tap |
  | Log | a day, a title, text | newest first; the day and text open on tap |
  | Questions and decisions | an open question, or a decision with its day and why | questions first, highlighted; decisions newest first |
  | Text pages | a title and text (`# heading`, `- list`, `1. steps`, ```` ``` code ``` ````, `**bold**`, links) | titles; a page opens to read, ✎ to edit (`proseModel.ts` — never raw HTML) |
  | Links | a title, an address, a note | the link opens the site; the site's name beside it shows the note and full address |

- **Templates** (`projectModel.TEMPLATES`): Hardware (Parts · Log · Questions and decisions · Guides · Links), Software (Bugs · Log · Questions and decisions · Docs · Links), Home (Materials and budget · Log · Links and photos), Learning (Resources · Notes · Log), Trip (Checklist · Budget · Bookings · Links), Blank. Each but Blank also starts with a few phases. `app_create_project(project, phases, blocks)` makes a project with them in one transaction.

## The pages

- **List** (`/projects`): one status at a time (Active, On hold, Done, Archived — in the address, `?status=`), an area switch once both areas have a project (`?area=`), New project. A card shows the kind and area, where the plan stands ("Phase 2 of 7 · Weighing on the bench" and a bar), the next open task and open questions — nothing else (owner, 18.10.2026: "no unneeded information directly but when clicked").
- **Project** (`/projects/:projectId`, its own address so Back works): the header card (name as the page's heading, status menu, About behind a tap, the status line — its date on hover or tap — the ring of phases done, the current phase with its Done when on hover or tap, tasks done and open questions, then Task · Log entry · Block · the main link), the plan, then the blocks. Layout (`projectBoard.ts`, `verify-feature-boards`): on a phone one column with section chips that jump to the plan and each block; from 1280 the plan, text pages and tables of more than three columns in main, the log, questions, links and narrow tables in the side track; main spans two tracks at 1920 and three at 2450, where the phases deal into two or three columns (`PhaseColumns`, phase i → column i mod N).
- **Details on demand:** dates, Done when, a log entry's text, a decision's why, a link's note — all wait for a hover or tap (`HoverPeek` for a fact, a disclosure for text). The current phase opens by itself; the others on tap.
- **Popups** (entity kinds): `project` (no id: New project with its template; by id: details), `project-phase`, `project-block` (a table's columns: add, rename, reorder, remove, choices, group by, currency), `project-entry` (a row, a log entry, a question or decision, a page, a link — the form follows the block's kind).

Every write says its result ("Task added", "Row added", "Decided", "Kitchen scale: On hold") and every delete asks and offers Undo (`useRowsDelete`; 144's `app_delete_rows` follows the new keys).

## The old items (migration 162)

Before 162 a project's work lived in `project_items` (title, notes, a software type, status, priority), reaching Daily only once scheduled. 162 copied every item into `tasks` (owner, 18.10.2026: closed items too, so progress stays right):

- An item that had been planned already had a task (`source_type project_item`); the newest open one (else the newest) became the project task, kept as it was — its day, slot, Google copy and domain (the old "Plan item" made it a Work task, so it stays on the Work board). Its item's notes come along only when it had none and isn't on Google.
- Every other item became an undated Backlog task with its status, priority, notes, order and phase, Google sync off, and `source_type project_item` + the item's id. An open one shows in the Tasks tab's "No date" group. A closed one's close time is the item's last change (`updated_at`, the nearest the old table kept — never "closed today"), so it shows among that day's closed tasks.
- The item's type (update, improvement, UI request, bug, wishlist) is not carried over; it stays in `project_items`.
- Existing projects became Personal (owner, 18.10.2026), so their new tasks stay off the Work board until a project is moved to Work (its tasks follow).
- `project_items` is left as the record; the app no longer reads it, the assistant may only read it, and 043's rule that a deleted item takes its slots and closes their tasks is switched off — an item now goes only with its phase or project, and a deleted phase keeps its tasks.

## The kitchen scale

Its technical document stays in git (`docs/kitchen-scale/README.md`) — sessions read the repo, not live data. The app holds the working copy: tasks, parts, log, decisions. Loading it is a one-off SQL the owner runs in the Supabase SQL editor after 162 is deployed (never a migration): `docs/kitchen-scale/load-into-app.sql` (`docs/deploy-checklist.md`). It loads the README as it was on 18.10.2026 (7 phases, 31 tasks, parts, log, questions and decisions, guides, links) and refuses to run twice.

## Not yet

- Photos and files (an upload store for a project) — links to an album or a document work meanwhile.
- Sending a table's "To buy" rows to Shop.
