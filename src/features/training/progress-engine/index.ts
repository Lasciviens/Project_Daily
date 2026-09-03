// Progress engine — public barrel. Import from here, not individual files,
// outside this folder (useProgressData.ts, ExerciseDecisionTable.tsx, etc.).
export * from './types'
export * from './policies'
export * from './normalize'
export * from './trend'
export * from './comparability'
export * from './events'
export * from './targets'
export * from './evaluate'
export * from './copy'
export { RULE_CATALOG } from './ruleCatalog'
export type { RuleCatalogEntry, EvidenceClass } from './ruleCatalog'
