import type { Actor, TeamState, TeamTask, TaskStatus } from './types.ts'

export type PipelineAction =
  | 'claim' | 'start' | 'submit' | 'approve' | 'request_changes'
  | 'commit' | 'test' | 'finish' | 'fail' | 'cancel'

/** 状态机：每个状态允许的动作。 */
const TRANSITIONS: Record<TaskStatus, readonly PipelineAction[]> = {
  pending: ['claim', 'fail', 'cancel'],
  claimed: ['start', 'fail', 'cancel'],
  in_progress: ['submit', 'fail', 'cancel'],
  in_review: ['approve', 'request_changes', 'fail', 'cancel'],
  changes_requested: ['submit', 'fail', 'cancel'],
  approved: ['commit', 'fail', 'cancel'],
  committed: ['test', 'fail', 'cancel'],
  tested: ['finish', 'fail', 'cancel'],
  complete: [],
  failed: [],
  cancelled: [],
}

export function allowedActions(status: TaskStatus): readonly PipelineAction[] {
  return TRANSITIONS[status]
}

export function nextStatus(status: TaskStatus, action: PipelineAction): TaskStatus | undefined {
  if (!TRANSITIONS[status].includes(action)) return undefined
  switch (action) {
    case 'claim': return 'claimed'
    case 'start': return 'in_progress'
    case 'submit': return 'in_review'
    case 'approve': return 'approved'
    case 'request_changes': return 'changes_requested'
    case 'commit': return 'committed'
    case 'test': return 'tested'
    case 'finish': return 'complete'
    case 'fail': return 'failed'
    case 'cancel': return 'cancelled'
  }
}

export function transitionError(status: TaskStatus, action: PipelineAction): string | undefined {
  if (nextStatus(status, action) !== undefined) return undefined
  return `cannot ${action} a task in status ${status}`
}

/** 硬门：claim 前依赖必须全部 complete。返回错误信息或 undefined。 */
export function claimGate(team: TeamState, task: TeamTask): string | undefined {
  const blocked = task.dependencies.filter((depId) =>
    team.tasks.find((t) => t.id === depId)?.status !== 'complete')
  if (blocked.length > 0) return `dependencies not complete: ${blocked.join(', ')}`
  return undefined
}

/** 硬门：只有 checker 角色成员能 APPROVE / REQUEST_CHANGES。 */
export function approveGate(actor: Actor): string | undefined {
  if (actor.kind === 'captain' || actor.role !== 'checker') return 'only a checker member may review'
  return undefined
}

/** 硬门：commit 前必须有 APPROVE 记录。 */
export function commitGate(task: TeamTask): string | undefined {
  if (task.review?.verdict !== 'APPROVE') return 'task has no APPROVE record'
  return undefined
}

/** 硬门：只有 tester 角色成员能提交测试结果，且任务必须 committed。 */
export function testGate(actor: Actor, task: TeamTask): string | undefined {
  if (actor.kind === 'captain' || actor.role !== 'tester') return 'only a tester member may test'
  if (task.status !== 'committed') return 'task must be committed before testing'
  return undefined
}

/** 生成新 attemptId（capability）。 */
export function newAttemptId(task: TeamTask): string {
  return `${task.id}-a${(task.attempt ?? 0) + 1}-${Date.now()}`
}
