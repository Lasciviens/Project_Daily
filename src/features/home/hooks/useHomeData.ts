// Queries have been moved into each widget component directly.
// Widgets use useWidgetState to control enabled/refetchInterval based on
// collapsed and syncActive state — this file is kept as a re-export barrel
// in case shared hooks are needed in future.

export { useWidgetState } from './useWidgetState'
