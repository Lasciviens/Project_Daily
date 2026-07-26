import { useState } from 'react'
import { toast } from '../../../app/store'
import { searchFoodsByName, type BarcodeProduct } from '../api/openFoodFactsApi'
import { searchBrandedFoods, isKassalappEnabled } from '../api/kassalappApi'

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

  const inputCls = 'min-h-[44px] px-2.5 text-sm border border-ink-200 rounded-lg bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400'

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5">
        <input value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') run() }}
          placeholder="Search online (e.g. chicken breast, gresham peanut butter)…"
          className={`flex-1 min-w-0 ${inputCls}`} autoFocus />
        <button type="button" onClick={run} disabled={loading || !query.trim()}
          className="shrink-0 min-h-[44px] px-3 rounded-lg text-xs font-semibold bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50">
          {loading ? '…' : 'Search'}
        </button>
      </div>
      {loading && <p className="text-xs text-ink-400">Searching…</p>}
      {!loading && searched && results.length === 0 && (
        <p className="text-xs text-ink-400">No results — try a broader/English name, or add it manually below.</p>
      )}
      {results.length > 0 && (
        <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
          {results.map((p, i) => (
            <button key={`${p.code}-${i}`} type="button" onClick={() => onPick(p)}
              className="press-feedback flex items-center gap-2 text-left px-2.5 py-1.5 min-h-[44px] rounded-lg border border-ink-200 bg-cream-100 hover:border-accent-400 transition-colors">
              {p.image_url && <img src={p.image_url} alt="" className="w-8 h-8 rounded object-cover shrink-0" onError={e => { e.currentTarget.style.display = 'none' }} />}
              <span className="flex-1 min-w-0">
                <span className="text-sm text-ink-800 truncate block">{p.name}</span>
                <span className="text-[10px] text-ink-400">
                  {p.brand ? `${p.brand} · ` : ''}{p.calories != null ? `${Math.round(p.calories)} kcal/100g` : 'no macros'}{p.protein_g != null ? ` · ${Math.round(p.protein_g)}g P` : ''}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
      <p className="text-[10px] text-ink-300">Open Food Facts{isKassalappEnabled() ? ' + Kassalapp (Norwegian stores)' : ''} — a food with no macros is skipped. Review before saving.</p>
    </div>
  )
}
