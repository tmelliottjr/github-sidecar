import type { Stack, StackedRow } from './types'

/**
 * Whether a stack agrees with a loaded row in it: the same size, and the same
 * pull request at the row position.
 */
export function agrees(stack: Stack, row: StackedRow): boolean {
  if (row.stack.size !== stack.size) return false
  return stack.layers.some((layer) => layer.position === row.stack.position && layer.id === row.id)
}
