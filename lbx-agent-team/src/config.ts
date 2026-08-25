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

export const Config: z<Config> = z.object({
  stateDir: z.string().default('.lbx-agent-team'),
  memberProvider: z.string().default('spawn'),
  memberModel: z.string(),
  maxMembers: z.natural().min(1).default(12),
  maxParallelDevers: z.natural().min(1).default(3),
  autoRoster: z.boolean().default(true),
  autoDispatch: z.boolean().default(true),
  gitWorktrees: z.boolean().default(true),
  artifactsDir: z.string().default('docs/lbx-agent-team'),
  maxReviewLoop: z.natural().min(1).default(3),
  promptSectionOrder: z.natural().default(117),
  slashCommand: z.boolean().default(true),
})
