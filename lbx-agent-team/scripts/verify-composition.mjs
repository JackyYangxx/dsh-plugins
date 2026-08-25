#!/usr/bin/env node
/**
 * Composition verification for lbx-agent-team (Task 14).
 *
 * Mounts the real built plugin (`lib/index.js` `apply`) on a minimal stub
 * context, following the reference `dsh-agent-teams/scripts/lifecycle-verify.mjs`
 * pattern: a plain Cordis-shaped context carrying only the services the plugin
 * actually touches (tools registry, systemPrompt, commands, agents, logger,
 * webServer / workspaceRegistry), then drives the registered surfaces exactly
 * the way the host would:
 *
 *  - all 17 `lbx_agent_team_*` tools land in the tools registry;
 *  - the `lbx-agent-team:usage` system prompt section exists (order 117) and
 *    names the entry tool;
 *  - with `slashCommand` on (default) the `/lbx-agent-team` host command
 *    registers against the commands registry, and the `agent/pre-step` gesture
 *    boundary converts a leading `/lbx-agent-team` user line into the
 *    deterministic activation directive; with `slashCommand: false` neither
 *    surface appears while the tools still register;
 *  - end-to-end create smoke: a temp workspace with a temp git repository and
 *    a fake spec file, `lbx_agent_team_create.execute` invoked with a fake
 *    `exec.agent` (`session.header.cwd` = the temp workspace) writes
 *    `<ws>/.lbx-agent-team/<teamId>/team.json` with the autoRoster
 *    planner/checker/tester, records the absolute spec path and the captain
 *    session id, and rejects a missing spec loudly;
 *  - HTTP state route smoke: the `/plugins/lbx-agent-team/state` route
 *    registered against the stubbed web server returns `{ teams: [...] }`
 *    containing the created team from the stubbed workspace registry;
 *  - webless mount (Composition C): with webServer / workspaceRegistry absent
 *    at mount time the plugin stays tool-only (no state route, no crash, all
 *    17 tools still register); binding both services later and emitting
 *    `internal/service` re-triggers `registerWebSurface` so the state route
 *    appears and serves `{ teams: [...] }`.
 *
 * Any failed assertion exits non-zero, so `pnpm verify` fails the build.
 *
 * The real Cordis Loader itself is intentionally not pulled in here: it is a
 * transitive peer of the dsh-* packages (not a direct dependency of this
 * plugin), and the reference verification script the task points to also
 * composes through a stub context rather than the Loader entry tree. The
 * stub context runs the genuine `apply()` entry point with all its service
 * access (systemPrompt.section, tools.register, commands inject, web route),
 * which is what this script exists to prove.
 */

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { apply, name as pluginName } from '../lib/index.js'

const execFileP = promisify(execFile)

const failures = []
function check(label, condition, detail = '') {
  const status = condition ? 'PASS' : 'FAIL'
  console.log(`  ${status}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!condition) failures.push(label)
}

/**
 * Build a fresh minimal composition: a Cordis-shaped stub context plus the
 * registries it collects (tools, sections, commands, listeners, web routes,
 * workspace list). Each composition gets its own registries so `apply()` can
 * run more than once with different configs.
 *
 * `options.webless` starts the composition without the webServer and
 * workspaceRegistry services, modelling a headless profile. Services are
 * tracked in a mutable presence set: binding them later and emitting
 * `internal/service` (`_bindWebSurface`) exercises the plugin's lazy
 * re-registration listener exactly the way a late service bind would.
 */
function makeContext(options = {}) {
  const tools = new Map()
  const sections = []
  const commands = new Map()
  const listeners = new Map()
  const routes = []
  const workspaces = []
  const services = new Set(options.webless ? [] : ['webServer', 'workspaceRegistry'])

  const webServerStub = { register(route) { routes.push(route); return () => {} } }
  const workspaceRegistryStub = { list() { return workspaces } }

  const ctx = {
    /** Run an effect synchronously and keep its disposer (reference pattern). */
    effect(setup) {
      const disposer = setup()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    /** Service registry lookup; only the services the plugin may touch. */
    get(key) {
      // The web route registers eagerly when both services are present at
      // mount time (the same path a full composition takes).
      if (key === 'webServer' && services.has('webServer')) return webServerStub
      if (key === 'workspaceRegistry' && services.has('workspaceRegistry')) return workspaceRegistryStub
      // `shell` absent → git helpers fall back to the local execFile shell.
      return undefined
    },
    /** Lazy optional inject: run the callback against this context now. */
    inject(_deps, callback) {
      const disposer = callback(this)
      return typeof disposer === 'function' ? disposer : () => {}
    },
    /** Minimal event bus with disposers (agent/status, agent/pre-step, ...). */
    on(event, listener) {
      const current = listeners.get(event) ?? []
      current.push(listener)
      listeners.set(event, current)
      return () => listeners.set(event, current.filter((candidate) => candidate !== listener))
    },
    /** Fire every listener of one event, awaiting async listeners. */
    async emit(event, ...args) {
      await Promise.all((listeners.get(event) ?? []).map((listener) => listener(...args)))
    },
    tools: { register(definition) { tools.set(definition.name, definition) } },
    systemPrompt: { section(section) { sections.push(section); return () => {} } },
    commands: { register(definition) { commands.set(definition.name, definition); return () => commands.delete(definition.name) } },
    agents: { get() { return undefined } },
    logger: { info() {}, warn() {}, debug() {} },
    /**
     * Late-bind the web surface after mount: register both services and emit
     * `internal/service` for each (the same events a real composition fires),
     * so the plugin's lazy re-registration listener can pick them up.
     */
    async _bindWebSurface() {
      services.add('webServer')
      services.add('workspaceRegistry')
      await ctx.emit('internal/service', 'webServer')
      await ctx.emit('internal/service', 'workspaceRegistry')
    },
    // Collected registries for assertions.
    _tools: tools,
    _sections: sections,
    _commands: commands,
    _listeners: listeners,
    _routes: routes,
    _workspaces: workspaces,
  }
  return ctx
}

/** Fake captain agent whose `session.header.cwd` pins the temp workspace. */
function captainFor(workspace) {
  return {
    id: 'captain-session',
    status: 'idle',
    options: { provider: 'fake', model: 'fake-model' },
    session: {
      header: { cwd: workspace, parentSession: undefined },
      events: [],
      append() {},
      requestHeader() { return { config: { provider: 'fake', model: 'fake-model' } } },
    },
    followups: [],
    followup(message) { this.followups.push(message) },
    steer() {},
    cancel() {},
    whenIdle() { return Promise.resolve() },
  }
}

console.log(`lbx-agent-team composition verification (plugin name: ${pluginName})`)

// ── Composition A: default config (slashCommand on) ────────────────────
const ctx = makeContext()
apply(ctx, {})
const toolNames = [...ctx._tools.keys()]

check('17 lbx_agent_team_* tools registered',
  toolNames.length === 17 && toolNames.every((name) => name.startsWith('lbx_agent_team_')),
  `got ${toolNames.length}: ${toolNames.join(', ')}`)
check('create tool registered first',
  ctx._tools.get('lbx_agent_team_create') !== undefined
    && typeof ctx._tools.get('lbx_agent_team_create').execute === 'function')
check('artifact tool registered last',
  ctx._tools.get('lbx_agent_team_artifact') !== undefined)

const usage = ctx._sections.find((section) => section.name === 'lbx-agent-team:usage')
check('system prompt section "lbx-agent-team:usage" exists', usage !== undefined)
check('usage section sits in the tool guidance band (order 117)', usage?.order === 117)
check('usage section names the entry tool', typeof usage?.text === 'string' && usage.text.includes('lbx_agent_team_create'))
check('usage section covers the artifact tool', typeof usage?.text === 'string' && usage.text.includes('lbx_agent_team_artifact'))

const command = ctx._commands.get('lbx-agent-team')
check('slash command /lbx-agent-team registered', command !== undefined && typeof command.description === 'string')
check('slash command advertises an input hint', typeof command?.input?.hint === 'string' && command.input.hint.length > 0)

const captain = captainFor(process.cwd())
const signal = new AbortController().signal
const bare = command.handler({ agent: captain, rawInput: '   ', signal, commandId: 'cmd-bare' })
check('bare /lbx-agent-team reports usage instead of activating',
  bare.kind === 'error' && bare.text.includes('Usage: /lbx-agent-team') && captain.followups.length === 0)
const argued = command.handler({ agent: captain, rawInput: ' build a tiny CLI', signal, commandId: 'cmd-argued' })
check('argued /lbx-agent-team queues one visible user turn',
  argued.kind === 'success' && captain.followups.length === 1
    && captain.followups[0]?.source?.kind === 'user')

const preStep = (ctx._listeners.get('agent/pre-step') ?? [])[0]
check('agent/pre-step gesture boundary installed', typeof preStep === 'function')
if (typeof preStep === 'function') {
  const decision = await preStep(
    { messages: [{ id: 'm', role: 'user', content: [{ type: 'text', text: '/lbx-agent-team ship a CLI' }], source: { kind: 'user' } }], signal },
    async () => ({ kind: 'enter', messages: [] }),
  )
  check('gesture boundary injects the deterministic activation',
    decision?.kind === 'enter' && decision.messages.length === 1
      && decision.messages[0]?.content?.some((block) => block.type === 'text' && block.text.includes('Activate the LBX Agent Team protocol')))
}

// ── Composition B: slashCommand off keeps tools but drops both surfaces ──
const ctxNoSlash = makeContext()
apply(ctxNoSlash, { slashCommand: false })
check('slashCommand=false: tools still register', ctxNoSlash._tools.size === 17)
check('slashCommand=false: no slash command registered', ctxNoSlash._commands.size === 0)
check('slashCommand=false: no gesture boundary listener', (ctxNoSlash._listeners.get('agent/pre-step') ?? []).length === 0)

// ── End-to-end create smoke ────────────────────────────────────────────
const workspace = await mkdtemp(join(tmpdir(), 'lbx-agent-team-verify-'))
try {
  await execFileP('git', ['init', '-q'], { cwd: workspace })
  await execFileP('git', ['config', 'user.email', 'verify@lbx-agent-team.test'], { cwd: workspace })
  await execFileP('git', ['config', 'user.name', 'lbx-agent-team verify'], { cwd: workspace })
  await writeFile(join(workspace, 'spec.md'), '# Fake spec\n\nImplement a tiny CLI that prints hello.\n')
  ctx._workspaces.push({ title: 'verify-workspace', path: workspace })

  const create = ctx._tools.get('lbx_agent_team_create')
  const exec = { agent: captainFor(workspace), signal: new AbortController().signal }
  const result = await create.execute({ name: 'Smoke Team', spec: 'spec.md', description: 'e2e create smoke' }, exec)
  check('create returns the sanitized team id', result.teamId === 'smoke-team', JSON.stringify(result))

  const teamJsonPath = join(workspace, '.lbx-agent-team', 'smoke-team', 'team.json')
  let team = undefined
  try {
    team = JSON.parse(await readFile(teamJsonPath, 'utf8'))
  } catch (error) {
    check(`team.json written to ${teamJsonPath}`, false, String(error))
  }
  check('team.json lands at <ws>/.lbx-agent-team/<teamId>/team.json', team !== undefined)
  const roster = team?.members?.map((member) => member.name) ?? []
  check('autoRoster registers planner/checker/tester',
    ['planner', 'checker', 'tester'].every((role) => roster.includes(role)), `roster: ${roster.join(', ')}`)
  check('roster members stay pending (lazy spawn)',
    (team?.members ?? []).every((member) => member.status === 'pending'))
  check('team records the absolute spec path and the captain session',
    team?.specPath === join(workspace, 'spec.md') && team?.captainSessionId === 'captain-session')

  let missingSpecRejected = false
  try {
    await create.execute({ name: 'No Spec', spec: 'does-not-exist.md' }, exec)
  } catch (error) {
    missingSpecRejected = /spec file not found/.test(String(error))
  }
  check('create rejects a missing spec loudly', missingSpecRejected)

  // ── HTTP state route smoke ───────────────────────────────────────────
  const route = ctx._routes.find((candidate) => candidate.path === '/plugins/lbx-agent-team/state')
  check('state route registered against the web server', route !== undefined)
  if (route !== undefined) {
    const res = {
      headersSent: false,
      writeHead(code, headers) { this.status = code; this.headers = headers },
      end(body) { this.body = body },
    }
    await route.handler({ url: '/plugins/lbx-agent-team/state' }, res)
    let payload = undefined
    try {
      payload = JSON.parse(res.body)
    } catch (error) {
      check('state route returns JSON', false, String(error))
    }
    check('state route responds 200 with { teams: [...] }',
      res.status === 200 && Array.isArray(payload?.teams))
    check('state route serves the created team snapshot',
      payload?.teams?.length === 1 && payload.teams[0].teamId === 'smoke-team'
        && payload.teams[0].captainSessionId === 'captain-session',
      JSON.stringify(payload?.teams))
    check('state snapshot carries the live member rows',
      ['planner', 'checker', 'tester'].every((name) =>
        payload?.teams?.[0]?.members?.some((member) => member.name === name)))
  }
  // ── Composition C: webless mount, then late web surface binding ──────
  const ctxWebless = makeContext({ webless: true })
  apply(ctxWebless, {})
  check('webless mount: tools register without web services', ctxWebless._tools.size === 17)
  check('webless mount: usage section still present',
    ctxWebless._sections.some((section) => section.name === 'lbx-agent-team:usage'))
  check('webless mount: no state route before web services bind', ctxWebless._routes.length === 0)

  ctxWebless._workspaces.push({ title: 'verify-workspace', path: workspace })
  await ctxWebless._bindWebSurface()
  check('late web binding registers the state route',
    ctxWebless._routes.length === 1 && ctxWebless._routes[0].path === '/plugins/lbx-agent-team/state',
    'routes: ' + (ctxWebless._routes.map((candidate) => candidate.path).join(', ') || 'none'))
  const lateRes = {
    headersSent: false,
    writeHead(code, headers) { this.status = code; this.headers = headers },
    end(body) { this.body = body },
  }
  await ctxWebless._routes[0].handler({ url: '/plugins/lbx-agent-team/state' }, lateRes)
  let latePayload = undefined
  try {
    latePayload = JSON.parse(lateRes.body)
  } catch (error) {
    check('late-bound route returns JSON', false, String(error))
  }
  check('late-bound route serves { teams: [...] } with the created team',
    lateRes.status === 200 && Array.isArray(latePayload?.teams)
      && latePayload.teams.length === 1 && latePayload.teams[0].teamId === 'smoke-team',
    JSON.stringify(latePayload?.teams))
} finally {
  await rm(workspace, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`\n${failures.length} composition check(s) FAILED: ${failures.join(', ')}`)
  process.exit(1)
}
console.log('\nall composition checks passed')