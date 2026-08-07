import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { generatePTAssessment, fetchAssessments, type PTAssessmentRow } from '../api/ptCoachApi'
import { toast } from '../../../app/store'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useAthleteProfile, useAthleteLimitations } from '../hooks/useAthleteProfile'
import { AthleteProfileSheet } from './AthleteProfileSheet'

// ─────────────────────────────────────────────────────────────────────────────
//  AI PT — user-initiated daily assessment (NEVER auto-runs; each run costs
//  one AI request). Assessments are LOGGED to pt_assessments (migration 051)
//  so the coach can follow up on its own advice next time, and the history
//  is browsable below. DB is the source of truth (localStorage cache retired).
// ─────────────────────────────────────────────────────────────────────────────

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

const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

export function PTCoachTab() {
  const today = todayStr()
  const qc = useQueryClient()
  const [feeling, setFeeling] = useState('normal')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [openHistoryId, setOpenHistoryId] = useState<string | null>(null)
  // Fallback display if the DB log isn't available yet (migration 051 not
  // applied): the generated text still shows, it just isn't persisted.
  const [localResult, setLocalResult] = useState<{ text: string; model: string | null } | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const { data: athleteProfile } = useAthleteProfile()
  const { data: activeLimitations = [] } = useAthleteLimitations(true)

  const { data: history = [] } = useQuery({
    queryKey: ['pt-assessments'],
    queryFn:  () => fetchAssessments(14),
    staleTime: 60_000,
  })

  // Latest of today = the "current" assessment; everything else is history.
  const dbCurrent: PTAssessmentRow | undefined = history.find(a => a.date === today)
  const current = dbCurrent ?? (localResult ? {
    id: 'local', date: today, feeling, note: note || null,
    assessment: localResult.text, model: localResult.model, created_at: '',
  } satisfies PTAssessmentRow : undefined)
  const past = history.filter(a => a.id !== current?.id)

  // Compact profile readout for the coach snapshot (see AthleteProfileSheet
  // for the actual form) — an unset profile invites setup instead of a blank.
  const profileParts = [athleteProfile?.goal?.replace('_', ' '), athleteProfile?.experience_level, athleteProfile?.equipment_access]
    .filter((p): p is string => !!p)
  const profileSummary = profileParts.length > 0
    ? `🎯 ${profileParts.join(' · ')}${activeLimitations.length > 0 ? ` · ${activeLimitations.length} limitation${activeLimitations.length === 1 ? '' : 's'}` : ''}`
    : 'Set up your training profile'

  async function run() {
    setLoading(true)
    const tid = toast.loading('Koç verilerini inceliyor…')
    try {
      const res = await generatePTAssessment({ feeling, note: note.trim() || undefined })
      setLocalResult(res)
      qc.invalidateQueries({ queryKey: ['pt-assessments'] })
      toast.dismiss(tid); toast.success('Değerlendirme hazır ✓')
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Değerlendirme başarısız')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2 rounded-xl border border-ink-200 bg-cream-50 px-3 py-1">
        <span className="text-xs text-ink-500 truncate">{profileSummary}</span>
        <button
          type="button"
          onClick={() => setProfileOpen(true)}
          aria-label="Training profile settings"
          title="Training profile"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-ink-500 hover:bg-cream-100 hover:text-ink-800 transition-colors shrink-0"
        >
          ⚙
        </button>
      </div>

      <AthleteProfileSheet open={profileOpen} onClose={() => setProfileOpen(false)} />

      <div className="rounded-2xl border border-ink-200 bg-cream-50 p-5 flex flex-col gap-4">
        <div>
          <h3 className="text-base font-bold text-ink-900">🧠 AI Koç — Günlük Değerlendirme</h3>
          <p className="text-xs text-ink-400 mt-0.5">
            Antrenmanını, setlerini/ağırlıklarını, haftalık kas hacmini, uykunu ve aktiviteni okuyup
            gerçek bir PT gibi değerlendirir; bir önceki değerlendirmesinin takibini de yapar.
            Sen başlatırsın — otomatik çalışmaz. Her değerlendirme kaydedilir.
          </p>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400 mb-1.5">Bugün nasıl hissediyorsun?</p>
          <div className="flex flex-wrap gap-1.5">
            {FEELINGS.map(f => (
              <button
                key={f.id}
                onClick={() => setFeeling(f.id)}
                className={`text-xs px-3 py-2 rounded-lg border transition-colors min-h-[44px] ${
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
          {loading ? 'Değerlendiriyor…' : current ? '↻ Yeniden değerlendir' : '▶ Değerlendir'}
        </button>

        {current && (
          <div className="border-t border-ink-100 pt-3">
            <div className="text-sm text-ink-700 leading-relaxed whitespace-pre-wrap">
              {renderBold(current.assessment)}
            </div>
            {/* Which model ACTUALLY answered — the fallback chain may have
                landed somewhere other than the default. */}
            <p className="text-[10px] text-ink-300 mt-2">
              {current.model ? current.model.replace('gemini-', '') : ''} · his: {current.feeling}
              {current.note ? ` · "${current.note}"` : ''}
            </p>
          </div>
        )}
      </div>

      {/* ── Assessment log ── */}
      {past.length > 0 && (
        <div className="rounded-2xl border border-ink-200 bg-cream-50 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400 mb-2">📜 Geçmiş değerlendirmeler</p>
          <ul className="flex flex-col gap-1">
            {past.map(a => (
              <li key={a.id} className="border border-ink-100 rounded-lg">
                <button
                  onClick={() => setOpenHistoryId(openHistoryId === a.id ? null : a.id)}
                  className="w-full flex items-center gap-2 px-2.5 py-2 text-left min-h-[44px]"
                >
                  <span className="text-xs font-semibold text-ink-800 shrink-0">{fmtDate(a.date)}</span>
                  <span className="text-[11px] text-ink-400 truncate flex-1">{a.feeling}{a.note ? ` · ${a.note}` : ''}</span>
                  <span className="text-[10px] text-ink-300 shrink-0">{openHistoryId === a.id ? '▲' : '▼'}</span>
                </button>
                {openHistoryId === a.id && (
                  <div className="px-2.5 pb-2.5 text-xs text-ink-600 leading-relaxed whitespace-pre-wrap border-t border-ink-50 pt-2">
                    {renderBold(a.assessment)}
                    {a.model && <p className="text-[10px] text-ink-300 mt-1.5">{a.model.replace('gemini-', '')}</p>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
