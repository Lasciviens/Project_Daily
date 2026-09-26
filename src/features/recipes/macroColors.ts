// One colour per macro, shared by every nutrition surface (bar, dots, rings).
// Chart series tokens, never the accent (THEME.md §2.5) — used as inline
// styles because SVG attributes can't take Tailwind classes.
export const MACRO_COLOR = {
  protein: 'rgb(var(--chart-1))',
  carbs:   'rgb(var(--chart-3))',
  fat:     'rgb(var(--chart-4))',
  fiber:   'rgb(var(--chart-5))',
} as const

export type Macro = keyof typeof MACRO_COLOR
