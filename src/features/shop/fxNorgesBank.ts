// Norges Bank's daily exchange rates to NOK (data.norges-bank.no, the EXR
// dataset, no key) — the rates Shop freezes on a purchase, a sale or an extra
// cost. Pure: the shop-price edge function fetches and runs this to fill
// fx_rates_nok (migration 137); scripts/verify-shop-owned.cjs checks it and
// that the mirror below is identical.
//
// Shape verified live on 08.10.2026
// (EXR/B.TRY+EUR+USD.NOK.SP?format=sdmx-json&startPeriod=…&endPeriod=…):
//   data.structure.dimensions.series = [FREQ, BASE_CUR, QUOTE_CUR, TENOR]
//   data.structure.dimensions.observation = [TIME_PERIOD] (business days only)
//   data.structure.attributes.series includes UNIT_MULT: TRY is quoted per
//   100 (UNIT_MULT 2), EUR and USD per 1 (UNIT_MULT 0)
//   data.dataSets[0].series["0:<base>:0:0"] = { attributes: [<value index per
//   series attribute>], observations: { "<time index>": ["53.78"] } }
//
// The block between the <fx-norges-bank> markers is a HAND MIRROR in
// supabase/functions/shop-price/index.ts.

// <fx-norges-bank>
export const NB_CURRENCIES = ['TRY', 'EUR', 'USD'] as const

/** The query for every currency we need over a range of days (yyyy-mm-dd). */
export function norgesBankUrl(from: string, to: string, currencies: readonly string[] = NB_CURRENCIES): string {
  const list = currencies.filter(c => (NB_CURRENCIES as readonly string[]).includes(c))
  return `https://data.norges-bank.no/api/data/EXR/B.${(list.length ? list : NB_CURRENCIES).join('+')}.NOK.SP?format=sdmx-json&startPeriod=${from}&endPeriod=${to}&locale=en`
}

export interface NbRate { currency: string; day: string; nokPerUnit: number }

type J = Record<string, unknown>
const obj = (v: unknown): J => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as J : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** Every published rate in a Norges Bank SDMX-JSON answer, as NOK per ONE unit (TRY's per-100 quote divided). */
export function parseNorgesBank(json: unknown): NbRate[] {
  const data = obj(obj(json).data)
  const structure = obj(data.structure)
  const dims = obj(structure.dimensions)
  const seriesDims = arr(dims.series).map(obj)
  const timeValues = arr(obj(arr(dims.observation)[0]).values).map(v => String(obj(v).id ?? ''))
  const baseIdx = seriesDims.findIndex(d => d.id === 'BASE_CUR')
  const quoteIdx = seriesDims.findIndex(d => d.id === 'QUOTE_CUR')
  const seriesAttrs = arr(obj(structure.attributes).series).map(obj)
  const multIdx = seriesAttrs.findIndex(a => a.id === 'UNIT_MULT')
  const out: NbRate[] = []
  const sets = arr(data.dataSets)
  for (const [key, raw] of Object.entries(obj(obj(sets[0]).series))) {
    const parts = key.split(':').map(Number)
    const base = String(obj(arr(seriesDims[baseIdx]?.values)[parts[baseIdx]]).id ?? '')
    const quote = quoteIdx >= 0 ? String(obj(arr(seriesDims[quoteIdx]?.values)[parts[quoteIdx]]).id ?? '') : 'NOK'
    if (!base || quote !== 'NOK') continue
    const s = obj(raw)
    const attrIdx = arr(s.attributes)[multIdx]
    const multRaw = multIdx >= 0 && typeof attrIdx === 'number' ? obj(arr(seriesAttrs[multIdx].values)[attrIdx]).id : '0'
    const mult = Math.pow(10, Number(multRaw ?? 0) || 0)
    for (const [t, o] of Object.entries(obj(s.observations))) {
      const day = timeValues[Number(t)]
      const value = Number(String(arr(o)[0] ?? '').replace(',', '.'))
      if (!day || !Number.isFinite(value) || value <= 0) continue
      out.push({ currency: base, day, nokPerUnit: value / mult })
    }
  }
  return out.sort((a, b) => a.currency.localeCompare(b.currency) || a.day.localeCompare(b.day))
}

function addDay(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}
const isWeekend = (day: string) => { const [y, m, d] = day.split('-').map(Number); const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return w === 0 || w === 6 }

export interface CalendarRate { day: string; currency: string; nok_per_unit: number; rate_day: string }

/**
 * One rate per calendar day from `from` to `to`: a business day its own, any
 * other day the last business day's before it. A day after the last published
 * one is filled only across a weekend — a weekday may simply not be published
 * yet (or be a holiday the next answer will show), so it waits.
 */
export function calendarRates(rates: readonly NbRate[], from: string, to: string): CalendarRate[] {
  const out: CalendarRate[] = []
  const byCur = new Map<string, NbRate[]>()
  for (const r of rates) byCur.set(r.currency, [...(byCur.get(r.currency) ?? []), r])
  for (const [currency, list] of byCur) {
    list.sort((a, b) => a.day.localeCompare(b.day))
    const lastPublished = list[list.length - 1].day
    let k = -1
    for (let day = from; day <= to; day = addDay(day, 1)) {
      while (k + 1 < list.length && list[k + 1].day <= day) k++
      if (k < 0) continue
      if (day > lastPublished) {
        let ok = true
        for (let d = addDay(lastPublished, 1); d <= day; d = addDay(d, 1)) if (!isWeekend(d)) { ok = false; break }
        if (!ok) continue
      }
      out.push({ day, currency, nok_per_unit: list[k].nokPerUnit, rate_day: list[k].day })
    }
  }
  return out
}
// </fx-norges-bank>
