import { useShopCategories } from '../../../../shop/hooks/useShop'
import { categoryPath } from '../../../../shop/shopModel'
import { formatDate } from '../../../../../shared/utils/dateFormat'
import { formatCount } from '../../../../ai/claude/ledgerRules'

/** "23.11.2026" from a stored time, or nothing. */
export const day = (iso: string): string => (iso ? formatDate(iso) : '')

/** A whole number with its thousands apart ("1 850"): the app's one number format. */
export const count = (n: number): string => formatCount(n)

/**
 * A stored value in plain words: a category id becomes its name from the owner's own categories ("Food / Snacks"); any
 * other value is shown as it is. A category no longer on the list says so (never its id).
 */
export function useValueWords(): (field: string, value: string | null) => string {
  const categories = useShopCategories().data ?? []
  return (field, value) => {
    if (value === null || value === '') return '—'
    if (!/(^|\.)category_id$/.test(field)) return value
    const p = categoryPath(value, categories)
    return p.topId ? [p.topName, p.subName].filter(Boolean).join(' / ') : 'a category no longer on your list'
  }
}
