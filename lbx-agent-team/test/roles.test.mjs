import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ROLE_PROMPTS } from '../lib/roles.js'

const ROLE_NAMES = ['planner', 'checker', 'tester', 'dever']

const ctx = {
  specPath: '/tmp/project/spec.md',
  stateRoot: '/tmp/teams',
  teamId: 'team-1',
  taskSubject: 'Implement the login widget',
}

const prompts = Object.fromEntries(
  ROLE_NAMES.map((name) => [name, ROLE_PROMPTS[name](ctx)]),
)

test('ROLE_PROMPTS exposes all four role builders', () => {
  assert.deepEqual(Object.keys(ROLE_PROMPTS).sort(), [...ROLE_NAMES].sort())
  for (const name of ROLE_NAMES) {
    assert.equal(typeof ROLE_PROMPTS[name], 'function')
  }
})

test('no role prompt contains literal placeholder tokens', () => {
  const tokens = ['{specPath}', '{stateRoot}', '{teamId}', '{taskSubject}']
  for (const name of ROLE_NAMES) {
    for (const token of tokens) {
      assert.ok(!prompts[name].includes(token), `${name} prompt must not contain literal ${token}`)
    }
  }
})

test('role prompts interpolate context values', () => {
  assert.ok(prompts.planner.includes(ctx.specPath), 'planner should interpolate specPath')
  assert.ok(prompts.dever.includes(ctx.taskSubject), 'dever should interpolate taskSubject')
  assert.ok(prompts.dever.includes(ctx.specPath), 'dever should interpolate specPath')
  for (const name of ['checker', 'tester', 'dever']) {
    assert.ok(
      prompts[name].includes(`${ctx.stateRoot}/${ctx.teamId}`),
      `${name} should interpolate stateRoot/teamId paths`,
    )
  }
})

test('planner prompt proposes the task list to the captain instead of creating tasks', () => {
  assert.ok(prompts.planner.includes('lbx_agent_team_send_message'), 'planner should propose via send_message')
  assert.ok(prompts.planner.includes('propose'), 'planner should propose the task list')
  assert.ok(!prompts.planner.includes('lbx_agent_team_create_task'), 'planner must not name the captain-only create_task tool')
})

test('checker prompt names the submit_review tool', () => {
  assert.ok(prompts.checker.includes('lbx_agent_team_submit_review'))
})

test('tester prompt names the test_task tool', () => {
  assert.ok(prompts.tester.includes('lbx_agent_team_test_task'))
})

test('dever prompt names the claim_task tool', () => {
  assert.ok(prompts.dever.includes('lbx_agent_team_claim_task'))
})

test('checker/tester/dever route communication through the captain with a mailbox', () => {
  for (const name of ['checker', 'tester', 'dever']) {
    assert.ok(
      prompts[name].includes('All communication goes through the captain'),
      `${name} should require captain-routed communication`,
    )
    assert.ok(
      prompts[name].includes('lbx_agent_team_send_message to the captain'),
      `${name} should name the send_message tool`,
    )
    assert.ok(
      prompts[name].includes('inbox/<your name>.jsonl'),
      `${name} should point at the member mailbox`,
    )
  }
})

test('dever prompt covers the claimed -> start -> submit pipeline', () => {
  assert.ok(prompts.dever.includes('done: false'), 'dever should trigger start with done: false')
  assert.ok(prompts.dever.includes('done: true'), 'dever should submit with done: true')
  assert.ok(prompts.dever.includes('in_progress'), 'dever should mention in_progress')
  assert.ok(prompts.dever.includes('in_review'), 'dever should mention in_review')
})

test('tester prompt instructs checking out the exact task state', () => {
  assert.ok(prompts.tester.includes('commit hash'), 'tester should read the commit hash')
  assert.ok(
    prompts.tester.includes('check out that exact state'),
    'tester should check out the exact task state',
  )
})
