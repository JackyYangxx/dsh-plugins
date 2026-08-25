/** 任务级工具：create_task / claim_task / update_task / reassign_task / submit_review / commit_task / test_task。 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { shellAdapter } from '../git.ts'
import { appendMailbox, withTeamLock, writeTeam } from '../state.ts'
import { approveGate, claimGate, commitGate, nextStatus, testGate, transitionError } from '../pipeline.ts'
import { interruptMember, registerMember, spawnMember } from '../members.ts'
import { TERMINAL_TASK_STATUSES, type TeamMember, type TeamTask } from '../types.ts'
import type { ToolsConfig } from '../tool-config.ts'
import {
  actorOf,
  assertAttempt,
  beginTaskAttempt,
  commitInWorktree,
  ensureTaskWorktree,
  env,
  gitCommandText,
  liveCaptain,
  mergeTaskBranch,
  newMessageId,
  openTaskOf,
  quiesceOldAssignee,
  removeTaskWorktree,
  requireAgent,
  requireCaptainTeam,
  requireFreshTeam,
  requireParticipantTeam,
  requireTask,
  requeueTask,
  resetTaskWorktree,
  stateRootOf,
  taskCommitCwd,
  workspaceOf,
  withTeamMutation,
  type Wake,
} from './helpers.ts'

export function registerTaskTools(ctx: Context, config: ToolsConfig): void {
  const e = env(ctx, config)

  // —— 工具 5/16：create_task ——
  ctx.tools.register(defineTool({
    name: 'lbx_agent_team_create_task',
    description: 'Add a task to the team task list (captain-only). assignee: a member name, "pool" (shared dever pool — auto-dispatched when dependencies are ready), "new-dever" (spawn a dedicated dever lazily at claim time), or "captain". A task is only claimable once every dependency is complete. With autoDispatch on, a ready pool task is claimed and its dever woken immediately.',
    parameters: {
      subject: { type: 'string', required: true, description: 'Brief title for the task.' },
      description: { type: 'string', description: 'What needs to be done, in detail.' },
      assignee: { type: 'string', description: 'Member name, pool (default), new-dever, or captain.' },
      dependencies: { type: 'array', items: { type: 'string' }, description: 'Task ids that must reach complete first.' },
      verification: { type: 'string', description: 'Exact command or method the tester will run to verify.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          taskId: { type: 'string', required: true },
          subject: { type: 'string', required: true },
          status: { type: 'string', required: true },
          assignee: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Task "${value.subject}" created as ${value.taskId} (status ${value.status}, assignee ${value.assignee}).`,
      }],
    },
    async execute(args, exec) {
      const agent = requireAgent(exec)
      const workspace = workspaceOf(agent)
      const stateRoot = stateRootOf(e, workspace)
      const team = await requireCaptainTeam(stateRoot, agent.id)
      return withTeamMutation(e, exec.signal, workspace, stateRoot, team.id, async (fresh) => {
        actorOf(fresh, agent.id)
        const subject = (args.subject ?? '').trim()
        if (subject === '') throw new Error('task subject must not be empty')
        const assignee = (args.assignee ?? 'pool').trim()
        const dependencies = args.dependencies ?? []
        for (const dep of dependencies) {
          if (!fresh.tasks.some((t) => t.id === dep)) {
            throw new Error(`dependency "${dep}" does not exist in team "${fresh.name}"`)
          }
        }
        if (assignee !== 'pool' && assignee !== 'new-dever' && assignee !== 'captain'
          && !fresh.members.some((m) => m.name === assignee && m.status !== 'removed')) {
          throw new Error(`assignee "${assignee}" is not an active member`)
        }
        const dedicated = assignee === 'new-dever'
        const taskId = `t${fresh.taskSeq + 1}`
        const task: TeamTask = {
          id: taskId,
          subject,
          description: args.description,
          status: 'pending',
          assignee: dedicated ? 'pool' : assignee,
          dedicated,
          dependencies,
          verification: args.verification,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        fresh.tasks.push(task)
        fresh.taskSeq += 1
        await writeTeam(stateRoot, fresh)
        return { result: { taskId, subject, status: task.status, assignee: task.assignee ?? '' } }
      })
    },
  }))

  // —— 工具 6/16：claim_task ——
  ctx.tools.register(defineTool({
    name: 'lbx_agent_team_claim_task',
    description: 'Claim one ready task (all dependencies must be complete). Pool tasks are claimed by a pool dever itself, or by the captain on behalf of a named pool dever; dedicated tasks (created with assignee=new-dever) are claimed by the captain — the plugin atomically spawns the dedicated dever, creates its worktree, marks it working and wakes it; captain tasks are claimed by the captain with no spawn/worktree. Returns the attempt_id required for every update of this task; it becomes stale after reassignment.',
    parameters: {
      taskId: { type: 'string', required: true, description: 'The task id to claim.' },
      member: { type: 'string', description: 'Claiming member name (pool/captain tasks). Dedicated tasks derive the dever name automatically.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          taskId: { type: 'string', required: true },
          status: { type: 'string', required: true },
          assignee: { type: 'string', required: true },
          attempt: { type: 'number', required: true },
          attemptId: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Task ${value.taskId} claimed by ${value.assignee} (attempt ${value.attempt}, attempt_id ${value.attemptId}, status ${value.status}).`,
      }],
    },
    async execute(args, exec) {
      const agent = requireAgent(exec)
      const workspace = workspaceOf(agent)
      const stateRoot = stateRootOf(e, workspace)
      const team = await requireParticipantTeam(stateRoot, agent.id)
      return withTeamMutation(e, exec.signal, workspace, stateRoot, team.id, async (fresh) => {
        const actor = actorOf(fresh, agent.id)
        const task = requireTask(fresh, args.taskId)
        if (task.status !== 'pending') throw new Error(`task ${task.id} is not claimable (status ${task.status})`)
        const gateErr = claimGate(fresh, task)
        if (gateErr !== undefined) throw new Error(gateErr)

        let member: TeamMember | undefined
        if (task.dedicated === true) {
          // dedicated：claim 时原子 spawn 专属 dever + 建 worktree + 置 working
          if (actor.kind !== 'captain') throw new Error('only the captain may claim a dedicated task')
          const dedicatedName = `dever-${task.id}`
          const claimed = (args.member ?? '').trim()
          if (claimed !== '' && claimed !== dedicatedName) {
            throw new Error(`dedicated task ${task.id} reserves the dever name "${dedicatedName}"`)
          }
          member = fresh.members.find((m) => m.name === dedicatedName && m.status !== 'removed')
          if (member === undefined) {
            registerMember(fresh, { name: dedicatedName, role: 'dever' })
            member = fresh.members[fresh.members.length - 1]!
          }
        } else if (task.assignee === 'captain') {
          if (actor.kind !== 'captain') throw new Error(`task ${task.id} is assigned to the captain`)
          member = undefined
        } else if (task.assignee === 'pool' || task.assignee === undefined) {
          const claimerName = (args.member ?? (actor.kind === 'member' ? actor.name : '')).trim()
          if (claimerName === '') throw new Error('member is required to claim a pool task')
          if (actor.kind === 'member' && actor.name !== claimerName) {
            throw new Error('a member may only claim a task for itself')
          }
          const poolMember = fresh.members.find((m) => m.name === claimerName && m.status !== 'removed')
          if (poolMember === undefined) throw new Error(`member not found: "${claimerName}"`)
          if (poolMember.role !== 'dever') throw new Error(`member "${claimerName}" is not a dever`)
          // I4：叠单防护——持有任何未完成任务（claimed/in_progress）时拒绝
          const open = openTaskOf(fresh, claimerName)
          if (open !== undefined) throw new Error(`member "${claimerName}" still has an open task ${open.id}`)
          member = poolMember
        } else {
          // 显式指派给命名成员
          if (actor.kind === 'member' && actor.name !== task.assignee) {
            throw new Error(`task ${task.id} is assigned to "${task.assignee}", not you`)
          }
          const named = fresh.members.find((m) => m.name === task.assignee && m.status !== 'removed')
          if (named === undefined) throw new Error(`member not found: "${task.assignee}"`)
          const namedOpen = openTaskOf(fresh, named.name)
          if (namedOpen !== undefined) throw new Error(`member "${named.name}" still has an open task ${namedOpen.id}`)
          member = named
        }

        let attemptId: string
        if (member === undefined) {
          attemptId = beginTaskAttempt(task, 'captain')
        } else {
          if (member.id === '') {
            await spawnMember(e.ctx, {
              teamId: fresh.id,
              member,
              roleCtx: { specPath: fresh.specPath, stateRoot, teamId: fresh.id, taskSubject: task.subject },
              provider: config.memberProvider,
              defaultModel: config.memberModel,
              signal: exec.signal,
            })
          }
          try {
            await ensureTaskWorktree(e, workspace, stateRoot, fresh, member, task.id)
          } catch (error) {
            if (member.id !== '') {
              const captain = liveCaptain(e.ctx, fresh)
              if (captain !== undefined) interruptMember(e.ctx, captain, member.id)
            }
            throw error
          }
          attemptId = beginTaskAttempt(task, member.name)
          member.status = 'working'
        }
        task.updatedAt = Date.now()
        await writeTeam(stateRoot, fresh)
        const wakes: Wake[] = member === undefined ? [] : [{ member, task }]
        return {
          result: {
            taskId: task.id,
            status: task.status,
            assignee: task.assignee ?? '',
            attempt: task.attempt ?? 0,
            attemptId,
          },
          wakes,
        }
      })
    },
  }))

  // —— 工具 7/16：update_task ——
  ctx.tools.register(defineTool({
    name: 'lbx_agent_team_update_task',
    description: 'Report progress/output on a claimed task and drive it through the pipeline. Members must present the current attempt_id returned by claim_task; a stale attempt_id is rejected ("stale attemptId — task was reassigned"). On a claimed task any update starts it (claimed → in_progress); output updates on in_progress do not migrate. done=true submits: in_progress/changes_requested → in_review (the assignee becomes idle). The captain finishes a tested task with done=true (tested → complete), which cleans up its worktree and archives a dedicated dever.',
    parameters: {
      taskId: { type: 'string', required: true, description: 'The task id to update.' },
      output: { type: 'string', description: 'Progress or final output summary.' },
      attemptId: { type: 'string', description: 'Current attempt capability from claim_task; required when the task has one.' },
      done: { type: 'boolean', description: 'true submits the task (in_review) or, for the captain on a tested task, completes it.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          taskId: { type: 'string', required: true },
          status: { type: 'string', required: true },
          attempt: { type: 'number', required: true },
          attemptId: { type: 'string' },
          output: { type: 'string' },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Task ${value.taskId} attempt ${value.attempt} → ${value.status}${value.output !== undefined ? `\nOutput: ${value.output}` : ''}${args.done === true ? ' (submitted)' : ''}`,
      }],
    },
    async execute(args, exec) {
      const agent = requireAgent(exec)
      const workspace = workspaceOf(agent)
      const stateRoot = stateRootOf(e, workspace)
      const team = await requireParticipantTeam(stateRoot, agent.id)
      return withTeamMutation(e, exec.signal, workspace, stateRoot, team.id, async (fresh) => {
        const actor = actorOf(fresh, agent.id)
        const task = requireTask(fresh, args.taskId)
        const member = task.assignee === undefined || task.assignee === 'pool' || task.assignee === 'captain'
          ? undefined
          : fresh.members.find((m) => m.name === task.assignee && m.status !== 'removed')
        // 授权：成员只能更新自己领取的任务（携带当前 attemptId）；队长可完成 tested 任务 / 更新 captain 任务
        if (actor.kind === 'member') {
          if (task.assignee !== actor.name) {
            throw new Error(`task ${task.id} is assigned to "${task.assignee ?? 'nobody'}", not you`)
          }
          assertAttempt(task, args.attemptId)
        } else {
          if (task.assignee !== 'captain' && task.assignee !== undefined && task.status !== 'tested') {
            throw new Error(`task ${task.id} is owned by member "${task.assignee}"; use lbx_agent_team_reassign_task to take over`)
          }
          assertAttempt(task, args.attemptId)
        }
        if (TERMINAL_TASK_STATUSES.includes(task.status)) {
          throw new Error(`terminal task ${task.id} is immutable`)
        }
        if (args.output !== undefined) task.output = args.output
        const done = args.done === true
        if (done) {
          if (task.status === 'tested') {
            if (actor.kind !== 'captain') throw new Error('only the captain may complete a tested task')
            task.status = nextStatus(task.status, 'finish')!
            // 清理 worktree；dedicated dever 完成任务后归档（D4）
            if (member !== undefined) {
              await removeTaskWorktree(e, workspace, stateRoot, fresh, member.name, task.id)
              if (task.dedicated === true) {
                member.status = 'removed'
                member.retiredAt = Date.now()
              }
            }
          } else if (task.status === 'in_progress' || task.status === 'changes_requested') {
            task.status = nextStatus(task.status, 'submit')!
            if (member !== undefined && member.status === 'working') member.status = 'idle'
          } else {
            const bad = transitionError(task.status, 'submit')
            throw new Error(bad ?? `cannot submit a task in status ${task.status}`)
          }
        } else if (task.status === 'claimed') {
          task.status = nextStatus(task.status, 'start')!
        }
        task.updatedAt = Date.now()
        await writeTeam(stateRoot, fresh)
        return {
          result: {
            taskId: task.id,
            status: task.status,
            attempt: task.attempt ?? 0,
            ...(task.attemptId !== undefined ? { attemptId: task.attemptId } : {}),
            ...(task.output !== undefined ? { output: task.output } : {}),
          },
        }
      })
    },
  }))

  // —— 工具 8/16：reassign_task ——
  ctx.tools.register(defineTool({
    name: 'lbx_agent_team_reassign_task',
    description: 'Captain-only. Revoke the current attempt of an unfinished task and hand it to the shared pool ("pool"), a named active member, or the captain ("captain"). The old assignee is interrupted and quiesced before the new state is written, so late updates are rejected as stale. Complete tasks are immutable; failed/cancelled tasks can be retried this way.',
    parameters: {
      taskId: { type: 'string', required: true, description: 'Task to retry/reassign.' },
      to: { type: 'string', required: true, description: '"pool", an active member name, or "captain".' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          taskId: { type: 'string', required: true },
          previousAssignee: { type: 'string', required: true },
          assignee: { type: 'string', required: true },
          status: { type: 'string', required: true },
          attempt: { type: 'number', required: true },
          attemptId: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Task ${value.taskId} reassigned ${value.previousAssignee || 'unassigned'} → ${value.assignee} (status ${value.status}, attempt ${value.attempt}${value.attemptId !== undefined ? `, attempt_id ${value.attemptId}` : ''}).`,
      }],
    },
    async execute(args, exec) {
      const agent = requireAgent(exec)
      const workspace = workspaceOf(agent)
      const stateRoot = stateRootOf(e, workspace)
      const team = await requireCaptainTeam(stateRoot, agent.id)
      let oldMember: TeamMember | undefined
      const result = await withTeamMutation(e, exec.signal, workspace, stateRoot, team.id, async (fresh) => {
        actorOf(fresh, agent.id)
        const task = requireTask(fresh, args.taskId)
        if (task.status === 'complete') throw new Error('cannot reassign a complete task')
        const previousAssignee = task.assignee ?? ''
        oldMember = task.assignee === undefined || task.assignee === 'pool' || task.assignee === 'captain'
          ? undefined
          : fresh.members.find((m) => m.name === task.assignee && m.status !== 'removed')
        const target = (args.to ?? '').trim()
        if (target === '') throw new Error('reassign target must not be empty')
        let targetMember: TeamMember | undefined
        if (target !== 'pool' && target !== 'captain') {
          targetMember = fresh.members.find((m) => m.name === target && m.status !== 'removed')
          if (targetMember === undefined) throw new Error(`member not found: "${target}"`)
          if (targetMember.status === 'working') throw new Error(`member "${target}" is busy with another task`)
        }
        // 清理旧 worktree/分支，使重试可重建。注意：不把旧成员置 idle——它可能仍在
        // 运行中且即将被 quiesce 打断；保持其当前状态，派发泵因此不会给它派新任务
        // （M1：quiesce 竞态）。
        if (oldMember !== undefined) {
          await resetTaskWorktree(e, workspace, stateRoot, fresh, oldMember.name, task.id)
        }
        const wakes: Wake[] = []
        if (target === 'pool') {
          requeueTask(task)
        } else if (target === 'captain') {
          task.dedicated = false
          beginTaskAttempt(task, 'captain')
        } else {
          // 转派给命名成员：spawn（若 pending）+ worktree + 置 working + 唤醒
          task.dedicated = false
          if (targetMember!.id === '') {
            await spawnMember(e.ctx, {
              teamId: fresh.id,
              member: targetMember!,
              roleCtx: { specPath: fresh.specPath, stateRoot, teamId: fresh.id, taskSubject: task.subject },
              provider: config.memberProvider,
              defaultModel: config.memberModel,
              signal: exec.signal,
            })
          }
          await ensureTaskWorktree(e, workspace, stateRoot, fresh, targetMember!, task.id)
          beginTaskAttempt(task, targetMember!.name)
          targetMember!.status = 'working'
          wakes.push({ member: targetMember!, task })
        }
        await writeTeam(stateRoot, fresh)
        return {
          result: {
            taskId: task.id,
            previousAssignee,
            assignee: task.assignee ?? '',
            status: task.status,
            attempt: task.attempt ?? 0,
            ...(task.attemptId !== undefined ? { attemptId: task.attemptId } : {}),
          },
          wakes,
        }
      })
      await quiesceOldAssignee(e, agent, oldMember, exec.signal)
      return result
    },
  }))

  // —— 工具 9/16：submit_review ——
  ctx.tools.register(defineTool({
    name: 'lbx_agent_team_submit_review',
    description: 'Checker verdict for a task in in_review (checker-role members only). APPROVE moves the task to approved so it can be committed; REQUEST_CHANGES moves it back to changes_requested (the assignee fixes and resubmits via update_task done=true) and increments the review-loop counter — after maxReviewLoop consecutive rejections the task is marked failed.',
    parameters: {
      taskId: { type: 'string', required: true, description: 'The task id being reviewed.' },
      verdict: { type: 'string', enum: ['APPROVE', 'REQUEST_CHANGES'], required: true, description: 'The checker verdict.' },
      findingsPath: { type: 'string', description: 'Path to the review notes (conventionally under artifacts/reviews/).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          taskId: { type: 'string', required: true },
          status: { type: 'string', required: true },
          reviewLoop: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Task ${value.taskId} → ${value.status} (review loop ${value.reviewLoop}).`,
      }],
    },
    async execute(args, exec) {
      const agent = requireAgent(exec)
      const workspace = workspaceOf(agent)
      const stateRoot = stateRootOf(e, workspace)
      const team = await requireParticipantTeam(stateRoot, agent.id)
      return withTeamMutation(e, exec.signal, workspace, stateRoot, team.id, async (fresh) => {
        const actor = actorOf(fresh, agent.id)
        const task = requireTask(fresh, args.taskId)
        const action = args.verdict === 'APPROVE' ? 'approve' : 'request_changes'
        const gateErr = approveGate(actor)
        if (gateErr !== undefined) throw new Error(gateErr)
        const bad = transitionError(task.status, action)
        if (bad !== undefined) throw new Error(bad)
        task.status = nextStatus(task.status, action)!
        task.review = {
          verdict: args.verdict,
          reviewer: actor.kind === 'member' ? actor.name : 'captain',
          findingsPath: args.findingsPath,
          at: Date.now(),
        }
        if (action === 'request_changes') {
          task.reviewLoop = (task.reviewLoop ?? 0) + 1
          if (task.reviewLoop >= config.maxReviewLoop) task.status = 'failed'
        }
        task.updatedAt = Date.now()
        await writeTeam(stateRoot, fresh)
        return { result: { taskId: task.id, status: task.status, reviewLoop: task.reviewLoop ?? 0 } }
      })
    },
  }))

  // —— 工具 10/16：commit_task ——
  ctx.tools.register(defineTool({
    name: 'lbx_agent_team_commit_task',
    description: 'Commit an approved task (approved → committed) and record the commit hash. The plugin runs git add -A + git commit in the task\'s dever worktree (or the workspace for captain tasks) with the provided message; an empty diff is tolerated and records the current HEAD hash. Requires the DSH shell service; without one the tool returns the exact commands to run and the caller must run them and call again with commitHash. The commit hash must match /^[0-9a-f]{40}$/.',
    parameters: {
      taskId: { type: 'string', required: true, description: 'The approved task id.' },
      message: { type: 'string', required: true, description: 'Commit message (provided by the dever).' },
      commitHash: { type: 'string', description: 'Manual commit hash when no shell service is available (second call).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          taskId: { type: 'string', required: true },
          status: { type: 'string', required: true },
          hash: { type: 'string' },
          branch: { type: 'string' },
          manual: { type: 'boolean', description: 'true when no shell service was available and the caller must run the commands.' },
          commands: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => {
        if (value.manual === true) {
          return [{
            type: 'text',
            text: `Task ${value.taskId} still ${value.status}: no shell service available. Run these commands, then call lbx_agent_team_commit_task again with commitHash:
${(value.commands ?? []).join('\n')}`,
          }]
        }
        return [{
          type: 'text',
          text: `Task ${value.taskId} committed (${value.hash ?? ''} on ${value.branch ?? ''}).`,
        }]
      },
    },
    async execute(args, exec) {
      const agent = requireAgent(exec)
      const workspace = workspaceOf(agent)
      const stateRoot = stateRootOf(e, workspace)
      const team = await requireParticipantTeam(stateRoot, agent.id)
      return withTeamLock(stateRoot, team.id, async () => {
        const fresh = await requireFreshTeam(stateRoot, team.id)
        actorOf(fresh, agent.id)
        const task = requireTask(fresh, args.taskId)
        const bad = transitionError(task.status, 'commit')
        if (bad !== undefined) throw new Error(bad)
        const gateErr = commitGate(task)
        if (gateErr !== undefined) throw new Error(gateErr)
        const message = (args.message ?? '').trim()
        if (message === '') throw new Error('commit message must not be empty')
        const member = task.assignee === undefined || task.assignee === 'pool' || task.assignee === 'captain'
          ? undefined
          : fresh.members.find((m) => m.name === task.assignee && m.status !== 'removed')
        const memberName = member?.name ?? (task.assignee === 'captain' ? 'captain' : '')
        // I1：gitWorktrees=false 或成员无 worktree（captain 任务/建 worktree 失败）时
        // 退化为共享工作树；manual 退化路径共用同一 cwd。
        const cwd = taskCommitCwd(config, member, workspace, stateRoot, fresh.id, task.id)

        const manualHash = (args.commitHash ?? '').trim()
        let hash: string
        let branch: string
        if (manualHash !== '') {
          if (!/^[0-9a-f]{40}$/.test(manualHash)) throw new Error(`invalid commit hash: ${manualHash}`)
          hash = manualHash
          branch = member?.branch ?? 'manual'
        } else if (shellAdapter(ctx) !== undefined) {
          const out = await commitInWorktree(e, cwd, message)
          hash = out.hash
          branch = out.branch
        } else {
          // 无 shell：返回精确命令文本，不做迁移（dever 执行后回报 hash 再调用一次）
          return { taskId: task.id, status: task.status, manual: true, commands: gitCommandText(cwd, message) }
        }
        task.status = 'committed'
        task.commit = { hash, branch, at: Date.now() }
        task.updatedAt = Date.now()
        await writeTeam(stateRoot, fresh)
        return { taskId: task.id, status: task.status, hash, branch }
      })
    },
  }))

  // —— 工具 11/16：test_task ——
  ctx.tools.register(defineTool({
    name: 'lbx_agent_team_test_task',
    description: 'Tester verdict for a committed task (tester-role members only). PASS moves the task to tested and, in worktree mode, merges its branch back to the main line (a conflict is reported to the captain\'s mailbox). FAIL keeps the task committed and synchronously opens a HIGH issue assigned to the task\'s assignee.',
    parameters: {
      taskId: { type: 'string', required: true, description: 'The committed task id.' },
      result: { type: 'string', enum: ['PASS', 'FAIL'], required: true, description: 'Test outcome.' },
      reportPath: { type: 'string', description: 'Path to the test report (conventionally under artifacts/tests/).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          taskId: { type: 'string', required: true },
          status: { type: 'string', required: true },
          issueId: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Task ${value.taskId} → ${value.status}${value.issueId !== undefined ? `; opened issue ${value.issueId}` : ''}.`,
      }],
    },
    async execute(args, exec) {
      const agent = requireAgent(exec)
      const workspace = workspaceOf(agent)
      const stateRoot = stateRootOf(e, workspace)
      const team = await requireParticipantTeam(stateRoot, agent.id)
      return withTeamLock(stateRoot, team.id, async () => {
        const fresh = await requireFreshTeam(stateRoot, team.id)
        const actor = actorOf(fresh, agent.id)
        const task = requireTask(fresh, args.taskId)
        const gateErr = testGate(actor, task)
        if (gateErr !== undefined) throw new Error(gateErr)
        const testerName = actor.kind === 'member' ? actor.name : 'captain'
        let issueId: string | undefined
        if (args.result === 'PASS') {
          task.status = nextStatus(task.status, 'test')!
          task.test = { result: 'PASS', tester: testerName, reportPath: args.reportPath, at: Date.now() }
          // tested 后把分支合并回主线；冲突报告给队长邮箱（§7.3.5）
          if (task.commit?.branch !== undefined && config.gitWorktrees !== false) {
            try {
              await mergeTaskBranch(e, workspace, fresh, task.commit.branch)
            } catch (error) {
              const msg = {
                id: newMessageId(),
                from: 'system',
                to: 'captain',
                content: `merge conflict on branch ${task.commit.branch} for task ${task.id}: ${String(error)} — coordinate resolution before finishing the task`,
                ts: Date.now(),
              }
              await appendMailbox(stateRoot, fresh.id, 'captain', msg)
              ctx.logger.warn(`lbx-agent-team: merge of ${task.commit.branch} failed: ${String(error)}`)
            }
          }
        } else {
          task.test = { result: 'FAIL', tester: testerName, reportPath: args.reportPath, at: Date.now() }
          const issue = {
            id: `i${fresh.issueSeq + 1}`,
            title: `Test FAIL: ${task.id} ${task.subject}`,
            severity: 'HIGH' as const,
            status: 'open' as const,
            taskId: task.id,
            reporter: testerName,
            responsible: task.assignee,
            createdAt: Date.now(),
          }
          fresh.issues.push(issue)
          fresh.issueSeq += 1
          issueId = issue.id
        }
        task.updatedAt = Date.now()
        await writeTeam(stateRoot, fresh)
        return { taskId: task.id, status: task.status, ...(issueId !== undefined ? { issueId } : {}) }
      })
    },
  }))
}
