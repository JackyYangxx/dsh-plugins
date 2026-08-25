import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendMailbox, readMailbox, readTeam, sanitizeKey, withTeamLock, writeTeam } from '../lib/state.js'

let root
test.before(async () => { root = await mkdtemp(join(tmpdir(), 'lbx-state-')) })
test.after(async () => { await rm(root, { recursive: true, force: true }) })

test('sanitizeKey produces safe ids', () => {
  assert.equal(sanitizeKey('  My Team!  '), 'my-team')
  assert.notEqual(sanitizeKey('小王'), sanitizeKey('小李'))
  assert.equal(sanitizeKey('..').startsWith('..'), false)
  assert.ok(sanitizeKey('').startsWith('team-'))
})

test('writeTeam then readTeam round-trips', async () => {
  const team = { id: 't1', name: 'x', specPath: 's.md', captainSessionId: 'c', status: 'active', createdAt: 1, members: [], tasks: [], issues: [], taskSeq: 0, issueSeq: 0 }
  await writeTeam(root, team)
  const got = await readTeam(root, 't1')
  assert.deepEqual(got, team)
  assert.equal(await readTeam(root, 'nope'), undefined)
})

test('readTeam rethrows on corrupt JSON instead of hiding it', async () => {
  await mkdir(join(root, 'corrupt'))
  await writeFile(join(root, 'corrupt', 'team.json'), '{ not json')
  await assert.rejects(() => readTeam(root, 'corrupt'), SyntaxError)
})

let active = 0
let maxActive = 0

test('withTeamLock serializes concurrent writes', async () => {
  const tasks = Array.from({ length: 20 }, () =>
    withTeamLock(root, 'lock-team', async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 1))
      active -= 1
    }))
  await Promise.all(tasks)
  assert.equal(maxActive, 1)
  assert.equal(active, 0)
})

test('withTeamLock releases the lock after a throwing fn', async () => {
  let releaseEntered
  const entered = new Promise((r) => { releaseEntered = r })
  const first = withTeamLock(root, 'lock-throw', async () => {
    releaseEntered()
    throw new Error('boom')
  })
  await entered
  const result = await withTeamLock(root, 'lock-throw', async () => 'ok')
  await assert.rejects(first, /boom/)
  assert.equal(result, 'ok')
})

test('mailbox appends and reads with torn-tail tolerance', async () => {
  await appendMailbox(root, 't1', 'dever-1', { id: 'm1', from: 'captain', to: 'dever-1', content: 'go', ts: 1 })
  await appendMailbox(root, 't1', 'dever-1', { id: 'm2', from: 'captain', to: 'dever-1', content: 'again', ts: 2 })
  const msgs = await readMailbox(root, 't1', 'dever-1')
  assert.equal(msgs.length, 2)
  assert.equal(msgs[0].content, 'go')
})
