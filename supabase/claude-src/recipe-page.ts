// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · what a recipe page holds
//
//  Most recipe sites describe their recipe for search engines as schema.org
//  data in a <script type="application/ld+json"> block: the title, the
//  ingredients as lines, the steps, the yield and often the nutrition. Code can
//  read that, so the model is asked only when a page has none (AI last).
//  Everything on the page is input: the data goes through cleanRecipe like any
//  answer, and the page's visible text is only ever sent as data in a tag.
// ─────────────────────────────────────────────────────────────────────────────

import { cleanRecipe, type RecipeFields } from './recipe-rules.ts'

export const PAGE_TEXT_MAX = 12_000
const LD_BLOCK_MAX = 600_000
const LD_NODES_MAX = 4000
const LD_TYPE = /\btype\s*=\s*["']?application\/ld\+json/i

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', deg: '°', frac12: '½', frac14: '¼', frac34: '¾' }

/** Text with its HTML entities written as characters (&amp; &#39; &#x27; …). Unknown ones stay as they are. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,8});/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : ' '
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })
}

/** The words a page shows: no scripts, styles or tags; line breaks where blocks end; at most `max` characters. */
export function pageVisibleText(html: string, max: number): string {
  const text = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
    .replace(/<(script|style|noscript|svg|template|head|iframe)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, ' ')
    .replace(/<\/?(?:p|div|br|li|ul|ol|h[1-6]|tr|section|article|header|footer|nav|table|form)\b[^<>]*>/gi, '\n')
    .replace(/<[^<>]*>/g, ' ')
  return decodeEntities(text)
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max)
}

/** A text from the page's data: tags and entities taken out, white space collapsed. */
function plainFrom(value: unknown): string {
  return typeof value === 'string' ? decodeEntities(value.replace(/<[^<>]*>/g, ' ')).replace(/\s+/g, ' ').trim() : ''
}

/** The schema.org Recipe nodes of a page's ld+json blocks, in the order they stand. */
function recipeNodes(html: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = []
  // Linear on purpose: each opener is found alone, its type read from the opener's own text, and the block's end is
  // found with indexOf (a lazy regex over a page of repeated openers took minutes).
  let seen = 0
  let readTo = 0
  for (const opener of html.matchAll(/<script\b([^<>]*)>/gi)) {
    if (opener.index < readTo || !LD_TYPE.test(opener[1])) continue
    const start = opener.index + opener[0].length
    const end = html.indexOf('</script', start)
    // An opener with no closer: nothing after it has one either, so the page is read to its end once.
    readTo = end < 0 ? html.length : end
    const body = html.slice(start, readTo)
    if (body.length > LD_BLOCK_MAX) { if (end < 0) break; continue }
    let data: unknown
    try { data = JSON.parse(body) } catch { continue }
    const stack: unknown[] = [data]
    while (stack.length && seen < LD_NODES_MAX) {
      const node = stack.pop()
      seen++
      if (Array.isArray(node)) { for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]); continue }
      if (node === null || typeof node !== 'object') continue
      const object = node as Record<string, unknown>
      const types = Array.isArray(object['@type']) ? object['@type'] : [object['@type']]
      if (types.some(t => typeof t === 'string' && (t === 'Recipe' || t.endsWith('/Recipe')))) found.push(object)
      if (object['@graph'] !== undefined) stack.push(object['@graph'])
    }
  }
  return found
}

/** The yield as a count: the first whole number in "4", 4, "Serves 4", ["4", "4 servings"]. Else undefined. */
function yieldCount(value: unknown): number | undefined {
  const first = Array.isArray(value) ? value[0] : value
  if (typeof first === 'number') return first
  const m = typeof first === 'string' ? /\d+/.exec(first) : null
  return m ? Number(m[0]) : undefined
}

const FRACTIONS: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 }
const UNIT_WORDS = new Set([
  'g', 'gr', 'gram', 'grams', 'kg', 'mg', 'ml', 'cl', 'dl', 'l', 'liter', 'litre', 'liters', 'litres', 'tsp', 'teaspoon', 'teaspoons',
  'tbsp', 'tablespoon', 'tablespoons', 'cup', 'cups', 'oz', 'ounce', 'ounces', 'lb', 'lbs', 'pound', 'pounds', 'pinch', 'clove', 'cloves',
  'slice', 'slices', 'can', 'cans', 'stick', 'sticks', 'piece', 'pieces', 'pcs', 'ss', 'ts', 'stk', 'boks', 'neve', 'klype', 'fedd',
])

/** "1 1/2 cups of flour" as { quantity: 1.5, unit: "cups", name: "flour" }. A line it cannot split is a name alone. */
function ingredientLine(line: string): { name: string; quantity?: number; unit?: string } {
  const m = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?\s*[½¼¾⅓⅔⅛]?|[½¼¾⅓⅔⅛])(?![\d–-])\s*(.*)$/.exec(line)
  if (!m || /^[–-]\s*\d/.test(m[2])) return { name: line }
  const q = m[1].trim()
  let quantity: number
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(q)
  const fraction = /^(\d+)\/(\d+)$/.exec(q)
  const withGlyph = /^(\d+(?:[.,]\d+)?)\s*([½¼¾⅓⅔⅛])$/.exec(q)
  if (mixed) quantity = Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])
  else if (fraction) quantity = Number(fraction[1]) / Number(fraction[2])
  else if (withGlyph) quantity = Number(withGlyph[1].replace(',', '.')) + FRACTIONS[withGlyph[2]]
  else if (FRACTIONS[q] !== undefined) quantity = FRACTIONS[q]
  else quantity = Number(q.replace(',', '.'))
  if (!Number.isFinite(quantity) || quantity <= 0) return { name: line }
  let rest = m[2]
  let unit: string | undefined
  const word = /^([^\s\d.,;:()]+)\.?\s*(.*)$/.exec(rest)
  if (word && UNIT_WORDS.has(word[1].toLowerCase())) { unit = word[1]; rest = word[2].replace(/^of\s+/i, '') }
  return rest.trim() ? { name: rest.trim(), quantity, ...(unit ? { unit } : {}) } : { name: line }
}

/** The steps as lines of text: a string, a list of strings, HowToStep objects or HowToSection objects around them. */
function stepLines(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 4 || out.length > 120) return out
  if (typeof value === 'string') {
    for (const part of value.replace(/<\/?(?:p|br|li)\b[^<>]*>/gi, '\n').split('\n')) {
      const line = plainFrom(part)
      if (line) out.push(line)
    }
  } else if (Array.isArray(value)) {
    for (const item of value) stepLines(item, out, depth + 1)
  } else if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>
    if (object.itemListElement !== undefined) stepLines(object.itemListElement, out, depth + 1)
    else stepLines(object.text ?? object.name, out, depth + 1)
  }
  return out
}

/** The first number in "250 kcal" or "12.5 g" (a comma may be the decimal mark), or undefined. kilojoules are not calories. */
function firstNumber(value: unknown, isCalories = false): number | undefined {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : ''
  if (isCalories && /kj/i.test(text) && !/kcal|cal/i.test(text)) return undefined
  const m = /-?\d+(?:[.,]\d+)?/.exec(text)
  return m ? Number(m[0].replace(',', '.')) : undefined
}

/**
 * The recipe a page describes in its own schema.org data, as the recipe editor takes it, or null when there is
 * none worth using (no title, no ingredients). Made by code alone: the first usable Recipe on the page wins.
 */
export function recipeFromPage(html: string): RecipeFields | null {
  for (const node of recipeNodes(html)) {
    const lines = Array.isArray(node.recipeIngredient) ? node.recipeIngredient : Array.isArray(node.ingredients) ? node.ingredients : []
    const nutrition = node.nutrition !== null && typeof node.nutrition === 'object' ? node.nutrition as Record<string, unknown> : {}
    const checked = cleanRecipe({
      title: plainFrom(node.name),
      servings: yieldCount(node.recipeYield),
      ingredients: lines.slice(0, 120).map(line => ingredientLine(plainFrom(line))).filter(i => i.name),
      steps: stepLines(node.recipeInstructions),
      macros: {
        calories: firstNumber(nutrition.calories, true), protein_g: firstNumber(nutrition.proteinContent),
        carbs_g: firstNumber(nutrition.carbohydrateContent), fat_g: firstNumber(nutrition.fatContent), sugar_g: firstNumber(nutrition.sugarContent),
      },
    })
    if (checked.ok) return checked.recipe
  }
  return null
}
