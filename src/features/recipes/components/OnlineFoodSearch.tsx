import { useState } from 'react'
import { Search } from 'lucide-react'
import { Button } from '../../../shared/ui'
import { toast } from '../../../app/store'
import { searchFoodsByName, type BarcodeProduct } from '../api/openFoodFactsApi'
import { searchBrandedFoods, isKassalappEnabled } from '../api/kassalappApi'
import { MacroWarningBadge } from './MacroWarningBadge'
import { checkMacroConsistency } from '../macroSanity'

// ─────────────────────────────────────────────────────────────────────────────
//  Online food search — the no-barcode / desktop path ("PC'de barkod
//  tarayamıyorum, online bulabilir miyim"). Searches Open Food Facts by name
//  (free, multilingual) and, when the Kassalapp token is configured, Norwegian
//  branded groceries too. Pick a result → onPick(per-100g product) fills the
//  new-ingredient form for review before saving.
// ─────────────────────────────────────────────────────────────────────────────

export function OnlineFoodSearch({ initialQuery = '', onPick }: {
  initialQuery?: string
  onPick: (p: BarcodeProduct) => void
}) {
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<BarcodeProduct[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  async function run() {
    const q = query.trim()
    if (!q) return
    setLoading(true); setSearched(true)
    try {
      // Kassalapp (Norwegian branded) + Open Food Facts, both normalized to the
      // same per-100g shape; dedupe by name. Only surface an error if BOTH fail
      // and nothing came back — one source erroring while the other returns
      // results must NOT toast (that was the "works but shows fetch failed" bug).
      let lastErr: unknown = null
      const [branded, off] = await Promise.all([
        (isKassalappEnabled() ? searchBrandedFoods(q) : Promise.resolve([])).catch((e: unknown) => { lastErr = e; return [] as BarcodeProduct[] }),
        searchFoodsByName(q).catch((e: unknown) => { lastErr = e; return [] as BarcodeProduct[] }),
      ])
      const seen = new Set<string>()
      const merged = [...branded, ...off].filter(p => {
        const k = p.name.toLowerCase()
        if (seen.has(k)) return false
        seen.add(k); return true
      }).slice(0, 20)
      setResults(merged)
      if (merged.length === 0 && lastErr) toast.error((lastErr as Error).message ?? 'Search failed')
    } finally { setLoading(false) }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5">
        <input value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') run() }}
          placeholder="Search online (e.g. chicken breast, gresham peanut butter)"
          aria-label="Search foods online"
          className="input min-w-0 flex-1" autoFocus />
        <Button variant="primary" icon={<Search />} onClick={run} loading={loading} disabled={!query.trim()} className="shrink-0">
          Search
        </Button>
      </div>
      {!loading && searched && results.length === 0 && (
        <p className="text-meta text-fg-muted">No results — try a broader or English name, or add it manually below.</p>
      )}
      {results.length > 0 && (
        <div className="scroll-y flex max-h-64 flex-col gap-1 overflow-y-auto">
          {results.map((p, i) => {
            const macroCheck = checkMacroConsistency(p.calories, p.protein_g, p.carbs_g, p.fat_g)
            // A div wrapper: the warning badge is itself a button, and a
            // <button> can never contain another <button>.
            return (
            <div key={`${p.code}-${i}`}
              className="flex min-h-[44px] items-center gap-2 rounded-row border border-line bg-surface px-2.5 py-1.5 transition-colors hover:border-accent-500/60">
              <button type="button" onClick={() => onPick(p)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                {p.image_url && <img src={p.image_url} alt="" className="h-8 w-8 shrink-0 rounded-md object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-fg">{p.name}</span>
                  <span className="text-meta text-fg-muted tabular-nums">
                    {p.brand ? `${p.brand} · ` : ''}{p.calories != null ? `${Math.round(p.calories)} kcal/100g` : 'no macros'}{p.protein_g != null ? ` · ${Math.round(p.protein_g)}g protein` : ''}
                  </span>
                </span>
              </button>
              {/* Flags a source-data inconsistency before it's ever saved. */}
              <MacroWarningBadge result={macroCheck} />
            </div>
            )
          })}
        </div>
      )}
      <p className="text-meta text-fg-muted">Open Food Facts{isKassalappEnabled() ? ' + Kassalapp (Norwegian stores)' : ''} — a food with no macros is skipped. Review before saving.</p>
    </div>
  )
}
