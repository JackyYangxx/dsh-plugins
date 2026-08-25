/**
 * Pure builders for captain action directives (M2-B).
 *
 * The activity panel renders captain-only per-task action buttons
 * (complete / reassign / cancel). Clicking one injects a structured user
 * message into the captain session via action-injector.ts; the captain model
 * — already running the LBX Agent Team protocol from its system-prompt usage
 * section — reads the directive and executes it with the existing
 * lbx_agent_team_* tools. The button is a pure UX directive: the tools'
 * own captain-only authorization still applies, so there is no privilege
 * bypass.
 *
 * The directive deliberately does NOT start with `/lbx-agent-team`, so the
 * command gesture boundary (command.ts) never treats it as a team-activation
 * line — no spurious "create a team" activation message gets appended. The
 * `[lbx-agent-team action: …]` marker is a recognizable prefix for the
 * captain (and for log/trace forensics), not a command gesture.
 *
 * This module is pure (no DOM, no context) so it runs under plain node in
 * the unit tests.
 */

/** Captain panel actions offered per task row. */
export type CaptainAction = 'cancel' | 'complete' | 'reassign'

/**
 * Terminal task statuses mirrored from the host pipeline (types.ts
 * TERMINAL_TASK_STATUSES): no further pipeline transition applies. Note that
 * failed/cancelled are STILL retryable through lbx_agent_team_reassign_task
 * (the tool only rejects complete), so the panel offers a retry-only reassign
 * button on them; complete is truly immutable.
 */
export const TERMINAL_TASK_STATUSES: readonly string[] = ['complete', 'failed', 'cancelled']

/** Whether a task status is terminal (no further pipeline action applies). */
export function isTerminalTaskStatus(status: string): boolean {
  return TERMINAL_TASK_STATUSES.includes(status)
}

/** Reassign target for the captain reassign action. */
export interface ReassignActionOptions {
  /**
   * Reassign target: an active member name, "pool" (shared dever pool), or
   * "captain" — the lbx_agent_team_reassign_task `to` parameter values.
   */
  readonly to: string
}

/**
 * Which panel actions apply to one task status (mirrors the host pipeline
 * transitions):
 * - complete — the captain's finish on tested tasks;
 * - reassign — every non-complete status, including retry of failed/cancelled
 *   (lbx_agent_team_reassign_task only rejects complete);
 * - cancel — every live (non-terminal) status; the pipeline has no cancel
 *   transition from failed/cancelled, so those get retry only.
 * Returns the actions in button display order: complete first when present,
 * then reassign, then cancel.
 */
export function actionButtonsFor(status: string): readonly CaptainAction[] {
  if (status === 'complete') return []
  // failed / cancelled are terminal but retryable via reassign_task.
  if (isTerminalTaskStatus(status)) return ['reassign']
  const actions: CaptainAction[] = []
  if (status === 'tested') actions.push('complete')
  actions.push('reassign', 'cancel')
  return actions
}

/**
 * Build the structured user message injected into the captain session for
 * one panel action.
 * @param action - the clicked captain action.
 * @param taskId - the task id (e.g. "t3").
 * @param teamName - the team display name (the captain leads one team, but
 * naming it removes any ambiguity).
 * @param options - reassign target; absent defaults to "pool".
 * @returns the full directive text.
 */
export function buildActionMessage(
  action: CaptainAction,
  taskId: string,
  teamName: string,
  options?: ReassignActionOptions,
): string {
  const header = [
    `[lbx-agent-team action: ${action}]`,
    `Captain, the user clicked "${action}" for task ${taskId} in team "${teamName}" on the activity panel.`,
    'Execute it with the corresponding LBX Agent Team tool:',
  ].join(' ')
  switch (action) {
    case 'cancel':
      return [
        header,
        'lbx_agent_team_cancel_task(',
        'taskId="' + taskId + '", ',
        'reason="User requested cancellation from the activity panel"',
        ')',
      ].join('')
    case 'complete':
      return [
        header,
        'lbx_agent_team_update_task(',
        'taskId="' + taskId + '", ',
        'done=true',
        ')',
        ' — the task is tested; you (the captain) complete it. If you do not have its current attempt_id, read it from lbx_agent_team_status first and pass it as attemptId.',
      ].join('')
    case 'reassign':
      return [
        header,
        'lbx_agent_team_reassign_task(',
        'taskId="' + taskId + '", ',
        'to="' + (options?.to ?? 'pool') + '"',
        ')',
      ].join('')
  }
}
