import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendMailbox, readMailbox, readTeam, sanitizeKey, withTeamLock, writeTeam } from '../lib/state.js'

let root
test.before(async () => { root = await mkdtemp(join(tmpdir(), 'lbx-state-')) })
test.after(async () => { await rm(root, { recursive: true, force: true }) })

test('sanitizeKey produces safe ids', () => {
  assert.equal(sanitizeKey('  My Team!  '), 'my-team')
  assert.equal(sanitizeKey(''), 'team')
})

test('writeTeam then readTeam round-trips', async () => {
  const team = { id: 't1', name: 'x', specPath: 's.md', captainSessionId: 'c', status: 'active', createdAt: 1, members: [], tasks: [], issues: [], taskSeq: 0, issueSeq: 0 }
  await writeTeam(root, team)
  const got = await readTeam(root, 't1')
  assert.deepEqual(got, team)
  assert.equal(await readTeam(root, 'nope'), undefined)
})

test('withTeamLock serializes concurrent writes', async () => {
  let counter = 0
  const tasks = Array.from({ length: 20 }, () =>
    withTeamLock(root, 'lock-team', async () => { counter += 1; await new Promise((r) => setTimeout(r, 1)) }))
  await Promise.all(tasks)
  assert.equal(counter, 20)
})

test('mailbox appends and reads with torn-tail tolerance', async () => {
  await appendMailbox(root, 't1', 'dever-1', { id: 'm1', from: 'captain', to: 'dever-1', content: 'go', ts: 1 })
  await appendMailbox(root, 't1', 'dever-1', { id: 'm2', from: 'captain', to: 'dever-1', content: 'again', ts: 2 })
  const msgs = await readMailbox(root, 't1', 'dever-1')
  assert.equal(msgs.length, 2)
  assert.equal(msgs[0].content, 'go')
})
