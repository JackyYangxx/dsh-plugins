import type { Context } from '@deepseek-ai/cordis'
// Type-only import: loads @deepseek-ai/dsh-system-prompt's 'declare module
// @deepseek-ai/cordis' augmentation so ctx.systemPrompt is typed.
import type {} from '@deepseek-ai/dsh-system-prompt'
import { Config, type Config as ConfigType } from './config.ts'

export const name = 'lbx-agent-team'
export const inject = ['tools', 'systemPrompt']
export { Config }

export function apply(ctx: Context, config: ConfigType): void {
  ctx.systemPrompt.section({
    name: 'lbx-agent-team:usage',
    order: config.promptSectionOrder ?? 117,
    text: 'LBX Agent Team usage protocol will be filled by Task 13.',
  })
  ctx.logger.info('lbx-agent-team mounted')
}
