const BASE = 'https://api.met.no/weatherapi/locationforecast/2.0/compact'

export interface WeatherCurrent {
  temp:      number
  symbol:    string
  windSpeed: number
  humidity:  number
  precip1h:  number
}

export interface WeatherHour {
  time:   string  // 'HH:00'
  temp:   number
  symbol: string
  precip: number
}

export interface WeatherData {
  current: WeatherCurrent
  hours:   WeatherHour[]
}

type Timeseries = {
  time: string
  data: {
    instant: { details: { air_temperature: number; wind_speed: number; relative_humidity: number } }
    next_1_hours?: { summary: { symbol_code: string }; details: { precipitation_amount: number } }
    next_6_hours?: { summary: { symbol_code: string }; details: { precipitation_amount: number } }
  }
}

function symbol(s: Timeseries): string {
  return s.data.next_1_hours?.summary.symbol_code
      ?? s.data.next_6_hours?.summary.symbol_code
      ?? 'cloudy'
}

export async function fetchWeather(lat: number, lon: number): Promise<WeatherData> {
  const res = await fetch(`${BASE}?lat=${lat}&lon=${lon}`)
  if (!res.ok) throw new Error(`Weather API ${res.status}`)
  const json = await res.json()
  const series: Timeseries[] = json.properties.timeseries

  const now   = Date.now()
  const future = series.filter(s => new Date(s.time).getTime() >= now - 30 * 60_000)
  const first  = future[0] ?? series[0]

  const current: WeatherCurrent = {
    temp:      Math.round(first.data.instant.details.air_temperature),
    symbol:    symbol(first),
    windSpeed: Math.round(first.data.instant.details.wind_speed),
    humidity:  Math.round(first.data.instant.details.relative_humidity),
    precip1h:  first.data.next_1_hours?.details.precipitation_amount ?? 0,
  }

  const hours: WeatherHour[] = future.slice(0, 12).map(s => {
    const d = new Date(s.time)
    return {
      time:   `${String(d.getHours()).padStart(2, '0')}:00`,
      temp:   Math.round(s.data.instant.details.air_temperature),
      symbol: symbol(s),
      precip: s.data.next_1_hours?.details.precipitation_amount ?? 0,
    }
  })

  return { current, hours }
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
