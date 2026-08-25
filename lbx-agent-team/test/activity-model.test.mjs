import { test } from 'node:test'
import assert from 'node:assert/strict'
import { taskStages, panelSummary } from '../lib/client/activity-model.js'

test('taskStages maps every pipeline status to a stage label', () => {
  const cases = [
    ['pending', 'pending'],
    ['claimed', 'working'],
    ['in_progress', 'working'],
    ['in_review', 'review'],
    ['approved', 'approved'],
    ['committed', 'committed'],
    ['tested', 'tested'],
    ['complete', 'done'],
    ['changes_requested', 'working'],
    ['failed', 'failed'],
    ['cancelled', 'cancelled'],
    // Host statuses added after this client shipped fall back to pending.
    ['future_status', 'pending'],
  ]
  for (const [status, stage] of cases) {
    assert.equal(taskStages(status), stage, `status ${status}`)
  }
})

test('panelSummary aggregates counts', () => {
  const s = panelSummary({
    tasks: [
      { status: 'complete' }, { status: 'in_review' }, { status: 'in_progress' },
    ],
  })
  assert.deepEqual(s, { total: 3, done: 1, inReview: 1, inProgress: 1, failed: 0, waiting: 0, other: 0 })
})

test('panelSummary handles an empty task list', () => {
  assert.deepEqual(panelSummary({ tasks: [] }), {
    total: 0, done: 0, inReview: 0, inProgress: 0, failed: 0, waiting: 0, other: 0,
  })
})

test('panelSummary buckets failed, waiting, claimed and transient statuses', () => {
  const s = panelSummary({
    tasks: [
      { status: 'failed' }, { status: 'pending' }, { status: 'approved' },
      { status: 'committed' }, { status: 'tested' }, { status: 'cancelled' },
      { status: 'claimed' }, { status: 'future_status' },
    ],
  })
  // failed(1) + waiting(pending + unknown fallback)(2) + inProgress(claimed)(1)
  // + other(approved/committed/tested/cancelled)(4) = total 8.
  assert.deepEqual(s, { total: 8, done: 0, inReview: 0, inProgress: 1, failed: 1, waiting: 2, other: 4 })
})
