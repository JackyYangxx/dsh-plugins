import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextDispatch } from '../lib/scheduler.js'

test('idle pool dever claims a ready pool task', () => {
  const team = makeTeam({
    members: [{ name: 'dever-1', status: 'idle', role: 'dever' }],
    tasks: [{ id: 't1', status: 'pending', assignee: 'pool', dedicated: false, dependencies: [] }],
  })
  const d = nextDispatch(team)
  assert.deepEqual(d, { member: 'dever-1', taskId: 't1' })
})

test('dedicated task is not claimed by pool', () => {
  const team = makeTeam({
    members: [{ name: 'dever-1', status: 'idle', role: 'dever' }],
    tasks: [{ id: 't1', status: 'pending', assignee: 'pool', dedicated: true, dependencies: [] }],
  })
  assert.equal(nextDispatch(team), undefined)
})

test('no dispatch when deps unsatisfied or no idle member', () => {
  const team = makeTeam({
    members: [{ name: 'dever-1', status: 'working', role: 'dever' }],
    tasks: [{ id: 't1', status: 'pending', assignee: 'pool', dedicated: false, dependencies: ['t0'] }],
  })
  assert.equal(nextDispatch(team), undefined)
})

function makeTeam({ members, tasks }) {
  return { id: 'team', members, tasks }
}
