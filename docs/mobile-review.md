# Mobile Review

Date: 2026-06-12

Branch: `flex/mobile-latest-pass-current`

Agent used: Flex (`.claude/agents/flex.md`)

## Scope

Mobile and responsive-only pass for the latest `main` state.

No API, Supabase, Edge Function, migration, data model, or feature behavior changes were made.

## Files changed

- `src/features/home/components/RuterWidget.tsx`
- `src/features/projects/pages/ProjectsPage.tsx`
- `docs/mobile-review.md`

## Issues found

### Transit widget

- Transit header buttons used 28px minimum height, below the Flex 44px mobile tap-target rule.
- Panel padding was slightly dense on mobile.
- Widget body had no explicit overflow guard.

### Projects page

- Projects used a fixed two-panel layout at all widths.
- On mobile this squeezes the project list and detail panel side-by-side.

## Fixes applied

### Transit widget

- Transit tab/settings controls now use 44px minimum height.
- Transit panel padding is smaller on base/mobile and returns to normal from `sm:`.
- Widget body has `overflow-x-hidden` guard.
- Existing container-width based wide layout was preserved.

### Projects page

- Projects page now collapses to single-column below `lg:`.
- Project list becomes a top panel on mobile with `max-h-56` and internal vertical scroll.
- Desktop two-panel layout remains from `lg:` upward.

## Breakpoints reviewed

- 375px: Transit controls are tappable; Projects is single-column.
- 390px: Project list no longer squeezes detail panel horizontally.
- 430px: Transit header controls remain touch-safe.
- 768px: Projects still avoids cramped side-by-side layout.

## Explicit confirmation

Desktop behavior intentionally unchanged where practical. Desktop-specific Projects layout remains at `lg:` and above. Transit side-by-side behavior remains container-width based and only the tap target/padding guard changed.

## Known limitations

- This pass did not redesign mobile navigation into a bottom tab bar because current main already has horizontal-scroll navigation.
- This pass did not touch API, Supabase, Edge Functions, migrations, or service files.
- Build was not executed inside this review environment; GitHub CI should confirm TypeScript/build status after merge.
