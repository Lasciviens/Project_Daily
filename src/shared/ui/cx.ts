/** Joins class names, dropping falsy entries. */
export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')
