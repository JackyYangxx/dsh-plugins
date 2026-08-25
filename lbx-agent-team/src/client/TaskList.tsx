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
 *
 * Captain view (M2-B): when `isCaptain` and `onAction` are provided, each
 * non-terminal row gains captain action buttons (complete on tested tasks,
 * reassign, cancel) plus an inline reassign-target picker. The buttons are a
 * pure UX directive: clicking one reports the action through `onAction`
 * (the caller owns message injection); actual execution still runs through
 * the captain model and the lbx_agent_team_* tools' own authorization.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { taskStages, type StageLabel } from './activity-model.ts'
import {
  actionButtonsFor,
  type CaptainAction,
  type ReassignActionOptions,
} from './action-messages.ts'
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
  /** Captain view: render per-task action buttons (complete/reassign/cancel). */
  readonly isCaptain?: boolean
  /** Reassign target names for the picker (active member names; pool/captain are implicit). */
  readonly reassignTargets?: readonly string[]
  /**
   * Click handler for one action button; returns a promise that resolves to
   * whether the directive was accepted (used to revert the optimistic
   * "sent" state on failure). The caller owns message injection.
   */
  readonly onAction?: (
    action: CaptainAction,
    task: ActivityTask,
    options?: ReassignActionOptions,
  ) => void | Promise<boolean>
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

/** How long the "sent" checkmark stays on a button after a click. */
const ACTION_SENT_MS = 1500

/** Stable key of one (action, task) click for the transient sent state. */
function actionSentKey(action: CaptainAction, taskId: string): string {
  return `${action}:${taskId}`
}

/** Reassign target chips: pool + captain first, then active member names. */
function reassignTargetChips(
  memberTargets: readonly string[] | undefined,
): readonly string[] {
  const seen = new Set<string>()
  const chips: string[] = []
  for (const target of ['pool', 'captain']) {
    seen.add(target)
    chips.push(target)
  }
  for (const name of memberTargets ?? []) {
    if (seen.has(name)) continue
    seen.add(name)
    chips.push(name)
  }
  return chips
}

/**
 * One captain action button. Reassign toggles the inline target picker
 * instead of injecting directly; complete/cancel report the action through
 * onAction immediately. While a send for this button is in flight (or after
 * a successful send) the button is disabled, so a double click cannot queue
 * two identical directives (Minor-3 review).
 */
function ActionButton({
  action,
  task,
  sent,
  open,
  busy,
  disabled,
  translate,
  onAction,
  onToggleReassign,
}: {
  readonly action: CaptainAction
  readonly task: ActivityTask
  readonly sent: boolean
  /** Whether this task's reassign picker is open (aria-expanded state). */
  readonly open: boolean
  /** True while this button's send is in flight (disabled + busy style). */
  readonly busy: boolean
  /** Whether the button is disabled (in-flight or sent). */
  readonly disabled: boolean
  readonly translate: LbxAgentTeamTranslate
  readonly onAction: (action: CaptainAction, task: ActivityTask, options?: ReassignActionOptions) => void | Promise<boolean>
  readonly onToggleReassign: () => void
}) {
  const key = action === 'complete' ? 'action.aria.complete'
    : action === 'reassign' ? 'action.aria.reassign'
    : 'action.aria.cancel'
  const handleClick = (): void => {
    if (action === 'reassign') {
      onToggleReassign()
      return
    }
    onAction(action, task)
  }
  return (
    <button
      type="button"
      className={css.actionButton}
      data-action={action}
      data-sent={sent || undefined}
      data-busy={busy || undefined}
      data-open={action === 'reassign' ? (open || undefined) : undefined}
      aria-expanded={action === 'reassign' ? open : undefined}
      aria-label={sent ? translate('action.aria.sent') : translate(key, { taskId: task.id })}
      title={sent ? translate('action.sent') : translate(key, { taskId: task.id })}
      disabled={disabled}
      onClick={handleClick}
    >
      {sent ? translate('action.sent') : translate(
        action === 'complete' ? 'action.complete'
          : action === 'reassign' ? 'action.reassign'
          : 'action.cancel',
      )}
    </button>
  )
}

/** Inline reassign target picker shown under the row's action buttons. */
function ReassignTargets({
  task,
  targets,
  translate,
  onAction,
}: {
  readonly task: ActivityTask
  readonly targets: readonly string[]
  readonly translate: LbxAgentTeamTranslate
  readonly onAction: (action: CaptainAction, task: ActivityTask, options?: ReassignActionOptions) => void | Promise<boolean>
}) {
  return (
    <span className={css.reassignMenu} data-reassign-menu>
      <span className={css.reassignLabel}>{translate('action.reassignTo')}</span>
      <span className={css.reassignTargets}>
        {targets.map((target) => (
          <button
            key={target}
            type="button"
            className={css.reassignTarget}
            data-target={target}
            onClick={() => { onAction('reassign', task, { to: target }) }}
          >
            {target === 'pool' ? translate('action.target.pool')
              : target === 'captain' ? translate('action.target.captain')
              : target}
          </button>
        ))}
      </span>
    </span>
  )
}

/** Task list: id, subject, assignee, stage badge and (captain view) actions. */
export function TaskList({
  tasks,
  caption,
  t,
  isCaptain = false,
  reassignTargets,
  onAction,
}: TaskListProps): ReactNode {
  const translate = t ?? enFallbackTranslate
  const title = caption ?? translate('tasks.caption')
  // Transient feedback, the in-flight send guard and the open reassign
  // picker (display state only).
  const [sentKey, setSentKey] = useState<string | null>(null)
  const [inFlightKey, setInFlightKey] = useState<string | null>(null)
  const [reassignOpenFor, setReassignOpenFor] = useState<string | null>(null)

  useEffect(() => {
    if (sentKey === null) return
    const timer = setTimeout(() => { setSentKey(null) }, ACTION_SENT_MS)
    return () => { clearTimeout(timer) }
  }, [sentKey])

  const captainView = isCaptain === true && onAction !== undefined
  const targets = reassignTargetChips(captainView ? reassignTargets : undefined)

  const handleAction = useCallback((
    action: CaptainAction,
    task: ActivityTask,
    options?: ReassignActionOptions,
  ): void => {
    if (onAction === undefined) return
    const key = actionSentKey(action, task.id)
    // In-flight guard: this button is disabled until the send settles, so a
    // double click cannot queue two identical directives (Minor-3 review).
    setInFlightKey(key)
    setReassignOpenFor(null)
    const outcome = onAction(action, task, options)
    if (outcome !== undefined && typeof outcome.then === 'function') {
      void outcome.then((ok) => {
        setInFlightKey((previous) => (previous === key ? null : previous))
        if (ok) setSentKey(key)
      })
    } else {
      setInFlightKey((previous) => (previous === key ? null : previous))
      setSentKey(key)
    }
  }, [onAction])

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
              const actions = captainView ? actionButtonsFor(task.status) : []
              const showActions = actions.length > 0
              const reassignOpen = reassignOpenFor === task.id
              return (
                <li key={task.id} className={css.taskRow} data-stage={stage} data-actions={showActions ? '' : undefined}>
                  <span className={css.taskId}>{task.id}</span>
                  <span className={css.taskSubject} title={task.subject}>{task.subject}</span>
                  <span className={css.taskAssignee}>{task.assignee === '' ? '—' : task.assignee}</span>
                  <span className={css.stageBadge} data-stage={stage}>{translate(STAGE_LABEL[stage])}</span>
                  {showActions && (
                    <span
                      className={css.taskActions}
                      data-lbx-agent-team-actions
                      data-open={reassignOpen || undefined}
                    >
                      <span className={css.taskActionButtons}>
                        {actions.map((action) => {
                          const key = actionSentKey(action, task.id)
                          const busy = inFlightKey === key
                          const sent = sentKey === key
                          return (
                            <ActionButton
                              key={action}
                              action={action}
                              task={task}
                              sent={sent}
                              open={reassignOpen}
                              busy={busy}
                              disabled={busy || sent}
                              translate={translate}
                              onAction={handleAction}
                              onToggleReassign={() => {
                                setReassignOpenFor((previous) => (previous === task.id ? null : task.id))
                              }}
                            />
                          )
                        })}
                      </span>
                      {reassignOpen && (
                        <ReassignTargets
                          task={task}
                          targets={targets}
                          translate={translate}
                          onAction={handleAction}
                        />
                      )}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
    </section>
  )
}
