/**
 * TaskList: pure presentational task list for the lbx-agent-team activity
 * panel (Task 17).
 *
 * Each task row shows its id, subject, assignee and a pipeline stage badge.
 * The stage is derived from the task status through
 * `activity-model.taskStages` (pending/working/review/approved/committed/
 * tested/done/failed/cancelled) and colour-graded per stage in the
 * stylesheet. No DOM access or effects.
 */

import { taskStages } from './activity-model.ts'
import type { ActivityTask } from './activity-monitor.ts'
import css from './TeamPanel.module.css'

export interface TaskListProps {
  /** Task rows in host snapshot order. */
  readonly tasks: readonly ActivityTask[]
  /** Section caption shown in the section header. */
  readonly caption?: string
}

/** Task list: id, subject, assignee and pipeline stage badge. */
export function TaskList({ tasks, caption = 'Tasks' }: TaskListProps) {
  return (
    <section className={css.section} data-panel-section="tasks">
      <header className={css.sectionHead}>
        <span className={css.sectionTitle}>{caption}</span>
        <span className={css.sectionCount}>{tasks.length}</span>
      </header>
      {tasks.length === 0
        ? <p className={css.emptyHint}>No tasks yet.</p>
        : (
          <ul className={css.taskList}>
            {tasks.map((task) => {
              const stage = taskStages(task.status)
              return (
                <li key={task.id} className={css.taskRow} data-stage={stage}>
                  <span className={css.taskId}>{task.id}</span>
                  <span className={css.taskSubject} title={task.subject}>{task.subject}</span>
                  <span className={css.taskAssignee}>{task.assignee === '' ? '—' : task.assignee}</span>
                  <span className={css.stageBadge} data-stage={stage}>{stage}</span>
                </li>
              )
            })}
          </ul>
        )}
    </section>
  )
}
