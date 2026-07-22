import { format } from 'date-fns'
import { supabase } from '../../../integrations/supabase/client'
import { invokeAI, type Message } from '../../ai/api/aiApi'

// Weekly review — the payoff of having training + nutrition + bodyweight in one
// place: a once-a-week cross-domain digest, generated the same lazy+cached way
// as the daily briefing (no cron, no edge function). Plain text + emoji headers
// (no markdown lib in the project), rendered with whitespace-pre-wrap.
const WEEKLY_REVIEW_PROMPT = `Sen Lasci's Board için kişisel bir antrenman & beslenme koçusun. Kullanıcının adı Furkan. Görevin: aşağıdaki GERÇEK son-7-gün verisine dayanarak kısa, dürüst, çapraz bir HAFTALIK DEĞERLENDİRME yazmak — antrenman, beslenme ve kilo trendini BİRLİKTE yorumla (tek tek tablo değil, bağ kur: örn. "antrenman hacmin iyi ama protein hedefin altında kaldı").

Biçim (kesin uy):
- Türkçe, samimi ama net ve dürüst bir koç tonu. Markdown YOK (## / ** / - yok), düz metin.
- Emoji başlıklı 3-4 kısa bölüm (örn. "🏋️ Antrenman", "🍽️ Beslenme", "⚖️ Kilo", "🎯 Bu hafta"). Her bölüm 1-3 satır.
- ~120-200 kelime. Duvar gibi metin yazma.
- Sonda TEK somut, önceliklendirilmiş öneri ("🎯 Bu hafta: ...").

İçerik:
- SADECE verilen veriyi kullan; rakam/eğilim uydurma. Bir alanda veri yoksa o bölümü atla.
- İyi gideni öv, kötü gideni fazla yumuşatmadan söyle (bir kez, suçlamadan).
- Kıyas yaparken sadece verideki sayıları kullan.`

function n(v: unknown): number { const x = Number(v); return Number.isFinite(x) ? x : 0 }

async function buildWeeklyContext(fromStr: string, toStr: string): Promise<string> {
  const [woR, foodR, bodyR] = await Promise.allSettled([
    supabase.from('hevy_workouts').select('title, start_time')
      .gte('start_time', `${fromStr}T00:00:00`).lte('start_time', `${toStr}T23:59:59`)
      .order('start_time', { ascending: true }),
    supabase.from('food_log_entries').select('date, calories, protein_g')
      .eq('status', 'eaten').gte('date', fromStr).lte('date', toStr),
    supabase.from('hevy_body_measurements').select('date, weight_kg')
      .gte('date', fromStr).lte('date', toStr).order('date', { ascending: true }),
  ])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = <T>(r: PromiseSettledResult<any>): T[] => r.status === 'fulfilled' ? (r.value.data ?? []) : []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const workouts = rows<any>(woR)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const food     = rows<any>(foodR)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body     = rows<any>(bodyR)

  const lines: string[] = [`Dönem: ${fromStr} → ${toStr} (son 7 gün)`]

  lines.push(`\nANTRENMAN: ${workouts.length} workout`)
  for (const w of workouts) lines.push(`  ${w.start_time?.slice(0, 10)} — ${w.title}`)

  // nutrition: per-day totals → averages over the days that were actually logged
  const byDay = new Map<string, { kcal: number; protein: number }>()
  for (const f of food) {
    const d = f.date as string
    const cur = byDay.get(d) ?? { kcal: 0, protein: 0 }
    cur.kcal += n(f.calories); cur.protein += n(f.protein_g)
    byDay.set(d, cur)
  }
  if (byDay.size) {
    const days = [...byDay.values()]
    const avgK = Math.round(days.reduce((a, b) => a + b.kcal, 0) / days.length)
    const avgP = Math.round(days.reduce((a, b) => a + b.protein, 0) / days.length)
    lines.push(`\nBESLENME: ${byDay.size}/7 gün loglandı · ortalama ${avgK} kcal/gün · ${avgP} g protein/gün`)
  } else {
    lines.push(`\nBESLENME: bu hafta hiç yemek loglanmamış`)
  }

  if (body.length) {
    const first = n(body[0].weight_kg), last = n(body[body.length - 1].weight_kg)
    const delta = Math.round((last - first) * 10) / 10
    lines.push(`\nKİLO: ${first}kg → ${last}kg (${delta >= 0 ? '+' : ''}${delta}kg, ${body.length} ölçüm)`)
  }

  return lines.join('\n')
}

export async function generateWeeklyReview(): Promise<string> {
  const to = new Date()
  const from = new Date(to.getTime() - 6 * 86400_000)
  const fromStr = format(from, 'yyyy-MM-dd')
  const toStr   = format(to, 'yyyy-MM-dd')

  const context = await buildWeeklyContext(fromStr, toStr)
  const messages: Message[] = [{ role: 'user', content: context }]
  const res = await invokeAI(messages, WEEKLY_REVIEW_PROMPT)
  const text = res.text ?? ''

  // Best-effort durable copy (so it persists cross-device and the coach can
  // recall past reviews). No-op until migration 065 creates ai_reviews.
  try {
    const uid = (await supabase.auth.getUser()).data.user?.id
    if (uid && text) {
      await supabase.from('ai_reviews').insert({
        user_id: uid, kind: 'weekly', period_start: fromStr, period_end: toStr,
        content: text, model: res.model ?? null,
      })
    }
  } catch { /* table may not exist yet / never block the UI */ }

  return text
}
