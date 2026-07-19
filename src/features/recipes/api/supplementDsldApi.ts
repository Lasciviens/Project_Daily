// Supplement lookup via the NIH DSLD (Dietary Supplement Label Database) —
// api.ods.od.nih.gov/dsld/v9. Free, no API key, CORS-open (access-control-
// allow-origin: *), so the browser calls it directly — no edge function.
// Verified live before wiring (per this repo's no-speculative-schema rule):
//   • search-filter?q=creatine → 3957 label hits (excellent supplement coverage)
//   • search hits carry a REDUCED projection (brandName/fullName only) — the
//     real macros live on label/{id}, so selection is a two-step fetch.
//   • label/{id} → { brandName, fullName, upcSku, servingSizes:[{minQuantity,
//     maxQuantity, unit, notes}], ingredientRows:[{ name, quantity:[{ quantity,
//     unit, servingSizeQuantity, servingSizeUnit }] }], thumbnail }
//   • ingredientRows[].quantity[0].quantity is ALREADY per serving.
// US products only — European/Norwegian brands come via the barcode → Open
// Food Facts path instead. Data is US-federal (public domain); we keep the
// source tag on the saved row for provenance.

const DSLD_BASE = 'https://api.ods.od.nih.gov/dsld/v9'

export interface SupplementHit {
  id:    string
  brand: string
  name:  string
  form:  string | null   // e.g. "Powder", "Capsule"
}

export interface SupplementActive {
  name:   string
  amount: number | null
  unit:   string | null
}

// A normalized supplement, macros PER SERVING (a scoop/capsule/etc.) — not the
// per-100g basis regular foods use, because a capsule has no meaningful per-100g
// protein. serving_grams is filled only when the label's serving is gram-based
// (protein/creatine powder), which lets it also convert cleanly to a per-100g
// library row.
export interface SupplementProduct {
  source:        string        // 'dsld' | 'openfoodfacts'
  source_ref:    string        // upcSku / EAN / dsld id
  name:          string
  brand:         string | null
  image_url:     string | null
  serving_label: string | null // e.g. "1 scoop", "2 Capsule(s)"
  serving_grams: number | null // grams per serving (gram-based servings only)
  calories:      number | null
  protein_g:     number | null
  carbs_g:       number | null
  fat_g:         number | null
  fiber_g:       number | null
  sugar_g:       number | null
  actives:       SupplementActive[]   // e.g. Creatine 5 g, Caffeine 200 mg
}

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') { const n = Number(v.replace(',', '.')); return Number.isFinite(n) ? n : null }
  return null
}

export async function searchSupplements(query: string): Promise<SupplementHit[]> {
  const q = query.trim()
  if (!q) return []
  const res = await fetch(`${DSLD_BASE}/search-filter?q=${encodeURIComponent(q)}&size=20`, {
    headers: { accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Supplement search failed (${res.status})`)
  const json = await res.json()
  const hits = Array.isArray(json?.hits) ? json.hits : []
  return hits
    .map((h: Record<string, unknown>): SupplementHit => {
      const src = (h._source ?? {}) as Record<string, unknown>
      const physical = src.physicalState as Record<string, unknown> | undefined
      return {
        id:    String(h._id ?? ''),
        brand: (src.brandName as string) ?? '',
        name:  (src.fullName as string) ?? (src.brandName as string) ?? 'Supplement',
        form:  (physical?.langualCodeDescription as string) ?? null,
      }
    })
    .filter((h: SupplementHit) => h.id && h.name)
}

// Nutrition-facts row names we map onto macro fields (DSLD label conventions;
// several spellings observed across labels).
const MACRO_ROWS: Record<keyof Pick<SupplementProduct, 'calories' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g' | 'sugar_g'>, string[]> = {
  calories:  ['calories', 'energy'],
  protein_g: ['protein'],
  carbs_g:   ['total carbohydrate', 'total carbohydrates', 'carbohydrate', 'carbohydrates'],
  fat_g:     ['total fat', 'total lipid', 'fat'],
  fiber_g:   ['dietary fiber', 'fiber', 'total dietary fiber'],
  sugar_g:   ['total sugars', 'sugars', 'sugar', 'added sugars'],
}
const MACRO_NAME_SET = new Set(Object.values(MACRO_ROWS).flat())

export async function fetchSupplementLabel(id: string): Promise<SupplementProduct> {
  const res = await fetch(`${DSLD_BASE}/label/${encodeURIComponent(id)}`, {
    headers: { accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Supplement label failed (${res.status})`)
  const j = await res.json() as Record<string, unknown>

  const rows = (Array.isArray(j.ingredientRows) ? j.ingredientRows : []) as Array<Record<string, unknown>>
  const rowValue = (names: string[]): number | null => {
    const row = rows.find(r => names.includes(String(r.name ?? '').trim().toLowerCase()))
    const q = Array.isArray(row?.quantity) ? (row!.quantity as Array<Record<string, unknown>>)[0] : undefined
    return num(q?.quantity)
  }

  // Serving: prefer a gram-based one (powders) so it converts to per-100g.
  const servings = (Array.isArray(j.servingSizes) ? j.servingSizes : []) as Array<Record<string, unknown>>
  const gramServing = servings.find(s => String(s.unit ?? '').toLowerCase().startsWith('gram'))
  const firstServing = servings[0]
  const serving_grams = gramServing ? num(gramServing.minQuantity) : null
  const serving_label = (gramServing?.notes as string)
    ?? (firstServing ? `${num(firstServing.minQuantity) ?? ''} ${firstServing.unit ?? ''}`.trim() : null)

  // Notable non-macro active ingredients per serving (creatine, caffeine…) —
  // the supplement-specific signal a plain food DB can't give.
  const actives: SupplementActive[] = rows
    .filter(r => !MACRO_NAME_SET.has(String(r.name ?? '').trim().toLowerCase()))
    .map(r => {
      const q = Array.isArray(r.quantity) ? (r.quantity as Array<Record<string, unknown>>)[0] : undefined
      return { name: String(r.name ?? '').trim(), amount: num(q?.quantity), unit: (q?.unit as string) ?? null }
    })
    .filter(a => a.name && a.amount != null)
    .slice(0, 6)

  const brand = (j.brandName as string) ?? null
  const full  = (j.fullName as string) ?? ''
  return {
    source:        'dsld',
    source_ref:    String(j.upcSku ?? id),
    name:          [brand, full].filter(Boolean).join(' ').trim() || 'Supplement',
    brand,
    image_url:     (j.thumbnail as string) ?? null,
    serving_label,
    serving_grams,
    calories:      rowValue(MACRO_ROWS.calories),
    protein_g:     rowValue(MACRO_ROWS.protein_g),
    carbs_g:       rowValue(MACRO_ROWS.carbs_g),
    fat_g:         rowValue(MACRO_ROWS.fat_g),
    fiber_g:       rowValue(MACRO_ROWS.fiber_g),
    sugar_g:       rowValue(MACRO_ROWS.sugar_g),
    actives,
  }
}
