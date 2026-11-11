// Shop's suggested categories and their default pictures (owner, 10.11.2026:
// "Add more sub categories and default pictures for them if no picture found
// or added"). Pure — scripts/verify-shop-taxonomy.cjs.
//
// Nothing here is ever written by itself: a category picker lists the owner's
// own categories first, then the ones below the owner doesn't have yet
// ("Suggested"), and picking one creates it then; "Add the suggested
// categories" makes them all at once, on the owner's tap (`suggestedPlan`,
// owner 10.11.2026). Names are matched case-,
// space- and "&"/"and"-insensitively, and through a few other names for the
// same thing (`aka`), so a suggestion never repeats what the owner has; the
// owner's own names always win. The list holds migration 030's seed, so its
// categories are matched, never suggested again.

/** The default pictures: a lucide icon each, drawn on the category's tint (components/categoryIcons.ts). */
export const PICTURES = [
  'apple', 'armchair', 'baby', 'bath', 'bed-double', 'beef', 'bike', 'book', 'book-headphones', 'book-image', 'book-open',
  'book-open-text', 'boxes', 'cable', 'camera', 'car-front', 'cooking-pot', 'cookie', 'croissant', 'cup-soda', 'coffee', 'dices',
  'drone', 'droplet', 'droplets', 'dumbbell', 'fish', 'fishing-rod', 'flame', 'footprints', 'gamepad', 'gamepad-2', 'gem', 'gift',
  'glasses', 'guitar', 'hammer', 'handbag', 'headphones', 'heart-pulse', 'house-wifi', 'image', 'lamp', 'laptop', 'luggage', 'milk',
  'monitor', 'monitor-smartphone', 'mountain', 'mountain-snow', 'newspaper', 'notebook-pen', 'package', 'paint-roller', 'palette',
  'paw-print', 'pen', 'perfume-bottle', 'pill', 'pill-bottle', 'plug-zap', 'puzzle', 'sandwich', 'scissors', 'shirt',
  'shopping-basket', 'smartphone', 'snowflake', 'soap-dispenser-droplet', 'sofa', 'sparkles', 'sport-shoe', 'spray-can', 'sprout',
  'tablet', 'tent', 'toothbrush', 'toy-brick', 'trees', 'tv', 'umbrella', 'volleyball', 'washing-machine', 'watch', 'waves', 'wheat',
  'wrench',
] as const
export type PictureKey = typeof PICTURES[number]

export interface TaxonomySub {
  name: string
  /** Other names for the same thing: an owner's category with one of them is this one. */
  aka?: readonly string[]
  /** Without one, the top category's. */
  picture?: PictureKey
}
export interface TaxonomyTop { name: string; aka?: readonly string[]; picture: PictureKey; subs: readonly TaxonomySub[] }

/**
 * Ten top categories for a Norwegian shopper, 6–12 subcategories each, in
 * English — rain gear and wool layers, skiing and snow clearing, the cabin,
 * pålegg, EV charging and roof boxes. Names are data in the owner's list, so
 * they follow migration 030's seed, which is in it: Title Case ("Computers &
 * Laptops"), so a picked suggestion never stands out in a mixed list.
 */
export const TAXONOMY: readonly TaxonomyTop[] = [
  { name: 'Electronics', aka: ['Electronic', 'Tech', 'Elektronikk'], picture: 'monitor-smartphone', subs: [
    { name: 'Phones', aka: ['Mobile phones', 'Smartphones', 'Mobiles'], picture: 'smartphone' },
    { name: 'Tablets', aka: ['iPads', 'E-readers'], picture: 'tablet' },
    { name: 'Computers & Laptops', aka: ['Computers', 'Laptops', 'PCs'], picture: 'laptop' },
    { name: 'Monitors', aka: ['Screens'], picture: 'monitor' },
    { name: 'Headphones', aka: ['Earbuds', 'Headsets'], picture: 'headphones' },
    { name: 'TV & Audio', aka: ['TV', 'TVs', 'Audio', 'TV & sound', 'Sound'], picture: 'tv' },
    { name: 'Cameras', aka: ['Camera', 'Photo'], picture: 'camera' },
    { name: 'Smartwatches', aka: ['Wearables'], picture: 'watch' },
    { name: 'Smart Home', aka: ['Home automation'], picture: 'house-wifi' },
    { name: 'Game Consoles', aka: ['Consoles', 'Gaming consoles'], picture: 'gamepad-2' },
    { name: 'Accessories', aka: ['Cables & chargers', 'Chargers'], picture: 'cable' },
  ] },
  { name: 'Clothing', aka: ['Clothes', 'Fashion', 'Apparel', 'Klær'], picture: 'shirt', subs: [
    { name: 'Tops', aka: ['Shirts', 'T-shirts', 'Sweaters'] },
    { name: 'Bottoms', aka: ['Trousers', 'Pants', 'Jeans'] },
    { name: 'Outerwear', aka: ['Jackets', 'Jackets & coats', 'Coats'] },
    { name: 'Rain Gear', aka: ['Rainwear', 'Rain clothes'], picture: 'umbrella' },
    { name: 'Wool & Base Layers', aka: ['Wool', 'Base layers', 'Thermals'], picture: 'snowflake' },
    { name: 'Underwear', aka: ['Socks & underwear'] },
    { name: 'Shoes', aka: ['Footwear', 'Shoes & boots'], picture: 'sport-shoe' },
    { name: 'Hats & Gloves', aka: ['Hats', 'Gloves', 'Hats, scarves & gloves'] },
    { name: 'Bags', aka: ['Bags & backpacks', 'Backpacks'], picture: 'handbag' },
    { name: 'Sportswear', aka: ['Activewear', 'Training clothes'] },
  ] },
  { name: 'Home & Living', aka: ['Home', 'Living', 'Hjem'], picture: 'sofa', subs: [
    { name: 'Furniture', picture: 'armchair' },
    { name: 'Kitchen', aka: ['Kitchenware', 'Cookware'], picture: 'cooking-pot' },
    { name: 'Appliances', aka: ['White goods', 'Home appliances'], picture: 'washing-machine' },
    { name: 'Bathroom', aka: ['Bath'], picture: 'bath' },
    { name: 'Bedding', aka: ['Bedroom', 'Bed linen'], picture: 'bed-double' },
    { name: 'Lighting', aka: ['Lamps', 'Lights'], picture: 'lamp' },
    { name: 'Decor', aka: ['Decoration', 'Interior'], picture: 'image' },
    { name: 'Storage', aka: ['Organising'], picture: 'boxes' },
    { name: 'Cleaning', aka: ['Cleaning supplies'], picture: 'spray-can' },
  ] },
  { name: 'Garden & DIY', aka: ['Garden', 'DIY', 'Garden & tools', 'Hage'], picture: 'hammer', subs: [
    { name: 'Tools', aka: ['Power tools', 'Hand tools'], picture: 'wrench' },
    { name: 'Paint & Building', aka: ['Paint', 'Building materials'], picture: 'paint-roller' },
    { name: 'Plants & Gardening', aka: ['Gardening', 'Plants'], picture: 'sprout' },
    { name: 'Grills', aka: ['Barbecue', 'BBQ'], picture: 'flame' },
    { name: 'Outdoor Furniture', aka: ['Garden furniture', 'Patio'], picture: 'armchair' },
    { name: 'Snow Clearing', aka: ['Snow', 'Snow shovels'], picture: 'snowflake' },
    { name: 'Cabin', aka: ['Cabin gear', 'Hytte'], picture: 'trees' },
  ] },
  { name: 'Sports & Outdoor', aka: ['Sports', 'Sport', 'Outdoor', 'Outdoors', 'Sports & outdoors'], picture: 'mountain', subs: [
    { name: 'Skiing', aka: ['Skis', 'Ski'], picture: 'mountain-snow' },
    { name: 'Hiking', aka: ['Trekking'], picture: 'footprints' },
    { name: 'Camping', picture: 'tent' },
    { name: 'Cycling', aka: ['Bikes', 'Bicycles'], picture: 'bike' },
    { name: 'Running', aka: ['Jogging'], picture: 'sport-shoe' },
    { name: 'Fitness Equipment', aka: ['Fitness', 'Gym', 'Gym equipment'], picture: 'dumbbell' },
    { name: 'Fishing', aka: ['Angling'], picture: 'fishing-rod' },
    { name: 'Water Sports', aka: ['Swimming', 'Paddling', 'Kayaking'], picture: 'waves' },
    { name: 'Ball Sports', aka: ['Football', 'Ball games'], picture: 'volleyball' },
  ] },
  { name: 'Personal Care & Health', aka: ['Personal care', 'Health', 'Health & beauty', 'Beauty', 'Care'], picture: 'heart-pulse', subs: [
    { name: 'Skincare', picture: 'droplet' },
    { name: 'Hair Care', aka: ['Hair'], picture: 'scissors' },
    { name: 'Makeup', aka: ['Cosmetics'], picture: 'sparkles' },
    { name: 'Fragrance', aka: ['Perfume', 'Fragrances'], picture: 'perfume-bottle' },
    { name: 'Shaving', aka: ['Shaving & grooming', 'Grooming'], picture: 'scissors' },
    { name: 'Oral Care', aka: ['Dental care', 'Teeth'], picture: 'toothbrush' },
    { name: 'Hygiene', picture: 'soap-dispenser-droplet' },
    { name: 'Vitamins & Supplements', aka: ['Vitamins', 'Supplements'], picture: 'pill-bottle' },
    { name: 'Pharmacy', aka: ['Medicine', 'Medication'], picture: 'pill' },
    { name: 'Glasses & Lenses', aka: ['Glasses', 'Contact lenses', 'Eyewear'], picture: 'glasses' },
  ] },
  { name: 'Hobby & Games', aka: ['Hobby', 'Hobbies', 'Hobbies & games', 'Games & hobbies', 'Gaming'], picture: 'puzzle', subs: [
    { name: 'Video Games', aka: ['Console games', 'PC games'], picture: 'gamepad' },
    { name: 'Board Games', aka: ['Board & card games', 'Card games'], picture: 'dices' },
    { name: 'Puzzles', aka: ['Jigsaw puzzles'], picture: 'puzzle' },
    { name: 'Building Sets', aka: ['Lego', 'Building blocks'], picture: 'toy-brick' },
    { name: 'Collectibles', aka: ['Trading cards', 'Figures'], picture: 'gem' },
    { name: 'Knitting & Crafts', aka: ['Knitting', 'Yarn', 'Crafts', 'Sewing'], picture: 'palette' },
    { name: 'Music Instruments', aka: ['Instruments', 'Musical instruments'], picture: 'guitar' },
    { name: 'Drones & RC', aka: ['Drones', 'RC'], picture: 'drone' },
  ] },
  { name: 'Groceries', aka: ['Grocery', 'Food', 'Food & drink', 'Dagligvarer'], picture: 'shopping-basket', subs: [
    { name: 'Fruit & Vegetables', aka: ['Fruit', 'Vegetables', 'Produce', 'Fruit & veg'], picture: 'apple' },
    { name: 'Bread & Bakery', aka: ['Bread', 'Bakery'], picture: 'croissant' },
    { name: 'Dairy & Eggs', aka: ['Dairy', 'Milk'], picture: 'milk' },
    { name: 'Meat & Fish', aka: ['Meat', 'Fish', 'Seafood'], picture: 'beef' },
    { name: 'Cheese & Spreads', aka: ['Cheese', 'Spreads', 'Pålegg'], picture: 'sandwich' },
    { name: 'Frozen', aka: ['Frozen food'], picture: 'snowflake' },
    { name: 'Pantry Staples', aka: ['Pantry', 'Dry goods'], picture: 'wheat' },
    { name: 'Snacks', aka: ['Sweets', 'Candy', 'Snacks & sweets'], picture: 'cookie' },
    { name: 'Drinks', aka: ['Beverages', 'Soft drinks'], picture: 'cup-soda' },
    { name: 'Coffee & Tea', aka: ['Coffee', 'Tea'], picture: 'coffee' },
    { name: 'Household Supplies', aka: ['Household', 'Paper goods'], picture: 'package' },
  ] },
  { name: 'Books & Stationery', aka: ['Books', 'Books & magazines', 'Bøker'], picture: 'book-open', subs: [
    { name: 'Books', aka: ['Paper books'], picture: 'book' },
    { name: 'E-Books', picture: 'book-open-text' },
    { name: 'Audiobooks', picture: 'book-headphones' },
    { name: 'Comics', aka: ['Comic books', 'Manga', 'Graphic novels'], picture: 'book-image' },
    { name: 'Magazines', aka: ['Newspapers', 'Magazines & newspapers'], picture: 'newspaper' },
    { name: 'Stationery', aka: ['Office supplies'], picture: 'pen' },
    { name: 'Notebooks & Planners', aka: ['Notebooks', 'Planners', 'Calendars'], picture: 'notebook-pen' },
    { name: 'Art Supplies', aka: ['Drawing', 'Painting'], picture: 'palette' },
  ] },
  { name: 'Car', aka: ['Cars', 'Vehicle', 'Car & transport', 'Bil'], picture: 'car-front', subs: [
    { name: 'Tyres & Wheels', aka: ['Tyres', 'Tires', 'Wheels'] },
    { name: 'Car Care', aka: ['Car wash', 'Car cleaning'], picture: 'droplets' },
    { name: 'Car Accessories', aka: ['Car gear'] },
    { name: 'EV Charging', aka: ['Charging', 'Charging cables'], picture: 'plug-zap' },
    { name: 'Roof Boxes & Racks', aka: ['Roof boxes', 'Roof racks', 'Bike racks'], picture: 'luggage' },
    { name: 'Winter Gear', aka: ['Snow chains', 'Ice scrapers'], picture: 'snowflake' },
    { name: 'Child Seats', aka: ['Car seats'], picture: 'baby' },
  ] },
]

// ── Matching names ───────────────────────────────────────────────────────────

/**
 * A category name to compare by: no case, no spaces, and "&", "+", "and" and
 * "og" all the same — "TV & Audio", "tv and audio" and "TV&audio" are one.
 */
export function categoryKey(name: string): string {
  return name.normalize('NFKC').toLocaleLowerCase('nb')
    .replace(/\s+(and|og)\s+/gu, '&').replace(/\+/g, '&')
    .replace(/[\s\-_.,'’/]+/gu, '')
}

const keysOf = (e: { name: string; aka?: readonly string[] }) => [e.name, ...(e.aka ?? [])].map(categoryKey)

const TOP_BY_KEY = new Map<string, TaxonomyTop>()
const SUB_BY_KEY = new Map<string, { top: TaxonomyTop; sub: TaxonomySub }>()
for (const top of TAXONOMY) {
  for (const k of keysOf(top)) TOP_BY_KEY.set(k, top)
  for (const sub of top.subs) for (const k of keysOf(sub)) SUB_BY_KEY.set(k, { top, sub })
}

/** The taxonomy's top category a name is (its own name or another name for it), else null. */
export function taxonomyTopOf(name: string): TaxonomyTop | null {
  return TOP_BY_KEY.get(categoryKey(name)) ?? null
}

/** The taxonomy's subcategory a name is: under `top` first, then anywhere. */
export function taxonomySubOf(name: string, top?: TaxonomyTop | null): TaxonomySub | null {
  const k = categoryKey(name)
  return top?.subs.find(s => keysOf(s).includes(k)) ?? SUB_BY_KEY.get(k)?.sub ?? null
}

// ── Suggestions ──────────────────────────────────────────────────────────────

interface Cat { id: string; name: string; parent_id: string | null }

/** Every name the owner already uses, at either level, as keys. */
function ownerKeys(categories: readonly Cat[]): Set<string> {
  return new Set(categories.map(c => categoryKey(c.name)))
}

/**
 * The taxonomy's top categories the owner has nothing for yet, in its order:
 * none that an owner's top category is (by its name or another name for it),
 * and none whose name the owner already uses for a subcategory.
 */
export function suggestedTops(categories: readonly Cat[]): string[] {
  const tops = new Set(categories.filter(c => !c.parent_id).map(c => categoryKey(c.name)))
  const any = ownerKeys(categories)
  return TAXONOMY.filter(t => !keysOf(t).some(k => tops.has(k)) && !any.has(categoryKey(t.name))).map(t => t.name)
}

/**
 * The subcategories to suggest under the owner's top category `topId` (or a
 * suggested top picked but not made yet): those
 * of the taxonomy's top it is (by name or another name), less every one the
 * owner already has anywhere under any of its names. An owner's own top that
 * is no taxonomy top gets none.
 */
export function suggestedSubs(categories: readonly Cat[], topId: string | null | undefined): string[] {
  const own = topId ? categories.find(c => c.id === topId && !c.parent_id) : undefined
  // A suggested top not made yet ("suggest:Electronics", picked in the same sheet) offers its own subcategories.
  const name = own?.name ?? (topId?.startsWith('suggest:') ? topId.slice('suggest:'.length) : null)
  const top = name ? taxonomyTopOf(name) : null
  if (!top) return []
  const had = ownerKeys(categories)
  return top.subs.filter(s => !keysOf(s).some(k => had.has(k))).map(s => s.name)
}

/** What "Add the suggested categories" makes: top categories with their subcategories, and subcategories under the owner's own tops. */
export interface SuggestedPlan {
  tops: { name: string; subs: string[] }[]
  under: { parentId: string; subs: string[] }[]
  /** Rows in all. */
  count: number
}

/**
 * Every suggestion the pickers offer, each once (owner, 10.11.2026: added once, on the owner's tap): the
 * suggested tops (`suggestedTops`) with their subcategories, and the subcategories suggested under the owner's
 * own tops (`suggestedSubs`) — none the owner has anywhere under any of its names, and none twice: a taxonomy
 * top the owner has under two names ("Electronics" and "Tech") gets its subcategories once, under the one with
 * its own name, else the first by name. Once it is made, nothing is suggested and this plan is empty.
 */
export function suggestedPlan(categories: readonly Cat[]): SuggestedPlan {
  const had = ownerKeys(categories)
  const fresh = (subs: readonly TaxonomySub[]) => subs.filter(s => {
    const keys = keysOf(s)
    if (keys.some(k => had.has(k))) return false
    for (const k of keys) had.add(k)
    return true
  }).map(s => s.name)
  const ownTops = categories.filter(c => !c.parent_id).sort((a, b) => a.name.localeCompare(b.name, 'nb'))
  const under: SuggestedPlan['under'] = []
  for (const top of TAXONOMY) {
    const mine = ownTops.filter(c => taxonomyTopOf(c.name) === top)
    const target = mine.find(c => categoryKey(c.name) === categoryKey(top.name)) ?? mine[0]
    const subs = target ? fresh(top.subs) : []
    if (target && subs.length) under.push({ parentId: target.id, subs })
  }
  const tops = suggestedTops(categories).map(name => ({ name, subs: fresh(TAXONOMY.find(t => t.name === name)?.subs ?? []) }))
  const count = tops.reduce((n, t) => n + 1 + t.subs.length, 0) + under.reduce((n, u) => n + u.subs.length, 0)
  return { tops, under, count }
}

/**
 * A picker's pick as the categories stand now: a suggestion ("suggest:Headphones") that has been made since —
 * by "Add the suggested categories" — becomes the owner's category of that name (under its top), so the select
 * shows what it holds; one still suggested stays; one neither made there nor suggested any more (made under the
 * owner's other top of the same kind) is no pick — never a second row on Save. Anything else stays as it is.
 */
export function pickWithMade<P extends { topId: string; subId: string }>(pick: P, categories: readonly Cat[]): P {
  const S = 'suggest:'
  const named = (name: string, parentId: string | null) =>
    categories.find(c => (c.parent_id ?? null) === parentId && categoryKey(c.name) === categoryKey(name))?.id
  const offered = (names: readonly string[], name: string) => names.some(n => categoryKey(n) === categoryKey(name))
  let topId = pick.topId
  if (topId.startsWith(S)) {
    const name = topId.slice(S.length)
    topId = named(name, null) ?? (offered(suggestedTops(categories), name) ? topId : '')
  }
  let subId = topId ? pick.subId : ''
  if (subId.startsWith(S)) {
    const name = subId.slice(S.length)
    subId = (topId.startsWith(S) ? undefined : named(name, topId)) ?? (offered(suggestedSubs(categories, topId), name) ? subId : '')
  }
  return topId === pick.topId && subId === pick.subId ? pick : { ...pick, topId, subId }
}

// ── Default pictures ─────────────────────────────────────────────────────────

/**
 * Words in a name the owner gave that say what it is, most specific first
 * ("headphone" before "phone"). A word of three letters or fewer counts only
 * as a whole word or with a plural ending ("ski", "skis" — never "skin");
 * four letters, as the start of a word ("shoe" → "shoes"); five or more,
 * anywhere in one (Norwegian puts words together: "vinterjakke").
 */
export const PICTURE_WORDS: readonly (readonly [PictureKey, readonly string[]])[] = [
  ['book-headphones', ['audiobook', 'audio book', 'lydbok']],
  ['book-open-text', ['ebook', 'e-book', 'ebok', 'e-bok']],
  ['book-image', ['comic', 'manga', 'tegneserie', 'graphic novel']],
  ['headphones', ['headphone', 'earbud', 'earphone', 'headset', 'microphone', 'hodetelefon', 'øretelefon']],
  ['watch', ['smartwatch', 'wearable', 'smartklokke', 'watch', 'klokke']],
  ['smartphone', ['phone', 'mobil', 'telefon', 'iphone']],
  ['tablet', ['tablet', 'ipad', 'nettbrett', 'e-reader', 'ereader', 'kindle']],
  ['laptop', ['laptop', 'computer', 'macbook', 'datamaskin', 'pc']],
  ['monitor', ['monitor', 'skjerm', 'display']],
  ['gamepad-2', ['console', 'konsoll', 'handheld', 'playstation', 'xbox', 'nintendo', 'gaming']],
  ['dices', ['board game', 'card game', 'brettspill', 'kortspill']],
  ['gamepad', ['video game', 'videogame', 'game', 'spill']],
  ['tv', ['tv', 'television', 'audio', 'speaker', 'soundbar', 'høyttaler', 'stereo', 'sound']],
  ['camera', ['camera', 'kamera', 'photo', 'foto']],
  ['house-wifi', ['smart home', 'smarthome', 'smarthus', 'home automation']],
  ['plug-zap', ['ev', 'charging', 'lading', 'elbil']],
  ['cable', ['cable', 'charger', 'kabel', 'lader', 'adapter']],
  ['umbrella', ['rain', 'regn']],
  ['mountain-snow', ['ski', 'skis', 'skiing', 'alpin', 'langrenn', 'snowboard']],
  ['snowflake', ['wool', 'thermal', 'base layer', 'ull', 'snow', 'snø', 'frozen', 'frys', 'winter', 'vinter']],
  ['sport-shoe', ['shoe', 'sneaker', 'boot', 'footwear', 'sko', 'støvl', 'running', 'jogg']],
  ['handbag', ['bag', 'handbag', 'purse', 'veske', 'wallet']],
  ['luggage', ['luggage', 'suitcase', 'travel', 'koffert', 'reise', 'roof box', 'takboks']],
  ['shirt', ['shirt', 'sweater', 'hoodie', 'jacket', 'coat', 'jakke', 'genser', 'skjorte', 'clothes', 'clothing', 'klær', 'trouser', 'jeans',
    'underwear', 'outerwear', 'sportswear', 'activewear', 'sock', 'hat', 'glove', 'lue', 'votter']],
  ['cooking-pot', ['kitchen', 'kjøkken', 'cookware', 'cooking', 'pots', 'pans']],
  ['droplets', ['car care', 'car wash', 'bilpleie']],
  ['washing-machine', ['appliance', 'washing', 'dishwasher', 'oppvask', 'fridge', 'freezer', 'hvitevare']],
  ['bath', ['bath', 'shower', 'dusj', 'bad']],
  ['bed-double', ['bed', 'bedding', 'mattress', 'pillow', 'duvet', 'seng', 'dyne', 'pute']],
  ['lamp', ['lamp', 'light', 'lighting', 'belysning', 'lys']],
  ['armchair', ['furniture', 'sofa', 'chair', 'møbel', 'møbler', 'stol']],
  ['image', ['decor', 'interior', 'interiør', 'pynt', 'poster']],
  ['boxes', ['storage', 'oppbevaring', 'box']],
  ['spray-can', ['clean', 'vacuum', 'støvsuger', 'rengjøring', 'vask']],
  ['wrench', ['tool', 'verktøy', 'drill', 'repair']],
  ['toy-brick', ['lego', 'building set', 'building block', 'toy', 'leke']],
  ['paint-roller', ['paint', 'maling', 'building', 'bygg']],
  ['flame', ['grill', 'barbecue', 'bbq']],
  ['sprout', ['garden', 'gardening', 'plant', 'flower', 'seed', 'hage', 'blomst']],
  ['trees', ['cabin', 'hytte']],
  ['tent', ['camping', 'tent', 'telt']],
  ['footprints', ['hiking', 'hike', 'trekking', 'tur']],
  ['bike', ['bike', 'cycling', 'bicycle', 'sykkel']],
  ['dumbbell', ['fitness', 'gym', 'training', 'trening', 'weights', 'workout']],
  ['fishing-rod', ['fishing', 'angling', 'fiske']],
  ['waves', ['swim', 'water sport', 'kayak', 'paddle', 'padle', 'boat', 'båt']],
  ['volleyball', ['ball', 'football', 'fotball', 'soccer', 'tennis', 'golf']],
  ['toothbrush', ['tooth', 'teeth', 'dental', 'tann']],
  ['droplet', ['skin', 'sunscreen', 'solkrem', 'hudpleie']],
  ['scissors', ['hair', 'shaving', 'barber', 'razor', 'grooming', 'hår']],
  ['sparkles', ['makeup', 'make-up', 'cosmetic', 'sminke', 'beauty']],
  ['perfume-bottle', ['perfume', 'fragrance', 'parfyme']],
  ['soap-dispenser-droplet', ['hygiene', 'soap', 'såpe']],
  ['pill-bottle', ['vitamin', 'supplement', 'kosttilskudd']],
  ['pill', ['pharmacy', 'medicine', 'medication', 'apotek', 'medisin']],
  ['glasses', ['glasses', 'lens', 'eyewear', 'briller', 'optic']],
  ['puzzle', ['puzzle', 'jigsaw', 'puslespill']],
  ['gem', ['collect', 'trading card', 'jewel', 'smykke', 'samle']],
  ['palette', ['knit', 'yarn', 'craft', 'sewing', 'strikk', 'garn', 'art', 'drawing', 'tegne']],
  ['guitar', ['guitar', 'gitar', 'piano', 'instrument', 'music', 'musikk']],
  ['drone', ['drone', 'rc']],
  ['newspaper', ['magazine', 'newspaper', 'avis', 'blad']],
  ['notebook-pen', ['notebook', 'planner', 'calendar', 'notatbok', 'kalender']],
  ['pen', ['stationery', 'office', 'pen', 'pencil', 'kontor', 'skrivesaker']],
  ['book', ['book', 'bok', 'bøker', 'novel', 'roman', 'library']],
  ['apple', ['fruit', 'vegetable', 'veg', 'produce', 'frukt', 'grønnsak']],
  ['croissant', ['bread', 'bakery', 'baking', 'brød', 'bakeri']],
  ['milk', ['dairy', 'milk', 'egg', 'melk', 'meieri']],
  ['sandwich', ['cheese', 'spread', 'pålegg', 'ost']],
  ['beef', ['meat', 'kjøtt']],
  ['fish', ['fish', 'seafood', 'fisk']],
  ['wheat', ['pantry', 'flour', 'pasta', 'rice', 'tørrvare']],
  ['cookie', ['snack', 'sweet', 'candy', 'chips', 'godteri', 'sjokolade']],
  ['coffee', ['coffee', 'tea', 'kaffe', 'te']],
  ['cup-soda', ['drink', 'soda', 'juice', 'beverage', 'brus', 'drikke']],
  ['package', ['household', 'paper', 'toalettpapir', 'husholdning']],
  ['baby', ['baby', 'child seat', 'barn', 'kids', 'children']],
  ['paw-print', ['pet', 'dog', 'cat', 'hund', 'katt', 'dyr']],
  ['gift', ['gift', 'present', 'gave']],
  ['car-front', ['car', 'tyre', 'tire', 'wheel', 'dekk', 'felg', 'bil']],
  // The general words last, so a more telling one wins ("Pet food", "Car care").
  ['shopping-basket', ['grocer', 'food', 'mat', 'dagligvare']],
  ['heart-pulse', ['health', 'helse', 'care']],
  ['monitor-smartphone', ['electronic', 'elektronikk', 'tech', 'gadget']],
  ['hammer', ['diy', 'hardware', 'jernvare']],
  ['mountain', ['outdoor', 'friluft', 'sport']],
  ['sofa', ['home', 'living', 'hjem', 'bolig']],
]

const PLURAL = /^(s|es|er|ene|en|ing|ings)$/u

/** Whether `name`'s words carry `word` (the length rules above; a phrase is looked for in the whole name). */
function hasWord(words: readonly string[], joined: string, word: string): boolean {
  const w = word.toLocaleLowerCase('nb')
  if (w.includes(' ')) return joined.includes(w)
  if (w.length <= 3) return words.some(x => x === w || (x.startsWith(w) && PLURAL.test(x.slice(w.length))))
  if (w.length === 4) return words.some(x => x.startsWith(w))
  return words.some(x => x.includes(w))
}

/** A picture guessed from a name's words, or null. */
export function guessPicture(name: string): PictureKey | null {
  const words = name.normalize('NFKC').toLocaleLowerCase('nb').split(/[^\p{L}\p{N}-]+/u).filter(Boolean)
  if (!words.length) return null
  const joined = words.join(' ')
  for (const [picture, list] of PICTURE_WORDS) if (list.some(w => hasWord(words, joined, w))) return picture
  return null
}

/**
 * A thing's default picture from its category (for a thing with no picture of
 * its own and none from its price watch): its subcategory's — the taxonomy's
 * when it is one, else guessed from the name the owner gave it — else its top
 * category's, the same way; null when nothing fits (the initials show).
 */
export function pictureKeyOf(topName: string | null | undefined, subName: string | null | undefined): PictureKey | null {
  const top = topName ? taxonomyTopOf(topName) : null
  // A top known by another name ("Gaming" is Hobby & Games) keeps the picture its own words say, when they say one.
  const own = top && topName && categoryKey(top.name) !== categoryKey(topName) ? guessPicture(topName) : null
  const topPicture = own ?? (top ? top.picture : topName ? guessPicture(topName) : null)
  if (!subName) return topPicture
  const sub = taxonomySubOf(subName, top)
  return sub?.picture ?? guessPicture(subName) ?? topPicture
}
