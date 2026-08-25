import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ACTIVITY_POLL_MS,
  ACTIVITY_PROBE_MS,
  ACTIVITY_STATE_URL,
  discoveryTeamKeys,
  getActivityMonitorTargetsSnapshot,
  getActivitySnapshotsSnapshot,
  missingMonitorTargets,
  monitorAgentTeam,
  parseActivityState,
  settleActivityMonitorTargets,
  startActivityPolling,
  subscribeActivityMonitorTargets,
  subscribeActivitySnapshots,
  updateActivitySnapshots,
} from '../lib/client/activity-monitor.js'

/** Minimal host-shaped snapshot for a team. */
function team(id, overrides = {}) {
  return {
    workspace: 'ws',
    teamId: id,
    name: id,
    captainSessionId: 'captain-session',
    status: 'active',
    createdAt: 1,
    members: [],
    tasks: [],
    issues: [],
    ...overrides,
  }
}

const target = (sessionId, teamId) => ({ key: `${sessionId}\u0000${teamId}`, sessionId, teamId })

// ── Pure shape validation ──────────────────────────────────────────────
test('parseActivityState accepts a teams array and rejects malformed payloads', () => {
  const good = [team('a'), team('b')]
  assert.deepEqual(parseActivityState({ teams: good }), good)
  assert.deepEqual(parseActivityState({ teams: [] }), [])
  assert.equal(parseActivityState(null), null)
  assert.equal(parseActivityState(undefined), null)
  assert.equal(parseActivityState('nope'), null)
  assert.equal(parseActivityState({}), null)
  assert.equal(parseActivityState({ teams: 'nope' }), null)
  assert.equal(parseActivityState({ teams: { 0: team('a') } }), null)
})

// ── Pure target selection ──────────────────────────────────────────────
test('missingMonitorTargets selects targets absent from the live snapshot', () => {
  const live = [team('t1', { captainSessionId: 's1' }), team('t2', { captainSessionId: 's2' })]
  const targets = [target('s1', 't1'), target('s2', 't2'), target('s1', 'gone')]
  assert.deepEqual(missingMonitorTargets(targets, live), [targets[2]])
  assert.deepEqual(missingMonitorTargets([], live), [])
  assert.deepEqual(missingMonitorTargets(targets, []), targets)
})

test('discoveryTeamKeys picks live teams captained by the discovery session', () => {
  const live = [
    team('a', { captainSessionId: 'sess' }),
    team('b', { captainSessionId: 'other' }),
    team('c', { captainSessionId: 'sess' }),
  ]
  assert.deepEqual([...discoveryTeamKeys(live, 'sess')].sort(), ['a', 'c'])
  assert.deepEqual([...discoveryTeamKeys(live, undefined)], [])
  assert.deepEqual([...discoveryTeamKeys(live, '  ')], [])
  assert.deepEqual([...discoveryTeamKeys([], 'sess')], [])
})

// ── Monitor-target registry (module state, React external-store shape) ─
test('monitorAgentTeam reference-counts targets and notifies listeners', () => {
  const seen = []
  const unsubscribe = subscribeActivityMonitorTargets(() => {
    seen.push(getActivityMonitorTargetsSnapshot().map((t) => t.teamId))
  })
  const release1 = monitorAgentTeam('sess', 'team-1')
  const release2 = monitorAgentTeam('sess', 'team-1')
  assert.deepEqual(getActivityMonitorTargetsSnapshot().map((t) => t.teamId), ['team-1'])
  assert.deepEqual(seen.at(-1), ['team-1'])
  release1()
  assert.deepEqual(getActivityMonitorTargetsSnapshot().map((t) => t.teamId), ['team-1'])
  release2()
  assert.deepEqual(getActivityMonitorTargetsSnapshot(), [])
  release2() // idempotent cleanup
  assert.deepEqual(getActivityMonitorTargetsSnapshot(), [])
  unsubscribe()
})

test('monitorAgentTeam ignores blank ids and settle deactivates only listed targets', () => {
  assert.equal(monitorAgentTeam('  ', '')(), undefined)
  const releaseA = monitorAgentTeam('s1', 't-a')
  const releaseB = monitorAgentTeam('s2', 't-b')
  settleActivityMonitorTargets(new Set(['s1\u0000t-a']))
  assert.deepEqual(getActivityMonitorTargetsSnapshot().map((t) => t.teamId), ['t-b'])
  // Re-registering a settled target reactivates it (StrictMode-safe);
  // the Map keeps insertion order, so t-a stays first.
  const releaseAgain = monitorAgentTeam('s1', 't-a')
  assert.deepEqual(getActivityMonitorTargetsSnapshot().map((t) => t.teamId), ['t-a', 't-b'])
  releaseA()
  releaseB()
  releaseAgain()
  assert.deepEqual(getActivityMonitorTargetsSnapshot(), [])
})

// ── Shared snapshot store ──────────────────────────────────────────────
test('updateActivitySnapshots publishes and keeps the last good snapshot', () => {
  assert.deepEqual(getActivitySnapshotsSnapshot(), { teams: [], archivedTeams: [] })
  let calls = 0
  const unsubscribe = subscribeActivitySnapshots(() => { calls += 1 })
  updateActivitySnapshots({ teams: [team('a')] })
  assert.equal(calls, 1)
  assert.equal(getActivitySnapshotsSnapshot().teams.length, 1)
  updateActivitySnapshots({}) // no-op keeps the same references, no notify
  assert.equal(calls, 1)
  updateActivitySnapshots({ archivedTeams: [team('gone')] })
  assert.equal(calls, 2)
  assert.equal(getActivitySnapshotsSnapshot().teams.length, 1)
  assert.equal(getActivitySnapshotsSnapshot().archivedTeams.length, 1)
  unsubscribe()
})

// ── Poll controller (injected runtime: no real timers / network) ───────
function makeHarness(overrides = {}) {
  const published = []
  const settled = []
  const fetchCalls = []
  const scheduleMs = []
  let scheduledCb = undefined
  const runtime = {
    fetchState: (url) => {
      fetchCalls.push(url)
      return Promise.resolve({ ok: true, json: async () => ({ teams: [] }) })
    },
    schedule: (cb, ms) => { scheduleMs.push(ms); scheduledCb = cb; return { ms } },
    cancel: () => {},
    publishSnapshots: (update) => { published.push(update) },
    settleTargets: (keys) => { settled.push([...keys]) },
    ...overrides,
  }
  return { published, settled, fetchCalls, scheduleMs, fire: () => scheduledCb?.(), runtime }
}

test('startActivityPolling is inert without targets and discovery', async () => {
  let scheduled = false
  const controller = startActivityPolling([], {
    fetchState: () => { throw new Error('must not fetch') },
    schedule: () => { scheduled = true },
  })
  await controller.firstTick
  controller.stop()
  assert.equal(scheduled, false)
})

test('explicit targets poll at the live cadence and publish the live snapshot', async () => {
  const live = [team('t1', { captainSessionId: 's1' })]
  const harness = makeHarness({
    fetchState: (url) => {
      harness.fetchCalls.push(url)
      return Promise.resolve({ ok: true, json: async () => ({ teams: live }) })
    },
  })
  const controller = startActivityPolling([target('s1', 't1')], harness.runtime)
  await controller.firstTick
  assert.deepEqual(harness.scheduleMs, [ACTIVITY_POLL_MS])
  assert.deepEqual(harness.fetchCalls, [ACTIVITY_STATE_URL])
  assert.deepEqual(harness.published, [{ teams: live }])
  controller.stop()
})

test('in-flight guard: a tick while one is pending starts no second request', async () => {
  let resolveLive
  let scheduledCb = undefined
  const fetchCalls = []
  const controller = startActivityPolling([target('s1', 't1')], {
    fetchState: (url) => {
      fetchCalls.push(url)
      return new Promise((resolve) => { resolveLive = resolve })
    },
    schedule: (cb) => { scheduledCb = cb; return {} },
    cancel: () => {},
  })
  scheduledCb() // second tick while the first is still in flight
  assert.equal(fetchCalls.length, 1)
  resolveLive({ ok: false, json: async () => ({}) })
  await controller.firstTick
  assert.equal(fetchCalls.length, 1) // failed tick: no retry, no publish
  controller.stop()
  scheduledCb() // after stop the timer callback is dead
  assert.equal(fetchCalls.length, 1)
})

test('a failed tick publishes nothing and the next tick recovers', async () => {
  const live = [team('t1', { captainSessionId: 's1' })]
  const responses = [
    { ok: false, json: async () => ({}) },
    { ok: true, json: async () => ({ teams: live }) },
  ]
  const harness = makeHarness({
    fetchState: () => Promise.resolve(responses.shift() ?? { ok: true, json: async () => ({ teams: [] }) }),
  })
  const controller = startActivityPolling([target('s1', 't1')], harness.runtime)
  await controller.firstTick
  assert.deepEqual(harness.published, []) // failed tick keeps the last snapshot
  harness.fire() // next tick recovers
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(harness.published, [{ teams: live }])
  controller.stop()
})

test('malformed-only responses never publish (shape validation drops)', async () => {
  const published = []
  const controller = startActivityPolling([target('s1', 't1')], {
    fetchState: async () => ({ ok: true, json: async () => ({ teams: 'nope' }) }),
    schedule: () => {},
    cancel: () => {},
    publishSnapshots: (update) => { published.push(update) },
  })
  await controller.firstTick
  assert.deepEqual(published, []) // malformed response discarded, snapshot kept
  controller.stop()
})

test('a missing monitored team triggers the archive fetch and settles the target', async () => {
  const harness = makeHarness() // default live body { teams: [] }
  const controller = startActivityPolling([target('s1', 'gone')], harness.runtime)
  await controller.firstTick
  assert.deepEqual(harness.fetchCalls, [ACTIVITY_STATE_URL, `${ACTIVITY_STATE_URL}?archived=1`])
  assert.deepEqual(harness.published, [{ teams: [] }, { archivedTeams: [] }])
  assert.deepEqual(harness.settled, [['s1\u0000gone']])
  controller.stop()
})

test('a live target present skips the archive fetch entirely', async () => {
  const live = [team('t1', { captainSessionId: 's1' })]
  const harness = makeHarness({
    fetchState: (url) => {
      harness.fetchCalls.push(url)
      return Promise.resolve({ ok: true, json: async () => ({ teams: live }) })
    },
  })
  const controller = startActivityPolling([target('s1', 't1')], harness.runtime)
  await controller.firstTick
  assert.deepEqual(harness.fetchCalls, [ACTIVITY_STATE_URL])
  assert.deepEqual(harness.published, [{ teams: live }])
  assert.deepEqual(harness.settled, [])
  controller.stop()
})

test('discovery session probes low-frequency, then upgrades to the live cadence', async () => {
  const discovered = [team('dt', { captainSessionId: 'sess' })]
  const responses = [
    { ok: true, json: async () => ({ teams: [] }) },          // tick 1 live
    { ok: true, json: async () => ({ teams: [] }) },          // tick 1 archived (restore pass)
    { ok: true, json: async () => ({ teams: discovered }) },  // tick 2 live: discovery found
  ]
  const harness = makeHarness({
    discoverySessionId: 'sess',
    fetchState: () => Promise.resolve(responses.shift() ?? { ok: true, json: async () => ({ teams: [] }) }),
  })
  const controller = startActivityPolling([], harness.runtime)
  await controller.firstTick
  assert.deepEqual(harness.scheduleMs, [ACTIVITY_PROBE_MS])
  harness.fire() // tick 2 — discovers the team and upgrades
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(harness.scheduleMs, [ACTIVITY_PROBE_MS, ACTIVITY_POLL_MS])
  assert.deepEqual(harness.published.at(-1), { teams: discovered })
  controller.stop()
})
