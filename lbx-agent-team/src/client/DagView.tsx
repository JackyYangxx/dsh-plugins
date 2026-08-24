/**
 * DagView: pure presentational dependency view for the lbx-agent-team
 * activity panel (Task 17).
 *
 * Tasks are rendered as an indented dependency list: the indentation depth is
 * the longest dependency chain above a task (roots first), and each row lists
 * its dependency ids as chips so the graph reads top-down like a pipeline.
 * The layout projections live in `dag-layout.ts` (no CSS/DOM dependency) and
 * are re-exported here so both the component and plain `node --test` imports
 * share one implementation.
 */

import type { CSSProperties } from 'react'
import { dagDepths, orderedDagEntries, type DagDepthEntry } from './dag-layout.ts'
import type { ActivityTask } from './activity-monitor.ts'
import css from './TeamPanel.module.css'

export { dagDepths, orderedDagEntries }
export type { DagDepthEntry }

export interface DagViewProps {
  /** Task rows in host snapshot order. */
  readonly tasks: readonly ActivityTask[]
  /** Section caption shown in the section header. */
  readonly caption?: string
  /** Clamp for the indentation depth (deeper chains flatten at this level). */
  readonly maxDepth?: number
}

const DAG_INDENT_PER_LEVEL = 14

/** Dependency list: tasks indented by upstream depth, dependency ids as chips.
 *  The section count is the number of tasks that carry dependencies (the ids
 *  the list actually renders as chip rows), not the number of edges. */
export function DagView({ tasks, caption = 'Task dependencies', maxDepth = 8 }: DagViewProps) {
  const entries = orderedDagEntries(tasks)
  const byId = new Map<string, ActivityTask>()
  for (const task of tasks) byId.set(task.id, task)
  const withDependencies = entries.filter((entry) => entry.task.dependencies.length > 0)
  return (
    <section className={css.section} data-panel-section="dag">
      <header className={css.sectionHead}>
        <span className={css.sectionTitle}>{caption}</span>
        <span className={css.sectionCount} title="tasks with dependencies">{withDependencies.length}</span>
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
