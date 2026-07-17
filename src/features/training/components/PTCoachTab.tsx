import { useState } from 'react'
import { generatePTAssessment } from '../api/ptCoachApi'
import { toast } from '../../../app/store'
import { todayStr } from '../../../shared/utils/dateUtils'

// ─────────────────────────────────────────────────────────────────────────────
//  AI PT — user-initiated daily assessment (NEVER auto-runs; each run costs
//  one AI request). Once-per-day cache in localStorage, same rationale as the
//  Home daily briefing; "Yeniden değerlendir" is the explicit re-run.
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_KEY = 'lasci.ptAssessment'
interface Cached { date: string; text: string; feeling: string }

function readCache(): Cached | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) as Cached : null
  } catch { return null }
}

const FEELINGS = [
  { id: 'az çalıştım',  label: '😴 Az çalıştım' },
  { id: 'normal',       label: '🙂 Normal' },
  { id: 'yorgunum',     label: '😮‍💨 Yorgunum' },
  { id: 'çok yorgunum', label: '🥵 Çok yorgunum' },
]

// Minimal markdown: only **bold** (matches AIPanel's renderer).
function renderBold(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={i} className="text-ink-900">{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>
  )
}

export function PTCoachTab() {
  const today = todayStr()
  // Lazy initializers read today's cached assessment once at mount — no
  // effect needed (and no set-state-in-effect cascade).
  const [feeling, setFeeling] = useState<string>(() => {
    const c = readCache()
    return c?.date === today ? c.feeling : 'normal'
  })
  const [note, setNote] = useState('')
  const [result, setResult] = useState<string | null>(() => {
    const c = readCache()
    return c?.date === today ? c.text : (c?.text ?? null)
  })
  const [resultDate, setResultDate] = useState<string | null>(() => readCache()?.date ?? null)
  const [loading, setLoading] = useState(false)

  async function run() {
    setLoading(true)
    const tid = toast.loading('Koç verilerini inceliyor…')
    try {
      const text = await generatePTAssessment({ feeling, note: note.trim() || undefined })
      setResult(text)
      setResultDate(today)
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ date: today, text, feeling } satisfies Cached)) } catch { /* quota */ }
      toast.dismiss(tid); toast.success('Değerlendirme hazır ✓')
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Değerlendirme başarısız')
    } finally {
      setLoading(false)
    }
  }

  const hasToday = result != null && resultDate === today

  return (
    <div className="max-w-2xl">
      <div className="rounded-2xl border border-ink-200 bg-cream-50 p-5 flex flex-col gap-4">
        <div>
          <h3 className="text-base font-bold text-ink-900">🧠 AI Koç — Günlük Değerlendirme</h3>
          <p className="text-xs text-ink-400 mt-0.5">
            Antrenmanını, setlerini/ağırlıklarını, haftalık kas hacmini, uykunu ve aktiviteni okuyup
            gerçek bir PT gibi değerlendirir. Sen başlatırsın — otomatik çalışmaz.
          </p>
        </div>

        {/* Feeling input */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400 mb-1.5">Bugün nasıl hissediyorsun?</p>
          <div className="flex flex-wrap gap-1.5">
            {FEELINGS.map(f => (
              <button
                key={f.id}
                onClick={() => setFeeling(f.id)}
                className={`text-xs px-3 py-2 rounded-lg border transition-colors min-h-[40px] ${
                  feeling === f.id
                    ? 'bg-accent-500 text-white border-accent-500'
                    : 'text-ink-600 border-ink-200 hover:border-accent-300'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="İstersen ekle: ağrı, motivasyon, hedef… (opsiyonel)"
            className="mt-2 w-full px-3 py-2 text-sm rounded-lg border border-ink-200 bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400 min-h-[44px]"
          />
        </div>

        <button
          onClick={run}
          disabled={loading}
          className="bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50 min-h-[44px] px-4 rounded-xl text-sm font-semibold transition-colors self-start"
        >
          {loading ? 'Değerlendiriyor…' : hasToday ? '↻ Yeniden değerlendir' : '▶ Değerlendir'}
        </button>

        {result && (
          <div className="border-t border-ink-100 pt-3">
            {resultDate !== today && (
              <p className="text-[10px] text-amber-600 mb-1">Bu değerlendirme {resultDate} tarihli.</p>
            )}
            <div className="text-sm text-ink-700 leading-relaxed whitespace-pre-wrap">
              {renderBold(result)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
