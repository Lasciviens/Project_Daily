# Projects

> Moved out of CLAUDE.md on 13.10.2026.

## Overview

Phases, items, status tracking. Add/edit share one popup (`ProjectItemModal`, opened as the `project-item` entity modal) — title/notes/phase/type/status/priority. Colours per enum (and each project's own colour, from the chart palette) live in `projectTones.ts`. The detail is a PageBoard (`projectBoard.ts`): header card (capped at 56rem), view controls and phases in main (spanning 2 tracks at 1920 and 3 at 2450), notes + activity in the last track. Phases are dealt into column stacks by index (`PhaseColumns`: phase i → column i mod N; two columns from 61rem of their own width, three from 92rem, so a card stays ≥ 30rem), each sized/collapsed independently. Board view's three status columns stop at 28rem each; at 2450 the work spans two tracks (`PROJECT_KANBAN_BOARD`). The project list is a collection (auto-fill 19–22rem cards) whose header stops over the last card (`projectsHeaderCapRem`).
