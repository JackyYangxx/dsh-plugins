import z from '@deepseek-ai/schemastery'

export interface Config {
  stateDir?: string
  memberProvider?: string
  memberModel?: string
  maxMembers?: number
  maxParallelDevers?: number
  autoRoster?: boolean
  autoDispatch?: boolean
  gitWorktrees?: boolean
  artifactsDir?: string
  maxReviewLoop?: number
  promptSectionOrder?: number
  slashCommand?: boolean
}

/** 插件默认值单点来源：schema 与工具层解析都引用本常量。 */
export const DEFAULTS = {
  stateDir: '.lbx-agent-team',
  memberProvider: 'spawn',
  maxMembers: 12,
  maxParallelDevers: 3,
  autoRoster: true,
  autoDispatch: true,
  gitWorktrees: true,
  artifactsDir: 'docs/lbx-agent-team',
  maxReviewLoop: 3,
  promptSectionOrder: 117,
  slashCommand: true,
} as const

export const Config: z<Config> = z.object({
  stateDir: z.string().default(DEFAULTS.stateDir),
  memberProvider: z.string().default(DEFAULTS.memberProvider),
  memberModel: z.string(),
  maxMembers: z.natural().min(1).default(DEFAULTS.maxMembers),
  maxParallelDevers: z.natural().min(1).default(DEFAULTS.maxParallelDevers),
  autoRoster: z.boolean().default(DEFAULTS.autoRoster),
  autoDispatch: z.boolean().default(DEFAULTS.autoDispatch),
  gitWorktrees: z.boolean().default(DEFAULTS.gitWorktrees),
  artifactsDir: z.string().default(DEFAULTS.artifactsDir),
  maxReviewLoop: z.natural().min(1).default(DEFAULTS.maxReviewLoop),
  promptSectionOrder: z.natural().default(DEFAULTS.promptSectionOrder),
  slashCommand: z.boolean().default(DEFAULTS.slashCommand),
})
