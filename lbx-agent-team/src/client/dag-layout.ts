/**
 * Pure dependency-layout projections for the lbx-agent-team activity panel
 * (Task 17).
 *
 * Deliberately free of any CSS/DOM/React import so the emitted
 * `lib/client/dag-layout.js` can be imported directly under `node --test`
 * and verified table-driven without a renderer.
 */

import type { ActivityTask } from './activity-monitor.ts'

/** One ordered row of the dependency list. */
export interface DagDepthEntry {
  readonly task: ActivityTask
  /** Longest dependency-chain depth; 0 = no upstream dependencies. */
  readonly depth: number
}

/**
 * Pure: longest dependency-chain depth per task id. Cycle-safe — a cycle
 * yields the bounded partial depth instead of recursing forever, so malformed
 * host data cannot hang the render. A dependency id missing from the task
 * list contributes zero depth (it is treated as an already-satisfied root).
 */
export function dagDepths(tasks: readonly ActivityTask[]): ReadonlyMap<string, number> {
  const byId = new Map<string, ActivityTask>()
  for (const task of tasks) byId.set(task.id, task)
  const memo = new Map<string, number>()
  const visiting = new Set<string>()
  const depthOf = (id: string): number => {
    const cached = memo.get(id)
    if (cached !== undefined) return cached
    const task = byId.get(id)
    if (task === undefined) return 0
    if (visiting.has(id)) return 0
    visiting.add(id)
    let depth = 0
    for (const dependency of task.dependencies) {
      const candidate = depthOf(dependency) + 1
      if (candidate > depth) depth = candidate
    }
    visiting.delete(id)
    memo.set(id, depth)
    return depth
  }
  for (const task of tasks) depthOf(task.id)
  return memo
}

/** Pure: tasks ordered roots-first for the indented list (depth, then id). */
export function orderedDagEntries(tasks: readonly ActivityTask[]): DagDepthEntry[] {
  const depths = dagDepths(tasks)
  return [...tasks]
    .map((task) => ({ task, depth: depths.get(task.id) ?? 0 }))
    .sort((left, right) =>
      left.depth - right.depth
      || left.task.id.localeCompare(right.task.id, 'en', { numeric: true }))
}
