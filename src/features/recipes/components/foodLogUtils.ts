import type { MealSlot } from '../types'

// Non-component helpers shared by the food-logging surfaces (kept out of the
// component files so react-refresh stays happy).

export const SLOT_OPTIONS: { id: MealSlot; icon: string; label: string }[] = [
  { id: 'breakfast',  icon: '🌅', label: 'Breakfast' },
  { id: 'lunch',      icon: '☀️', label: 'Lunch' },
  { id: 'dinner',     icon: '🌙', label: 'Dinner' },
  { id: 'snack',      icon: '🍎', label: 'Snack' },
  { id: 'supplement', icon: '💊', label: 'Supplement' },
]

export function sanitizeDecimal(raw: string): string {
  const cleaned = raw.replace(',', '.').replace(/[^0-9.]/g, '')
  const firstDot = cleaned.indexOf('.')
  return firstDot === -1 ? cleaned : cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
}

// Deterministic emoji for a food with no photo — keyword match on name +
// group (English, Norwegian, Turkish tokens all show up in this library).
const EMOJI_RULES: [RegExp, string][] = [
  [/egg|yumurta|eggerøre/i, '🥚'],
  [/chicken|tavuk|kylling/i, '🍗'],
  [/beef|biff|sığır|kjøttdeig|steak|köfte/i, '🥩'],
  [/fish|laks|salmon|torsk|balık|tuna|ton/i, '🐟'],
  [/rice|pirinç|ris\b/i, '🍚'],
  [/pasta|makarna|spagetti|noodle/i, '🍝'],
  [/bread|ekmek|brød|toast|bagel/i, '🍞'],
  [/oat|yulaf|havre|müsli|musli|granola/i, '🥣'],
  [/milk|süt|melk\b/i, '🥛'],
  [/yog|kefir|skyr/i, '🥛'],
  [/cheese|peynir|ost\b|cheddar|mozzarella/i, '🧀'],
  [/apple|elma|eple/i, '🍎'],
  [/banana|muz|banan/i, '🍌'],
  [/berr|çilek|jordbær|blåbær/i, '🫐'],
  [/potato|patates|potet/i, '🥔'],
  [/tomato|domates|tomat/i, '🍅'],
  [/salad|salat|lettuce|marul/i, '🥬'],
  [/broccoli|brokoli/i, '🥦'],
  [/carrot|havuç|gulrot/i, '🥕'],
  [/nut|fındık|badem|almond|peanut|fıstık|nøtt/i, '🥜'],
  [/chocolate|çikolata|sjokolade/i, '🍫'],
  [/whey|protein|kreatin|creatine|bcaa|scoop/i, '🥤'],
  [/vitamin|omega|magnesium|zink|supplement/i, '💊'],
  [/coffee|kahve|kaffe/i, '☕'],
  [/soup|çorba|suppe/i, '🍲'],
  [/pizza/i, '🍕'],
  [/burger/i, '🍔'],
  [/oil|yağ|olje|butter|tereyağ|smør/i, '🧈'],
]
const GROUP_EMOJI: [RegExp, string][] = [
  [/supplement/i, '💊'],
  [/frukt|fruit|meyve/i, '🍎'],
  [/grønnsak|vegetable|sebze/i, '🥦'],
  [/kjøtt|meat|et\b/i, '🥩'],
  [/fisk|fish/i, '🐟'],
  [/melk|dairy|meieri/i, '🥛'],
  [/korn|grain|brød|cereal/i, '🌾'],
  [/drikke|beverage|içecek/i, '🥤'],
]

export function foodEmoji(name?: string | null, group?: string | null): string {
  const n = name ?? ''
  for (const [re, e] of EMOJI_RULES) if (re.test(n)) return e
  const g = group ?? ''
  for (const [re, e] of GROUP_EMOJI) if (re.test(g)) return e
  return '🥗'
}
