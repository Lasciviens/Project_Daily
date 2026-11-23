import { formatDate } from '../../../../../shared/utils/dateFormat'

/** "23.11.2026" from a stored time, or nothing. */
export const day = (iso: string): string => (iso ? formatDate(iso) : '')
