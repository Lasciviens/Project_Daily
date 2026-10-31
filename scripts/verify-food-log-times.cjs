// Food log times (181; owner, 31.10.2026: "log times for food section so I can see on my diary" — "Now, can
// change") and portion options ("there are no type of portion, it's manually written … It should be options"):
// the browser's rules (foodLogUtils, foodAmount.portionWordOptions) and where they are used. The database's side
// (the trigger, its meal hours = MEAL_USUAL_TIME) is verify-db-food-log-times.
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const U = require('../src/features/recipes/components/foodLogUtils.ts')
const A = require('../src/features/recipes/foodAmount.ts')

let n = 0
const eq = (a, b, msg) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) { console.error(`✗ ${msg}\n  got  ${JSON.stringify(a)}\n  want ${JSON.stringify(b)}`); process.exit(1) }
  n++
}
const src = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')

// ── The time a log gets ──
const at = new Date(2026, 9, 31, 20, 7)
eq(U.defaultEatenTime('2026-10-31', 'dinner', '2026-10-31', at), '20:07', 'today: the time it is logged')
eq(U.defaultEatenTime('2026-10-30', 'breakfast', '2026-10-31', at), '07:00', 'another day: its meal\'s usual time')
eq(Object.entries(U.MEAL_USUAL_TIME), [['breakfast', '07:00'], ['lunch', '12:00'], ['snack', '15:00'], ['dinner', '18:00'], ['supplement', '21:00']],
  'the meal hours (the Diary\'s, and 181\'s food_meal_usual_time — verify-db-food-log-times compares them)')
eq([U.eatenTimeLabel('08:12:00'), U.eatenTimeLabel('08:12'), U.eatenTimeLabel(null), U.eatenTimeLabel('soon')], ['08:12', '08:12', null, null],
  'a stored time reads HH:MM; none or nonsense reads as no time')

// ── Where the time goes ──
const logger = src('src/features/recipes/components/FoodLogModal.tsx')
eq(/const timed = [^\n]*plan \|\| !timePick \? entries/.test(logger), true, 'the logger sends only a picked time (an unpicked one is the database\'s, exact to the minute); a plan has none')
eq(/write\.mutate\(\{ entries: timed\(entries\)/.test(logger) && /write\.mutateAsync\(\{ entries: timed\(itemsToEntries\(/.test(logger)
  && (logger.match(/write\.mutate(Async)?\(/g) || []).length === 2, true, 'both of the logger\'s writes go through it (the one-tap logs and the basket)')
eq(/!plan && !dish && <FoodTimeField/.test(logger), true, 'the logger shows the time beside the meal (not for a plan or a dish\'s edit)')
eq(/eaten_time: time/.test(src('src/features/recipes/components/EditFoodLogModal.tsx')), true, 'the edit popup saves a changed time')
eq(/eatenTimeLabel\(meal\.eaten_time\)/.test(src('src/features/recipes/components/FoodTodayTab.tsx')), true, 'Food · Today shows a logged food\'s time')
const nut = src('src/features/daily/api/dayNutritionApi.ts')
eq(/UNIFIED_SELECT_181 = `\$\{UNIFIED_SELECT\}, eaten_time`/.test(nut) && /isMissingEatenTime\(uni\.error\)/.test(nut), true,
  'the day\'s food read takes the time, and a database without 181 reads without it')
eq(/isMissingEatenTime\(error\)/.test(src('src/features/recipes/api/foodLogApi.ts')), true, 'a log or an edit on a database without 181 saves without the time')
eq(/eaten_time\(time HH:MM/.test(src('supabase/functions/ai-proxy/index.ts')), true, 'the assistant\'s catalogue names eaten_time')

// ── Portion options ──
const opts = A.portionWordOptions(['scoop', 'Muffin', '2 slices (60 g)', null, 'egg', 'muffin'], '')
eq(opts.slice(0, A.PORTION_WORDS.length), [...A.PORTION_WORDS], 'the usual portion words first')
eq(opts.slice(A.PORTION_WORDS.length), ['Muffin', 'egg'], 'then the owner\'s own words in use, each once (any case), never a label with numbers')
eq(A.portionWordOptions([], '2 slices (60 g)').slice(-1), ['2 slices (60 g)'], 'a saved label that is none of them still shows (so it is never lost)')
eq(A.portionWordOptions([], 'Slice').length, A.PORTION_WORDS.length, 'a saved word in another case is the same choice')
for (const f of ['NewFoodForm.tsx', 'IngredientManager.tsx', 'FoodLogModal.tsx', 'RecipeModal.tsx']) {
  eq(/<PortionWordSelect\b/.test(src(`src/features/recipes/components/${f}`)), true, `${f} picks the portion from the list`)
}
eq(/placeholder="Portion label \(1 scoop\)"|placeholder="1 scoop"|placeholder="portion"/.test(['NewFoodForm.tsx', 'IngredientManager.tsx', 'FoodLogModal.tsx', 'RecipeModal.tsx'].map(f => src(`src/features/recipes/components/${f}`)).join('\n')), false,
  'no portion is typed by hand anywhere any more (Other… still takes a new word)')

console.log(`verify-food-log-times: ${n} checks passed`)
