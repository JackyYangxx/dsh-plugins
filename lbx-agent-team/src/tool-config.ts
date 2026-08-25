/** 工具层已解析的插件配置：默认值在此展开，工具只消费本类型。 */
import type { Config } from './config.ts'

export interface ToolsConfig {
  /** 团队状态目录名（workspace 下）。 */
  stateDir: string
  /** 成员子代理 provider 名（spawn / fork）。 */
  memberProvider: string
  /** 可选的成员 model 覆盖。 */
  memberModel?: string
  /** 团队成员上限（不含队长）。 */
  maxMembers: number
  /** 并行 pool dever 上限。 */
  maxParallelDevers: number
  /** create 时自动登记 planner/checker/tester 名册。 */
  autoRoster: boolean
  /** 就绪 pool 任务自动派发给 idle dever。 */
  autoDispatch: boolean
  /** dever 使用独立 git worktree（否则共享工作树）。 */
  gitWorktrees: boolean
  /** 同一任务连续 REQUEST_CHANGES 上限，超限置 failed。 */
  maxReviewLoop: number
}

export function resolveToolsConfig(config: Config): ToolsConfig {
  return {
    stateDir: config.stateDir ?? '.lbx-agent-team',
    memberProvider: config.memberProvider ?? 'spawn',
    memberModel: config.memberModel,
    maxMembers: config.maxMembers ?? 12,
    maxParallelDevers: config.maxParallelDevers ?? 3,
    autoRoster: config.autoRoster ?? true,
    autoDispatch: config.autoDispatch ?? true,
    gitWorktrees: config.gitWorktrees ?? true,
    maxReviewLoop: config.maxReviewLoop ?? 3,
  }
}
