// Task 11: 工具层纯逻辑测试——attempt 能力、worktree 路径派生、dispatch 派发泵。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readMailbox, readTeam, withTeamLock, writeTeam } from '../lib/state.js'
import { createWorktree, localShell, runGit } from '../lib/git.js'
import { registerTaskTools } from '../lib/tools/task-tools.js'
import {
  assertAttempt,
  beginTaskAttempt,
  dispatchInsideLock,
  fireWakes,
  openTaskOf,
  requeueTask,
  resetTaskWorktree,
  syncMemberStatus,
  taskBranch,
  taskCommitCwd,
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
    ctx: {
      agents: { get: () => undefined },
      logger: { warn: () => {}, info: () => {} },
      get: () => undefined, // shellAdapter 探测：无 shell 服务 → 本地兜底
    },
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

// —— 评审修复测试：I1（commit cwd 守卫）/ I2（worktree 清理）/ I4（叠单防护）——

test('taskCommitCwd guards gitWorktrees=false and members without a worktree (I1)', () => {
  const member = {
    id: 'm1', name: 'dever-1', role: 'dever', status: 'idle',
    worktreePath: '/ws/.lbx-agent-team/team1/worktrees/dever-1/t1',
    branch: 'team/team1/t1', joinedAt: 1,
  }
  // gitWorktrees=false → 共享工作树
  assert.equal(taskCommitCwd(makeConfig({ gitWorktrees: false }), member, '/ws', '/ws/.lbx-agent-team', 'team1', 't1'), '/ws')
  // 无成员（captain 任务）→ 共享工作树
  assert.equal(taskCommitCwd(makeConfig({ gitWorktrees: true }), undefined, '/ws', '/ws/.lbx-agent-team', 'team1', 't1'), '/ws')
  // 成员有 worktree → 该任务的确定性 worktree 路径
  assert.equal(
    taskCommitCwd(makeConfig({ gitWorktrees: true }), member, '/ws', '/ws/.lbx-agent-team', 'team1', 't1'),
    '/ws/.lbx-agent-team/team1/worktrees/dever-1/t1',
  )
  // 成员无 worktreePath（建 worktree 失败/非 dever）→ 共享工作树
  const bare = { id: 'm2', name: 'dever-2', role: 'dever', status: 'idle', joinedAt: 1 }
  assert.equal(taskCommitCwd(makeConfig({ gitWorktrees: true }), bare, '/ws', '/ws/.lbx-agent-team', 'team1', 't2'), '/ws')
})

test('resetTaskWorktree removes the task worktree and branch (I2)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lbx-tools-git-'))
  try {
    const repo = join(root, 'repo')
    const shell = localShell()
    await runGit(shell, root, ['init', '-b', 'main', 'repo'])
    await runGit(shell, repo, ['config', 'user.email', 't@t.t'])
    await runGit(shell, repo, ['config', 'user.name', 't'])
    await writeFile(join(repo, 'base.txt'), 'base\n')
    await runGit(shell, repo, ['add', '-A'])
    await runGit(shell, repo, ['commit', '-m', 'base'])
    const stateRoot = join(repo, '.lbx-agent-team')
    const wtPath = taskWorktreePath(stateRoot, 'team1', 'dever-1', 't1')
    const branch = taskBranch('team1', 't1')
    await createWorktree(shell, { repo, path: wtPath, branch, base: 'main' })
    const before = await runGit(shell, repo, ['branch', '--list', branch])
    assert.ok(before.stdout.includes('team1/t1'))

    const e = makeEnv(makeConfig({ gitWorktrees: true }))
    await resetTaskWorktree(e, repo, stateRoot, makeTeam(), 'dever-1', 't1')

    const after = await runGit(shell, repo, ['branch', '--list', branch])
    assert.equal(after.stdout.trim(), '')
    const exists = await access(wtPath).then(() => true).catch(() => false)
    assert.equal(exists, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('openTaskOf detects a member holding claimed/in_progress work (I4)', () => {
  const team = makeTeam({
    members: [{ id: 'm1', name: 'dever-1', role: 'dever', status: 'working', joinedAt: 1 }],
    tasks: [
      makeTask('t1', { status: 'claimed', assignee: 'dever-1' }),
      makeTask('t2', { status: 'in_progress', assignee: 'dever-2' }),
    ],
  })
  assert.equal(openTaskOf(team, 'dever-1').id, 't1')
  assert.equal(openTaskOf(team, 'dever-2').id, 't2')
  assert.equal(openTaskOf(team, 'dever-3'), undefined)
  // submitted（in_review）不再视为叠单
  const idle = makeTeam({
    tasks: [makeTask('t1', { status: 'in_review', assignee: 'dever-1' })],
  })
  assert.equal(openTaskOf(idle, 'dever-1'), undefined)
})

test('dispatchInsideLock never stacks a second task on a member with open work (I4)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lbx-tools-'))
  try {
    const stateRoot = join(root, '.lbx-agent-team')
    const workspace = root
    const team = makeTeam({
      members: [{ id: 'm1', name: 'dever-1', role: 'dever', status: 'idle', joinedAt: 1 }],
      // dever-1 已持有 t1（in_progress）；t2 就绪但不应派发给它
      tasks: [
        makeTask('t1', { status: 'in_progress', assignee: 'dever-1' }),
        makeTask('t2', { status: 'pending', assignee: 'pool' }),
      ],
      taskSeq: 2,
    })
    await writeTeam(stateRoot, team)
    const fresh = await readTeam(stateRoot, 'team1')
    const wakes = await dispatchInsideLock(makeEnv(), signal(), workspace, stateRoot, fresh)
    assert.equal(wakes.length, 0)
    assert.equal(fresh.tasks[1].status, 'pending')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('syncMemberStatus parks a member that still owns open work (I4)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lbx-tools-'))
  try {
    const stateRoot = join(root, '.lbx-agent-team')
    const workspace = root
    const team = makeTeam({
      members: [{ id: 'm1', name: 'dever-1', role: 'dever', status: 'working', joinedAt: 1 }],
      tasks: [makeTask('t1', { status: 'in_progress', assignee: 'dever-1' })],
      taskSeq: 1,
    })
    await writeTeam(stateRoot, team)
    const e = makeEnv()
    const agent = { id: 'm1', session: { header: { cwd: workspace } } }
    // turn 结束（idle），但持有 in_progress 任务 → 保持 working（parked），不派发
    await syncMemberStatus(e, agent, 'idle', workspace)
    const persisted = await readTeam(stateRoot, 'team1')
    assert.equal(persisted.members[0].status, 'working')
    assert.equal(persisted.tasks[0].status, 'in_progress')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('syncMemberStatus releases a member with no open work to idle (I4)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lbx-tools-'))
  try {
    const stateRoot = join(root, '.lbx-agent-team')
    const workspace = root
    const team = makeTeam({
      members: [{ id: 'm1', name: 'dever-1', role: 'dever', status: 'working', joinedAt: 1 }],
    })
    await writeTeam(stateRoot, team)
    const e = makeEnv()
    const agent = { id: 'm1', session: { header: { cwd: workspace } } }
    await syncMemberStatus(e, agent, 'idle', workspace)
    const persisted = await readTeam(stateRoot, 'team1')
    assert.equal(persisted.members[0].status, 'idle')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// —— fireWakes 回滚与离线耐久（复审建议的回归保护）——

/** fireWakes 专用 env：mock ctx.agents（队长在线/离线）与 ctx.subagents.followup。 */
function makeWakeEnv({ followup, captainOnline = true } = {}) {
  const captain = { id: 'captain-1' }
  return {
    ctx: {
      agents: { get: (id) => (captainOnline && id === 'captain-1' ? captain : undefined) },
      subagents: { followup: followup ?? (async () => {}) },
      logger: { warn: () => {}, info: () => {} },
      get: () => undefined,
    },
    config: makeConfig({ gitWorktrees: false, autoDispatch: false }),
  }
}

/** 落盘一个已 claim 的团队（dever-1 working、t1 claimed + attemptId）。 */
async function makeClaimedTeam(root) {
  const stateRoot = join(root, '.lbx-agent-team')
  const team = makeTeam({
    members: [{ id: 'm1', name: 'dever-1', role: 'dever', status: 'working', joinedAt: 1 }],
    tasks: [makeTask('t1')],
    taskSeq: 1,
  })
  await writeTeam(stateRoot, team)
  const fresh = await readTeam(stateRoot, 'team1')
  beginTaskAttempt(fresh.tasks[0], 'dever-1')
  await writeTeam(stateRoot, fresh)
  return { stateRoot, fresh }
}

test('fireWakes rolls back the claim when the member wake fails (attemptId match)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lbx-tools-'))
  try {
    const { stateRoot, fresh } = await makeClaimedTeam(root)
    const e = makeWakeEnv({ followup: async () => { throw new Error('wake failed') } })
    const wakes = [{ member: fresh.members[0], task: fresh.tasks[0] }]
    await fireWakes(e, signal(), stateRoot, 'team1', wakes)
    const persisted = await readTeam(stateRoot, 'team1')
    // 回滚：任务回 pending/pool、attemptId 清空、成员回 idle
    assert.equal(persisted.tasks[0].status, 'pending')
    assert.equal(persisted.tasks[0].assignee, 'pool')
    assert.equal(persisted.tasks[0].attemptId, undefined)
    assert.equal(persisted.members[0].status, 'idle')
    // 消息先落盘（耐久）
    const inbox = await readMailbox(stateRoot, 'team1', 'dever-1')
    assert.equal(inbox.length, 1)
    assert.equal(inbox[0].from, 'captain')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('fireWakes does not roll back a claim taken over concurrently (stale attemptId)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lbx-tools-'))
  try {
    const { stateRoot, fresh } = await makeClaimedTeam(root)
    // 模拟并发接管（如 reassign）：磁盘上 attemptId 已被换新
    const taken = await readTeam(stateRoot, 'team1')
    taken.tasks[0].attemptId = 't1-a2-999'
    taken.tasks[0].assignee = 'dever-2'
    taken.tasks[0].status = 'claimed'
    await writeTeam(stateRoot, taken)
    // 携带旧 attemptId 的唤醒失败 → 不得回滚（只回滚精确派发）
    const e = makeWakeEnv({ followup: async () => { throw new Error('wake failed') } })
    const wakes = [{ member: fresh.members[0], task: fresh.tasks[0] }]
    await fireWakes(e, signal(), stateRoot, 'team1', wakes)
    const persisted = await readTeam(stateRoot, 'team1')
    assert.equal(persisted.tasks[0].attemptId, 't1-a2-999')
    assert.equal(persisted.tasks[0].assignee, 'dever-2')
    assert.equal(persisted.tasks[0].status, 'claimed')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('fireWakes persists the assignment message first when the captain is offline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lbx-tools-'))
  try {
    const { stateRoot, fresh } = await makeClaimedTeam(root)
    const e = makeWakeEnv({ captainOnline: false })
    const wakes = [{ member: fresh.members[0], task: fresh.tasks[0] }]
    await fireWakes(e, signal(), stateRoot, 'team1', wakes)
    // 消息已落盘（恢复后重投）；无唤醒尝试 → 不回滚
    const inbox = await readMailbox(stateRoot, 'team1', 'dever-1')
    assert.equal(inbox.length, 1)
    assert.ok(inbox[0].content.includes('Attempt id: t1-a1-'))
    const persisted = await readTeam(stateRoot, 'team1')
    assert.equal(persisted.tasks[0].status, 'claimed')
    assert.equal(persisted.members[0].status, 'working')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// —— M2-A：captain-only cancel_task（非终态取消 / 终态拒绝 / 成员置 idle+interrupt /
//    派发泵跳过被释放成员 / dedicated worktree 清理+归档 / 非队长拒绝）——

/** 工具注册 harness：收集注册的工具，可选覆盖 ctx 服务（subagents 等）。 */
function makeToolCtx(config = makeConfig(), overrides = {}) {
  const tools = new Map()
  const ctx = {
    agents: { get: () => undefined },
    logger: { warn: () => {}, info: () => {} },
    get: () => undefined,
    tools: { register: (def) => tools.set(def.name, def) },
    ...overrides,
  }
  registerTaskTools(ctx, config)
  return { ctx, tools }
}

/** 队长 agent（session.header.cwd 指向 workspace）。 */
function makeCaptain(workspace) {
  return { id: 'captain-1', session: { header: { cwd: workspace } } }
}

/** 落盘一个团队并返回 stateRoot。 */
async function setupTeam(root, teamOverrides = {}) {
  const stateRoot = join(root, '.lbx-agent-team')
  const team = makeTeam(teamOverrides)
  await writeTeam(stateRoot, team)
  return stateRoot
}

const cancelTool = (tools) => tools.get('lbx_agent_team_cancel_task')

test('cancel_task cancels a held non-terminal task, records fields, idles and interrupts the member', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lbx-tools-'))
  try {
    const stateRoot = await setupTeam(root, {
      members: [{ id: 'm1', name: 'dever-1', role: 'dever', status: 'working', joinedAt: 1 }],
      tasks: [makeTask('t1', { status: 'in_progress', assignee: 'dever-1' })],
      taskSeq: 1,
    })
    const interrupts = []
    const { tools } = makeToolCtx(makeConfig(), {
      subagents: { interrupt: (id) => interrupts.push(String(id)) },
    })
    const result = await cancelTool(tools).execute(
      { taskId: 't1', reason: 'scope cut' },
      { agent: makeCaptain(root), signal: new AbortController().signal },
    )
    assert.equal(result.status, 'cancelled')
    assert.equal(result.worktreeRemoved, false)
    assert.equal(result.archivedDever, undefined)
    const persisted = await readTeam(stateRoot, 'team1')
    assert.equal(persisted.tasks[0].status, 'cancelled')
    assert.equal(persisted.tasks[0].cancelledBy, 'captain')
    assert.ok(typeof persisted.tasks[0].cancelledAt === 'number')
    assert.equal(persisted.tasks[0].reason, 'scope cut')
    assert.equal(persisted.members[0].status, 'idle')
    assert.deepEqual(interrupts, ['m1'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('cancel_task rejects a terminal task with the contract message', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lbx-tools-'))
  try {
    const stateRoot = await setupTeam(root, {
      tasks: [makeTask('t1', { status: 'complete' })],
      taskSeq: 1,
    })
    const { tools } = makeToolCtx()
    await assert.rejects(
      cancelTool(tools).execute(
        { taskId: 't1' },
        { agent: makeCaptain(root), signal: new AbortController().signal },
      ),
      { message: 'cannot cancel a task in status complete' },
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('cancel_task rejects a missing task with the contract message', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lbx-tools-'))
  try {
    const stateRoot = await setupTeam(root, {})
    const { tools } = makeToolCtx()
    await assert.rejects(
      cancelTool(tools).execute(
        { taskId: 't99' },
        { agent: makeCaptain(root), signal: new AbortController().signal },
      ),
      { message: 'task not found: t99' },
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('cancel_task rejects a non-captain caller (requireCaptainTeam)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lbx-tools-'))
  try {
    const stateRoot = await setupTeam(root, {
      members: [{ id: 'm1', name: 'dever-1', role: 'dever', status: 'idle', joinedAt: 1 }],
      tasks: [makeTask('t1', { status: 'in_progress', assignee: 'dever-1' })],
      taskSeq: 1,
    })
    const { tools } = makeToolCtx()
    const memberAgent = { id: 'm1', session: { header: { cwd: root } } }
    await assert.rejects(
      cancelTool(tools).execute(
        { taskId: 't1' },
        { agent: memberAgent, signal: new AbortController().signal },
      ),
      { message: 'you are not leading any active team — call lbx_agent_team_create first' },
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('cancel_task dispatches ready work to other idle devers but not to the freed member', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lbx-tools-'))
  try {
    const stateRoot = await setupTeam(root, {
      members: [
        { id: 'm1', name: 'dever-1', role: 'dever', status: 'working', joinedAt: 1 },
        { id: 'm2', name: 'dever-2', role: 'dever', status: 'idle', joinedAt: 1 },
      ],
      tasks: [
        makeTask('t1', { status: 'in_progress', assignee: 'dever-1' }),
        makeTask('t2'),
      ],
      taskSeq: 2,
    })
    const { tools } = makeToolCtx()
    await cancelTool(tools).execute(
      { taskId: 't1' },
      { agent: makeCaptain(root), signal: new AbortController().signal },
    )
    const persisted = await readTeam(stateRoot, 'team1')
    assert.equal(persisted.tasks[0].status, 'cancelled')
    // 就绪任务派发给其他 idle dever（dever-2），而非刚被释放的 dever-1
    assert.equal(persisted.tasks[1].status, 'claimed')
    assert.equal(persisted.tasks[1].assignee, 'dever-2')
    assert.equal(persisted.members[0].status, 'idle')
    assert.equal(persisted.members[1].status, 'working')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('cancel_task leaves the freed member idle with no auto-dispatch when no other dever is idle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lbx-tools-'))
  try {
    const stateRoot = await setupTeam(root, {
      members: [{ id: 'm1', name: 'dever-1', role: 'dever', status: 'working', joinedAt: 1 }],
      tasks: [
        makeTask('t1', { status: 'in_progress', assignee: 'dever-1' }),
        makeTask('t2'),
      ],
      taskSeq: 2,
    })
    const { tools } = makeToolCtx()
    await cancelTool(tools).execute(
      { taskId: 't1' },
      { agent: makeCaptain(root), signal: new AbortController().signal },
    )
    const persisted = await readTeam(stateRoot, 'team1')
    assert.equal(persisted.tasks[0].status, 'cancelled')
    assert.equal(persisted.tasks[1].status, 'pending') // 被释放成员本次被泵跳过
    assert.equal(persisted.members[0].status, 'idle')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('cancel_task removes the dedicated worktree and archives the spawned dever (real git)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lbx-tools-git-'))
  try {
    const repo = join(root, 'repo')
    const shell = localShell()
    await runGit(shell, root, ['init', '-b', 'main', 'repo'])
    await runGit(shell, repo, ['config', 'user.email', 't@t.t'])
    await runGit(shell, repo, ['config', 'user.name', 't'])
    await writeFile(join(repo, 'base.txt'), 'base\n')
    await runGit(shell, repo, ['add', '-A'])
    await runGit(shell, repo, ['commit', '-m', 'base'])
    const stateRoot = join(repo, '.lbx-agent-team')
    const wtPath = taskWorktreePath(stateRoot, 'team1', 'dever-t1', 't1')
    const branch = taskBranch('team1', 't1')
    await createWorktree(shell, { repo, path: wtPath, branch, base: 'main' })

    const interrupts = []
    await setupTeam(repo, {
      members: [{
        id: 'm1', name: 'dever-t1', role: 'dever', status: 'working', joinedAt: 1,
        worktreePath: wtPath, branch,
      }],
      tasks: [makeTask('t1', { status: 'in_progress', assignee: 'dever-t1', dedicated: true })],
      taskSeq: 1,
    })
    const config = makeConfig({ gitWorktrees: true })
    const { tools } = makeToolCtx(config, {
      subagents: { interrupt: (id) => interrupts.push(String(id)) },
    })
    const result = await cancelTool(tools).execute(
      { taskId: 't1' },
      { agent: makeCaptain(repo), signal: new AbortController().signal },
    )
    assert.equal(result.status, 'cancelled')
    assert.equal(result.worktreeRemoved, true)
    assert.equal(result.archivedDever, 'dever-t1')
    const persisted = await readTeam(stateRoot, 'team1')
    assert.equal(persisted.tasks[0].status, 'cancelled')
    assert.equal(persisted.members[0].status, 'removed')
    assert.ok(typeof persisted.members[0].retiredAt === 'number')
    assert.deepEqual(interrupts, ['m1'])
    // 真实 git：worktree 与分支都被清理
    const branchAfter = await runGit(shell, repo, ['branch', '--list', branch])
    assert.equal(branchAfter.stdout.trim(), '')
    const wtExists = await access(wtPath).then(() => true).catch(() => false)
    assert.equal(wtExists, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
