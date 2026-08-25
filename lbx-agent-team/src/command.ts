/**
 * The `/lbx-agent-team` slash command and its plain-text gesture boundary.
 *
 * Two deterministic activation paths, mirroring the Harness skill pipeline
 * (`dsh-tool-skill` + the `ui-skill` client source):
 *
 * 1. **Host command** — `ctx.commands.register` publishes the closed-namespace
 *    `/lbx-agent-team` command. The web GUI's slash menu (the Harness
 *    `ui-commands` client) lists it from the host catalog with the input
 *    hint; the argued line is claimed client-side and executed through
 *    `command.execute`. The handler replays that exact line as an ordinary
 *    user follow-up (`agent.followup`) so it remains visible in the chat; the
 *    gesture boundary then adds the deterministic activation message.
 * 2. **Gesture boundary** — a `agent/pre-step` listener recognizes a leading
 *    `/lbx-agent-team` token in genuine user messages and injects the same
 *    activation message. This covers surfaces with no command adjudication
 *    (headless CLI, API, pasted text in plain composers) and also handles the
 *    exact user line replayed by the host command. Mid-sentence mentions stay
 *    ordinary prose; only `source.kind === 'user'` messages are scanned, so
 *    injected or external text cannot forge the gesture.
 *
 * @module lbx-agent-team/command
 */

import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'

/** The slash command name (without the leading slash). */
export const LBX_AGENT_TEAM_COMMAND = 'lbx-agent-team'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /**
     * A deterministic `/lbx-agent-team` activation injected after the visible
     * user-authored slash line.
     */
    'lbx-agent-team-command': {
      readonly kind: 'lbx-agent-team-command'
      /** The user-supplied goal text (absent when the gesture was bare). */
      readonly goal?: string
    }
  }
}

/**
 * A leading, whitespace-bounded `/lbx-agent-team` token — the command grammar
 * shape the harness uses (`parseCommand`): `/` inside words, file paths and
 * mid-sentence mentions never match.
 */
const GESTURE = /^\/lbx-agent-team(?=$|[\t\n\r ])/u

/**
 * The deterministic activation text. The system-prompt usage section owns
 * the full protocol; this message only switches it on for one concrete goal,
 * pointing the captain at the entry tool (the tool's own schema enforces its
 * required fields).
 * @param goal - the user-supplied goal, or `''` for a bare invocation.
 */
export function buildActivationDirective(goal: string): string {
  const goalLine = goal === ''
    ? 'The goal was not given — ask the user what the team should accomplish.'
    : `Goal: ${goal}`
  return [
    'The user invoked the `/lbx-agent-team` command. Activate the LBX Agent Team protocol from your instructions now: you are the captain of a multi-agent team. Start by calling lbx_agent_team_create with a team name and the goal as its description; the tool itself validates the required fields.',
    goalLine,
  ].join('\n')
}

/**
 * The goal of the latest start-anchored `/lbx-agent-team` gesture in genuine
 * user messages, or `undefined` when no message carries one. `''` means a
 * bare `/lbx-agent-team` token with no goal.
 * @param messages - the step's claimed batch (user messages only scanned).
 */
export function invokedLbxAgentTeamGoal(messages: readonly UserMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message === undefined || message.source.kind !== 'user') continue
    for (const block of message.content) {
      if (block.type !== 'text') continue
      const text = block.text.trimStart()
      if (!GESTURE.test(text)) continue
      return text.slice(LBX_AGENT_TEAM_COMMAND.length + 1).trim()
    }
  }
  return undefined
}

/**
 * Register the closed-namespace `/lbx-agent-team` host command. The handler
 * preserves the exact submitted slash line as an ordinary user follow-up;
 * the pre-step gesture boundary injects the activation directive and wakes
 * the captain deterministically. The registration rides the calling
 * context's fiber, so a disposed scope (HMR, plugin removal) unregisters the
 * command.
 * @param ctx - host context providing the `commands` registry.
 */
export function registerLbxAgentTeamCommand(ctx: Context): void {
  ctx.effect(() => ctx.commands.register({
    name: LBX_AGENT_TEAM_COMMAND,
    description: 'run a goal with a multi-agent team (you become the captain)',
    input: { hint: '<goal — what the team should accomplish>' },
    handler(invocation: CommandInvocation): CommandResult {
      const goal = invocation.rawInput.trim()
      if (goal === '') {
        return {
          kind: 'error',
          text: `Usage: /${LBX_AGENT_TEAM_COMMAND} <goal — what the team should accomplish>`,
        }
      }
      invocation.agent.followup(createUserMessage({
        content: [{ type: 'text', text: `/${LBX_AGENT_TEAM_COMMAND}${invocation.rawInput}` }],
        source: { kind: 'user' },
      }))
      return {
        kind: 'success',
        text: `LBX Agent Team activated — the captain will assemble a team for: ${goal}`,
      }
    },
  }), 'lbx-agent-team: slash command')
}

/**
 * Install the `agent/pre-step` gesture boundary: a claimed user message
 * starting with `/lbx-agent-team` gains the deterministic activation message
 * appended after every other injection, closest to the model's answer.
 * @param ctx - host context providing the `agent/pre-step` waterfall.
 */
export function installLbxAgentTeamGestureBoundary(ctx: Context): void {
  ctx.on('agent/pre-step', async (
    { messages, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const goal = invokedLbxAgentTeamGoal(messages)
    if (goal === undefined) return decision
    signal.throwIfAborted()
    const activation = createUserMessage({
      content: [{ type: 'text', text: buildActivationDirective(goal) }],
      source: {
        kind: 'lbx-agent-team-command',
        ...goal === '' ? {} : { goal },
      },
    })
    return { kind: 'enter', messages: [...decision.messages, activation] }
  })
}
