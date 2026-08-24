// Task 11: 工具层纯逻辑测试——attempt 能力、worktree 路径派生、dispatch 派发泵。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readTeam, withTeamLock, writeTeam } from '../lib/state.js'
import {
  assertAttempt,
  beginTaskAttempt,
  dispatchInsideLock,
  requeueTask,
  taskBranch,
  taskWorktreePath,
  withTeamMutation,
} from '../lib/tools/helpers.js'

function makeConfig(overrides = {}) {
  return {
    stateDir: '.lbx-agent-team',
    memberProvider: 'spawn',
    maxMembers: 12,
    maxParallelDevers: 3,
    autoRoster: true,
    autoDispatch: true,
    gitWorktrees: false,
    maxReviewLoop: 3,
    ...overrides,
  }
}

function makeEnv(config = makeConfig()) {
  return {
    ctx: { agents: { get: () => undefined }, logger: { warn: () => {} } },
    config,
  }
}

function makeTask(id, overrides = {}) {
  return {
    id,
    subject: `subject ${id}`,
    status: 'pending',
    assignee: 'pool',
    dedicated: false,
    dependencies: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function makeTeam(overrides = {}) {
  return {
    id: 'team1',
    name: 'Team One',
    specPath: 'spec.md',
    captainSessionId: 'captain-1',
    status: 'active',
    createdAt: 1,
    members: [],
    tasks: [],
    issues: [],
    taskSeq: 0,
    issueSeq: 0,
    ...overrides,
  }
}

const signal = () => new AbortController().signal

// —— worktree 路径/分支派生 ——

test('taskWorktreePath / taskBranch are deterministic per (member, task)', () => {
  assert.equal(
    taskWorktreePath('/ws/.lbx-agent-team', 'alpha', 'dever-1', 't3'),
    '/ws/.lbx-agent-team/alpha/worktrees/dever-1/t3',
  )
  assert.equal(taskBranch('alpha', 't3'), 'team/alpha/t3')
  // 同一任务不同成员 → 不同路径（无复用冲突）
  assert.notEqual(
    taskWorktreePath('/ws/.lbx-agent-team', 'alpha', 'dever-1', 't3'),
    taskWorktreePath('/ws/.lbx-agent-team', 'alpha', 'dever-2', 't3'),
  )
})

// —— attempt 能力 ——

test('beginTaskAttempt mints a fresh attemptId and marks claimed', () => {
  const task = makeTask('t1')
  const id1 = beginTaskAttempt(task, 'dever-1')
  assert.equal(task.status, 'claimed')
  assert.equal(task.assignee, 'dever-1')
  assert.equal(task.attempt, 1)
  assert.ok(id1.startsWith('t1-a1-'))
  assert.equal(task.attemptId, id1)
  const id2 = beginTaskAttempt(task, 'dever-2')
  assert.equal(task.attempt, 2)
  assert.notEqual(id2, id1)
})

test('assertAttempt rejects a stale attemptId with the exact contract message', () => {
  const task = makeTask('t1')
  const current = beginTaskAttempt(task, 'dever-1')
  assert.throws(() => assertAttempt(task, 't1-a0-0'), {
    message: 'stale attemptId — task was reassigned',
  })
  assert.throws(() => assertAttempt(task, undefined), {
    message: 'stale attemptId — task was reassigned',
  })
  // 当前 attemptId 放行
  assert.doesNotThrow(() => assertAttempt(task, current))
  // 任务无 attemptId（从未 claim）时不做校验
  const bare = makeTask('t2')
  assert.doesNotThrow(() => assertAttempt(bare, undefined))
})

test('requeueTask returns a task to the shared pool and invalidates the attempt', () => {
  const task = makeTask('t1')
  beginTaskAttempt(task, 'dever-1')
  requeueTask(task)
  assert.equal(task.status, 'pending')
  assert.equal(task.assignee, 'pool')
  assert.equal(task.attemptId, undefined)
  assert.equal(task.dedicated, false)
})

// —— dispatch 派发泵 ——

test('dispatchInsideLock claims a ready pool task for an idle dever and persists', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lbx-tools-'))
  try {
    const stateRoot = join(root, '.lbx-agent-team')
    const workspace = root
    const team = makeTeam({
      members: [{ id: 'm1', name: 'dever-1', role: 'dever', status: 'idle', joinedAt: 1 }],
      tasks: [makeTask('t1')],
      taskSeq: 1,
    })
    await writeTeam(stateRoot, team)
    const fresh = await readTeam(stateRoot, 'team1')
    const e = makeEnv()
    let wakes
    await withTeamLock(stateRoot, 'team1', async () => {
      wakes = await dispatchInsideLock(e, signal(), workspace, stateRoot, fresh)
    })
    assert.equal(fresh.tasks[0].status, 'claimed')
    assert.equal(fresh.tasks[0].assignee, 'dever-1')
    assert.ok(fresh.tasks[0].attemptId)
    assert.equal(fresh.members[0].status, 'working')
    assert.equal(wakes.length, 1)
    assert.equal(wakes[0].member.name, 'dever-1')
    // 持久化
    const persisted = await readTeam(stateRoot, 'team1')
    assert.equal(persisted.tasks[0].status, 'claimed')
    assert.equal(persisted.tasks[0].attemptId, fresh.tasks[0].attemptId)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('dispatchInsideLock never claims a task with unfinished dependencies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lbx-tools-'))
  try {
    const stateRoot = join(root, '.lbx-agent-team')
    const workspace = root
    const team = makeTeam({
      members: [{ id: 'm1', name: 'dever-1', role: 'dever', status: 'idle', joinedAt: 1 }],
      // t1 已 claimed（不可再领）；t2 依赖 t1（未 complete）→ 阻塞
      tasks: [makeTask('t1', { status: 'claimed', assignee: 'dever-1' }), makeTask('t2', { dependencies: ['t1'] })],
      taskSeq: 2,
    })
    await writeTeam(stateRoot, team)
    const fresh = await readTeam(stateRoot, 'team1')
    const wakes = await dispatchInsideLock(makeEnv(), signal(), workspace, stateRoot, fresh)
    assert.equal(wakes.length, 0)
    assert.equal(fresh.tasks[0].status, 'claimed') // t1 已领取，不被重领
    assert.equal(fresh.tasks[1].status, 'pending') // t2 依赖未完成，不被派发
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('dispatchInsideLock is a no-op when autoDispatch is off', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lbx-tools-'))
  try {
    const stateRoot = join(root, '.lbx-agent-team')
    const workspace = root
    const team = makeTeam({
      members: [{ id: 'm1', name: 'dever-1', role: 'dever', status: 'idle', joinedAt: 1 }],
      tasks: [makeTask('t1')],
      taskSeq: 1,
    })
    await writeTeam(stateRoot, team)
    const fresh = await readTeam(stateRoot, 'team1')
    const wakes = await dispatchInsideLock(
      makeEnv(makeConfig({ autoDispatch: false })),
      signal(), workspace, stateRoot, fresh,
    )
    assert.equal(wakes.length, 0)
    assert.equal(fresh.tasks[0].status, 'pending')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('withTeamMutation runs the mutation then dispatches (create_task trigger)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lbx-tools-'))
  try {
    const stateRoot = join(root, '.lbx-agent-team')
    const workspace = root
    const team = makeTeam({
      members: [{ id: 'm1', name: 'dever-1', role: 'dever', status: 'idle', joinedAt: 1 }],
    })
    await writeTeam(stateRoot, team)
    const e = makeEnv()
    const result = await withTeamMutation(e, signal(), workspace, stateRoot, 'team1', async (fresh) => {
      const task = makeTask('t1')
      fresh.tasks.push(task)
      fresh.taskSeq = 1
      await writeTeam(stateRoot, fresh)
      return { result: { taskId: task.id } }
    })
    assert.equal(result.taskId, 't1')
    const persisted = await readTeam(stateRoot, 'team1')
    // 新创建的池任务被自动派发给 idle dever（fireWakes 因无 live captain 跳过，但状态已迁移）
    assert.equal(persisted.tasks[0].status, 'claimed')
    assert.equal(persisted.tasks[0].assignee, 'dever-1')
    assert.equal(persisted.members[0].status, 'working')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
