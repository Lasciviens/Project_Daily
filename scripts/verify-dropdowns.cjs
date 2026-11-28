#!/usr/bin/env node
/*
 * Verification — dropdowns, app-wide (owner, 28.11.2026: "İ loved the dropdown from "Show"/"Movie" selecting... I
 * almodt want everything to use that type dropdown.." — "Also make sure it is on design md so this is our default from
 * now on"; THEME §8 → Dropdowns, .claude/rules/ui.md → Dropdowns). Every dropdown or choice list in new or changed UI
 * is the shared field list: FieldOptions for a search, FieldSelect for plain choices. This script holds the rule to
 * what exists today: a raw ComboboxOptions / ListboxOptions or a native <select> only in today's files (THEME's
 * migration backlog) — a new file with one fails; a file that moves comes off its list. The item screen itself has no
 * raw list at all (verify-item-screen §13).
 * Run: node scripts/verify-dropdowns.cjs
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const root = path.join(__dirname, '..')
let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const filesWith = re => execSync(`grep -rlE '${re}' src --include=*.tsx || true`, { cwd: root }).toString().trim().split('\n').filter(Boolean).sort()

/** The shared field list itself. */
const SHARED = ['src/shared/components/FieldOptions.tsx', 'src/shared/components/FieldSelect.tsx']

/** Today's raw Headless UI choice lists (THEME §8's backlog; the Games page's Tg* look moves with Games). */
const RAW_LISTS = [
  'src/features/devRequests/components/PropertyPills.tsx', 'src/features/games/test-game/components/TgDropdown.tsx',
  'src/features/games/test-game/components/TgMultiDropdown.tsx', 'src/features/home/components/CurrencyConverter.tsx',
  'src/features/home/components/ruter/StopSearchInput.tsx', 'src/features/recipes/components/AssignMealModal.tsx',
  'src/features/recipes/components/LibraryTabFilters.tsx', 'src/features/recipes/components/RecipeModalFoodLink.tsx',
  'src/features/recipes/components/foodLogKit.tsx', 'src/features/supplements/components/WhatField.tsx',
  'src/features/training/components/ExerciseProgressChart.tsx', 'src/features/training/components/RelativeStrengthChart.tsx',
  'src/features/training/components/RoutineFormParts.tsx', 'src/shared/components/CommandPalette.tsx',
]

/** Today's native selects (THEME §8's backlog). plan-modal/fields.tsx's ChipSelect serves the sheets outside the item
 *  screen (the supplements' schedule, Food's amount rows); on the item screen it is a SelectChip. */
const NATIVE_SELECTS = [
  'src/features/ai/chat/ChatExtras.tsx',
  'src/features/books/components/LibraryTab.tsx',
  'src/features/books/components/kobo/DurationInput.tsx',
  'src/features/books/components/kobo/FontPicker.tsx',
  'src/features/books/components/kobo/ListEditors.tsx',
  'src/features/books/components/kobo/MenuOrderCard.tsx',
  'src/features/books/components/kobo/SettingControl.tsx',
  'src/features/books/components/send/SendReviewItem.tsx',
  'src/features/books/components/stats/FinishedBooksCard.tsx',
  'src/features/developer/components/ActivityLogFilters.tsx',
  'src/features/developer/components/MemoryFields.tsx',
  'src/features/developer/components/MemoryTab.tsx',
  'src/features/developer/components/ai/AiCalls.tsx',
  'src/features/developer/components/ai/AiChatControls.tsx',
  'src/features/developer/components/ai/AiJobSettingsCard.tsx',
  'src/features/developer/components/ai/AiTestBench.tsx',
  'src/features/developer/components/ai/memory/SetAside.tsx',
  'src/features/games/components/AddGameModal.tsx',
  'src/features/games/components/GameDetailModal.tsx',
  'src/features/games/components/PlayStationTab.tsx',
  'src/features/games/components/SteamTab.tsx',
  'src/features/games/test-game/components/scrape/TgScrapeSearchForm.tsx',
  'src/features/home/components/ruter/RoutesTab.tsx',
  'src/features/media/components/CinemaVisitSheet.tsx',
  'src/features/media/components/DiscoverFilters.tsx',
  'src/features/media/components/LibraryView.tsx',
  'src/features/media/components/ListGrid.tsx',
  'src/features/media/components/ListsView.tsx',
  'src/features/media/components/MediaSearchResults.tsx',
  'src/features/media/components/SpreadWatchedSheet.tsx',
  'src/features/media/components/TonightPicker.tsx',
  'src/features/projects/modals/ProjectBlockEntityModal.tsx',
  'src/features/projects/modals/ProjectEntityModals.tsx',
  'src/features/projects/modals/ProjectEntryEntityModal.tsx',
  'src/features/recipes/components/FoodCategorySelect.tsx',
  'src/features/recipes/components/IngredientList.tsx',
  'src/features/recipes/components/IngredientManager.tsx',
  'src/features/recipes/components/PortionWordSelect.tsx',
  'src/features/recipes/components/QuickGuessOptionsField.tsx',
  'src/features/recipes/components/RecipeBuilder.tsx',
  'src/features/recipes/components/RecipeModal.tsx',
  'src/features/settings/components/AreaSwitchDialog.tsx',
  'src/features/settings/components/CalendarTab.tsx',
  'src/features/settings/components/SubscriptionBits.tsx',
  'src/features/settings/components/SubscriptionSheet.tsx',
  'src/features/shop/components/CategoryPicker.tsx',
  'src/features/shop/components/ShopFilters.tsx',
  'src/features/shop/components/ShopItemForm.tsx',
  'src/features/shop/components/chain/StepMore.tsx',
  'src/features/shop/components/owned/OwnedFilters.tsx',
  'src/features/shop/components/owned/SellSheet.tsx',
  'src/features/shop/components/receipt/ReceiptLines.tsx',
  'src/features/shop/components/record/AdSheet.tsx',
  'src/features/shop/components/record/PurchaseEditor.tsx',
  'src/features/shop/components/record/RecordBody.tsx',
  'src/features/shop/components/record/RecordCosts.tsx',
  'src/features/shop/components/record/RecordMoney.tsx',
  'src/features/shop/components/record/RecordResale.tsx',
  'src/features/shop/components/record/factList.tsx',
  'src/features/shop/components/shopEditors.tsx',
  'src/features/shop/components/shopKit.tsx',
  'src/features/shop/components/shopPickers.tsx',
  'src/features/shop/components/stores/DealDaysList.tsx',
  'src/features/shop/components/stores/RuleSheet.tsx',
  'src/features/training/components/CreateExerciseModal.tsx',
  'src/features/training/components/LimitationsList.tsx',
  'src/features/training/components/LogHevyWorkoutModal.tsx',
  'src/features/training/components/MusclePreferencesList.tsx',
  'src/features/training/components/RoutineFormParts.tsx',
  'src/features/training/components/RoutineModals.tsx',
  'src/features/training/progress/DecisionFilterBar.tsx',
  'src/features/work/components/WorkToolbar.tsx',
  'src/shared/components/plan-modal/fields.tsx',
]

const lists = filesWith('<(ComboboxOptions|ListboxOptions)\\b')
const newLists = lists.filter(f => !RAW_LISTS.includes(f) && !SHARED.includes(f))
check('no new raw ComboboxOptions / ListboxOptions (new code uses FieldOptions / FieldSelect)', newLists.length === 0, newLists.join(', '))
const goneLists = RAW_LISTS.filter(f => !lists.includes(f))
check('…a file that moved to the field list comes off the backlog (here and in THEME)', goneLists.length === 0, goneLists.join(', '))

const selects = filesWith('<select\\b')
const newSelects = selects.filter(f => !NATIVE_SELECTS.includes(f))
check('no new native <select> (new code uses FieldSelect)', newSelects.length === 0, newSelects.join(', '))
const goneSelects = NATIVE_SELECTS.filter(f => !selects.includes(f))
check('…a file whose selects moved comes off the list', goneSelects.length === 0, goneSelects.join(', '))

const theme = fs.readFileSync(path.join(root, 'docs/design/THEME.md'), 'utf8')
const ui = fs.readFileSync(path.join(root, '.claude/rules/ui.md'), 'utf8')
check('THEME makes it the default, quoting the owner, and names every raw list of the backlog',
  theme.includes('Also make sure it is on design md so this is our default from now on') && theme.includes('I almodt want everything to use that type dropdown')
  && RAW_LISTS.every(f => theme.includes(path.basename(f, '.tsx'))), RAW_LISTS.filter(f => !theme.includes(path.basename(f, '.tsx'))).join(', '))
check('…ui.md carries the rule, and says this script checks it', /FieldSelect/.test(ui) && /verify-dropdowns/.test(ui))

console.log(`\nverify-dropdowns: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
