import { format, addDays } from 'date-fns'
import { supabase } from '../../../integrations/supabase/client'
import { invokeAI, type Message } from '../../ai/api/aiApi'
import { fetchWeather, weatherLabel } from './weatherApi'
import { fetchCurrencyWeekTrend } from './currencyApi'
import { fetchNews, NEWS_FEEDS } from './newsApi'

const OSLO = { lat: 59.9139, lon: 10.7522 }

// The briefing is a plain-text morning digest — deliberately NOT markdown, so
// the card can render it with whitespace-pre-wrap without a markdown parser
// (the project ships no markdown lib). Emoji section headers do the structuring.
const BRIEFING_SYSTEM_PROMPT = `Sen Lasci's Board adlı kişisel bir gösterge panelinin sabah asistanısın. Kullanıcının adı Furkan. Görevin: aşağıda verilen GERÇEK verilere dayanarak Furkan için sıcak, kişisel, GÜNE BAŞLANGIÇ brifingi yazmak — bir arkadaşının güne dair hızlı bir özet geçmesi gibi.

Biçim kuralları (kesinlikle uy):
- Türkçe yaz. Samimi ama abartısız bir ton kullan.
- Markdown KULLANMA (## yok, ** yok, - listesi yok). Düz metin yaz.
- Bölümleri emoji başlıklarıyla ayır (örn. "☀️ Bugün", "✅ İşler", "🏋️ Antrenman", "📰 Gündem", "💱 Döviz", "🎬 İzleme", "📋 Projeler"). Her bölüm 1-4 kısa satır olsun.
- Kısa ve taranabilir tut — duvar gibi metin yazma. Toplamda makul uzunlukta (yaklaşık 150-250 kelime).
- Selamlama tek satır olsun (günün saatine ve hava durumuna göre), sonra bölümler.
- Sonda tek satırlık kısa, motive edici veya bağlama uygun bir kapanış.

İçerik kuralları:
- SADECE sana verilen veriyi kullan. Veri uydurma — durak/haber/rakam icat etme.
- Bir bölümde veri yoksa o bölümü tamamen atla (boş "veri yok" satırı yazma).
- İşler bölümünde: en önemli/yüksek öncelikli veya vakti gelen işlere nazikçe dikkat çek. Bugün iş yoksa bunu olumlu bir şekilde belirt.
- Gündem (haberler) bölümünde: verilen başlıkları Türkçeye çevir/özetle, kaynak ülkeye göre grupla (🇹🇷 / 🇳🇴 / 🌍), her biri tek satır. En çok 2-3 başlık per grup, en dikkat çekicileri seç.
- Döviz bölümünde: haftalık trendi kısaca yorumla (hangi parite ne yönde ne kadar hareket etmiş), Furkan TRY ve NOK ile ilgileniyor.
- Program/schedule varsa bugünkü randevuları/blokları saatleriyle özetle.`

// Gather everything with allSettled so one failing source (e.g. the currency
// API being down) never blocks the whole briefing — missing sections just
// get skipped by the prompt's "skip empty sections" rule.
async function buildBriefingContext(): Promise<string> {
  const today    = format(new Date(), 'yyyy-MM-dd')
  const in14days = format(addDays(new Date(), 14), 'yyyy-MM-dd')

  const [
    tasksR, scheduleR, trainingR, lastWorkoutR, moviesR, tvR, projectsR,
    weatherR, currencyR, ...newsR
  ] = await Promise.allSettled([
    supabase.from('tasks').select('title, status, priority, domain, due_time, description')
      .or(`section.eq.today,due_date.eq.${today}`).neq('status', 'cancelled'),
    supabase.from('time_blocks').select('title, start_time, duration_minutes, category')
      .eq('date', today).order('start_time', { ascending: true }).limit(12),
    supabase.from('time_blocks').select('title, date, start_time')
      .eq('category', 'training').gte('date', today).lte('date', in14days)
      .order('date', { ascending: true }).limit(5),
    supabase.from('hevy_workouts').select('title, hevy_created_at')
      .order('hevy_created_at', { ascending: false }).limit(1),
    supabase.from('user_movie_entries').select('status, movie:movies(title)')
      .eq('status', 'watching').limit(6),
    supabase.from('user_tv_entries').select('status, current_season, current_episode, tv_series:tv_series(title)')
      .in('status', ['watching', 'paused']).limit(6),
    supabase.from('project_items').select('title, status, project:projects(name)')
      .eq('status', 'in_progress').limit(8),
    fetchWeather(OSLO.lat, OSLO.lon),
    fetchCurrencyWeekTrend(),
    ...NEWS_FEEDS.map(f => fetchNews(f.key, 4)),
  ])

  const val = <T>(r: PromiseSettledResult<T>, fallback: T): T =>
    r.status === 'fulfilled' ? r.value : fallback
  // Matches the loosely-typed pattern in aiApi.ts's buildContext — supabase
  // rows here are read-only display data, not worth threading full row types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (r: PromiseSettledResult<any>): any[] =>
    r.status === 'fulfilled' ? (r.value?.data ?? []) : []

  const lines: string[] = [`TARİH: ${format(new Date(), 'EEEE, d MMMM yyyy')}`, `SAAT: ${format(new Date(), 'HH:mm')}`]

  // Weather
  const weather = weatherR.status === 'fulfilled' ? weatherR.value : null
  if (weather) {
    lines.push(`\nHAVA (Oslo): ${weather.current.temp}°C, ${weatherLabel(weather.current.symbol)}, rüzgar ${weather.current.windSpeed} m/s${weather.current.precip1h > 0 ? `, yağış ${weather.current.precip1h}mm` : ''}`)
  }

  // Tasks
  const tasks = rows(tasksR)
  const openTasks = tasks.filter(t => t.status !== 'done')
  const doneCount = tasks.filter(t => t.status === 'done').length
  if (tasks.length) {
    lines.push(`\nBUGÜNKÜ İŞLER (${openTasks.length} açık, ${doneCount} bitti):`)
    for (const t of openTasks) {
      lines.push(`  - ${t.title} [${t.priority} öncelik, ${t.domain}]${t.due_time ? ` @${t.due_time.slice(0, 5)}` : ''}${t.description ? ` — ${t.description}` : ''}`)
    }
  } else {
    lines.push('\nBUGÜNKÜ İŞLER: bugün planlanmış iş yok')
  }

  // Schedule
  const schedule = rows(scheduleR).filter(b => b.start_time)
  if (schedule.length) {
    lines.push('\nBUGÜNKÜ PROGRAM:')
    for (const b of schedule) {
      lines.push(`  - ${b.start_time.slice(0, 5)} ${b.title} (${b.duration_minutes}dk)`)
    }
  }

  // Training
  const training = rows(trainingR)
  if (training.length) {
    lines.push('\nYAKLAŞAN ANTRENMANLAR:')
    for (const s of training) {
      lines.push(`  - ${s.date}${s.start_time ? ` ${s.start_time.slice(0, 5)}` : ''} ${s.title}`)
    }
  }
  const lastWorkout = rows(lastWorkoutR)[0]
  if (lastWorkout) {
    lines.push(`SON ANTRENMAN: ${lastWorkout.title} (${lastWorkout.hevy_created_at?.slice(0, 10)})`)
  }

  // Currency week trend
  const currency = val(currencyR, [] as Awaited<ReturnType<typeof fetchCurrencyWeekTrend>>)
  if (currency.length) {
    lines.push('\nDÖVİZ — SON 7 GÜN TRENDİ:')
    for (const c of currency) {
      const dir = c.changePct >= 0 ? '+' : ''
      lines.push(`  - ${c.pair}: ${c.now.toFixed(c.now > 100 ? 1 : 4)} (${dir}${c.changePct.toFixed(2)}% / hafta)`)
    }
  }

  // News
  const newsSections: string[] = []
  NEWS_FEEDS.forEach((feed, i) => {
    const items = rows(newsR[i])
    if (items.length) {
      const flag = feed.category === 'tr' ? '🇹🇷' : feed.category === 'no' ? '🇳🇴' : '🌍'
      newsSections.push(`  ${flag} ${feed.label}:`)
      for (const it of items.slice(0, 4)) newsSections.push(`    • ${it.title}`)
    }
  })
  if (newsSections.length) {
    lines.push('\nHABER BAŞLIKLARI (çevir/özetle):')
    lines.push(...newsSections)
  }

  // Media
  const movies = rows(moviesR)
  const tv     = rows(tvR)
  if (movies.length || tv.length) {
    lines.push('\nİZLEMEYE DEVAM:')
    for (const m of movies) lines.push(`  - Film: ${m.movie?.title}`)
    for (const s of tv) lines.push(`  - Dizi: ${s.tv_series?.title} (S${s.current_season}E${s.current_episode}${s.status === 'paused' ? ', duraklatıldı' : ''})`)
  }

  // Projects
  const projects = rows(projectsR)
  if (projects.length) {
    lines.push('\nDEVAM EDEN PROJE İŞLERİ:')
    for (const p of projects) lines.push(`  - ${p.title}${p.project?.name ? ` (${p.project.name})` : ''}`)
  }

  return lines.join('\n')
}

export async function generateDailyBriefing(): Promise<string> {
  const context = await buildBriefingContext()
  const messages: Message[] = [{ role: 'user', content: 'Bugünün brifingini hazırla.' }]
  const res = await invokeAI(messages, `${BRIEFING_SYSTEM_PROMPT}\n\n---\nBUGÜNÜN VERİSİ:\n${context}`)
  return res.text
}
