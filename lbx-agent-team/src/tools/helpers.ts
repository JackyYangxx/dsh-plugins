/**
 * 工具层共享辅助：团队定位、锁内新鲜状态、attempt 能力、worktree 生命周期
 * 与 autoDispatch 派发泵。所有写操作由调用方在 withTeamLock 内基于
 * requireFreshTeam 的最新状态执行（Task 5 评审：requireFreshTeam 模式）。
 * @module lbx-agent-team/tools/helpers
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { randomUUID } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createWorktree, localShell, mergeBranch, removeWorktree, runGit, shellAdapter, shq, type ShellAdapter } from '../git.ts'
import { appendMailbox, readTeam, withTeamLock, writeTeam } from '../state.ts'
import { claimGate, newAttemptId } from '../pipeline.ts'
import { nextDispatch } from '../scheduler.ts'
import { interruptMember, spawnMember, wakeMember } from '../members.ts'
import type { ToolsConfig } from '../tool-config.ts'
import type { Actor, TeamMember, TeamState, TeamTask } from '../types.ts'

/** 已解析配置 + cordis 上下文，供全部工具闭包共享。 */
export interface ToolEnv {
  ctx: Context
  config: ToolsConfig
}

export function env(ctx: Context, config: ToolsConfig): ToolEnv {
  return { ctx, config }
}

export function requireAgent(exec: ToolRunContext): Agent {
  if (!exec.agent) throw new Error('lbx_agent_team tools require a calling agent')
  return exec.agent
}

export function workspaceOf(agent: Agent): string {
  return agent.session.header.cwd ?? process.cwd()
}

export function stateRootOf(e: ToolEnv, workspace: string): string {
  return join(workspace, e.config.stateDir)
}

/** 从新鲜状态重推导调用者身份（锁内使用）。 */
export function actorOf(team: TeamState, agentId: string): Actor {
  if (team.captainSessionId === agentId) return { kind: 'captain' }
  const m = team.members.find((x) => x.id === agentId && x.status !== 'removed')
  if (!m) throw new Error('you are neither the captain nor an active member of this team')
  return { kind: 'member', name: m.name, role: m.role }
}

/** stateRoot 下所有团队目录（排除 archive/ 归档区）。 */
async function listTeamDirs(stateRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(stateRoot, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory() && e.name !== 'archive').map((e) => e.name)
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return []
    throw err
  }
}

/** 队长当前领导的 active 团队（单队长单团队）。 */
export async function findTeamByCaptain(stateRoot: string, captainId: string): Promise<TeamState | undefined> {
  for (const name of await listTeamDirs(stateRoot)) {
    const team = await readTeam(stateRoot, name)
    if (team?.captainSessionId === captainId && team.status === 'active') return team
  }
  return undefined
}

/** 队长或任一活动成员参与的 active 团队。 */
export async function findTeamByParticipant(stateRoot: string, agentId: string): Promise<TeamState | undefined> {
  for (const name of await listTeamDirs(stateRoot)) {
    const team = await readTeam(stateRoot, name)
    if (team === undefined || team.status !== 'active') continue
    if (team.captainSessionId === agentId) return team
    if (team.members.some((m) => m.id === agentId && m.status !== 'removed')) return team
  }
  return undefined
}

export async function requireCaptainTeam(stateRoot: string, captainId: string): Promise<TeamState> {
  const team = await findTeamByCaptain(stateRoot, captainId)
  if (!team) throw new Error('you are not leading any active team — call lbx_agent_team_create first')
  return team
}

export async function requireParticipantTeam(stateRoot: string, callerId: string): Promise<TeamState> {
  const team = await findTeamByParticipant(stateRoot, callerId)
  if (!team) throw new Error('you do not lead or belong to any active team yet')
  return team
}

/** 锁内重读最新团队；绝不拿外部读到的陈旧快照写回（Task 5 评审）。 */
export async function requireFreshTeam(stateRoot: string, teamId: string): Promise<TeamState> {
  const fresh = await readTeam(stateRoot, teamId)
  if (!fresh || fresh.status !== 'active') throw new Error(`team "${teamId}" is no longer active`)
  return fresh
}

export function requireMember(team: TeamState, name: string): TeamMember {
  const member = team.members.find((m) => m.name === name && m.status !== 'removed')
  if (!member) throw new Error(`member not found: "${name}"`)
  return member
}

export function requireTask(team: TeamState, taskId: string): TeamTask {
  const task = team.tasks.find((t) => t.id === taskId)
  if (!task) throw new Error(`task not found: ${taskId}`)
  return task
}

export function newMessageId(): string {
  return randomUUID()
}

/** 解析团队队长在进程内的 live agent（wake/interrupt 需要 exact live parent）。 */
export function liveCaptain(ctx: Context, team: TeamState): Agent | undefined {
  return ctx.agents.get(team.captainSessionId as SessionId)
}

/** 等待成员 quiesce；不可用或信号中断时返回（best effort）。 */
export async function waitForMemberIdle(ctx: Context, member: TeamMember, signal: AbortSignal): Promise<void> {
  if (member.id === '') return
  const live = ctx.agents.get(member.id as SessionId)
  if (live === undefined) return
  if (signal.aborted) throw signal.reason ?? new Error('operation was cancelled')
  await Promise.race([
    live.whenIdle(),
    new Promise<never>((_resolve, reject) => {
      const onAbort = () => reject(signal.reason ?? new Error('operation was cancelled'))
      signal.addEventListener('abort', onAbort, { once: true })
    }),
  ])
}

// —— worktree 生命周期（Task 6 辅助；路径/分支确定性派生，避免复用冲突）——

/** 每个 (成员, 任务) 一个 worktree：<stateRoot>/<teamId>/worktrees/<member>/<taskId>/。 */
export function taskWorktreePath(stateRoot: string, teamId: string, memberName: string, taskId: string): string {
  return join(stateRoot, teamId, 'worktrees', memberName, taskId)
}

export function taskBranch(teamId: string, taskId: string): string {
  return `team/${teamId}/${taskId}`
}

/** DSH shell 服务优先；无服务时本地 execFile 兜底（测试/headless）。 */
export function teamShell(ctx: Context): ShellAdapter {
  return shellAdapter(ctx) ?? localShell()
}

/**
 * commit_task 的 cwd 派生：gitWorktrees=false、无成员（captain 任务）或成员从未建
 * worktree（worktreePath 未回填）时退化为共享工作树（workspace）；否则用该任务
 * 的确定性 worktree 路径。
 */
export function taskCommitCwd(
  config: ToolsConfig,
  member: TeamMember | undefined,
  workspace: string,
  stateRoot: string,
  teamId: string,
  taskId: string,
): string {
  if (config.gitWorktrees === false) return workspace
  if (member === undefined || member.worktreePath === undefined) return workspace
  return taskWorktreePath(stateRoot, teamId, member.name, taskId)
}

/** claim 时建 worktree；gitWorktrees=false 时退化为共享工作树（无操作）。 */
export async function ensureTaskWorktree(
  e: ToolEnv,
  workspace: string,
  stateRoot: string,
  team: TeamState,
  member: TeamMember,
  taskId: string,
): Promise<void> {
  if (e.config.gitWorktrees === false) return
  if (member.role !== 'dever') return // 只有 dever 使用独立 worktree（D5）
  await createWorktree(teamShell(e.ctx), {
    repo: workspace,
    path: taskWorktreePath(stateRoot, team.id, member.name, taskId),
    branch: taskBranch(team.id, taskId),
    base: 'HEAD',
  })
  member.worktreePath = taskWorktreePath(stateRoot, team.id, member.name, taskId)
  member.branch = taskBranch(team.id, taskId)
}

/** 撤销旧 attempt 后清理该任务的 worktree 与分支，使重试可重建。best effort。 */
export async function resetTaskWorktree(
  e: ToolEnv,
  workspace: string,
  stateRoot: string,
  team: TeamState,
  memberName: string,
  taskId: string,
): Promise<void> {
  if (e.config.gitWorktrees === false) return
  const sh = teamShell(e.ctx)
  const path = taskWorktreePath(stateRoot, team.id, memberName, taskId)
  try {
    await removeWorktree(sh, workspace, path)
  } catch {
    // 目录可能不存在（从未 claim）——忽略
  }
  await runGit(sh, workspace, ['branch', '-D', taskBranch(team.id, taskId)])
}

/** tested 后把任务分支 --no-ff 合并回主线；冲突抛错由调用方协调。 */
export async function mergeTaskBranch(e: ToolEnv, workspace: string, team: TeamState, branch: string): Promise<void> {
  if (e.config.gitWorktrees === false) return
  await mergeBranch(teamShell(e.ctx), workspace, branch)
}

/** 任务完成/归档时删除其 worktree。best effort。 */
export async function removeTaskWorktree(
  e: ToolEnv,
  workspace: string,
  stateRoot: string,
  team: TeamState,
  memberName: string,
  taskId: string,
): Promise<void> {
  if (e.config.gitWorktrees === false) return
  try {
    await removeWorktree(teamShell(e.ctx), workspace, taskWorktreePath(stateRoot, team.id, memberName, taskId))
  } catch {
    // best effort：worktree 可能已不存在
  }
}

/** 在指定 cwd 全量提交；空 diff 视为"无变更"，返回当前 HEAD hash（Task 6 评审）。 */
export async function commitInWorktree(
  e: ToolEnv,
  cwd: string,
  message: string,
): Promise<{ hash: string; branch: string }> {
  const sh = teamShell(e.ctx)
  const add = await runGit(sh, cwd, ['add', '-A'])
  if (!add.ok) throw new Error(`git add failed: ${add.stderr}`)
  // exit 0 = 无暂存变更（空 diff）→ 跳过 commit；exit 1 = 有变更 → commit
  const staged = await runGit(sh, cwd, ['diff', '--cached', '--quiet'])
  if (!staged.ok) {
    const commit = await runGit(sh, cwd, ['commit', '-m', message])
    if (!commit.ok) throw new Error(`git commit failed: ${commit.stderr}`)
  }
  const rev = await runGit(sh, cwd, ['rev-parse', 'HEAD'])
  if (!rev.ok) throw new Error(`git rev-parse failed: ${rev.stderr}`)
  const hash = rev.stdout.trim()
  if (!/^[0-9a-f]{40}$/.test(hash)) throw new Error(`git rev-parse returned unexpected output: ${hash}`)
  const sym = await runGit(sh, cwd, ['symbolic-ref', '--short', 'HEAD'])
  return { hash, branch: sym.ok ? sym.stdout.trim() : 'HEAD' }
}
export function gitCommandText(cwd: string, message: string): string[] {
  return [
    `git -C ${shq(cwd)} add -A`,
    `git -C ${shq(cwd)} commit -m ${shq(message)}`,
    `git -C ${shq(cwd)} rev-parse HEAD`,
  ]
}

// —— attempt 能力（Task 4 评审：assignee-match + attemptId 校验）——

/** 生成新 attempt：attemptId（a{attempt+1}）、attempt++、assignee、claimed。 */
export function beginTaskAttempt(task: TeamTask, assignee: string): string {
  task.attemptId = newAttemptId(task)
  task.attempt = (task.attempt ?? 0) + 1
  task.assignee = assignee
  task.status = 'claimed'
  task.updatedAt = Date.now()
  return task.attemptId
}

/** 陈旧 attemptId 拒绝（迟到结果防覆盖）。 */
export function assertAttempt(task: TeamTask, attemptId: string | undefined): void {
  if (task.attemptId !== undefined && attemptId !== task.attemptId) {
    throw new Error('stale attemptId — task was reassigned')
  }
}

/** 成员当前持有的未完成任务（claimed / in_progress）——叠单防护。 */
export function openTaskOf(team: TeamState, memberName: string): TeamTask | undefined {
  return team.tasks.find((t) =>
    t.assignee === memberName && (t.status === 'claimed' || t.status === 'in_progress'))
}

/** 任务退回共享池：assignee=pool、pending、attempt 失效、dedicated 解除。 */
export function requeueTask(task: TeamTask): void {
  task.assignee = 'pool'
  task.status = 'pending'
  task.attempt = (task.attempt ?? 0) + 1
  task.attemptId = undefined
  task.dedicated = false
  task.updatedAt = Date.now()
}

// —— autoDispatch 派发泵（Task 9 评审）——

export interface Wake {
  member: TeamMember
  task: TeamTask
}

export function taskWakePrompt(stateRoot: string, teamId: string, member: TeamMember, task: TeamTask): string {
  const attemptId = task.attemptId ?? ''
  const location = member.worktreePath !== undefined
    ? `Work in your worktree ${member.worktreePath} (branch ${member.branch}).`
    : 'Work in the shared workspace.'
  return [
    `LBX Agent Team task assignment (team ${teamId}):`,
    `Task ${task.id}: ${task.subject}`,
    `Attempt id: ${attemptId}`,
    location,
    `1. Call lbx_agent_team_update_task(taskId=${task.id}, attemptId=${attemptId}, done: false) to start (status in_progress).`,
    '2. Implement ONLY this task; run the project typecheck after changes.',
    `3. When done, call lbx_agent_team_update_task(taskId=${task.id}, output=<summary>, attemptId=${attemptId}, done: true) to submit for review.`,
    '4. If update_task rejects your attempt_id as stale, STOP: the task was reassigned.',
    `5. Check your mailbox at ${stateRoot}/${teamId}/inbox/${member.name}.jsonl for captain messages.`,
  ].join('\n')
}

/**
 * 锁内派发泵：对 fresh 状态循环 nextDispatch，原子 claim（依赖+attemptId）、
 * 置成员 working、pending 成员先 spawn。并发事件可能算出同一 (member, task)，
 * 因此选择必须在锁内基于最新状态重跑。全新团队无 idle dever 时先按
 * maxParallelDevers 上限 spawn pending 的 pool dever。返回待唤醒列表，
 * 由调用方在锁外 fireWakes（唤醒不持有状态锁）。
 */
export async function dispatchInsideLock(
  e: ToolEnv,
  signal: AbortSignal,
  workspace: string,
  stateRoot: string,
  fresh: TeamState,
  opts?: { excludeMembers?: string[] },
): Promise<Wake[]> {
  if (e.config.autoDispatch === false || fresh.status !== 'active') return []
  const wakes: Wake[] = []
  let mutated = false

  // spawnMember 对 dever 强制要求 roleCtx.taskSubject：取首个就绪池任务的主题
  //（该 dever 大概率会被派发到同一任务；实际任务以唤醒消息为准）。
  const firstReady = fresh.tasks.find((t) =>
    t.status === 'pending' && t.assignee === 'pool' && t.dedicated !== true && claimGate(fresh, t) === undefined)

  if (firstReady !== undefined) {
    const activePoolCount = (): number => fresh.members.filter((m) => m.role === 'dever' && m.status !== 'removed').length
    for (const member of fresh.members) {
      if (member.role !== 'dever' || member.status !== 'pending') continue
      if (activePoolCount() >= e.config.maxParallelDevers) break
      try {
        await spawnMember(e.ctx, {
          teamId: fresh.id,
          member,
          roleCtx: { specPath: fresh.specPath, stateRoot, teamId: fresh.id, taskSubject: firstReady.subject },
          provider: e.config.memberProvider,
          defaultModel: e.config.memberModel,
          signal,
        })
      } catch (error) {
        e.ctx.logger.warn(`lbx-agent-team: spawn of pool dever ${member.name} failed: ${String(error)}`)
        continue
      }
      mutated = true
    }
  }

  for (;;) {
    const d = nextDispatch(fresh, opts?.excludeMembers)
    if (d === undefined) break
    const task = fresh.tasks.find((t) => t.id === d.taskId)
    const member = fresh.members.find((m) => m.name === d.member && m.status !== 'removed')
    if (task === undefined || member === undefined) continue
    // I4：持有未完成任务（claimed/in_progress）的成员不派发新任务（parked 语义）。
    // nextDispatch 只选第一个 idle dever，若它被 parked 则本次泵无法推进其他成员
    // ——必须 break 而非 continue，否则同一 (member, task) 会无限重选。
    if (openTaskOf(fresh, member.name) !== undefined) break
    if (member.status === 'pending') {
      try {
        await spawnMember(e.ctx, {
          teamId: fresh.id,
          member,
          roleCtx: { specPath: fresh.specPath, stateRoot, teamId: fresh.id, taskSubject: task.subject },
          provider: e.config.memberProvider,
          defaultModel: e.config.memberModel,
          signal,
        })
      } catch (error) {
        e.ctx.logger.warn(`lbx-agent-team: spawn of dever ${member.name} failed: ${String(error)}`)
        continue
      }
    }
    beginTaskAttempt(task, member.name)
    try {
      await ensureTaskWorktree(e, workspace, stateRoot, fresh, member, task.id)
    } catch (error) {
      e.ctx.logger.warn(`lbx-agent-team: worktree for ${task.id}/${member.name} failed: ${String(error)}`)
    }
    member.status = 'working'
    mutated = true
    wakes.push({ member, task })
  }

  if (mutated) await writeTeam(stateRoot, fresh)
  return wakes
}

/**
 * 锁外唤醒（耐久 + 回滚）：无论队长是否在线，先把任务分配消息 appendMailbox 落盘
 * （保证消息不丢；队长恢复后成员被任何原因唤醒时都会读到）。队长在线时对每个成员
 * best effort followup；唤醒失败则回滚该次 claim（任务回 pending、成员回 idle）——
 * 只回滚本次精确派发（attemptId 匹配），并发队长接手过的任务不动。
 */
export async function fireWakes(
  e: ToolEnv,
  signal: AbortSignal,
  stateRoot: string,
  teamId: string,
  wakes: Wake[],
): Promise<void> {
  if (wakes.length === 0) return
  const team = await readTeam(stateRoot, teamId)
  if (team === undefined) return
  // 1) 先落盘：消息在队长在线检查之前写入，保证耐久。
  for (const { member, task } of wakes) {
    if (member.id === '') continue
    const content = taskWakePrompt(stateRoot, teamId, member, task)
    const message = { id: newMessageId(), from: 'captain', to: member.name, content, ts: Date.now() }
    try {
      await appendMailbox(stateRoot, teamId, member.name, message)
    } catch (error) {
      e.ctx.logger.warn(`lbx-agent-team: mailbox append for ${member.name} failed: ${String(error)}`)
    }
  }
  // 2) 队长不在线：消息已入队，恢复后重投（成员被唤醒时读邮箱）。
  const captain = liveCaptain(e.ctx, team)
  if (captain === undefined) {
    e.ctx.logger.info(`lbx-agent-team: captain offline; ${wakes.length} task assignment(s) queued in member mailboxes, redelivered on resume`)
    return
  }
  // 3) 在线：唤醒；失败回滚该次 claim。
  for (const { member, task } of wakes) {
    if (member.id === '') continue
    const content = taskWakePrompt(stateRoot, teamId, member, task)
    const ok = await wakeMember(e.ctx, captain, member.id, content, signal)
    if (!ok) {
      e.ctx.logger.warn(`lbx-agent-team: wake of ${member.name} for ${task.id} failed; rolling back the claim`)
      await withTeamLock(stateRoot, teamId, async () => {
        const fresh = await readTeam(stateRoot, teamId)
        if (fresh === undefined || fresh.status !== 'active') return
        const current = fresh.tasks.find((t) => t.id === task.id)
        // 只回滚我们的精确派发：attemptId 已被并发接手则不动
        if (current === undefined || current.attemptId !== task.attemptId) return
        current.status = 'pending'
        current.assignee = 'pool'
        current.attemptId = undefined
        current.updatedAt = Date.now()
        const m = fresh.members.find((x) => x.id === member.id && x.status !== 'removed')
        if (m !== undefined) m.status = 'idle'
        await writeTeam(stateRoot, fresh)
      })
    }
  }
}

/**
 * 独立派发入口（observer / 状态泵）：锁内跑 dispatchInsideLock，锁外 fireWakes。
 * 工具内部请用 withTeamMutation（在同一个锁内派发，避免重复加锁）。
 */
export async function runDispatch(
  e: ToolEnv,
  signal: AbortSignal,
  workspace: string,
  stateRoot: string,
  teamId: string,
): Promise<void> {
  if (e.config.autoDispatch === false) return
  let wakes: Wake[] = []
  await withTeamLock(stateRoot, teamId, async () => {
    const fresh = await readTeam(stateRoot, teamId)
    if (fresh === undefined || fresh.status !== 'active') return
    wakes = await dispatchInsideLock(e, signal, workspace, stateRoot, fresh)
  })
  await fireWakes(e, signal, stateRoot, teamId, wakes)
}

/** 锁内变更 + 派发 + 锁外唤醒的统一封装（写工具通用骨架）。 */
export interface Mutation<T> {
  result: T
  /** 工具自身产生的唤醒（如 claim 的专属 dever）；与派发唤醒合并后统一 fire。 */
  wakes?: Wake[]
}

export async function withTeamMutation<T>(
  e: ToolEnv,
  signal: AbortSignal,
  workspace: string,
  stateRoot: string,
  teamId: string,
  fn: (fresh: TeamState) => Promise<Mutation<T>>,
): Promise<T> {
  const out = await withTeamLock(stateRoot, teamId, async () => {
    const fresh = await requireFreshTeam(stateRoot, teamId)
    const mutation = await fn(fresh)
    const dispatched = await dispatchInsideLock(e, signal, workspace, stateRoot, fresh)
    return { result: mutation.result, wakes: [...(mutation.wakes ?? []), ...dispatched] }
  })
  await fireWakes(e, signal, stateRoot, teamId, out.wakes)
  return out.result
}

/** agent/status 观察者：成员 turn 结束（idle）或开始（running）时同步团队状态并泵派发。 */
export async function syncMemberStatus(
  e: ToolEnv,
  agent: Agent,
  status: 'idle' | 'running',
  workspace: string,
): Promise<void> {
  const stateRoot = stateRootOf(e, workspace)
  const team = await findTeamByParticipant(stateRoot, agent.id)
  if (team === undefined || team.captainSessionId === agent.id) return
  let shouldDispatch = false
  await withTeamLock(stateRoot, team.id, async () => {
    const fresh = await readTeam(stateRoot, team.id)
    const member = fresh?.members.find((m) => m.id === agent.id && m.status !== 'removed')
    if (fresh === undefined || member === undefined) return
    if (status === 'idle' && openTaskOf(fresh, member.name) !== undefined) {
      // I4：成员 turn 结束但仍持有 claimed/in_progress 任务 → parked（保持 working），
      // 不派发新任务，直到该任务被提交/转派。
      if (member.status !== 'working') {
        member.status = 'working'
        await writeTeam(stateRoot, fresh)
      }
      return
    }
    const next = status === 'running' ? 'working' : 'idle'
    if (member.status === next) return
    member.status = next
    await writeTeam(stateRoot, fresh)
    if (next === 'idle') shouldDispatch = true
  })
  if (shouldDispatch) {
    await runDispatch(e, new AbortController().signal, workspace, stateRoot, team.id)
  }
}

/** reassign 后中断旧 assignee 并等待其安静。 */
export async function quiesceOldAssignee(
  e: ToolEnv,
  captain: Agent,
  member: TeamMember | undefined,
  signal: AbortSignal,
): Promise<void> {
  if (member === undefined || member.id === '') return
  interruptMember(e.ctx, captain, member.id)
  try {
    await waitForMemberIdle(e.ctx, member, signal)
  } catch (error) {
    e.ctx.logger.warn(`lbx-agent-team: old assignee did not quiesce cleanly: ${String(error)}`)
  }
}
