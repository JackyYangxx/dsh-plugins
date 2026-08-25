/** 通信/状态/工件工具：issue_create / issue_resolve / send_message / status / artifact。 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { appendMailbox, readMailbox, readTeam, withTeamLock, writeTeam } from '../state.ts'
import { renderFinalReport, renderTasklist, renderTestReport, renderReview } from '../artifacts.ts'
import { wakeMember } from '../members.ts'
import type { TeamIssue, TeamMessage } from '../types.ts'
import type { ToolsConfig } from '../tool-config.ts'
import {
  actorOf,
  env,
  liveCaptain,
  newMessageId,
  requireAgent,
  requireFreshTeam,
  requireParticipantTeam,
  requireTask,
  stateRootOf,
  workspaceOf,
} from './helpers.ts'

export function registerCommsTools(ctx: Context, config: ToolsConfig): void {
  const e = env(ctx, config)

  // —— 工具 12/16：issue_create ——
  ctx.tools.register(defineTool({
    name: 'lbx_agent_team_issue_create',
    description: 'Record an issue on the team (any active participant). lbx_agent_team_test_task creates issues automatically on FAIL; use this tool for manual reports. responsible defaults to the referenced task\'s assignee.',
    parameters: {
      title: { type: 'string', required: true, description: 'Short issue title.' },
      severity: { type: 'string', enum: ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW'], required: true, description: 'Issue severity.' },
      taskId: { type: 'string', description: 'Related task id, if any.' },
      responsible: { type: 'string', description: 'Member responsible for fixing; defaults to the task assignee.' },
      steps: { type: 'string', description: 'Steps to reproduce.' },
      expected: { type: 'string', description: 'Expected behavior.' },
      actual: { type: 'string', description: 'Actual behavior.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          issueId: { type: 'string', required: true },
          title: { type: 'string', required: true },
          severity: { type: 'string', required: true },
          status: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Issue ${value.issueId} created: "${value.title}" (${value.severity}, status ${value.status}).`,
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
        const reporter = actor.kind === 'captain' ? 'captain' : actor.name
        const title = (args.title ?? '').trim()
        if (title === '') throw new Error('issue title must not be empty')
        if (args.taskId !== undefined) requireTask(fresh, args.taskId)
        const responsibleArg = (args.responsible ?? '').trim()
        let responsible: string | undefined
        if (responsibleArg !== '') {
          responsible = responsibleArg
        } else if (args.taskId !== undefined) {
          responsible = fresh.tasks.find((t) => t.id === args.taskId)?.assignee
        }
        const issue: TeamIssue = {
          id: `i${fresh.issueSeq + 1}`,
          title,
          severity: args.severity,
          status: 'open',
          taskId: args.taskId,
          reporter,
          responsible,
          steps: args.steps,
          expected: args.expected,
          actual: args.actual,
          createdAt: Date.now(),
        }
        fresh.issues.push(issue)
        fresh.issueSeq += 1
        await writeTeam(stateRoot, fresh)
        return { issueId: issue.id, title: issue.title, severity: issue.severity, status: issue.status }
      })
    },
  }))

  // —— 工具 13/16：issue_resolve ——
  ctx.tools.register(defineTool({
    name: 'lbx_agent_team_issue_resolve',
    description: 'Resolve an open issue (open → resolved). Only the captain or the issue\'s reporter may resolve it. Optionally record the fixing commit hash.',
    parameters: {
      issueId: { type: 'string', required: true, description: 'The issue id to resolve.' },
      commitHash: { type: 'string', description: 'Optional fixing commit hash (40 hex chars).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          issueId: { type: 'string', required: true },
          status: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Issue ${value.issueId} → ${value.status}.`,
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
        const issue = fresh.issues.find((i) => i.id === args.issueId)
        if (issue === undefined) throw new Error(`issue not found: ${args.issueId}`)
        const callerName = actor.kind === 'captain' ? 'captain' : actor.name
        if (actor.kind !== 'captain' && issue.reporter !== callerName) {
          throw new Error('only the captain or the issue reporter may resolve this issue')
        }
        if (issue.status !== 'open') throw new Error(`issue ${issue.id} is already ${issue.status}`)
        if (args.commitHash !== undefined && !/^[0-9a-f]{40}$/.test(args.commitHash)) {
          throw new Error(`invalid commit hash: ${args.commitHash}`)
        }
        issue.status = 'resolved'
        issue.resolution = { commitHash: args.commitHash, at: Date.now() }
        await writeTeam(stateRoot, fresh)
        return { issueId: issue.id, status: issue.status }
      })
    },
  }))

  // —— 工具 14/16：send_message ——
  ctx.tools.register(defineTool({
    name: 'lbx_agent_team_send_message',
    description: 'Send a message to the captain or to an active teammate (any active participant). The message is persisted to the recipient\'s mailbox; a member recipient is also woken (best effort) so the message becomes its next turn. Check your own mailbox via lbx_agent_team_status.',
    parameters: {
      to: { type: 'string', required: true, description: 'Recipient: "captain" or a member name.' },
      content: { type: 'string', required: true, description: 'The message text.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          messageId: { type: 'string', required: true },
          from: { type: 'string', required: true },
          to: { type: 'string', required: true },
          delivered: { type: 'string', required: true, description: 'wake (member recipient woken) or mailbox (durable inbox only).' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Message ${value.messageId} ${value.from} → ${value.to} delivered via ${value.delivered}.`,
      }],
    },
    async execute(args, exec) {
      const agent = requireAgent(exec)
      const workspace = workspaceOf(agent)
      const stateRoot = stateRootOf(e, workspace)
      const team = await requireParticipantTeam(stateRoot, agent.id)
      let prepared: { freshId: string; message: TeamMessage; recipientId: string } | undefined
      await withTeamLock(stateRoot, team.id, async () => {
        const fresh = await requireFreshTeam(stateRoot, team.id)
        const actor = actorOf(fresh, agent.id)
        const from = actor.kind === 'captain' ? 'captain' : actor.name
        const to = (args.to ?? '').trim()
        const content = (args.content ?? '').trim()
        if (content === '') throw new Error('message content must not be empty')
        let recipientKey: string
        let recipientId = ''
        if (to === 'captain') {
          recipientKey = 'captain'
        } else {
          const member = fresh.members.find((m) => m.name === to && m.status !== 'removed')
          if (member === undefined) throw new Error(`no such member: "${to}"`)
          recipientKey = member.name
          recipientId = member.id
        }
        const message: TeamMessage = { id: newMessageId(), from, to: recipientKey, content, ts: Date.now() }
        await appendMailbox(stateRoot, fresh.id, recipientKey, message)
        prepared = { freshId: fresh.id, message, recipientId }
      })
      let delivered: 'wake' | 'mailbox' = 'mailbox'
      if (prepared !== undefined && prepared.recipientId !== '') {
        // 消息已持久化；唤醒只是 best effort（团队可能刚被归档）
        const fresh = await readTeam(stateRoot, prepared.freshId)
        const captain = fresh === undefined ? undefined : liveCaptain(e.ctx, fresh)
        if (captain !== undefined) {
          const ok = await wakeMember(
            e.ctx,
            captain,
            prepared.recipientId,
            `Message from ${prepared.message.from}:\n\n${prepared.message.content}`,
            exec.signal,
          )
          delivered = ok ? 'wake' : 'mailbox'
        }
      }
      return {
        messageId: prepared?.message.id ?? '',
        from: prepared?.message.from ?? '',
        to: prepared?.message.to ?? '',
        delivered,
      }
    },
  }))

  // —— 工具 15/16：status ——
  ctx.tools.register(defineTool({
    name: 'lbx_agent_team_status',
    description: 'Team snapshot (any active participant): members, tasks, issues, blocked tasks (dependencies not complete) and the ready queue (pending tasks whose dependencies are complete), plus the caller\'s unread inbox. Poll this to watch progress.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          teamId: { type: 'string', required: true },
          teamName: { type: 'string', required: true },
          viewer: { type: 'string', required: true },
          members: { type: 'array', items: { type: 'json' }, required: true },
          tasks: { type: 'array', items: { type: 'json' }, required: true },
          issues: { type: 'array', items: { type: 'json' }, required: true },
          blockers: { type: 'array', items: { type: 'json' }, required: true },
          readyQueue: { type: 'array', items: { type: 'string' }, required: true },
          inbox: { type: 'array', items: { type: 'json' }, required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderStatus(value) }],
    },
    async execute(_args, exec) {
      const agent = requireAgent(exec)
      const workspace = workspaceOf(agent)
      const stateRoot = stateRootOf(e, workspace)
      const located = await requireParticipantTeam(stateRoot, agent.id)
      const { fresh, viewer } = await withTeamLock(stateRoot, located.id, async () => {
        const fresh = await requireFreshTeam(stateRoot, located.id)
        const actor = actorOf(fresh, agent.id)
        return { fresh, viewer: actor.kind === 'captain' ? 'captain' : actor.name }
      })
      const inbox = await readMailbox(stateRoot, fresh.id, viewer)
      const blockers = fresh.tasks
        .filter((t) => t.status === 'pending' && t.dependencies.length > 0)
        .map((t) => ({
          taskId: t.id,
          blockedBy: t.dependencies.filter((d) => fresh.tasks.find((x) => x.id === d)?.status !== 'complete'),
        }))
        .filter((b) => b.blockedBy.length > 0)
      const readyQueue = fresh.tasks
        .filter((t) => t.status === 'pending'
          && t.dependencies.every((d) => fresh.tasks.find((x) => x.id === d)?.status === 'complete'))
        .map((t) => t.id)
      return {
        teamId: fresh.id,
        teamName: fresh.name,
        viewer,
        members: fresh.members.filter((m) => m.status !== 'removed').map((m) => ({
          name: m.name,
          role: m.role,
          status: m.status,
          provider: m.provider ?? '',
          model: m.model ?? '',
          reasoningEffort: m.reasoningEffort ?? '',
          worktreePath: m.worktreePath ?? '',
          branch: m.branch ?? '',
        })),
        tasks: fresh.tasks.map((t) => ({
          id: t.id,
          subject: t.subject,
          status: t.status,
          assignee: t.assignee ?? '',
          dedicated: t.dedicated === true,
          dependencies: t.dependencies,
          attempt: t.attempt ?? 0,
          attemptId: t.attemptId ?? '',
          verification: t.verification ?? '',
          ...(t.output !== undefined ? { output: t.output } : {}),
          ...(t.commit !== undefined ? { commit: { hash: t.commit.hash, branch: t.commit.branch } } : {}),
        })),
        issues: fresh.issues.map((i) => ({
          id: i.id,
          title: i.title,
          severity: i.severity,
          status: i.status,
          responsible: i.responsible ?? '',
          taskId: i.taskId ?? '',
        })),
        blockers,
        readyQueue,
        inbox: inbox.map((m) => ({ id: m.id, from: m.from, content: m.content, ts: m.ts })),
      }
    },
  }))

  // —— 工具 4/16：artifact ——
  ctx.tools.register(defineTool({
    name: 'lbx_agent_team_artifact',
    description: 'Generate a deterministic markdown artifact from the team JSON truth (any active participant) and write it under <stateDir>/<teamId>/artifacts/ (tasklist.md, reviews/<taskId>.md, tests/report.md, final-report.md). Returns the written path. taskId is required for kind=review.',
    parameters: {
      kind: {
        type: 'string',
        enum: ['tasklist', 'review', 'testreport', 'final'],
        required: true,
        description: 'tasklist (task list), review (one review record, needs taskId), testreport (test report), final (final acceptance report).',
      },
      taskId: { type: 'string', description: 'Required for kind=review.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true },
          path: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Artifact ${value.kind} written to ${value.path}.`,
      }],
    },
    async execute(args, exec) {
      const agent = requireAgent(exec)
      const workspace = workspaceOf(agent)
      const stateRoot = stateRootOf(e, workspace)
      const team = await requireParticipantTeam(stateRoot, agent.id)
      return withTeamLock(stateRoot, team.id, async () => {
        const fresh = await requireFreshTeam(stateRoot, team.id)
        actorOf(fresh, agent.id)
        let content: string
        let relPath: string
        switch (args.kind) {
          case 'tasklist':
            content = renderTasklist(fresh)
            relPath = 'tasklist.md'
            break
          case 'review': {
            if (args.taskId === undefined) throw new Error('taskId is required for kind=review')
            requireTask(fresh, args.taskId)
            content = renderReview(fresh, args.taskId)
            relPath = join('reviews', `${args.taskId}.md`)
            break
          }
          case 'testreport':
            content = renderTestReport(fresh)
            relPath = join('tests', 'report.md')
            break
          case 'final':
            content = renderFinalReport(fresh)
            relPath = 'final-report.md'
            break
          default:
            throw new Error(`unknown artifact kind: ${String(args.kind)}`)
        }
        // 路径一致性（Task 10 评审）：角色 prompt 已告知 checker/tester 工件位于
        // {stateRoot}/{teamId}/artifacts/ 下，故写入该目录而非 config.artifactsDir。
        const dir = join(stateRoot, fresh.id, 'artifacts')
        const path = join(dir, relPath)
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, content)
        return { kind: args.kind, path }
      })
    },
  }))
}

/** status 快照的紧凑文本渲染。 */
function renderStatus(value: Record<string, unknown>): string {
  const v = value as {
    teamId: string
    teamName: string
    viewer: string
    members: { name: string; role: string; status: string; provider: string; model: string; worktreePath: string; branch: string }[]
    tasks: { id: string; subject: string; status: string; assignee: string; dependencies: string[]; attempt: number; attemptId: string; output?: string; commit?: { hash: string; branch: string } }[]
    issues: { id: string; title: string; severity: string; status: string; responsible: string; taskId: string }[]
    blockers: { taskId: string; blockedBy: string[] }[]
    readyQueue: string[]
    inbox: { id: string; from: string; content: string; ts: number }[]
  }
  const lines: string[] = [
    `Team "${v.teamName}" (${v.teamId}) — viewing as ${v.viewer}`,
    `Members (${v.members.length}):`,
    ...v.members.map((m) => {
      const route = m.provider && m.model ? ` · ${m.provider}/${m.model}` : ''
      const wt = m.worktreePath ? ` · wt ${m.branch}` : ''
      return `  - ${m.name} [${m.role}] ${m.status}${route}${wt}`
    }),
    `Tasks (${v.tasks.length}):`,
    ...v.tasks.map((t) => {
      const dep = t.dependencies.length > 0 ? ` deps[${t.dependencies.join(',')}]` : ''
      const out = t.output !== undefined ? ` output=${t.output.slice(0, 80)}` : ''
      const commit = t.commit !== undefined ? ` commit=${t.commit.hash.slice(0, 8)}@${t.commit.branch}` : ''
      return `  - ${t.id} ${t.status} by ${t.assignee || 'unassigned'} (a${t.attempt})${dep}${out}${commit}`
    }),
    `Issues (${v.issues.length}):`,
    ...v.issues.map((i) => `  - ${i.id} [${i.severity}] ${i.status} ${i.title}${i.responsible ? ` (→ ${i.responsible})` : ''}`),
    `Blocked (${v.blockers.length}):`,
    ...v.blockers.map((b) => `  - ${b.taskId} blocked by ${b.blockedBy.join(', ')}`),
    `Ready queue: ${v.readyQueue.join(', ') || 'none'}`,
    `Inbox (${v.inbox.length} unread):`,
    ...v.inbox.map((m) => `  - [${m.from}] ${m.content.slice(0, 160)}`),
  ]
  return lines.join('\n')
}
