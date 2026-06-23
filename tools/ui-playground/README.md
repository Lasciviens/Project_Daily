# Project Daily UI Playground

Standalone briefing playground for UI experiments. This is not production UI code and does not call live APIs.

## Purpose

Use this page to mock a redesign visually, then export JSON or an AI prompt that can be given to Codex, Claude, or ChatGPT as implementation guidance.

## How to use

Open `tools/ui-playground/index.html` in a browser. It redirects to the standalone playground file.

You can:

- drag blocks around the canvas
- resize selected blocks from the bottom-right handle
- edit x/y/width/height, text, color, radius, border and shadow
- switch desktop/tablet/mobile canvas widths
- duplicate/delete/bring blocks forward
- export layout JSON
- export an AI implementation prompt

## Source context used

The mock follows the current transit structure:

- `RuterWidget` wraps Departures, Routes and Settings tabs.
- Wide mode shows Departures and Routes side by side.
- Departures groups rows by quay labels such as `mot Oslo S`.
- Routes uses From/To stop cards with direction hints.

The homepage widgets are intentionally shallow surface mocks. They are only there to give the transit redesign context inside the dashboard.

## Constraints

- No build step.
- No dependencies.
- No production app imports.
- Layout is saved only in localStorage.
- Use browser screenshot plus exported prompt/JSON as the handoff artifact.
