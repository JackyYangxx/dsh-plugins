import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TERMINAL_TASK_STATUSES } from '../lib/types.js'

test('TERMINAL_TASK_STATUSES contains only final states', () => {
  assert.deepEqual(TERMINAL_TASK_STATUSES, ['complete', 'failed', 'cancelled'])
})
