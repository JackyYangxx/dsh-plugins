import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderTasklist, renderFinalReport } from '../lib/artifacts.js'

const team = {
  id: 't1', name: 'demo', specPath: 'docs/specs/demo.md', status: 'active', captainSessionId: 'c',
  createdAt: 1, taskSeq: 1, issueSeq: 0,
  members: [{ id: 'p', name: 'planner', role: 'planner', status: 'idle', joinedAt: 1 }],
  tasks: [{ id: 't1', subject: 'add login', status: 'complete', assignee: 'dever-1', dependencies: [], createdAt: 1, updatedAt: 2 }],
  issues: [],
}

test('renderTasklist lists every task with status', () => {
  const md = renderTasklist(team)
  assert.match(md, /# demo Task List/)
  assert.match(md, /- \[x\] t1: add login/)
  assert.match(md, /\*\*Spec:\*\* docs\/specs\/demo.md/)
})

test('renderFinalReport summarizes pipeline results', () => {
  const md = renderFinalReport(team)
  assert.match(md, /demo Final Report/)
  assert.match(md, /1 complete/)
  assert.match(md, /0 failed/)
})
