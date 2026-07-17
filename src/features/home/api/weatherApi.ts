const BASE = 'https://api.met.no/weatherapi/locationforecast/2.0/compact'

export interface WeatherCurrent {
  temp:          number
  symbol:        string
  windSpeed:     number
  windDirection: string   // 8-point compass label, e.g. 'NW'
  humidity:      number
  pressure:      number   // hPa, sea level
  cloudCover:    number   // %
  precip1h:      number
}

export interface WeatherHour {
  time:   string  // 'HH:00'
  temp:   number
  symbol: string
  precip: number
}

export interface WeatherDay {
  date:   string  // 'yyyy-MM-dd'
  label:  string  // 'Mon', 'Tue', ...
  min:    number
  max:    number
  symbol: string  // midday symbol, most representative of the day
  precip: number  // total for the day
}

export interface WeatherData {
  current: WeatherCurrent
  hours:   WeatherHour[]
  daily:   WeatherDay[]
}

type Timeseries = {
  time: string
  data: {
    instant: {
      details: {
        air_temperature:          number
        wind_speed:               number
        wind_from_direction?:     number
        relative_humidity:        number
        air_pressure_at_sea_level?: number
        cloud_area_fraction?:     number
      }
    }
    next_1_hours?: { summary: { symbol_code: string }; details: { precipitation_amount: number } }
    next_6_hours?: { summary: { symbol_code: string }; details: { precipitation_amount: number } }
  }
}

function symbol(s: Timeseries): string {
  return s.data.next_1_hours?.summary.symbol_code
      ?? s.data.next_6_hours?.summary.symbol_code
      ?? 'cloudy'
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
function degToCompass(deg: number): string {
  return COMPASS[Math.round(deg / 45) % 8]
}

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Groups the raw series into calendar days (starting tomorrow — today is
// already covered by "current" + the 12h strip) and picks a representative
// midday symbol per day, so the forecast doesn't just show whatever the first
// hour of the day happens to be (e.g. clear at 00:00, rain all afternoon).
function computeDailyForecast(series: Timeseries[], daysAhead = 5): WeatherDay[] {
  const todayStr = localDateStr(new Date())
  const byDate = new Map<string, Timeseries[]>()
  for (const s of series) {
    const d = new Date(s.time)
    const key = localDateStr(d)
    if (key === todayStr) continue
    const bucket = byDate.get(key) ?? []
    bucket.push(s)
    byDate.set(key, bucket)
  }

  const days = [...byDate.entries()].slice(0, daysAhead)
  return days.map(([date, points]) => {
    const temps = points.map(p => p.data.instant.details.air_temperature)
    const precip = points.reduce((sum, p) => sum + (p.data.next_1_hours?.details.precipitation_amount ?? p.data.next_6_hours?.details.precipitation_amount ?? 0), 0)
    // Midday point (closest to 12:00 local) is the most representative symbol
    // for a compact day summary — midnight/early-morning symbols are misleading.
    const midday = points.reduce((best, p) => {
      const hour = new Date(p.time).getHours()
      const bestHour = new Date(best.time).getHours()
      return Math.abs(hour - 12) < Math.abs(bestHour - 12) ? p : best
    }, points[0])
    return {
      date,
      label: new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' }),
      min: Math.round(Math.min(...temps)),
      max: Math.round(Math.max(...temps)),
      symbol: symbol(midday),
      precip: Math.round(precip * 10) / 10,
    }
  })
}

export async function fetchWeather(lat: number, lon: number): Promise<WeatherData> {
  const res = await fetch(`${BASE}?lat=${lat}&lon=${lon}`)
  if (!res.ok) throw new Error(`Weather API ${res.status}`)
  const json = await res.json()
  const series: Timeseries[] = json.properties.timeseries

  const now   = Date.now()
  const future = series.filter(s => new Date(s.time).getTime() >= now - 30 * 60_000)
  const first  = future[0] ?? series[0]
  const d = first.data.instant.details

  const current: WeatherCurrent = {
    temp:          Math.round(d.air_temperature),
    symbol:        symbol(first),
    windSpeed:     Math.round(d.wind_speed),
    windDirection: d.wind_from_direction != null ? degToCompass(d.wind_from_direction) : '—',
    humidity:      Math.round(d.relative_humidity),
    pressure:      Math.round(d.air_pressure_at_sea_level ?? 0),
    cloudCover:    Math.round(d.cloud_area_fraction ?? 0),
    precip1h:      first.data.next_1_hours?.details.precipitation_amount ?? 0,
  }

  const hours: WeatherHour[] = future.slice(0, 12).map(s => {
    const dt = new Date(s.time)
    return {
      time:   `${String(dt.getHours()).padStart(2, '0')}:00`,
      temp:   Math.round(s.data.instant.details.air_temperature),
      symbol: symbol(s),
      precip: s.data.next_1_hours?.details.precipitation_amount ?? 0,
    }
  })

  const daily = computeDailyForecast(series)

  return { current, hours, daily }
}

const ICON_MAP: Record<string, string> = {
  clearsky_day: '☀️', clearsky_night: '🌙', clearsky_polartwilight: '🌅',
  fair_day: '🌤', fair_night: '🌤', fair_polartwilight: '🌤',
  partlycloudy_day: '⛅', partlycloudy_night: '⛅', partlycloudy_polartwilight: '⛅',
  cloudy: '☁️', fog: '🌫',
  rainshowers_day: '🌦', rainshowers_night: '🌧', rainshowers_polartwilight: '🌧',
  rainshowersandthunder_day: '⛈', rainshowersandthunder_night: '⛈',
  sleetshowers_day: '🌨', sleetshowers_night: '🌨',
  snowshowers_day: '🌨', snowshowers_night: '❄️',
  rain: '🌧', heavyrain: '⛈', heavyrainandthunder: '⛈',
  lightrain: '🌧', lightrainandthunder: '🌩',
  sleet: '🌨', heavysleet: '🌨', lightsleet: '🌨',
  snow: '❄️', heavysnow: '❄️', lightsnow: '🌨',
  rainandthunder: '⛈', snowandthunder: '⛈',
}

export function weatherIcon(code: string): string {
  return ICON_MAP[code] ?? ICON_MAP[code.replace(/_day|_night|_polartwilight/, '')] ?? '🌡️'
}

export function weatherLabel(code: string): string {
  const base = code.replace(/_day|_night|_polartwilight/, '')
  const labels: Record<string, string> = {
    clearsky: 'Clear sky', fair: 'Fair', partlycloudy: 'Partly cloudy',
    cloudy: 'Cloudy', fog: 'Foggy', rainshowers: 'Rain showers',
    rainshowersandthunder: 'Thundershowers', sleetshowers: 'Sleet showers',
    snowshowers: 'Snow showers', rain: 'Rain', heavyrain: 'Heavy rain',
    lightrain: 'Light rain', lightrainandthunder: 'Light rain & thunder',
    sleet: 'Sleet', heavysleet: 'Heavy sleet', lightsleet: 'Light sleet',
    snow: 'Snow', heavysnow: 'Heavy snow', lightsnow: 'Light snow',
    rainandthunder: 'Rain & thunder', heavyrainandthunder: 'Storm',
  }
  return labels[base] ?? base.replace(/_/g, ' ')
}
