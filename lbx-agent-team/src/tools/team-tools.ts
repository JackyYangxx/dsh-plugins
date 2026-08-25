/** 团队级工具：create / add_member / remove_member / delete。 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { access, mkdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { ensureGitRepo, localShell, shellAdapter } from '../git.ts'
import { interruptMember, registerMember } from '../members.ts'
import { readTeam, sanitizeKey, withTeamLock, writeTeam } from '../state.ts'
import { TERMINAL_TASK_STATUSES, type TeamState } from '../types.ts'
import type { ToolsConfig } from '../tool-config.ts'
import {
  actorOf,
  env,
  findTeamByCaptain,
  liveCaptain,
  removeTaskWorktree,
  requireAgent,
  requireCaptainTeam,
  requireFreshTeam,
  requeueTask,
  resetTaskWorktree,
  stateRootOf,
  workspaceOf,
  withTeamMutation,
} from './helpers.ts'

export function registerTeamTools(ctx: Context, config: ToolsConfig): void {
  const e = env(ctx, config)

  // —— 工具 1/16：create ——
  ctx.tools.register(defineTool({
    name: 'lbx_agent_team_create',
    description: 'Create an LBX Agent Team: the calling session becomes the captain (one active team per captain). REQUIRES an existing spec file (workspace-relative or absolute) and, when gitWorktrees is enabled (default), a git repository in the workspace. Registers the standard roster (planner/checker/tester) when autoRoster is on; add pool devers with lbx_agent_team_add_member (role=dever) or create dedicated tasks with assignee=new-dever. Fails loudly if the spec file is missing or the team id is taken.',
    parameters: {
      name: { type: 'string', required: true, description: 'Team name (also its stable id; sanitized).' },
      spec: { type: 'string', required: true, description: 'Path to the spec document; must already exist.' },
      description: { type: 'string', description: 'Team purpose / the goal the team will work on.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { teamId: { type: 'string', required: true } },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Team created: ${value.teamId}. You are the captain. Add members and tasks to get started.`,
      }],
    },
    async execute(args, exec) {
      const agent = requireAgent(exec)
      const workspace = workspaceOf(agent)
      const stateRoot = stateRootOf(e, workspace)
      const name = (args.name ?? '').trim()
      if (name === '') throw new Error('team name must not be empty')
      const spec = (args.spec ?? '').trim()
      if (spec === '') throw new Error('spec path must not be empty')
      const specPath = join(workspace, spec)
      // spec 必填门（D9）
      try {
        await access(specPath)
      } catch {
        throw new Error(`spec file not found: ${specPath} — generate the spec document first`)
      }
      // git 前置（D5）
      if (config.gitWorktrees !== false) {
        const sh = shellAdapter(ctx) ?? localShell()
        const repo = await ensureGitRepo(sh, workspace)
        if (!repo.ok) throw new Error(repo.error ?? 'git required for worktree mode')
      }
      const teamId = sanitizeKey(name)
      // M3：per-captain 锁 + per-teamId 锁，防并发 create 双团队/同名覆盖
      return withTeamLock(stateRoot, `captain:${agent.id}`, async () => {
        return withTeamLock(stateRoot, teamId, async () => {
        const existing = await readTeam(stateRoot, teamId)
        if (existing) throw new Error(`team "${teamId}" already exists — pick another name or delete it first`)
        const current = await findTeamByCaptain(stateRoot, agent.id)
        if (current) throw new Error(`you already lead team "${current.name}" — end it before creating another`)
        const team: TeamState = {
          id: teamId,
          name,
          specPath,
          description: args.description,
          captainSessionId: agent.id,
          status: 'active',
          createdAt: Date.now(),
          members: [],
          tasks: [],
          issues: [],
          taskSeq: 0,
          issueSeq: 0,
        }
        if (config.autoRoster !== false) {
          for (const role of ['planner', 'checker', 'tester'] as const) {
            registerMember(team, { name: role, role })
          }
        }
        await writeTeam(stateRoot, team)
        return { teamId }
        })
      })
    },
  }))

  // —— 工具 2/16：add_member ——
  ctx.tools.register(defineTool({
    name: 'lbx_agent_team_add_member',
    description: 'Register a durable team member (captain-only). The member is registered as pending and spawned lazily the first time it needs work: a pool dever spawns when it first claims a task (auto-dispatch also spawns pending pool devers up to maxParallelDevers), a dedicated dever spawns when its task is claimed. For dever members with gitWorktrees enabled (default) the plugin creates a dedicated git worktree + branch at spawn/claim time. Supply provider/model/reasoningEffort only to override the captain\'s LLM route.',
    parameters: {
      name: { type: 'string', required: true, description: 'Unique member name inside the team.' },
      role: { type: 'string', required: true, description: 'Role: planner, checker, tester, dever, or a custom role string.' },
      provider: { type: 'string', description: 'Optional LLM provider route; requires model.' },
      model: { type: 'string', description: 'Optional model override.' },
      reasoningEffort: { type: 'string', description: 'Optional reasoning effort override.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          memberName: { type: 'string', required: true },
          role: { type: 'string', required: true },
          status: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Member "${value.memberName}" added (role ${value.role}, status ${value.status}). It spawns when it first needs work.`,
      }],
    },
    async execute(args, exec) {
      const agent = requireAgent(exec)
      const workspace = workspaceOf(agent)
      const stateRoot = stateRootOf(e, workspace)
      const team = await requireCaptainTeam(stateRoot, agent.id)
      return withTeamMutation(e, exec.signal, workspace, stateRoot, team.id, async (fresh) => {
        actorOf(fresh, agent.id) // captain-only（锁内重查）
        const memberName = (args.name ?? '').trim()
        if (memberName === '') throw new Error('member name must not be empty')
        if (sanitizeKey(memberName) === 'captain') throw new Error('member name "captain" is reserved for the captain')
        if (fresh.members.some((m) => sanitizeKey(m.name) === sanitizeKey(memberName))) {
          throw new Error(`member name "${memberName}" is already used in team "${fresh.name}"`)
        }
        if (fresh.members.filter((m) => m.status !== 'removed').length >= config.maxMembers) {
          throw new Error(`member limit ${config.maxMembers} reached`)
        }
        registerMember(fresh, {
          name: memberName,
          role: (args.role ?? '').trim(),
          provider: args.provider,
          model: args.model,
          reasoningEffort: args.reasoningEffort,
        })
        await writeTeam(stateRoot, fresh)
        const member = fresh.members[fresh.members.length - 1]!
        return { result: { memberName: member.name, role: member.role, status: member.status } }
      })
    },
  }))

  // —— 工具 3/16：remove_member ——
  ctx.tools.register(defineTool({
    name: 'lbx_agent_team_remove_member',
    description: 'Remove a member (captain-only): revoke its current attempt, return every unfinished task to the shared pool (assignee=pool, pending, attempt invalidated), mark the member removed, and interrupt + quiesce its live turn. Use when a member leaves or is replaced.',
    parameters: {
      member: { type: 'string', required: true, description: 'Name of the member to remove.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          memberName: { type: 'string', required: true },
          status: { type: 'string', required: true },
          requeuedTasks: { type: 'array', items: { type: 'string' }, required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Member "${value.memberName}" removed (status ${value.status}); requeued tasks: ${value.requeuedTasks.join(', ') || 'none'}.`,
      }],
    },
    async execute(args, exec) {
      const agent = requireAgent(exec)
      const workspace = workspaceOf(agent)
      const stateRoot = stateRootOf(e, workspace)
      const team = await requireCaptainTeam(stateRoot, agent.id)
      let removedId = ''
      const result = await withTeamMutation(e, exec.signal, workspace, stateRoot, team.id, async (fresh) => {
        actorOf(fresh, agent.id)
        const member = fresh.members.find((m) => m.name === args.member && m.status !== 'removed')
        if (!member) throw new Error(`member not found: "${args.member}"`)
        removedId = member.id
        const requeued: string[] = []
        for (const task of fresh.tasks) {
          if (task.assignee !== member.name) continue
          if (task.status === 'complete' || TERMINAL_TASK_STATUSES.includes(task.status)) continue
          // I2：先清掉该任务的 worktree + 分支，否则重试 claim 会撞 "branch already exists"
          await resetTaskWorktree(e, workspace, stateRoot, fresh, member.name, task.id)
          requeueTask(task)
          requeued.push(task.id)
        }
        member.status = 'removed'
        member.retiredAt = Date.now()
        await writeTeam(stateRoot, fresh)
        return { result: { memberName: member.name, status: member.status, requeuedTasks: requeued } }
      })
      if (removedId !== '') {
        const captain = liveCaptain(e.ctx, team)
        if (captain !== undefined) interruptMember(e.ctx, captain, removedId)
      }
      return result
    },
  }))

  // —— 工具 16/16：delete ——
  ctx.tools.register(defineTool({
    name: 'lbx_agent_team_delete',
    description: 'Archive your team (captain-only): mark the team archived, remove member worktrees (best effort), interrupt all spawned members, and move the team directory under <stateDir>/archive/ so history stays on disk for later review. The team can no longer be found by status/update tools.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          archived: { type: 'boolean', required: true },
          teamName: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Team "${value.teamName}" archived. Its state directory was moved under <stateDir>/archive/.`,
      }],
    },
    async execute(_args, exec) {
      const agent = requireAgent(exec)
      const workspace = workspaceOf(agent)
      const stateRoot = stateRootOf(e, workspace)
      const team = await requireCaptainTeam(stateRoot, agent.id)
      const archived = await withTeamLock(stateRoot, team.id, async () => {
        const fresh = await requireFreshTeam(stateRoot, team.id)
        actorOf(fresh, agent.id)
        for (const task of fresh.tasks) {
          if (task.assignee === undefined || task.assignee === 'pool' || task.assignee === 'captain') continue
          await removeTaskWorktree(e, workspace, stateRoot, fresh, task.assignee, task.id)
        }
        for (const m of fresh.members) {
          if (m.status === 'removed') continue
          m.status = 'removed'
          m.retiredAt = Date.now()
        }
        fresh.status = 'archived'
        await writeTeam(stateRoot, fresh)
        // M2：目录移入 archive/ 在锁内完成，与状态归档原子化
        await mkdir(join(stateRoot, 'archive'), { recursive: true })
        await rename(join(stateRoot, fresh.id), join(stateRoot, 'archive', fresh.id))
        return { id: fresh.id, name: fresh.name, memberIds: fresh.members.map((m) => m.id).filter((id) => id !== '') }
      })
      const captain = liveCaptain(e.ctx, team)
      for (const id of archived.memberIds) {
        if (captain !== undefined) interruptMember(e.ctx, captain, id)
      }
      return { archived: true, teamName: archived.name }
    },
  }))
}
