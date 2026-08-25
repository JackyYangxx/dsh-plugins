import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TERMINAL_TASK_STATUSES,
  actionButtonsFor,
  buildActionMessage,
  isTerminalTaskStatus,
} from '../lib/client/action-messages.js'

test('TERMINAL_TASK_STATUSES mirrors the host terminal set', () => {
  assert.deepEqual([...TERMINAL_TASK_STATUSES].sort(), ['cancelled', 'complete', 'failed'])
})

test('isTerminalTaskStatus classifies terminal and live statuses', () => {
  for (const status of ['complete', 'failed', 'cancelled']) {
    assert.equal(isTerminalTaskStatus(status), true, status)
  }
  for (const status of ['pending', 'claimed', 'in_progress', 'in_review', 'approved', 'committed', 'tested', 'changes_requested']) {
    assert.equal(isTerminalTaskStatus(status), false, status)
  }
})

test('actionButtonsFor offers no actions on complete tasks', () => {
  assert.deepEqual(actionButtonsFor('complete'), [])
})

test('actionButtonsFor offers retry-only reassign on failed/cancelled tasks', () => {
  // The pipeline has no cancel transition from failed/cancelled, but
  // lbx_agent_team_reassign_task retries them — so only reassign shows.
  for (const status of ['failed', 'cancelled']) {
    assert.deepEqual(actionButtonsFor(status), ['reassign'], status)
  }
})

test('actionButtonsFor offers reassign+cancel on live statuses', () => {
  for (const status of ['pending', 'claimed', 'in_progress', 'in_review', 'approved', 'committed', 'changes_requested']) {
    assert.deepEqual(actionButtonsFor(status), ['reassign', 'cancel'], status)
  }
})

test('actionButtonsFor puts complete first on tested tasks', () => {
  assert.deepEqual(actionButtonsFor('tested'), ['complete', 'reassign', 'cancel'])
})

test('actionButtonsFor is defensive about unknown statuses (treated as live)', () => {
  // A host status this client has not seen yet must still allow captain
  // cancel/reassign rather than hiding all controls.
  assert.deepEqual(actionButtonsFor('future_status'), ['reassign', 'cancel'])
})

test('buildActionMessage is never a /lbx-agent-team gesture line', () => {
  // The command gesture boundary (command.ts GESTURE) requires a leading
  // slash; the injected directive must never trip the team-activation path.
  for (const action of ['cancel', 'complete', 'reassign']) {
    const message = buildActionMessage(action, 't3', 'Demo Team')
    assert.ok(!message.startsWith('/lbx-agent-team'), `${action} message must not be a gesture line`)
    assert.ok(message.startsWith('[lbx-agent-team action:'), `${action} message carries the action marker`)
  }
})

test('buildActionMessage cancel names the cancel tool and the task', () => {
  const message = buildActionMessage('cancel', 't3', 'Demo Team')
  assert.ok(message.includes('lbx_agent_team_cancel_task'))
  assert.ok(message.includes('taskId="t3"'))
  assert.ok(message.includes('Demo Team'))
  assert.ok(message.includes('[lbx-agent-team action: cancel]'))
})

test('buildActionMessage complete instructs update_task done=true on the tested task', () => {
  const message = buildActionMessage('complete', 't7', 'Demo Team')
  assert.ok(message.includes('lbx_agent_team_update_task'))
  assert.ok(message.includes('taskId="t7"'))
  assert.ok(message.includes('done=true'))
  // The captain needs the current attempt_id to complete a member-owned
  // tested task; the directive points at lbx_agent_team_status for it.
  assert.ok(message.includes('attempt_id'))
  assert.ok(message.includes('lbx_agent_team_status'))
})

test('buildActionMessage reassign defaults to the shared pool', () => {
  const message = buildActionMessage('reassign', 't3', 'Demo Team')
  assert.ok(message.includes('lbx_agent_team_reassign_task'))
  assert.ok(message.includes('taskId="t3"'))
  assert.ok(message.includes('to="pool"'))
})

test('buildActionMessage reassign honours an explicit target', () => {
  const message = buildActionMessage('reassign', 't3', 'Demo Team', { to: 'planner' })
  assert.ok(message.includes('to="planner"'))
})
