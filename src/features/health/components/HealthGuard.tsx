import type { ReactNode } from 'react'
import { ErrorBoundary } from '../../../shared/components/ErrorBoundary'

/** A Health window or card: a render error shows its own Try-again card, logged under its name. */
export function HealthGuard({ name, children }: { name: string; children: ReactNode }) {
  return <ErrorBoundary label={name} action={`health_${name.toLowerCase().replace(/\W+/g, '_')}`}>{children}</ErrorBoundary>
}
