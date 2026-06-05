export interface CurrencyData {
  base:  string
  date:  string
  rates: Record<string, number>
}

const TARGETS = ['EUR', 'USD', 'GBP', 'SEK', 'DKK']

export async function fetchCurrency(base = 'NOK', targets = TARGETS): Promise<CurrencyData> {
  const res = await fetch(
    `https://api.frankfurter.app/latest?from=${base}&to=${targets.join(',')}`
  )
  if (!res.ok) throw new Error(`Currency API ${res.status}`)
  return res.json()
}
