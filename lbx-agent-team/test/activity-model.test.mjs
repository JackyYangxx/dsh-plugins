import { test } from 'node:test'
import assert from 'node:assert/strict'
import { taskStages, panelSummary } from '../lib/client/activity-model.js'

test('taskStages maps pipeline status to stage labels', () => {
  assert.equal(taskStages('in_review'), 'review')
  assert.equal(taskStages('approved'), 'approved')
  assert.equal(taskStages('complete'), 'done')
})

test('panelSummary aggregates counts', () => {
  const s = panelSummary({
    tasks: [
      { status: 'complete' }, { status: 'in_review' }, { status: 'in_progress' },
    ],
  })
  assert.deepEqual(s, { total: 3, done: 1, inReview: 1, inProgress: 1, failed: 0 })
})
