import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderTasklist, renderReview, renderTestReport, renderFinalReport, statusBox } from '../lib/artifacts.js'

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

test('renderTasklist is deterministic for the same state', () => {
  assert.equal(renderTasklist(team), renderTasklist(team))
})

test('renderTasklist escapes newlines in free-text fields (no injected items/headings)', () => {
  const injected = {
    ...team,
    tasks: [{ ...team.tasks[0], subject: 'add login\n- [ ] forged: task\n# Fake Heading', assignee: 'a\nb' }],
  }
  const md = renderTasklist(injected)
  const listItems = md.split('\n').filter((l) => l.startsWith('- '))
  const headings = md.split('\n').filter((l) => l.startsWith('# '))
  assert.equal(listItems.length, 1)
  assert.equal(headings.length, 1)
  assert.ok(listItems[0].startsWith('- [x] t1: add login'))
})

test('renderFinalReport summarizes pipeline results', () => {
  const md = renderFinalReport(team)
  assert.match(md, /demo Final Report/)
  assert.match(md, /1 complete/)
  assert.match(md, /0 failed/)
})

test('renderReview prints verdict, reviewer, findings and timestamp', () => {
  const reviewed = {
    ...team,
    tasks: [{ ...team.tasks[0], review: { verdict: 'APPROVE', reviewer: 'checker-1', findingsPath: 'docs/reviews/t1.md', at: 1700000000000 } }],
  }
  const md = renderReview(reviewed, 't1')
  assert.match(md, /# Review: add login/)
  assert.match(md, /APPROVE by checker-1/)
  assert.match(md, /Findings:\*\* docs\/reviews\/t1.md/)
  assert.match(md, /at 2023-11-14T22:13:20.000Z/)
})

test('renderReview falls back to none for unknown task or missing review', () => {
  assert.match(renderReview(team, 'nope'), /\*\*Verdict:\*\* none/)
  assert.match(renderReview(team, 't1'), /\*\*Verdict:\*\* none/)
})

test('renderTestReport prints result, tester and report path', () => {
  const tested = {
    ...team,
    tasks: [{ ...team.tasks[0], test: { result: 'PASS', tester: 'tester-1', reportPath: 'docs/reports/t1.md', at: 2 } }],
  }
  const md = renderTestReport(tested)
  assert.match(md, /- t1: PASS by tester-1 \(docs\/reports\/t1.md\)/)
})

test('renderTestReport shows not tested when absent', () => {
  const md = renderTestReport(team)
  assert.match(md, /- t1: not tested/)
})

test('statusBox marks only complete as [x]', () => {
  assert.equal(statusBox('complete'), '[x]')
  for (const s of ['pending', 'in_progress', 'in_review', 'approved', 'committed', 'tested', 'failed', 'cancelled']) {
    assert.equal(statusBox(s), '[ ]', s)
  }
})
