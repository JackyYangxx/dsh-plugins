import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  installMemberSelectionRuntime,
  MEMBER_DENIED_TOOLS,
  registerMember,
  resolveMemberLlmSelection,
  spawnMember,
} from '../lib/members.js'

test('registerMember appends a pending unspawned member', () => {
  const team = { members: [], taskSeq: 0 }
  const member = registerMember(team, { name: 'planner', role: 'planner' })
  assert.equal(team.members.length, 1)
  assert.equal(team.members[0], member)
  assert.equal(member.id, '')
  assert.equal(member.status, 'pending')
  assert.equal(member.name, 'planner')
  assert.equal(member.role, 'planner')
  assert.ok(member.joinedAt > 0)
  assert.equal(member.provider, undefined)
  assert.equal(member.model, undefined)
  assert.equal(member.reasoningEffort, undefined)
})

test('registerMember preserves explicit LLM route fields', () => {
  const team = { members: [], taskSeq: 0 }
  const member = registerMember(team, {
    name: 'dever-1',
    role: 'dever',
    provider: 'spawn',
    model: 'deepseek-v4',
    reasoningEffort: 'high',
  })
  assert.equal(member.provider, 'spawn')
  assert.equal(member.model, 'deepseek-v4')
  assert.equal(member.reasoningEffort, 'high')
  assert.equal(member.status, 'pending')
})

test('registerMember appends in order and returns each member', () => {
  const team = { members: [], taskSeq: 0 }
  const a = registerMember(team, { name: 'planner', role: 'planner' })
  const b = registerMember(team, { name: 'checker', role: 'checker' })
  assert.deepEqual(team.members.map((m) => m.name), ['planner', 'checker'])
  assert.equal(a.name, 'planner')
  assert.equal(b.name, 'checker')
})

test('MEMBER_DENIED_TOOLS excludes exactly the captain-only tools', () => {
  assert.deepEqual(MEMBER_DENIED_TOOLS, [
    'lbx_agent_team_create',
    'lbx_agent_team_add_member',
    'lbx_agent_team_remove_member',
    'lbx_agent_team_reassign_task',
    'lbx_agent_team_create_task',
    'lbx_agent_team_delete',
  ])
})

// —— resolveMemberLlmSelection ——

function makeCaptain(route = { provider: 'deepseek', model: 'deepseek-v4', reasoningEffort: 'high' }) {
  return {
    options: { provider: route.provider, model: route.model },
    session: {
      requestHeader: () => ({ config: { ...route } }),
    },
  }
}

function makeLlm() {
  return {
    async resolveCallConfig(config) {
      return { ...config }
    },
  }
}

test('resolveMemberLlmSelection prefers explicit provider+model and drops effort on a changed route', async () => {
  const selection = await resolveMemberLlmSelection(
    { llm: makeLlm() },
    makeCaptain(),
    { provider: 'anthropic', model: 'claude-x' },
  )
  assert.deepEqual(selection, { provider: 'anthropic', model: 'claude-x' })
})

test('resolveMemberLlmSelection falls back to the captain route and inherits its effort', async () => {
  const selection = await resolveMemberLlmSelection({ llm: makeLlm() }, makeCaptain(), {})
  assert.deepEqual(selection, { provider: 'deepseek', model: 'deepseek-v4', reasoningEffort: 'high' })
})

test("resolveMemberLlmSelection treats the 'default' effort sentinel as target-default", async () => {
  const selection = await resolveMemberLlmSelection(
    { llm: makeLlm() },
    makeCaptain(),
    { reasoningEffort: 'default' },
  )
  assert.deepEqual(selection, { provider: 'deepseek', model: 'deepseek-v4' })
})

test('resolveMemberLlmSelection keeps an explicit effort on the same route', async () => {
  const selection = await resolveMemberLlmSelection(
    { llm: makeLlm() },
    makeCaptain(),
    { reasoningEffort: 'low' },
  )
  assert.deepEqual(selection, { provider: 'deepseek', model: 'deepseek-v4', reasoningEffort: 'low' })
})

test('resolveMemberLlmSelection falls back to captain options when no request header exists', async () => {
  const captain = {
    options: { provider: 'deepseek', model: 'deepseek-v4' },
    session: { requestHeader: () => undefined },
  }
  const selection = await resolveMemberLlmSelection({ llm: makeLlm() }, captain, {})
  assert.deepEqual(selection, { provider: 'deepseek', model: 'deepseek-v4' })
})

test('resolveMemberLlmSelection rejects an explicit provider without a model', async () => {
  await assert.rejects(
    () => resolveMemberLlmSelection({ llm: makeLlm() }, makeCaptain(), { provider: 'anthropic' }),
    /explicit member LLM provider requires an explicit member model/,
  )
})

// —— installMemberSelectionRuntime / withPending ——

function makeSubagentsCtx() {
  const installs = []
  const ctx = {
    subagents: {
      registerContinuableSetup: (contribution) => {
        installs.push(contribution)
        return () => undefined
      },
    },
    __installs: installs,
  }
  return ctx
}

test('installMemberSelectionRuntime registers one continuable setup contribution', () => {
  const ctx = makeSubagentsCtx()
  installMemberSelectionRuntime(ctx)
  assert.equal(ctx.__installs.length, 1)
  assert.equal(typeof ctx.__installs[0], 'function')
})

test('withPending rejects a duplicate pending key for the same label', async () => {
  const runtime = installMemberSelectionRuntime(makeSubagentsCtx())
  const selection = { provider: 'deepseek', model: 'deepseek-v4' }
  const first = runtime.withPending('parent', 'lbx-agent-team:t:m', selection, async () => {
    await assert.rejects(
      () => runtime.withPending('parent', 'lbx-agent-team:t:m', selection, async () => 'dup'),
      /already pending/,
    )
    return 'ok'
  })
  assert.equal(await first, 'ok')
})

test('withPending releases the key in finally even when the operation throws', async () => {
  const runtime = installMemberSelectionRuntime(makeSubagentsCtx())
  const selection = { provider: 'deepseek', model: 'deepseek-v4' }
  await assert.rejects(
    () => runtime.withPending('parent', 'lbx-agent-team:t:m', selection, async () => {
      throw new Error('boom')
    }),
    /boom/,
  )
  const retry = await runtime.withPending('parent', 'lbx-agent-team:t:m', selection, async () => 'retry')
  assert.equal(retry, 'retry')
})

test('withPending keeps distinct labels independent', async () => {
  const runtime = installMemberSelectionRuntime(makeSubagentsCtx())
  const selection = { provider: 'deepseek', model: 'deepseek-v4' }
  const [a, b] = await Promise.all([
    runtime.withPending('parent', 'lbx-agent-team:t:a', selection, async () => 'A'),
    runtime.withPending('parent', 'lbx-agent-team:t:b', selection, async () => 'B'),
  ])
  assert.deepEqual([a, b], ['A', 'B'])
})

// —— spawnMember guards ——

const roleCtx = { specPath: '/tmp/spec.md', stateRoot: '/tmp/teams', teamId: 't1' }

test('spawnMember rejects an already-spawned member', async () => {
  const member = { id: 'sess-1', name: 'dever-1', role: 'dever', status: 'idle', joinedAt: 1 }
  await assert.rejects(
    () => spawnMember({}, { teamId: 't1', member, roleCtx }),
    /already spawned/,
  )
})

test('spawnMember rejects a removed member', async () => {
  const member = { id: '', name: 'dever-1', role: 'dever', status: 'removed', joinedAt: 1 }
  await assert.rejects(
    () => spawnMember({}, { teamId: 't1', member, roleCtx }),
    /removed/,
  )
})

test('spawnMember rejects a dever without roleCtx.taskSubject', async () => {
  const member = { id: '', name: 'dever-1', role: 'dever', status: 'pending', joinedAt: 1 }
  await assert.rejects(
    () => spawnMember({}, { teamId: 't1', member, roleCtx }),
    /taskSubject/,
  )
})

test('spawnMember accepts a dever that carries taskSubject past the guards', async () => {
  const member = { id: '', name: 'dever-1', role: 'dever', status: 'pending', joinedAt: 1 }
  // Guards pass; the next failure must come from the team lookup, not the guards.
  await assert.rejects(
    () => spawnMember({}, { teamId: 't1', member, roleCtx: { ...roleCtx, taskSubject: 'Build login' } }),
    /team "t1" not found/,
  )
})
