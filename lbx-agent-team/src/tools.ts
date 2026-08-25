/**
 * lbx_agent_team_* 工具面：17 个工具的注册入口。
 *
 * 三个子注册器（src/tools/team-tools.ts / task-tools.ts / comms-tools.ts）共享
 * src/tools/helpers.ts 的辅助：团队定位、锁内新鲜状态（requireFreshTeam 模式）、
 * attempt 能力、worktree 生命周期与 autoDispatch 派发泵。另注册 agent/status
 * 观察者：成员 turn 结束（idle）时同步团队状态并泵派发（Task 9 评审的
 * "member idle" 触发点）。
 *
 * @module lbx-agent-team/tools
 *
 * 接线：本模块只定义注册，不自动执行。由 index.ts apply() 调用
 * registerLbxAgentTeamTools(ctx, resolveToolsConfig(config)) 完成接线。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import type { ToolsConfig } from './tool-config.ts'
import { env, syncMemberStatus, workspaceOf } from './tools/helpers.ts'
import { registerTeamTools } from './tools/team-tools.ts'
import { registerTaskTools } from './tools/task-tools.ts'
import { registerCommsTools } from './tools/comms-tools.ts'

export type { ToolsConfig } from './tool-config.ts'
export { resolveToolsConfig } from './tool-config.ts'

/** 注册全部 17 个 lbx_agent_team_* 工具与成员状态观察者。 */
export function registerLbxAgentTeamTools(ctx: Context, config: ToolsConfig): void {
  registerTeamTools(ctx, config)
  registerTaskTools(ctx, config)
  registerCommsTools(ctx, config)

  // 成员 idle/running 边 → 同步团队状态 + 泵派发（member idle 触发点）。
  const e = env(ctx, config)
  ctx.on('agent/status', ({ agent, status }: { agent: Agent; status: AgentStatus }) => {
    void syncMemberStatus(e, agent, status, workspaceOf(agent)).catch((error: unknown) => {
      ctx.logger.warn(`lbx-agent-team: member status sync failed for ${agent.id}: ${String(error)}`)
    })
  })
}
