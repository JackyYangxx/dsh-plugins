/**
 * DagView: pure presentational dependency view for the lbx-agent-team
 * activity panel (Task 17).
 *
 * Tasks are rendered as an indented dependency list: the indentation depth is
 * the longest dependency chain above a task (roots first), and each row lists
 * its dependency ids as chips so the graph reads top-down like a pipeline.
 * The layout projections (`dagDepths` / `orderedDagEntries`) are pure
 * functions so they can be unit-tested without rendering.
 */

import type { CSSProperties } from 'react'
import type { ActivityTask } from './activity-monitor.ts'
import css from './TeamPanel.module.css'

export interface DagViewProps {
  /** Task rows in host snapshot order. */
  readonly tasks: readonly ActivityTask[]
  /** Section caption shown in the section header. */
  readonly caption?: string
  /** Clamp for the indentation depth (deeper chains flatten at this level). */
  readonly maxDepth?: number
}

/** One ordered row of the dependency list. */
export interface DagDepthEntry {
  readonly task: ActivityTask
  /** Longest dependency-chain depth; 0 = no upstream dependencies. */
  readonly depth: number
}

/**
 * Pure: longest dependency-chain depth per task id. Cycle-safe — a cycle
 * yields the bounded partial depth instead of recursing forever, so malformed
 * host data cannot hang the render.
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

/** Pure: tasks ordered roots-first for the indented list. */
export function orderedDagEntries(tasks: readonly ActivityTask[]): DagDepthEntry[] {
  const depths = dagDepths(tasks)
  return [...tasks]
    .map((task) => ({ task, depth: depths.get(task.id) ?? 0 }))
    .sort((left, right) =>
      left.depth - right.depth
      || left.task.id.localeCompare(right.task.id, 'en', { numeric: true }))
}

const DAG_INDENT_PER_LEVEL = 14

/** Dependency list: tasks indented by upstream depth, dependency ids as chips. */
export function DagView({ tasks, caption = 'Dependencies', maxDepth = 8 }: DagViewProps) {
  const entries = orderedDagEntries(tasks)
  const byId = new Map<string, ActivityTask>()
  for (const task of tasks) byId.set(task.id, task)
  const withDependencies = entries.filter((entry) => entry.task.dependencies.length > 0)
  return (
    <section className={css.section} data-panel-section="dag">
      <header className={css.sectionHead}>
        <span className={css.sectionTitle}>{caption}</span>
        <span className={css.sectionCount}>{withDependencies.length}</span>
      </header>
      {entries.length === 0
        ? <p className={css.emptyHint}>No tasks yet.</p>
        : (
          <ol className={css.dagList}>
            {entries.map(({ task, depth }) => {
              const indentation = Math.min(depth, maxDepth) * DAG_INDENT_PER_LEVEL
              const rowStyle: CSSProperties = { paddingLeft: indentation > 0 ? indentation : undefined }
              return (
                <li key={task.id} className={css.dagRow} data-depth={depth} style={rowStyle}>
                  <span className={css.dagNode}>
                    <span className={css.dagNodeDot} aria-hidden />
                    <span className={css.dagNodeId}>{task.id}</span>
                    <span className={css.dagNodeSubject} title={task.subject}>{task.subject}</span>
                  </span>
                  {task.dependencies.length > 0 && (
                    <span className={css.dagDepends}>
                      <span className={css.dagDependsLabel} aria-hidden>←</span>
                      {task.dependencies.map((dependency) => (
                        <span
                          key={dependency}
                          className={css.dagDepChip}
                          data-resolved={byId.has(dependency)}
                          title={dependency}
                        >
                          {dependency}
                        </span>
                      ))}
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
        )}
    </section>
  )
}
