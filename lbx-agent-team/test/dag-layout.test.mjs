import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dagDepths, orderedDagEntries } from '../lib/client/dag-layout.js'

/** Minimal task row matching the subset dag-layout reads (id + dependencies). */
function task(id, dependencies = []) {
  return { id, subject: id, status: 'pending', assignee: '', dependencies }
}

test('dagDepths: tasks without dependencies sit at depth 0', () => {
  const tasks = [task('a'), task('b'), task('c')]
  const depths = dagDepths(tasks)
  assert.deepEqual(tasks.map((t) => depths.get(t.id)), [0, 0, 0])
})

test('dagDepths: multi-level chains accumulate depth', () => {
  const tasks = [
    task('a'),
    task('b', ['a']),
    task('c', ['b']),
    task('d', ['c']),
    // e fans in from both a (depth 0) and c (depth 2) — takes the longest chain.
    task('e', ['a', 'c']),
  ]
  const depths = dagDepths(tasks)
  assert.deepEqual(
    tasks.map((t) => depths.get(t.id)),
    [0, 1, 2, 3, 3],
  )
})

test('dagDepths: a missing dependency contributes zero depth', () => {
  const tasks = [task('b', ['ghost'])]
  const depths = dagDepths(tasks)
  // The absent dependency is treated as an already-satisfied root: it adds
  // nothing beyond its own edge, and never appears in the result map.
  assert.equal(depths.get('b'), 1)
  assert.equal(depths.has('ghost'), false)
})

test('dagDepths: self and multi-task cycles stay bounded', () => {
  const self = dagDepths([task('a', ['a'])])
  assert.equal(self.get('a'), 1)

  const pair = dagDepths([task('x', ['y']), task('y', ['x'])])
  assert.equal(pair.get('x'), 2)
  assert.equal(pair.get('y'), 1)
})

test('orderedDagEntries: depth is the primary sort key, roots first', () => {
  const tasks = [task('d', ['c']), task('a'), task('b'), task('c', ['b'])]
  const entries = orderedDagEntries(tasks)
  assert.deepEqual(
    entries.map((entry) => [entry.task.id, entry.depth]),
    [['a', 0], ['b', 0], ['c', 1], ['d', 2]],
  )
})

test('orderedDagEntries: same-depth ids sort in numeric natural order (task-2 < task-10)', () => {
  const tasks = [task('task-10'), task('task-2')]
  const entries = orderedDagEntries(tasks)
  assert.deepEqual(
    entries.map((entry) => entry.task.id),
    ['task-2', 'task-10'],
  )
})

test('orderedDagEntries: sort is deterministic for a fixed input', () => {
  const tasks = [task('z', ['m']), task('m'), task('a', ['m'])]
  const first = orderedDagEntries(tasks).map((entry) => entry.task.id)
  const second = orderedDagEntries(tasks).map((entry) => entry.task.id)
  assert.deepEqual(first, second)
  assert.deepEqual(first, ['m', 'a', 'z'])
})
