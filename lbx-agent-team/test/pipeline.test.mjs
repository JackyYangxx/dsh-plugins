import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextStatus, transitionError, claimGate, approveGate, commitGate, testGate } from '../lib/pipeline.js'

test('valid transitions advance status', () => {
  assert.equal(nextStatus('pending', 'claim'), 'claimed')
  assert.equal(nextStatus('in_progress', 'submit'), 'in_review')
  assert.equal(nextStatus('in_review', 'approve'), 'approved')
  assert.equal(nextStatus('in_review', 'request_changes'), 'changes_requested')
  assert.equal(nextStatus('changes_requested', 'submit'), 'in_review')
  assert.equal(nextStatus('approved', 'commit'), 'committed')
  assert.equal(nextStatus('committed', 'test'), 'tested')
  assert.equal(nextStatus('tested', 'finish'), 'complete')
})

test('invalid transitions return undefined and transitionError reports', () => {
  assert.equal(nextStatus('pending', 'commit'), undefined)
  assert.match(transitionError('pending', 'commit'), /cannot commit a task in status pending/)
  assert.equal(nextStatus('complete', 'fail'), undefined)
  assert.equal(nextStatus('failed', 'cancel'), undefined)
})

test('claim gate rejects unsatisfied dependencies', () => {
  const team = makeTeam({ t1: 'pending', t2: 'pending' })
  const t2 = team.tasks.find((t) => t.id === 't2')
  t2.dependencies = ['t1']
  assert.match(claimGate(team, t2), /dependencies not complete/)
})

test('approve gate requires checker role', () => {
  const task = makeTask('in_review')
  assert.match(approveGate({ kind: 'member', name: 'dever-1', role: 'dever' }), /only a checker/)
  assert.equal(approveGate({ kind: 'member', name: 'checker', role: 'checker' }), undefined)
})

test('commit gate requires APPROVE record', () => {
  const task = makeTask('approved')
  assert.match(commitGate(task), /no APPROVE record/)
  task.review = { verdict: 'APPROVE', reviewer: 'checker', at: 1 }
  assert.equal(commitGate(task), undefined)
})

test('test gate requires tester role and committed status', () => {
  const task = makeTask('approved')
  assert.match(testGate({ kind: 'member', name: 'dever-1', role: 'dever' }, task), /only a tester/)
  assert.match(testGate({ kind: 'member', name: 'tester', role: 'tester' }, task), /must be committed/)
  task.status = 'committed'
  assert.equal(testGate({ kind: 'member', name: 'tester', role: 'tester' }, task), undefined)
})

function makeTask(status) {
  return { id: 't1', subject: 'x', status, dependencies: [], createdAt: 1, updatedAt: 1 }
}
function makeTeam(statuses) {
  const tasks = Object.entries(statuses).map(([id, status]) => ({ ...makeTask(status), id }))
  return { id: 'team', tasks }
}
