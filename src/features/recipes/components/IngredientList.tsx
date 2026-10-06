import { useMemo, useState } from 'react'
import { Pencil, Search, X } from 'lucide-react'
import { Card, EmptyState, IconButton, MetaLine, SkeletonText, TonePill, Truncate, cx } from '../../../shared/ui'
import { formatDate } from '../../../shared/utils/dateFormat'
import { useRecipes } from '../hooks/useRecipes'
import { USAGE_DAYS, useFoodUsage } from '../hooks/useFoodUsage'
import {
  FOOD_FLAGS, FOOD_SORTS, filterFoods, isHighProteinFood, portionMacros, proteinDensity, recipeUseCounts, sortFoods,
  usageKey, type FoodFlag, type FoodSort,
} from '../foodLibraryModel'
import { checkMacroConsistency } from '../macroSanity'
import { FOOD_GROUPS, type IngredientLibraryItem } from '../types'
import { FoodThumb } from './foodLogKit'
import { MacroLine } from './MacroLine'
import { MacroWarningBadge } from './MacroWarningBadge'

const SOURCE_LABEL: Record<string, string> = {
  openfoodfacts: 'Open Food Facts', kassalapp: 'Kassalapp', dsld: 'NIH DSLD', matvaretabellen: 'Matvaretabellen',
}
const PAGE = 120

/**
 * "Your foods": every library food with its macros per 100 g, what one portion
 * gives you, how often you ate it lately and how many recipes use it — sorted
 * and filtered by what matters when building a day (protein per kcal, most eaten…).
 */
export function IngredientList({ library, isLoading, onEdit, onDelete, editingId }: {
  library: IngredientLibraryItem[]
  isLoading: boolean
  onEdit: (ing: IngredientLibraryItem) => void
  onDelete: (ing: IngredientLibraryItem, usedIn: number) => void
  editingId: string | null
}) {
  const { data: recipes = [] } = useRecipes()
  const { usage } = useFoodUsage()
  const recipeUse = useMemo(() => recipeUseCounts(recipes), [recipes])
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<string | null>(null)
  const [flags, setFlags] = useState<FoodFlag[]>([])
  const [sort, setSort] = useState<FoodSort>('az')
  const [limit, setLimit] = useState(PAGE)

  const presentGroups = useMemo(() => {
    const s = new Set<string>()
    let hasOther = false
    for (const i of library) { if (i.food_group) s.add(i.food_group); else hasOther = true }
    return { ordered: FOOD_GROUPS.filter(g => s.has(g)), hasOther }
  }, [library])

  const shown = useMemo(
    () => sortFoods(filterFoods(library, { query, group, flags }, usage, recipeUse), sort, usage),
    [library, query, group, flags, sort, usage, recipeUse],
  )
  const narrowed = query.trim() !== '' || group !== null || flags.length > 0
  const toggle = (f: FoodFlag) => { setLimit(PAGE); setFlags(fs => (fs.includes(f) ? fs.filter(x => x !== f) : [...fs, f])) }
  const pickGroup = (g: string | null) => { setLimit(PAGE); setGroup(g) }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {(presentGroups.ordered.length > 0 || presentGroups.hasOther) && (
        <div role="tablist" aria-label="Food group" className="scroll-x -mx-1 flex gap-1.5 px-1">
          <button type="button" role="tab" aria-selected={group === null} className="pill-tab shrink-0" onClick={() => pickGroup(null)}>All</button>
          {presentGroups.ordered.map(g => (
            <button key={g} type="button" role="tab" aria-selected={group === g} className="pill-tab shrink-0" onClick={() => pickGroup(g)}>{g}</button>
          ))}
          {presentGroups.hasOther && <button type="button" role="tab" aria-selected={group === '__other'} className="pill-tab shrink-0" onClick={() => pickGroup('__other')}>Other</button>}
        </div>
      )}
      <div className="scroll-x -mx-1 flex gap-1.5 px-1" aria-label="Show only">
        {FOOD_FLAGS.map(f => (
          <button key={f.value} type="button" aria-pressed={flags.includes(f.value)} onClick={() => toggle(f.value)}
            className="pill-tab min-h-[44px] shrink-0 sm:min-h-0">{f.label}</button>
        ))}
      </div>

      <Card padded={false} className="@container overflow-hidden">
        <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <p className="section-label mr-auto">Your foods <span className="count-badge ml-1 normal-case tracking-normal">{shown.length}{narrowed ? ` / ${library.length}` : ''}</span></p>
          {/* Narrow card: label + sort on one row, search under them at full width. */}
          <label className="relative order-last w-full @[30rem]:order-none @[30rem]:w-52">
            <span className="sr-only">Search your foods</span>
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint" />
            <input value={query} onChange={e => { setLimit(PAGE); setQuery(e.target.value) }} placeholder="Search" className="input pl-8" />
          </label>
          <select aria-label="Sort foods" className="input w-auto max-w-[9.5rem] @[30rem]:max-w-none" value={sort} onChange={e => setSort(e.target.value as FoodSort)}>
            {FOOD_SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </header>
        {isLoading ? (
          <div className="p-4"><SkeletonText lines={5} /></div>
        ) : shown.length === 0 ? (
          <EmptyState title={narrowed ? 'No match' : 'No foods yet'}
            description={narrowed ? 'Nothing matches these filters.' : 'Add your basics (chicken, rice, oats, whey…) with the form.'} />
        ) : (
          // CSS columns, not a grid, so the order reads DOWN each column.
          <ul className="-mb-px @[68rem]:columns-2 @[68rem]:gap-x-6 @[100rem]:columns-3">
            {shown.slice(0, limit).map(ing => (
              <FoodRow key={ing.id} ing={ing} editing={ing.id === editingId}
                eaten={usage.get(usageKey.ingredient(ing.id))} usedIn={recipeUse.get(ing.id) ?? 0}
                onEdit={() => onEdit(ing)} onDelete={() => onDelete(ing, recipeUse.get(ing.id) ?? 0)} />
            ))}
          </ul>
        )}
        {shown.length > limit && (
          <button type="button" onClick={() => setLimit(l => l + PAGE)}
            className="min-h-[44px] w-full border-t border-line px-4 text-meta font-medium text-accent-600 hover:bg-surface-hover">
            Show {Math.min(PAGE, shown.length - limit)} more ({shown.length - limit} left)
          </button>
        )}
      </Card>
      <p className="max-w-2xl text-meta text-fg-muted">
        Macros are per 100 g (100 ml for drinks); a portion line shows what one portion gives you. "Eaten" counts the last {USAGE_DAYS} days of your diary.
        Editing a food updates every meal made from it, past days included. Nutrition data: Matvaretabellen (Mattilsynet), NLOD; Open Food Facts, ODbL.
      </p>
    </div>
  )
}

function FoodRow({ ing, eaten, usedIn, editing, onEdit, onDelete }: {
  ing: IngredientLibraryItem
  eaten: { count: number; lastDate: string } | undefined
  usedIn: number
  editing: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const check = checkMacroConsistency(ing.calories, ing.protein_g, ing.carbs_g, ing.fat_g)
  const density = proteinDensity(ing.calories, ing.protein_g)
  const portion = portionMacros(ing)
  const per = ing.unit?.trim().toLowerCase() === 'ml' ? '100 ml' : '100 g'

  return (
    <li className={cx('flex break-inside-avoid items-start gap-3 border-b border-line py-2 pl-3 pr-1.5 text-body', editing && 'bg-accent-50')}>
      <FoodThumb name={ing.name} group={ing.food_group} imageUrl={ing.image_url} size={40} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <Truncate className="font-medium text-fg">{ing.name}</Truncate>
          <MacroWarningBadge result={check} />
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-meta tabular-nums text-fg-2"><strong className="font-semibold text-fg">{ing.calories ?? '–'}</strong> kcal / {per}</span>
          <MacroLine protein={ing.protein_g} carbs={ing.carbs_g} fat={ing.fat_g} />
          {isHighProteinFood(ing)
            ? <TonePill tone="success">{density != null ? `${density} g P / 100 kcal` : 'High protein'}</TonePill>
            : density != null && <span className="text-micro tabular-nums text-fg-faint" title="Grams of protein per 100 kcal">{density} g P / 100 kcal</span>}
        </div>
        {portion && (
          <MetaLine className="text-micro tabular-nums text-fg-muted" items={[
            `${ing.serving_label || 'Portion'} (${Math.round(portion.grams)} g): ${portion.calories ?? '–'} kcal`,
            `${portion.protein_g ?? '–'} g protein`,
          ]} />
        )}
        <MetaLine className="text-micro tabular-nums text-fg-muted" items={[
          ing.food_group,
          (ing.source && SOURCE_LABEL[ing.source]) || 'Your own',
          eaten && `Eaten ${eaten.count}×`,
          eaten && `last ${formatDate(eaten.lastDate)}`,
          usedIn > 0 && `in ${usedIn} recipe${usedIn === 1 ? '' : 's'}`,
        ]} />
      </div>
      {/* Stacked on a phone so the text column keeps its width. */}
      <div className="flex shrink-0 flex-col @[30rem]:flex-row">
        <IconButton label={`Edit ${ing.name}`} onClick={onEdit}><Pencil /></IconButton>
        <IconButton label={`Delete ${ing.name}`} onClick={onDelete} className="text-fg-faint hover:!text-danger"><X /></IconButton>
      </div>
    </li>
  )
}
