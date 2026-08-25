/**
 * LBX Agent Team for DeepSeek Harness.
 *
 * A host-plane plugin that registers the `lbx_agent_team_*` tools and one
 * usage section into the global system prompt, plus the deterministic
 * `/lbx-agent-team` slash command with its gesture boundary and the activity
 * panel data route. After installation any session can run the
 * coordinator-led multi-agent development pipeline through natural language
 * (e.g. "use LBX Agent Team to implement X"): the model becomes the
 * coordinator (captain), registers the fixed roster (planner / checker /
 * tester / dever), breaks the spec into tasks with dependencies, delegates
 * through the pipeline state machine (claim → implement → review → commit →
 * test → complete), relays messages, and collects results.
 *
 * Assembly:
 * - system prompt usage section (spec §10; order `config.promptSectionOrder`);
 * - `registerLbxAgentTeamTools(ctx, resolveToolsConfig(config))` (Task 11);
 * - `/lbx-agent-team` slash command + gesture boundary when
 *   `config.slashCommand !== false` (Task 12; `commands` stays a lazy,
 *   optional inject so a minimal composition without the command registry
 *   keeps the plugin fully functional);
 * - `/plugins/lbx-agent-team/state` route: disk truth (team.json per
 *   workspace) merged with live subagent activity, registered lazily against
 *   the web server and workspace registry (webless profiles stay tool-only
 *   and never block boot).
 *
 * Installation (bundle): `dsh plugin --profile <name> add lbx-agent-team`
 * (or a local path). The bundle patch mounts this plugin row into the host
 * composition; the tools register into the shared `tools` registry and the
 * usage section into the global system prompt, so the plugin needs no realm.
 *
 * @module lbx-agent-team
 */

import type { Context } from '@deepseek-ai/cordis'
// Declaration merge only: makes ctx.llm, ctx.subagents, ctx.systemPrompt and
// ctx.agents visible without pulling the optional peer runtimes into this
// bundle (the value imports live inside the modules that need them).
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-agent'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Config, type Config as ConfigType } from './config.ts'
import { registerLbxAgentTeamTools } from './tools.ts'
import { resolveToolsConfig, type ToolsConfig } from './tool-config.ts'
import { installLbxAgentTeamGestureBoundary, registerLbxAgentTeamCommand } from './command.ts'
import { readTeam } from './state.ts'
import type { MemberStatus, TaskStatus, TeamState } from './types.ts'

/**
 * Structural slice of the web server service, compatible with both the
 * published `dsh-host-webserver@0.0.1-rc.1` (`ctx.httpServer` /
 * `HttpServerService`) and the renamed `webServer` / `WebServer` in later
 * builds: the beta transition renames the service without changing the route
 * registration shape.
 */
interface WebRouteHost {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/** Web-server service key candidates, newest first. */
const WEB_SERVER_KEYS = ['webServer', 'httpServer'] as const
/** Workspace registry service key candidates, newest first. */
const WORKSPACE_KEYS = ['workspaceRegistry', 'workspace'] as const

export const name = 'lbx-agent-team'
export const inject = ['tools', 'llm', 'subagents', 'systemPrompt', 'agents']

export { Config }

/** Live subagent activity of one member, derived from the live agent registry. */
export type MemberActivity = 'working' | 'idle' | 'unknown'

/** One member row of the activity snapshot. */
export interface TeamActivityMember {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly status: MemberStatus
  readonly activity: MemberActivity
}

/** One task row of the activity snapshot. */
export interface TeamActivityTask {
  readonly id: string
  readonly subject: string
  readonly status: TaskStatus
  readonly assignee: string
  readonly dependencies: readonly string[]
}

/** One issue row of the activity snapshot. */
export interface TeamActivityIssue {
  readonly id: string
  readonly title: string
  readonly severity: 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW'
  readonly status: 'open' | 'resolved'
}

/** The full panel payload for one team (disk truth + live activity). */
export interface TeamActivitySnapshot {
  readonly workspace: string
  readonly teamId: string
  readonly name: string
  readonly description?: string
  readonly captainSessionId: string
  readonly status: 'active' | 'archived'
  readonly createdAt: number
  readonly members: readonly TeamActivityMember[]
  readonly tasks: readonly TeamActivityTask[]
  readonly issues: readonly TeamActivityIssue[]
}

/** The model-facing usage policy: when and how to drive the LBX Agent Team. */
function usageSectionText(toolNames: string): string {
  return `When the user asks to run something with the LBX Agent Team (e.g. "use LBX Agent Team to do X"), or an activation message from the /lbx-agent-team slash command arrives, you are the coordinator (captain) of a multi-agent development team. Follow this protocol:
0. The user must first provide a spec document (a file path) that the team implements. If there is no spec yet, tell the user to write one and do not create a team — lbx_agent_team_create itself rejects a missing spec path.
1. Call lbx_agent_team_create with a team name, the spec path and the goal as description. You become the coordinator and may lead one team at a time.
2. Call lbx_agent_team_add_member once per role the goal needs (planner, checker, tester, dever, or a custom role). Members are registered lazily and spawned as durable subagents on their first work. By default a member on your current provider/model snapshots your current reasoning effort; a member routed to a different provider or model automatically uses that target model's default effort. Never ask the user to choose these per member; only pass provider/model when the user explicitly requests a different route for that role, and reasoning_effort only when the user explicitly requests a particular effort ("default" explicitly selects the target model's default).
3. Break the spec into tasks with lbx_agent_team_create_task and wire dependencies. Assign role-specific work when useful; unassigned ready work belongs to the shared pool, and assignee=new-dever reserves a dedicated dever for that task. The scheduler automatically claims one ready task for each truly idle dever and wakes it, including across later rounds.
4. Lead by delegation: monitor with lbx_agent_team_status, send guidance with lbx_agent_team_send_message, and let members execute the pipeline (claim → update → in_review → submit_review → commit → test → complete). Do not duplicate a member's work merely because its turn is slow. If the user requires every member to contribute or report, create one task per required contribution (or message each member directly); never wait for an unassigned member to produce work it was never given.
5. Quality gates are hard: only a checker may approve or request changes on a task, only an approved task may be committed, and only a tested task may complete. A task whose review loop exceeds the configured limit is failed by the plugin — surface that to the user instead of bypassing the gate. If work must change owner, restart from scratch, or be taken over, call lbx_agent_team_reassign_task first.
6. Tasks carry attempt_id capabilities. Members must use the current attempt_id for updates; stale-attempt errors mean ownership changed. Check status after progress notifications until every required task is terminal and every member is idle/ready; do not busy-poll or require reports from members with no assigned work.
7. Present the team's results to the user, then lbx_agent_team_delete the team unless the user wants to keep working with it.

Tools: ${toolNames}`
}

/** Snapshot the real driver activity for durable member ids (disk truth is authoritative). */
function memberActivityOf(
  ctx: Context,
  memberIds: readonly string[],
): Map<string, 'running' | 'idle' | 'ready'> {
  const activity = new Map<string, 'running' | 'idle' | 'ready'>()
  for (const id of memberIds) {
    if (id === '') continue
    const live = ctx.agents.get(id as SessionId)
    activity.set(id, live === undefined ? 'ready' : live.status)
  }
  return activity
}

/** Live activity label for one member row; archived teams have no live activity. */
function memberActivityLabel(
  historic: boolean,
  memberId: string,
  live: 'running' | 'idle' | 'ready' | undefined,
): MemberActivity {
  if (historic) return 'idle'
  if (memberId === '') return 'unknown'
  if (live === 'running') return 'working'
  if (live === 'idle' || live === 'ready') return 'idle'
  return 'unknown'
}

/**
 * Assemble one team snapshot from its durable record plus live activity.
 * @param ctx - the plugin context (injects `agents`, used for activity).
 * @param stateRoot - resolved absolute state root of the owning workspace.
 * @param workspace - display name of the owning workspace.
 * @param state - the durable team record.
 * @param historic - archived teams have no meaningful live activity.
 * @returns the panel snapshot.
 */
async function assembleTeamSnapshot(
  ctx: Context,
  stateRoot: string,
  workspace: string,
  state: TeamState,
  historic = false,
): Promise<TeamActivitySnapshot> {
  const roster = historic
    ? state.members
    : state.members.filter((member) => member.status !== 'removed')
  const activity = historic
    ? new Map<string, 'running' | 'idle' | 'ready'>()
    : memberActivityOf(ctx, roster.map((member) => member.id))
  const members: TeamActivityMember[] = roster.map((member) => {
    const live = activity.get(member.id)
    return {
      id: member.id,
      name: member.name,
      role: member.role ?? '',
      status: member.status,
      activity: memberActivityLabel(historic, member.id, live),
    }
  })
  return {
    workspace,
    teamId: state.id,
    name: state.name,
    ...state.description !== undefined ? { description: state.description } : {},
    captainSessionId: state.captainSessionId,
    status: state.status,
    createdAt: state.createdAt,
    members,
    tasks: state.tasks.map((task) => ({
      id: task.id,
      subject: task.subject,
      status: task.status,
      assignee: task.assignee ?? '',
      dependencies: task.dependencies,
    })),
    issues: state.issues.map((issue) => ({
      id: issue.id,
      title: issue.title,
      severity: issue.severity,
      status: issue.status,
    })),
  }
}

/**
 * Collect every active team under the given workspace state roots.
 * @param ctx - the plugin context.
 * @param roots - `{ workspace, stateRoot }` pairs (resolved absolute roots).
 * @returns the snapshots in stable order (workspace, then team id).
 */
async function collectTeamsActivity(
  ctx: Context,
  roots: readonly { workspace: string; stateRoot: string }[],
): Promise<TeamActivitySnapshot[]> {
  const snapshots: TeamActivitySnapshot[] = []
  for (const root of roots) {
    let entries
    try {
      entries = await readdir(root.stateRoot, { withFileTypes: true })
    } catch (error: unknown) {
      if ((error as { code?: string }).code === 'ENOENT') continue
      throw error
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'archive') continue
      try {
        const state = await readTeam(root.stateRoot, entry.name)
        if (state === undefined) continue
        snapshots.push(await assembleTeamSnapshot(ctx, root.stateRoot, root.workspace, state))
      } catch (error: unknown) {
        ctx.logger.warn(`lbx-agent-team: skipped unreadable team state "${entry.name}" in workspace "${root.workspace}": ${String(error)}`)
      }
    }
  }
  return snapshots
}

/**
 * Collect every archived team under the given workspace state roots (the
 * `archive/` subdirectory of each state root). Serves the historic panel
 * path to restore full team detail after deletion.
 * @param ctx - the plugin context.
 * @param roots - `{ workspace, stateRoot }` pairs.
 * @returns the archived snapshots in stable order.
 */
async function collectArchivedTeamsActivity(
  ctx: Context,
  roots: readonly { workspace: string; stateRoot: string }[],
): Promise<TeamActivitySnapshot[]> {
  const snapshots: TeamActivitySnapshot[] = []
  for (const root of roots) {
    const archiveRoot = join(root.stateRoot, 'archive')
    let entries
    try {
      entries = await readdir(archiveRoot, { withFileTypes: true })
    } catch (error: unknown) {
      if ((error as { code?: string }).code === 'ENOENT') continue
      throw error
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        const state = await readTeam(archiveRoot, entry.name)
        if (state === undefined) continue
        snapshots.push(await assembleTeamSnapshot(ctx, archiveRoot, root.workspace, state, true))
      } catch (error: unknown) {
        ctx.logger.warn(`lbx-agent-team: skipped unreadable archived team "${entry.name}" in workspace "${root.workspace}": ${String(error)}`)
      }
    }
  }
  return snapshots
}

export function apply(ctx: Context, config: ConfigType): void {
  const resolved: ToolsConfig = resolveToolsConfig(config)

  // Provider registration is a sibling plugin's effect (`subagent-spawn` /
  // `subagent-fork` rows), which can land after this mount under the Loader's
  // concurrent activation — so capability validation happens at the first
  // member spawn (`spawnMember`), the earliest point the provider list is
  // settled, rather than here.

  const toolNames = [
    'lbx_agent_team_create',
    'lbx_agent_team_add_member',
    'lbx_agent_team_remove_member',
    'lbx_agent_team_delete',
    'lbx_agent_team_create_task',
    'lbx_agent_team_claim_task',
    'lbx_agent_team_update_task',
    'lbx_agent_team_reassign_task',
    'lbx_agent_team_submit_review',
    'lbx_agent_team_commit_task',
    'lbx_agent_team_test_task',
    'lbx_agent_team_issue_create',
    'lbx_agent_team_issue_resolve',
    'lbx_agent_team_send_message',
    'lbx_agent_team_status',
    'lbx_agent_team_artifact',
  ].join(', ')
  ctx.systemPrompt.section({
    name: 'lbx-agent-team:usage',
    order: config.promptSectionOrder ?? 117,
    text: usageSectionText(toolNames),
  })

  registerLbxAgentTeamTools(ctx, resolved)

  // Deterministic activation surfaces: the closed-namespace `/lbx-agent-team`
  // host command (surfaces in the Web GUI slash menu via the Harness
  // ui-commands client) and the plain-text gesture boundary for surfaces
  // without command adjudication (headless CLI). Both default on; a profile
  // can disable them to keep the natural-language trigger exclusive.
  //
  // `commands` is registered lazily (not a required inject): it ships in the
  // base bundle of every standard profile, but a minimal composition that
  // omits the command registry keeps the plugin fully functional — the fiber
  // never pends on it and simply never gains the slash command.
  if (config.slashCommand ?? true) {
    ctx.inject(['commands'], (commandCtx) => {
      registerLbxAgentTeamCommand(commandCtx)
    })
    installLbxAgentTeamGestureBoundary(ctx)
  }

  // The activity panel data route needs the Web server and the workspace
  // registry, which headless profiles do not mount; under concurrent
  // activation they may also bind after this plugin. Register the route
  // lazily: try now, then on each service binding event. In a webless profile
  // the plugin stays tool-only and never blocks boot.
  let webRegistered = false
  const registerWebSurface = (): void => {
    if (webRegistered) return
    const webServer = (ctx.get(WEB_SERVER_KEYS[0]) ?? ctx.get(WEB_SERVER_KEYS[1])) as WebRouteHost | undefined
    const workspaceRegistry = (ctx.get(WORKSPACE_KEYS[0]) ?? ctx.get(WORKSPACE_KEYS[1])) as WorkspaceRegistry | undefined
    if (webServer === undefined || workspaceRegistry === undefined) return
    webRegistered = true

    // Activity panel data route: the browser floater polls this for team
    // snapshots (disk truth + live subagent activity). Mirrors the reference
    // plugin's server-side snapshot pattern. The static assets route is
    // intentionally omitted: the plugin ships no assets/ directory yet, so
    // unknown paths 404 naturally; the panel task can add the allowlisted
    // route when artwork exists.
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/plugins/lbx-agent-team/state',
      handler: async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://x')
          const roots = workspaceRegistry.list().map((workspace) => ({
            workspace: workspace.title,
            stateRoot: join(workspace.path, resolved.stateDir),
          }))
          // ?archived=1 serves teams moved to archive/ (post-delete review).
          const snapshots = url.searchParams.get('archived') === '1'
            ? await collectArchivedTeamsActivity(ctx, roots)
            : await collectTeamsActivity(ctx, roots)
          const body = JSON.stringify({ teams: snapshots })
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          })
          res.end(body)
        } catch (error: unknown) {
          ctx.logger.warn(`lbx-agent-team: state route failed: ${String(error)}`)
          if (!res.headersSent) {
            res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
          }
          res.end(JSON.stringify({ error: 'lbx-agent-team state snapshot failed' }))
        }
      },
    }), 'lbx-agent-team: state route')
  }

  registerWebSurface()
  ctx.on('internal/service', (name) => {
    if (WEB_SERVER_KEYS.includes(name as (typeof WEB_SERVER_KEYS)[number])
      || WORKSPACE_KEYS.includes(name as (typeof WORKSPACE_KEYS)[number])) {
      registerWebSurface()
    }
  })

  ctx.logger.info('lbx-agent-team mounted')
}
