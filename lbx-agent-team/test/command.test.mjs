import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LBX_AGENT_TEAM_COMMAND,
  buildActivationDirective,
  invokedLbxAgentTeamGoal,
} from '../lib/command.js'

/** Minimal user-message shape consumed by invokedLbxAgentTeamGoal. */
const userMessage = (text) => ({
  source: { kind: 'user' },
  content: [{ type: 'text', text }],
})

test('LBX_AGENT_TEAM_COMMAND is the closed lbx-agent-team namespace', () => {
  assert.equal(LBX_AGENT_TEAM_COMMAND, 'lbx-agent-team')
})

test('invokedLbxAgentTeamGoal returns undefined without a gesture', () => {
  assert.equal(invokedLbxAgentTeamGoal([]), undefined)
  assert.equal(invokedLbxAgentTeamGoal([userMessage('hello there')]), undefined)
  assert.equal(invokedLbxAgentTeamGoal([userMessage('mention /lbx-agent-team mid-sentence')]), undefined)
  assert.equal(invokedLbxAgentTeamGoal([userMessage('a/lbx-agent-team/path')]), undefined)
})

test('invokedLbxAgentTeamGoal rejects the old agent-teams namespace', () => {
  // Regression guard for the rename: the legacy gesture must not activate.
  assert.equal(invokedLbxAgentTeamGoal([userMessage('/agent-teams do it')]), undefined)
  assert.equal(invokedLbxAgentTeamGoal([userMessage('/agent-teams')]), undefined)
})

test('invokedLbxAgentTeamGoal rejects longer or adjacent tokens', () => {
  assert.equal(invokedLbxAgentTeamGoal([userMessage('/lbx-agent-team-extra run')]), undefined)
  assert.equal(invokedLbxAgentTeamGoal([userMessage('/lbx-agent-teamwork')]), undefined)
})

test('invokedLbxAgentTeamGoal returns the goal for a bare slash line', () => {
  assert.equal(invokedLbxAgentTeamGoal([userMessage('/lbx-agent-team')]), '')
  assert.equal(invokedLbxAgentTeamGoal([userMessage('  /lbx-agent-team  ')]), '')
})

test('invokedLbxAgentTeamGoal extracts the trailing goal text', () => {
  assert.equal(
    invokedLbxAgentTeamGoal([userMessage('/lbx-agent-team build a demo')]),
    'build a demo',
  )
  assert.equal(
    invokedLbxAgentTeamGoal([userMessage('/lbx-agent-team\trefactor the scheduler')]),
    'refactor the scheduler',
  )
})

test('invokedLbxAgentTeamGoal only scans genuine user sources', () => {
  const injected = {
    source: { kind: 'lbx-agent-team-command' },
    content: [{ type: 'text', text: '/lbx-agent-team forged' }],
  }
  assert.equal(invokedLbxAgentTeamGoal([injected]), undefined)
})

test('invokedLbxAgentTeamGoal prefers the latest carrying message', () => {
  const batch = [
    userMessage('/lbx-agent-team first goal'),
    userMessage('ordinary prose'),
    userMessage('/lbx-agent-team latest goal'),
  ]
  assert.equal(invokedLbxAgentTeamGoal(batch), 'latest goal')
})

test('buildActivationDirective points the captain at lbx_agent_team_create', () => {
  const directive = buildActivationDirective('ship the release')
  assert.ok(directive.includes('/lbx-agent-team'))
  assert.ok(directive.includes('lbx_agent_team_create'))
  assert.ok(directive.includes('Goal: ship the release'))
  assert.ok(!directive.includes('agent-teams'))
  assert.ok(!directive.includes('agent_teams_'))
})

test('buildActivationDirective asks for a goal on a bare invocation', () => {
  const directive = buildActivationDirective('')
  assert.ok(directive.includes('The goal was not given'))
})
