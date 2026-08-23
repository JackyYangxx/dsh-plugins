import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MEMBER_DENIED_TOOLS, registerMember } from '../lib/members.js'

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
