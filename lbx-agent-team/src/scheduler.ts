import type { TeamState } from './types.ts'
import { claimGate } from './pipeline.ts'

export interface Dispatch { member: string; taskId: string }

/**
 * 纯函数：从当前团队状态决定下一笔派发（一个 idle pool dever 领取一个就绪 pool 任务）。
 * 无就绪组合返回 undefined。maxParallelDevers 由调用方保证 pool 大小。
 */
export function nextDispatch(team: TeamState): Dispatch | undefined {
  const idle = team.members.find((m) => m.status === 'idle' && m.role === 'dever')
  if (idle === undefined) return undefined
  const ready = team.tasks.find((t) =>
    t.status === 'pending' && t.assignee === 'pool' && t.dedicated !== true && claimGate(team, t) === undefined)
  if (ready === undefined) return undefined
  return { member: idle.name, taskId: ready.id }
}
