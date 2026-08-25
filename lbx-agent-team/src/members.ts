/**
 * Member subagent lifecycle for lbx-agent-team: lazy registration, lazy spawn
 * as durable continuable children of the captain, followup wake-ups, and
 * interrupt.
 *
 * Members are registered first (id='', status='pending') and only spawned when
 * they first need work. A spawned member is a durable continuable subagent of
 * the captain, so it keeps its conversation across turns and across harness
 * restarts: the captain wakes it with {@link ctx.subagents.followup}, it works
 * through its turn (updating team state through the `lbx_agent_team_*` tools),
 * and becomes idle again. Its final assistant message is not readable
 * programmatically, so the member persists reports into the captain's mailbox
 * and the task records, which the captain reads through
 * `lbx_agent_team_status`.
 *
 * Spawn details follow the dsh-agent-teams reference implementation: label
 * prefix `lbx-agent-team:<teamId>:<memberName>`, captain-only tools denied via
 * `toolFilter`, a compact member persona shadowing the deployment persona, and
 * a provider/model/reasoning snapshot resolved from the captain's current
 * request route (explicit member-level values win).
 * @module lbx-agent-team/members
 */

import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type Agent, type ModelSelection } from '@deepseek-ai/dsh-agent'
// Value import used below; the dsh-subagent module also declares ctx.subagents.
import { foldSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ROLE_PROMPTS, type RolePromptContext } from './roles.ts'
import { readTeam } from './state.ts'
import type { TeamMember } from './types.ts'

/** Captain-only LBX Agent Team tools hidden from every spawned member. */
export const MEMBER_DENIED_TOOLS = [
  'lbx_agent_team_create',
  'lbx_agent_team_add_member',
  'lbx_agent_team_remove_member',
  'lbx_agent_team_reassign_task',
  'lbx_agent_team_create_task',
  'lbx_agent_team_cancel_task',
  'lbx_agent_team_delete',
] as const

/** Label prefix marking spawned children as lbx-agent-team members. */
export const MEMBER_LABEL_PREFIX = 'lbx-agent-team:'

/** Durable provider/model/reasoning snapshot for one member. */
export interface MemberLlmSelection {
  /** Registered LLM provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Adapter-owned reasoning effort, absent when the target has no explicit/default effort. */
  reasoningEffort?: string
}

/** Member-level LLM route request resolved at spawn time. */
export interface MemberLlmSelectionRequest {
  /** Explicit LLM provider route; requires an explicit model. */
  provider?: string
  /** Explicit model id; otherwise the plugin default or captain model is used. */
  model?: string
  /** Plugin-level member model default. */
  defaultModel?: string
  /** Explicit reasoning effort; "default" selects the target model's default effort. */
  reasoningEffort?: string
}

/** Process-local bridge between spawn admission and synchronous child setup. */
export interface MemberSelectionRuntime {
  /** Make one selection visible while Harness materializes the fresh child. */
  withPending<T>(
    parentSessionId: string,
    label: string,
    selection: MemberLlmSelection,
    operation: () => Promise<T>,
  ): Promise<T>
}

/** 成员注册（不 spawn）。调用方在团队锁内更新 team.members。 */
export function registerMember(
  team: { members: TeamMember[]; taskSeq: number },
  input: { name: string; role: string; provider?: string; model?: string; reasoningEffort?: string },
): TeamMember {
  const member: TeamMember = {
    id: '',
    name: input.name,
    role: input.role,
    status: 'pending',
    provider: input.provider,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    joinedAt: Date.now(),
  }
  team.members.push(member)
  return member
}

function pendingSelectionKey(parentSessionId: string, label: string): string {
  return `${parentSessionId}\u0000${label}`
}

function modelSelection(selection: MemberLlmSelection): ModelSelection {
  return {
    provider: selection.provider,
    model: selection.model,
    ...selection.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: ReasoningEffortId(selection.reasoningEffort) },
  }
}

/**
 * Install the fresh-creation member model-selection bridge. Every continuable
 * child whose durable label carries the lbx-agent-team prefix receives the
 * pending spawn selection (provider/model/reasoning effort) in its unpublished
 * context, so the member runs on the snapshotted route from its first turn.
 *
 * Cold resume (harness restart) is deliberately not restored here: the durable
 * subagent descriptor already carries provider/model, so a resumed member
 * keeps its route and falls back to the target model's default effort — the
 * same behavior the reference applies to members without a saved route.
 */
export function installMemberSelectionRuntime(ctx: Context): MemberSelectionRuntime {
  const pending = new Map<string, MemberLlmSelection>()
  ctx.subagents.registerContinuableSetup((childCtx) => {
    const child = childCtx.agent
    if (child === undefined) return () => undefined
    const suffix = child.session.events.slice(child.session.header.seedLength ?? 0)
    const descriptor = foldSubagentDescriptor(suffix)
    if (descriptor?.mode !== 'continuable' || !descriptor.label.startsWith(MEMBER_LABEL_PREFIX)) {
      return () => undefined
    }
    const parentSessionId = child.session.header.parentSession
    if (parentSessionId === undefined) return () => undefined
    const selection = pending.get(pendingSelectionKey(parentSessionId, descriptor.label))
    if (selection === undefined) return () => undefined
    return installModelSelection(childCtx, {
      current: modelSelection(selection),
      assembled: undefined,
    })
  })

  return {
    async withPending<T>(
      parentSessionId: string,
      label: string,
      selection: MemberLlmSelection,
      operation: () => Promise<T>,
    ): Promise<T> {
      const key = pendingSelectionKey(parentSessionId, label)
      if (pending.has(key)) {
        throw new Error(`member model selection is already pending for "${label}"`)
      }
      pending.set(key, selection)
      try {
        return await operation()
      } finally {
        pending.delete(key)
      }
    },
  }
}

/** Lazily installed per-context selection bridge (installed on first spawn). */
let installedRuntime: { ctx: Context; runtime: MemberSelectionRuntime } | undefined

function selectionRuntime(ctx: Context): MemberSelectionRuntime {
  if (installedRuntime === undefined || installedRuntime.ctx !== ctx) {
    installedRuntime = { ctx, runtime: installMemberSelectionRuntime(ctx) }
  }
  return installedRuntime.runtime
}

/**
 * Resolve the member's reasoning effort: an explicit effort wins, the sentinel
 * "default" forces the target model's default, and a changed route drops the
 * captain's effort so the target materializes its own default.
 */
function resolveMemberReasoningEffort(
  explicitEffort: string | undefined,
  sameRoute: boolean,
  currentEffort: ReasoningEffortId | undefined,
): ReasoningEffortId | undefined {
  if (explicitEffort === undefined) {
    if (sameRoute) return currentEffort
    return undefined
  }
  if (explicitEffort === 'default') return undefined
  return ReasoningEffortId(explicitEffort)
}

/**
 * Resolve one member's complete model selection. Ordinary members snapshot the
 * captain's current request route and reasoning effort. When provider or model
 * changes, effort is intentionally omitted so the target model materializes
 * its own default instead of receiving an adapter-owned id from another route.
 * An explicit effort overrides either policy; the sentinel "default" also
 * selects the target model's default. The final effort is validated against
 * the target model before a child is created.
 */
export async function resolveMemberLlmSelection(
  ctx: Context,
  captain: Agent,
  request: MemberLlmSelectionRequest,
  signal?: AbortSignal,
): Promise<MemberLlmSelection> {
  const explicitProvider = request.provider?.trim()
  const explicitModel = request.model?.trim()
  const defaultModel = request.defaultModel?.trim()
  const explicitEffort = request.reasoningEffort?.trim()
  if (request.provider !== undefined && explicitProvider === '') {
    throw new Error('member LLM provider must not be empty')
  }
  if (request.model !== undefined && explicitModel === '') {
    throw new Error('member model must not be empty')
  }
  if (request.defaultModel !== undefined && defaultModel === '') {
    throw new Error('configured memberModel must not be empty')
  }
  if (request.reasoningEffort !== undefined && explicitEffort === '') {
    throw new Error('member reasoning effort must not be empty')
  }
  if (explicitProvider !== undefined && explicitModel === undefined) {
    throw new Error('an explicit member LLM provider requires an explicit member model')
  }

  const current = captain.session.requestHeader()?.config
  const currentProvider = current?.provider ?? captain.options.provider
  const currentModel = current?.model ?? captain.options.model
  const provider = explicitProvider ?? currentProvider
  const model = explicitModel ?? defaultModel ?? currentModel
  if (provider === undefined || model === undefined) {
    throw new Error('cannot resolve the member LLM route from the current captain session')
  }

  // Effort ids belong to one exact provider/model capability. Preserve the
  // captain's effort only on the same route; a changed route must resolve its
  // own default. Explicit effort still wins, while "default" forces that
  // target-default behavior even when the route did not change.
  const sameRoute = provider === currentProvider && model === currentModel
  const reasoningEffort = resolveMemberReasoningEffort(explicitEffort, sameRoute, current?.reasoningEffort)
  const resolved = await ctx.llm.resolveCallConfig({
    provider,
    model,
    ...reasoningEffort === undefined
      ? {}
      : { reasoningEffort },
  }, signal)
  return {
    provider: resolved.provider,
    model: resolved.model,
    ...resolved.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: String(resolved.reasoningEffort) },
  }
}

/** Fallback role prompt for roles without a ROLE_PROMPTS preset. */
function genericRolePrompt(member: TeamMember, roleCtx: RolePromptContext): string {
  return [
    `You are ${member.name}, a ${member.role ?? 'worker'} member of the LBX Agent Team "${roleCtx.teamId}".`,
    'Your job: do the work the captain assigns you, following the team rules.',
    'Rules:',
    `1. Read the spec at ${roleCtx.specPath} when your work references it.`,
    `2. Do NOT modify the spec. Never edit team state files under ${roleCtx.stateRoot} — use the lbx_agent_team_* tools.`,
    '3. Call the lbx_agent_team_* tools for team state and report to the captain via lbx_agent_team_send_message when done or blocked.',
  ].join('\n')
}

/** The member's initial prompt: the role preset (dever carries taskSubject). */
function initialMemberPrompt(member: TeamMember, roleCtx: RolePromptContext): string {
  const rolePrompt = ROLE_PROMPTS[member.role]?.(roleCtx) ?? genericRolePrompt(member, roleCtx)
  return `${rolePrompt}\n\nYou have joined the team as ${member.name}. The captain will send you tasks and messages; wait for instructions.`
}

/** The member's system prompt (persona), shadowing the deployment persona. */
function memberPersona(teamId: string, member: TeamMember, roleCtx: RolePromptContext): string {
  return [
    `You are ${member.name}, a ${member.role ?? 'worker'} member of the LBX Agent Team "${teamId}" running inside DeepSeek Harness. The captain leads the team; you are a worker member.`,
    'Team context:',
    `- Team id: ${teamId}`,
    `- Your identity inside the team: ${member.name}`,
    `- Team state lives under ${roleCtx.stateRoot}/${teamId}/ (team.json, tasks, issues, inbox/). You may inspect these files read-only for diagnostics, but never edit them directly — use the lbx_agent_team_* tools so concurrent updates stay safe.`,
    '- Each message you receive is a new turn: act on it and end your turn with a concise reply.',
    'Working rules:',
    "1. Do your role's job exactly as the instructions describe; do not do the captain's or other members' work.",
    "2. You are a worker: you cannot create or delete teams, add/remove members, reassign tasks, or create tasks — that is the captain's job.",
    '3. Communicate through lbx_agent_team_send_message (to the captain or teammates) and check your mailbox for messages.',
  ].join('\n')
}

/** Options for {@link spawnMember}. */
export interface MemberSpawnOptions {
  /** The team id (also present on roleCtx; kept for clarity). */
  teamId: string
  /** The member record to spawn; its id/status are backfilled on success. */
  member: TeamMember
  /** Role prompt context (specPath/stateRoot/teamId; taskSubject required for dever). */
  roleCtx: RolePromptContext
  /** Registered `ctx.subagents` provider name (defaults to the plugin default `spawn`). */
  provider?: string
  /** Plugin-configured member model override. */
  defaultModel?: string
  /** Member delegation depth cap (0 forbids delegation entirely). */
  maxDepth?: number
  /** Caller cancellation, forwarded to the start. */
  signal?: AbortSignal
}

/**
 * 懒 spawn：成员第一次需要工作时调用。返回续聊子代理会话 id。
 *
 * 照参考 dsh-agent-teams/src/members.ts 的 spawn 流程：
 * - provider 用插件配置（spawn/fork），经 ctx.subagents 的对应 provider；在首次
 *   spawn 时做能力校验（continuable / persona / toolFilter），fail loud；
 * - label 前缀 `lbx-agent-team:${teamId}:${memberName}`；
 * - prompt 由 ROLE_PROMPTS[role] 生成（dever 必须传 taskSubject）；
 * - LLM selection 快照沿用 captain 的 provider/model/effort，成员显式指定时用指定值；
 * - 给成员的工具集合排除 captain 专用工具（MEMBER_DENIED_TOOLS）。
 *
 * 成功后回填 member.id / provider / model / reasoningEffort / status='idle'；
 * 调用方在团队锁内持久化。失败时不做任何落盘，抛错由调用方处理。
 */
export async function spawnMember(
  ctx: Context,
  opts: MemberSpawnOptions,
): Promise<string> {
  const { teamId, member, roleCtx } = opts
  if (member.id !== '') {
    throw new Error(`member "${member.name}" is already spawned (id ${member.id})`)
  }
  if (member.status === 'removed') {
    throw new Error(`member "${member.name}" was removed and cannot be spawned`)
  }
  if (member.role === 'dever' && (roleCtx.taskSubject === undefined || roleCtx.taskSubject.trim() === '')) {
    throw new Error(`spawning dever member "${member.name}" requires roleCtx.taskSubject`)
  }

  // The parent must be the exact live captain recorded in the durable team
  // record, not the tool caller (a member-side tool call may trigger a spawn).
  const team = await readTeam(roleCtx.stateRoot, teamId)
  if (team === undefined) {
    throw new Error(`lbx-agent-team: team "${teamId}" not found under ${roleCtx.stateRoot} — cannot spawn member "${member.name}"`)
  }
  const captain = ctx.agents.get(SessionId(team.captainSessionId))
  if (captain === undefined) {
    throw new Error(`lbx-agent-team: captain session ${team.captainSessionId} of team "${teamId}" is not live — cannot spawn member "${member.name}"`)
  }

  // Fail loud at the first use: provider registration is a sibling plugin's
  // effect and may settle after this plugin mounts.
  const providerName = opts.provider ?? 'spawn'
  const provider = ctx.subagents.getProvider(providerName)
  if (provider === undefined) {
    throw new Error(
      `lbx-agent-team: no subagent provider "${providerName}" is registered (available: ${ctx.subagents.list().join(', ') || 'none'}) — `
      + 'check that the subagent provider row (e.g. subagent-spawn) is mounted in the composition',
    )
  }
  if (provider.prepareContinuable === undefined) {
    throw new Error(`lbx-agent-team: provider "${providerName}" does not support continuable members`)
  }
  if (!provider.capabilities.persona) {
    throw new Error(`lbx-agent-team: provider "${providerName}" cannot apply a member persona`)
  }
  if (!provider.capabilities.toolFilter) {
    throw new Error(`lbx-agent-team: provider "${providerName}" cannot restrict captain-only tools for members`)
  }

  const selection = await resolveMemberLlmSelection(ctx, captain, {
    provider: member.provider,
    model: member.model,
    defaultModel: opts.defaultModel,
    reasoningEffort: member.reasoningEffort,
  }, opts.signal)

  const label = `${MEMBER_LABEL_PREFIX}${teamId}:${member.name}`
  const start = await selectionRuntime(ctx).withPending(captain.id, label, selection, () => (
    ctx.subagents.startContinuable({
      provider: providerName,
      label,
      request: {
        prompt: [{ type: 'text', text: initialMemberPrompt(member, roleCtx) }],
        parent: captain,
        persona: memberPersona(teamId, member, roleCtx),
        toolFilter: { deny: [...MEMBER_DENIED_TOOLS] },
        agentOptions: {
          provider: selection.provider,
          model: selection.model,
        },
        ...opts.maxDepth !== undefined ? { maxDepth: opts.maxDepth } : {},
      },
      signal: opts.signal ?? new AbortController().signal,
    })
  ))

  // Backfill the durable member record; the caller persists inside its lock.
  member.id = start.childId
  member.provider = selection.provider
  member.model = selection.model
  member.reasoningEffort = selection.reasoningEffort
  member.status = 'idle'
  return start.childId
}

/**
 * 唤醒成员做一轮工作（followup）。Best effort：失败（成员已消失或不可续聊）记
 * 日志并返回 false，让调用方决定（邮箱投递仍然发生了）。
 * @param captain - 成员的 exact live direct parent（队长 agent）。
 * @returns 是否被成员 inbox 接受。
 */
export async function wakeMember(
  ctx: Context,
  captain: Agent,
  memberId: string,
  message: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    await ctx.subagents.followup(captain, SessionId(memberId), [{ type: 'text', text: message }], {
      source: { kind: 'plugin', plugin: 'lbx-agent-team' },
      signal: signal ?? new AbortController().signal,
    })
    return true
  } catch (error: unknown) {
    ctx.logger.warn(`lbx-agent-team: followup to member ${memberId} failed: ${String(error)}`)
    return false
  }
}

/**
 * 中断成员当前轮次（reassign 前调用并等待 quiesce）。Best effort，fire and
 * return：目标可能继续运行直到观察到信号。
 * @param captain - 成员的 exact live direct parent（队长 agent）。
 */
export function interruptMember(ctx: Context, captain: Agent, memberId: string): void {
  try {
    ctx.subagents.interrupt(SessionId(memberId), { kind: 'ancestor', agent: captain })
  } catch (error: unknown) {
    ctx.logger.warn(`lbx-agent-team: interrupt of member ${memberId} failed: ${String(error)}`)
  }
}
