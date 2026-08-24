/**
 * TaskList: pure presentational task list for the lbx-agent-team activity
 * panel (Task 17).
 *
 * Each task row shows its id, subject, assignee and a pipeline stage badge.
 * The stage is derived from the task status through
 * `activity-model.taskStages` (pending/working/review/approved/committed/
 * tested/done/failed/cancelled) and colour-graded per stage in the
 * stylesheet. No DOM access or effects. Copy flows through the optional `t`
 * locale seat (Task 18); without one an English fallback keeps the component
 * renderable standalone.
 */

import { taskStages, type StageLabel } from './activity-model.ts'
import type { ActivityTask } from './activity-monitor.ts'
import { enFallbackTranslate, type LbxAgentTeamLocaleKey, type LbxAgentTeamTranslate } from './locales.ts'
import css from './TeamPanel.module.css'

export interface TaskListProps {
  /** Task rows in host snapshot order. */
  readonly tasks: readonly ActivityTask[]
  /** Section caption shown in the section header. */
  readonly caption?: string
  /** Optional locale translate seat; English fallback when absent. */
  readonly t?: LbxAgentTeamTranslate
}

/** Exhaustive stage → locale key; a new StageLabel fails the build here. */
const STAGE_LABEL: Record<StageLabel, LbxAgentTeamLocaleKey> = {
  pending: 'stage.pending',
  working: 'stage.working',
  review: 'stage.review',
  approved: 'stage.approved',
  committed: 'stage.committed',
  tested: 'stage.tested',
  done: 'stage.done',
  failed: 'stage.failed',
  cancelled: 'stage.cancelled',
}

/** Task list: id, subject, assignee and pipeline stage badge. */
export function TaskList({ tasks, caption, t }: TaskListProps) {
  const translate = t ?? enFallbackTranslate
  const title = caption ?? translate('tasks.caption')
  return (
    <section className={css.section} data-panel-section="tasks">
      <header className={css.sectionHead}>
        <span className={css.sectionTitle}>{title}</span>
        <span className={css.sectionCount}>{tasks.length}</span>
      </header>
      {tasks.length === 0
        ? <p className={css.emptyHint}>{translate('tasks.empty')}</p>
        : (
          <ul className={css.taskList}>
            {tasks.map((task) => {
              const stage = taskStages(task.status)
              return (
                <li key={task.id} className={css.taskRow} data-stage={stage}>
                  <span className={css.taskId}>{task.id}</span>
                  <span className={css.taskSubject} title={task.subject}>{task.subject}</span>
                  <span className={css.taskAssignee}>{task.assignee === '' ? '—' : task.assignee}</span>
                  <span className={css.stageBadge} data-stage={stage}>{translate(STAGE_LABEL[stage])}</span>
                </li>
              )
            })}
          </ul>
        )}
    </section>
  )
}
