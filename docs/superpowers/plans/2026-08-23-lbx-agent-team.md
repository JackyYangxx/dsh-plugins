# LBX Agent Team 插件实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 `lbx-agent-team` DSH 原生插件：coordinator（主会话）驱动的多智能体开发团队（planner/checker/dever/tester），带 pipeline 状态机硬门、git worktree 隔离、懒创建成员子代理、markdown 工件与 Web 活动面板。

**Architecture:** Cordis 双面插件（host + client）。host 注册 `lbx_agent_team_*` 工具、system prompt 协议段、`/lbx-agent-team` slash 命令与 `/plugins/lbx-agent-team/*` HTTP 路由；状态以 JSON 落盘 `<workspace>/.lbx-agent-team/<teamId>/`（原子写 + 进程内锁 + 邮箱），pipeline 状态机由 `pipeline.ts` 纯函数强制门控。成员为可续聊子代理（懒 spawn），dedicated dever 在独立 git worktree 分支工作，完成后合并回主线。client 为 React 活动面板（tsdown client bundle）。

**Tech Stack:** TypeScript (NodeNext, strict) · Cordis `@deepseek-ai/cordis` · `@deepseek-ai/dsh-tools` (defineTool) · `@deepseek-ai/schemastery` (z) · `@deepseek-ai/dsh-subagent` (continuable children) · node:test（单元测试）· tsdown + lightningcss（client bundle）· React 18

**依据文档：** `docs/superpowers/specs/2026-08-23-lbx-agent-team-design.md`（下称 spec）

**参考实现：** Task 1 克隆 `https://github.com/NanmiCoder/dsh-agent-teams` 到 `/tmp/dsh-agent-teams`。凡标"照参考"的任务，先读参考对应文件再动手；所有名字按本计划改名（`agent_teams_*` → `lbx_agent_team_*`、`agent-teams` → `lbx-agent-team`、`.agent-teams` → `.lbx-agent-team`）。

**范围：** 本计划覆盖 spec §15 的 M1（host 核心 + client 面板 + 验证 + 分发）。M2（开发 skill 打包、面板交互增强、多团队视图）不在本计划。

---

## 文件结构（锁定分解）

```
lbx-agent-team/
├── package.json / cordis.patch.yml / tsconfig.json / tsconfig.client.json / tsdown.config.ts / .gitignore
├── src/
│   ├── index.ts        # 入口：inject、Config、system prompt 段、HTTP 路由、注册工具/命令
│   ├── config.ts       # Config schema（z）
│   ├── types.ts        # TeamState/TeamMember/TeamTask/TeamIssue 等纯类型
│   ├── pipeline.ts     # 状态机迁移表 + 硬门校验（纯函数，可单测）
│   ├── state.ts        # JSON 持久化 + 进程内锁 + 邮箱（原子写、no-clobber、torn-tail）
│   ├── git.ts          # shell 适配 + worktree/commit/merge 辅助
│   ├── roles.ts        # 角色预设 prompt（planner/checker/tester/dever）
│   ├── members.ts      # 成员子代理生命周期（懒 spawn/followup/interrupt）+ worktree 挂接
│   ├── scheduler.ts    # pool dever 自动领任务（autoDispatch）
│   ├── artifacts.ts    # markdown 工件生成（确定性纯函数）
│   ├── tools.ts        # 16 个 lbx_agent_team_* 工具注册
│   ├── command.ts      # /lbx-agent-team slash 命令 + 手势边界
│   └── client/
│       ├── index.tsx   # client 入口（slots 注册）
│       ├── TeamPanel.tsx / Roster.tsx / TaskList.tsx / DagView.tsx / Issues.tsx
│       ├── activity-model.ts   # 纯投影函数（状态 → 面板视图）
│       ├── activity-monitor.ts # 轮询 host 状态路由
│       ├── locales.ts  # 中英文案
│       └── *.module.css
├── test/               # node:test 单元测试（*.test.mjs，对 lib/ 运行）
│   ├── pipeline.test.mjs
│   ├── state.test.mjs
│   ├── git.test.mjs
│   └── artifacts.test.mjs
├── scripts/verify-composition.mjs   # scratch profile 组合验证
└── docs/README.md 等
```

---

## 阶段 0：脚手架与参考基线

### Task 1: 克隆并验证参考实现可构建

**Files:**
- 操作：`/tmp/dsh-agent-teams`（参考仓库，只读）

- [ ] **Step 1: 克隆参考仓库**

```bash
git clone --depth 1 https://github.com/NanmiCoder/dsh-agent-teams.git /tmp/dsh-agent-teams
```
Expected: 克隆成功，`/tmp/dsh-agent-teams/src/` 存在。

- [ ] **Step 2: 安装并构建参考实现（确认环境依赖可用）**

```bash
cd /tmp/dsh-agent-teams && pnpm install && pnpm build
```
Expected: 构建成功，生成 `lib/`。若 pnpm 版本不兼容报 engines 错误，按提示切换 Node ≥22.19。

- [ ] **Step 3: 通读参考关键文件（后续任务的基础）**

读这些文件并记录要点：`src/index.ts`（入口/inject/路由）、`src/tools.ts`（defineTool 用法）、`src/state.ts`（持久化/锁/邮箱）、`src/members.ts`（spawn/followup）、`src/scheduler.ts`、`src/command.ts`（slash 命令）、`tsdown.config.ts`、`src/client/index.tsx`（client 入口）。
Expected: 对每个文件能说出：它导出什么、注入哪些 service、生命周期资源如何 dispose。

- [ ] **Step 4: 记录基线提交**

```bash
cd /tmp/dsh-agent-teams && git rev-parse HEAD
```
把输出记到本计划开头（后续任务引用该 commit 的代码行号以它为准）。

- [ ] **Step 5: 提交脚手架决策**

```bash
cd /Users/fxy/Documents/dsh-workspace/dsh-plugins && git status --short
```
Expected: 工作树干净（无未提交改动）。本任务不产生代码。

### Task 2: 创建 lbx-agent-team 包脚手架

**Files:**
- Create: `package.json`、`cordis.patch.yml`、`tsconfig.json`、`tsconfig.client.json`、`tsdown.config.ts`、`.gitignore`、`src/config.ts`（空 Config 先注册）、`src/index.ts`（最小可加载入口）

- [ ] **Step 1: 建目录并写 package.json**

```bash
mkdir -p lbx-agent-team/src/client lbx-agent-team/test lbx-agent-team/scripts lbx-agent-team/docs
```

`lbx-agent-team/package.json`（照参考 `/tmp/dsh-agent-teams/package.json`，改名 + 改描述；peer/dev 依赖版本与其一致）：

```jsonc
{
  "name": "lbx-agent-team",
  "version": "0.1.0",
  "description": "LBX Agent Team for DeepSeek Harness: coordinator-led multi-agent dev team (planner/checker/dever/tester) with pipeline hard gates, git worktree isolation and a web activity panel",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "files": ["lib", "assets", "cordis.patch.yml", "README.md", "README_ZH.md"],
  "engines": { "node": "^22.19.0 || >=24" },
  "license": "MIT",
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "inject": [
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-conversation",
        "@deepseek-ai/dsh-client-ui-layout"
      ],
      "platform": "web"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json && tsc -p tsconfig.client.json && tsdown",
    "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit",
    "test": "node --test test/",
    "verify": "pnpm build && node --test test/ && node scripts/verify-composition.mjs",
    "prepublishOnly": "pnpm verify"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1-rc.1",
    "@deepseek-ai/dsh-agent": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-client-locale": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-client-runtime": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-client-ui-conversation": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-client-ui-layout": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-client-ui-primitives": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-client-ui-slots": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-commands": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-llm": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-session": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-subagent": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-system-prompt": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-tools": "^0.1.0-rc.6",
    "@deepseek-ai/schemastery": "^3.18.1-rc.1",
    "react": "^18.2.0"
  },
  "peerDependenciesMeta": { /* 与参考一致：全部 optional */ },
  "devDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-agent": "0.1.0-rc.8",
    "@deepseek-ai/dsh-client-locale": "0.1.0-rc.8",
    "@deepseek-ai/dsh-client-runtime": "0.1.0-rc.8",
    "@deepseek-ai/dsh-client-ui-conversation": "0.1.0-rc.8",
    "@deepseek-ai/dsh-client-ui-layout": "0.1.0-rc.8",
    "@deepseek-ai/dsh-client-ui-primitives": "0.1.0-rc.8",
    "@deepseek-ai/dsh-client-ui-slots": "0.1.0-rc.8",
    "@deepseek-ai/dsh-commands": "0.1.0-rc.8",
    "@deepseek-ai/dsh-llm": "0.1.0-rc.8",
    "@deepseek-ai/dsh-session": "0.1.0-rc.8",
    "@deepseek-ai/dsh-subagent": "0.1.0-rc.8",
    "@deepseek-ai/dsh-system-prompt": "0.1.0-rc.8",
    "@deepseek-ai/dsh-tools": "0.1.0-rc.8",
    "@deepseek-ai/dsh-workspace": "0.1.0-rc.8",
    "@deepseek-ai/schemastery": "^3.18.1",
    "@types/node": "^24.13.3",
    "@types/react": "~18.3.1",
    "@types/react-dom": "^18.3.7",
    "lightningcss": "^1.33.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "tsdown": "0.22.2",
    "typescript": "^5.9.3"
  }
}
```

- [ ] **Step 2: 写 cordis.patch.yml**

```yaml
- insert:
    - id: lbx-agent-team
      name: lbx-agent-team
      config:
        stateDir: .lbx-agent-team
        memberProvider: spawn
```

- [ ] **Step 3: 复制 tsconfig 与 tsdown 配置（照参考，改名）**

`tsconfig.json` 与 `tsconfig.client.json` 逐字复制参考对应文件（见 `/tmp/dsh-agent-teams/tsconfig.json`、`tsconfig.client.json`）。`tsdown.config.ts` 照参考文件复制，仅改：
- `PLUGIN_ID` 读取 `./package.json` 的 `name`（已是 `lbx-agent-team`，无需硬编码）；
- 其余（PLATFORM_MODULES、CSS 虚拟 id、purity gate）保持与参考一致。

- [ ] **Step 4: 写 .gitignore**

```
.DS_Store
node_modules/
lib/
dist/
*.log
.lbx-agent-team/
```

- [ ] **Step 5: 写最小可加载入口 + 空 Config**

`lbx-agent-team/src/config.ts`：

```ts
import z from '@deepseek-ai/schemastery'

export interface Config {
  stateDir?: string
  memberProvider?: string
  memberModel?: string
  maxMembers?: number
  maxParallelDevers?: number
  autoRoster?: boolean
  autoDispatch?: boolean
  gitWorktrees?: boolean
  artifactsDir?: string
  maxReviewLoop?: number
  promptSectionOrder?: number
  slashCommand?: boolean
}

export const Config: z<Config> = z.object({
  stateDir: z.string().default('.lbx-agent-team'),
  memberProvider: z.string().default('spawn'),
  memberModel: z.string(),
  maxMembers: z.natural().min(1).default(12),
  maxParallelDevers: z.natural().min(1).default(3),
  autoRoster: z.boolean().default(true),
  autoDispatch: z.boolean().default(true),
  gitWorktrees: z.boolean().default(true),
  artifactsDir: z.string().default('docs/lbx-agent-team'),
  maxReviewLoop: z.natural().min(1).default(3),
  promptSectionOrder: z.natural().default(117),
  slashCommand: z.boolean().default(true),
})
```

`lbx-agent-team/src/index.ts`（最小版，只挂 system prompt 段；后续任务逐步充实）：

```ts
import type { Context } from '@deepseek-ai/cordis'
import { Config, type Config as ConfigType } from './config.ts'

export const name = 'lbx-agent-team'
export const inject = ['tools', 'systemPrompt']
export { Config }

export function apply(ctx: Context, config: ConfigType): void {
  ctx.systemPrompt.section({
    name: 'lbx-agent-team:usage',
    order: config.promptSectionOrder ?? 117,
    text: 'LBX Agent Team usage protocol will be filled by Task 13.',
  })
  ctx.logger.info('lbx-agent-team mounted')
}
```

- [ ] **Step 6: 安装依赖并构建**

```bash
cd /Users/fxy/Documents/dsh-workspace/dsh-plugins/lbx-agent-team && pnpm install && pnpm build
```
Expected: tsc 通过，tsdown 生成 `lib/client.js`（最小 client 出口可能为空，允许）。若 client 侧因无 `src/client` 报错，先建空 `src/client/index.tsx`（`export const inject = ['slots']` + 空 apply），再构建。

- [ ] **Step 7: 提交**

```bash
cd /Users/fxy/Documents/dsh-workspace/dsh-plugins && git add lbx-agent-team && git commit -m "chore: scaffold lbx-agent-team package"

---

## 阶段 A：Host 核心

### Task 3: 类型定义 types.ts

**Files:**
- Create: `lbx-agent-team/src/types.ts`
- Test: `lbx-agent-team/test/types.test.mjs`（轻量：构造一个合法 TeamState 样例并断言结构）

- [ ] **Step 1: 写 types.ts（照 spec §4，完整代码）**

```ts
/** 任务生命周期状态（pipeline 顺序）。 */
export type TaskStatus =
  | 'pending' | 'claimed' | 'in_progress' | 'in_review'
  | 'approved' | 'committed' | 'tested' | 'complete'
  | 'changes_requested' | 'failed' | 'cancelled'

export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ['complete', 'failed', 'cancelled']

export type MemberRole = 'planner' | 'checker' | 'tester' | 'dever' | (string & {})

export type MemberStatus = 'pending' | 'idle' | 'working' | 'removed'

export interface TeamMember {
  id: string            // 子代理会话 id（spawn 后填充；pending 时为 ''）
  name: string
  role: MemberRole
  status: MemberStatus
  provider?: string
  model?: string
  reasoningEffort?: string
  worktreePath?: string
  branch?: string
  joinedAt: number
  retiredAt?: number
}

export interface TeamTask {
  id: string
  subject: string
  description?: string
  status: TaskStatus
  assignee?: string     // 成员名 | 'pool' | 'captain'
  dedicated?: boolean   // true = 需要专用 dever（懒 spawn）
  dependencies: string[]
  verification?: string
  output?: string
  attempt?: number
  attemptId?: string
  reviewLoop?: number   // 连续 REQUEST_CHANGES 计数（超 maxReviewLoop 置 failed）
  review?: { verdict: 'APPROVE' | 'REQUEST_CHANGES'; reviewer: string; findingsPath?: string; at: number }
  commit?: { hash: string; branch: string; at: number }
  test?: { result: 'PASS' | 'FAIL'; tester: string; reportPath?: string; at: number }
  createdAt: number
  updatedAt: number
}

export interface TeamIssue {
  id: string
  title: string
  severity: 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW'
  status: 'open' | 'resolved'
  taskId?: string
  reporter: string
  responsible?: string
  steps?: string
  expected?: string
  actual?: string
  resolution?: { commitHash?: string; at: number }
  createdAt: number
}

export interface TeamState {
  id: string
  name: string
  specPath: string
  description?: string
  captainSessionId: string
  status: 'active' | 'archived'
  createdAt: number
  members: TeamMember[]
  tasks: TeamTask[]
  issues: TeamIssue[]
  taskSeq: number
  issueSeq: number
}

export interface TeamMessage {
  id: string
  from: string
  to: string
  content: string
  ts: number
  readAt?: number
}

export type Actor = { kind: 'captain' } | { kind: 'member'; name: string; role: string }
```

- [ ] **Step 2: 写测试**

`lbx-agent-team/test/types.test.mjs`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TERMINAL_TASK_STATUSES } from '../lib/types.js'

test('TERMINAL_TASK_STATUSES contains only final states', () => {
  assert.deepEqual(TERMINAL_TASK_STATUSES, ['complete', 'failed', 'cancelled'])
})
```

- [ ] **Step 3: 构建 + 跑测试**

```bash
cd /Users/fxy/Documents/dsh-workspace/dsh-plugins/lbx-agent-team && pnpm build && node --test test/
```
Expected: types.test.mjs PASS。

- [ ] **Step 4: 提交**

```bash
git add lbx-agent-team/src/types.ts lbx-agent-team/test/types.test.mjs && git commit -m "feat: define team data model types"
```

### Task 4: pipeline 状态机与硬门

**Files:**
- Create: `lbx-agent-team/src/pipeline.ts`
- Test: `lbx-agent-team/test/pipeline.test.mjs`

- [ ] **Step 1: 写失败测试**

`lbx-agent-team/test/pipeline.test.mjs`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextStatus, transitionError, claimGate, approveGate, commitGate, testGate } from '../lib/pipeline.js'

test('valid transitions advance status', () => {
  assert.equal(nextStatus('pending', 'claim'), 'claimed')
  assert.equal(nextStatus('in_progress', 'submit'), 'in_review')
  assert.equal(nextStatus('in_review', 'approve'), 'approved')
  assert.equal(nextStatus('in_review', 'request_changes'), 'changes_requested')
  assert.equal(nextStatus('changes_requested', 'submit'), 'in_review')
  assert.equal(nextStatus('approved', 'commit'), 'committed')
  assert.equal(nextStatus('committed', 'test'), 'tested')
  assert.equal(nextStatus('tested', 'finish'), 'complete')
})

test('invalid transitions return undefined and transitionError reports', () => {
  assert.equal(nextStatus('pending', 'commit'), undefined)
  assert.match(transitionError('pending', 'commit'), /cannot commit a task in status pending/)
  assert.equal(nextStatus('complete', 'fail'), undefined)
  assert.equal(nextStatus('failed', 'cancel'), undefined)
})

test('claim gate rejects unsatisfied dependencies', () => {
  const team = makeTeam({ t1: 'complete', t2: 'pending' })
  const t2 = team.tasks.find((t) => t.id === 't2')
  assert.match(claimGate(team, t2), /dependencies not complete/)
})

test('approve gate requires checker role', () => {
  const task = makeTask('in_review')
  assert.match(approveGate({ kind: 'member', name: 'dever-1', role: 'dever' }), /only a checker/)
  assert.equal(approveGate({ kind: 'member', name: 'checker', role: 'checker' }), undefined)
})

test('commit gate requires APPROVE record', () => {
  const task = makeTask('approved')
  assert.match(commitGate(task), /no APPROVE record/)
  task.review = { verdict: 'APPROVE', reviewer: 'checker', at: 1 }
  assert.equal(commitGate(task), undefined)
})

test('test gate requires tester role and committed status', () => {
  const task = makeTask('approved')
  assert.match(testGate({ kind: 'member', name: 'dever-1', role: 'dever' }, task), /only a tester/)
  assert.match(testGate({ kind: 'member', name: 'tester', role: 'tester' }, task), /must be committed/)
  task.status = 'committed'
  assert.equal(testGate({ kind: 'member', name: 'tester', role: 'tester' }, task), undefined)
})

function makeTask(status) {
  return { id: 't1', subject: 'x', status, dependencies: [], createdAt: 1, updatedAt: 1 }
}
function makeTeam(statuses) {
  const tasks = Object.entries(statuses).map(([id, status]) => ({ ...makeTask(status), id }))
  return { id: 'team', tasks }
}
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/fxy/Documents/dsh-workspace/dsh-plugins/lbx-agent-team && pnpm build && node --test test/pipeline.test.mjs
```
Expected: FAIL（`lib/pipeline.js` 不存在）。

- [ ] **Step 3: 实现 pipeline.ts**

```ts
import type { Actor, TeamState, TeamTask, TaskStatus } from './types.ts'

export type PipelineAction =
  | 'claim' | 'start' | 'submit' | 'approve' | 'request_changes'
  | 'commit' | 'test' | 'finish' | 'fail' | 'cancel'

/** 状态机：每个状态允许的动作。 */
const TRANSITIONS: Record<TaskStatus, readonly PipelineAction[]> = {
  pending: ['claim', 'fail', 'cancel'],
  claimed: ['start', 'fail', 'cancel'],
  in_progress: ['submit', 'fail', 'cancel'],
  in_review: ['approve', 'request_changes', 'fail', 'cancel'],
  changes_requested: ['submit', 'fail', 'cancel'],
  approved: ['commit', 'fail', 'cancel'],
  committed: ['test', 'fail', 'cancel'],
  tested: ['finish', 'fail', 'cancel'],
  complete: [],
  failed: [],
  cancelled: [],
}

export function allowedActions(status: TaskStatus): readonly PipelineAction[] {
  return TRANSITIONS[status]
}

export function nextStatus(status: TaskStatus, action: PipelineAction): TaskStatus | undefined {
  if (!TRANSITIONS[status].includes(action)) return undefined
  switch (action) {
    case 'claim': return 'claimed'
    case 'start': return 'in_progress'
    case 'submit': return 'in_review'
    case 'approve': return 'approved'
    case 'request_changes': return 'changes_requested'
    case 'commit': return 'committed'
    case 'test': return 'tested'
    case 'finish': return 'complete'
    case 'fail': return 'failed'
    case 'cancel': return 'cancelled'
  }
}

export function transitionError(status: TaskStatus, action: PipelineAction): string | undefined {
  if (nextStatus(status, action) !== undefined) return undefined
  return `cannot ${action} a task in status ${status}`
}

/** 硬门：claim 前依赖必须全部 complete。返回错误信息或 undefined。 */
export function claimGate(team: TeamState, task: TeamTask): string | undefined {
  const blocked = task.dependencies.filter((depId) =>
    team.tasks.find((t) => t.id === depId)?.status !== 'complete')
  if (blocked.length > 0) return `dependencies not complete: ${blocked.join(', ')}`
  return undefined
}

/** 硬门：只有 checker 角色成员能 APPROVE / REQUEST_CHANGES。 */
export function approveGate(actor: Actor): string | undefined {
  if (actor.kind === 'captain' || actor.role !== 'checker') return 'only a checker member may review'
  return undefined
}

/** 硬门：commit 前必须有 APPROVE 记录。 */
export function commitGate(task: TeamTask): string | undefined {
  if (task.review?.verdict !== 'APPROVE') return 'task has no APPROVE record'
  return undefined
}

/** 硬门：只有 tester 角色成员能提交测试结果，且任务必须 committed。 */
export function testGate(actor: Actor, task: TeamTask): string | undefined {
  if (actor.kind === 'captain' || actor.role !== 'tester') return 'only a tester member may test'
  if (task.status !== 'committed') return 'task must be committed before testing'
  return undefined
}

/** 生成新 attemptId（capability）。 */
export function newAttemptId(task: TeamTask): string {
  return `${task.id}-a${(task.attempt ?? 0) + 1}-${Date.now()}`
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/fxy/Documents/dsh-workspace/dsh-plugins/lbx-agent-team && pnpm build && node --test test/pipeline.test.mjs
```
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add lbx-agent-team/src/pipeline.ts lbx-agent-team/test/pipeline.test.mjs && git commit -m "feat: pipeline state machine with hard gates"
```

### Task 5: 持久化 state.ts（原子写 + 锁 + 邮箱）

**Files:**
- Create: `lbx-agent-team/src/state.ts`
- Test: `lbx-agent-team/test/state.test.mjs`

- [ ] **Step 1: 写失败测试**

`lbx-agent-team/test/state.test.mjs`：

```js
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
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/fxy/Documents/dsh-workspace/dsh-plugins/lbx-agent-team && pnpm build && node --test test/state.test.mjs
```
Expected: FAIL。

- [ ] **Step 3: 实现 state.ts**

```ts
import { mkdir, open, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { TeamMessage, TeamState } from './types.ts'

const locks = new Map<string, Promise<unknown>>()

/** 净化为用户可读的目录 id。 */
export function sanitizeKey(name: string): string {
  const cleaned = name.trim().toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned === '' ? 'team' : cleaned
}

/** 进程内锁：同一 (stateRoot, teamId) 的写操作串行。 */
export async function withTeamLock<T>(stateRoot: string, teamId: string, fn: () => Promise<T>): Promise<T> {
  const key = `team:${stateRoot}:${teamId}`
  const prev = locks.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  locks.set(key, prev.then(() => gate))
  await prev
  try {
    return await fn()
  } finally {
    release()
    if (locks.get(key) === gate) locks.delete(key)
  }
}

export async function readTeam(stateRoot: string, teamId: string): Promise<TeamState | undefined> {
  try {
    const raw = await readFile(join(stateRoot, teamId, 'team.json'), 'utf8')
    return JSON.parse(raw) as TeamState
  } catch {
    return undefined
  }
}

/** 原子发布：临时文件 + fsync + rename（同目录）。 */
export async function writeTeam(stateRoot: string, team: TeamState): Promise<void> {
  const dir = join(stateRoot, team.id)
  await mkdir(dir, { recursive: true })
  const tmp = join(dir, `team.json.tmp-${process.pid}-${Date.now()}`)
  const final = join(dir, 'team.json')
  const fh = await open(tmp, 'w')
  try {
    await fh.writeFile(JSON.stringify(team, null, 2))
    await fh.sync()
  } finally {
    await fh.close()
  }
  await rename(tmp, final)
}

export async function appendMailbox(
  stateRoot: string, teamId: string, member: string, message: TeamMessage,
): Promise<void> {
  const dir = join(stateRoot, teamId, 'inbox')
  await mkdir(dir, { recursive: true })
  const fh = await open(join(dir, `${member}.jsonl`), 'a')
  try {
    await fh.writeFile(JSON.stringify(message) + '\n')
    await fh.sync()
  } finally {
    await fh.close()
  }
}

/** 读邮箱；容忍末尾 torn line（半行 JSON 直接丢弃）。 */
export async function readMailbox(
  stateRoot: string, teamId: string, member: string,
): Promise<TeamMessage[]> {
  let raw: string
  try {
    raw = await readFile(join(stateRoot, teamId, 'inbox', `${member}.jsonl`), 'utf8')
  } catch {
    return []
  }
  const out: TeamMessage[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      out.push(JSON.parse(trimmed) as TeamMessage)
    } catch {
      // torn tail：忽略
    }
  }
  return out
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/fxy/Documents/dsh-workspace/dsh-plugins/lbx-agent-team && pnpm build && node --test test/state.test.mjs
```
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add lbx-agent-team/src/state.ts lbx-agent-team/test/state.test.mjs && git commit -m "feat: durable team state with atomic writes and mailboxes"
```

### Task 6: git.ts（worktree 生命周期）

**Files:**
- Create: `lbx-agent-team/src/git.ts`
- Test: `lbx-agent-team/test/git.test.mjs`

说明：git 执行通过 shell 适配层。优先用注入的 `ctx.bash`（参考 SKILL.md §4 提到 `ctx.bash` 是 Cordis 服务）；找不到时允许 `child_process.execFile` 兜底（本任务测试用兜底实现，不依赖 DSH 进程）。

- [ ] **Step 1: 写失败测试**

`lbx-agent-team/test/git.test.mjs`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commitAll, createWorktree, ensureGitRepo, mergeBranch } from '../lib/git.js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const shell = {
  exec: async (cmd, cwd) => {
    const r = await run(cmd, { cwd, shell: true })
    return { ok: true, stdout: r.stdout, stderr: r.stderr }
  },
}

let root
test.before(async () => { root = await mkdtemp(join(tmpdir(), 'lbx-git-')) })
test.after(async () => { await rm(root, { recursive: true, force: true }) })

test('worktree lifecycle: create, commit, merge back', async () => {
  const repo = join(root, 'repo')
  await shell.exec('git init -b main', repo)
  await shell.exec('git config user.email t@t.t', repo)
  await shell.exec('git config user.name t', repo)
  await shell.exec('echo base > base.txt && git add -A && git commit -m base', repo)

  const wt = join(root, 'wt')
  await createWorktree(shell, { repo, path: wt, branch: 'team/t1/t1', base: 'main' })
  await shell.exec('echo work > base.txt', wt)
  const hash = await commitAll(shell, wt, 'feat: work')
  assert.match(hash, /^[0-9a-f]{40}$/)

  await mergeBranch(shell, repo, 'team/t1/t1')
  const out = await shell.exec('cat base.txt', repo)
  assert.match(out.stdout, /work/)
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/fxy/Documents/dsh-workspace/dsh-plugins/lbx-agent-team && pnpm build && node --test test/git.test.mjs
```
Expected: FAIL。

- [ ] **Step 3: 实现 git.ts**

```ts
import type { Context } from '@deepseek-ai/cordis'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

export interface ShellResult { ok: boolean; stdout: string; stderr: string }
export interface ShellAdapter { exec(cmd: string, cwd: string): Promise<ShellResult> }

/** 从 ctx 取 shell 服务（bash/shell/terminal），无则 undefined。 */
export function shellAdapter(ctx: Context): ShellAdapter | undefined {
  for (const key of ['bash', 'shell', 'terminal'] as const) {
    const svc = (ctx as unknown as Record<string, unknown>)[key] as
      | { exec(cmd: string, opts?: { cwd?: string }): Promise<{ code?: number; stdout?: string; stderr?: string }> }
      | undefined
    if (svc && typeof svc.exec === 'function') {
      return {
        exec: async (cmd, cwd) => {
          const r = await svc.exec(cmd, { cwd })
          return { ok: (r.code ?? 0) === 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
        },
      }
    }
  }
  return undefined
}

/** 无 ctx 时的直连兜底（测试与 headless 用）。 */
export function localShell(): ShellAdapter {
  return {
    exec: async (cmd, cwd) => {
      try {
        const r = await execFileP(cmd, { cwd, shell: true })
        return { ok: true, stdout: r.stdout, stderr: r.stderr }
      } catch (e) {
        const err = e as { stdout?: string; stderr?: string }
        return { ok: false, stdout: err.stdout ?? '', stderr: err.stderr ?? String(e) }
      }
    },
  }
}

export async function runGit(sh: ShellAdapter, cwd: string, args: string[]): Promise<ShellResult> {
  return sh.exec(`git ${args.map((a) => JSON.stringify(a)).join(' ')}`, cwd)
}

/** 校验 cwd 是 git 仓库；不是则返回错误信息。 */
export async function ensureGitRepo(sh: ShellAdapter, cwd: string): Promise<{ ok: boolean; error?: string }> {
  const r = await runGit(sh, cwd, ['rev-parse', '--is-inside-work-tree'])
  if (!r.ok || r.stdout.trim() !== 'true') return { ok: false, error: 'workspace is not a git repository — run git init first' }
  return { ok: true }
}

/** 在 repo 建 worktree（新分支 branch，基于 base）。 */
export async function createWorktree(
  sh: ShellAdapter,
  opts: { repo: string; path: string; branch: string; base: string },
): Promise<void> {
  const r = await runGit(sh, opts.repo, ['worktree', 'add', '-b', opts.branch, opts.path, opts.base])
  if (!r.ok) throw new Error(`git worktree add failed: ${r.stderr}`)
}

/** 在 worktree 全量提交，返回 commit hash。 */
export async function commitAll(sh: ShellAdapter, cwd: string, message: string): Promise<string> {
  const add = await runGit(sh, cwd, ['add', '-A'])
  if (!add.ok) throw new Error(`git add failed: ${add.stderr}`)
  const commit = await runGit(sh, cwd, ['commit', '-m', message])
  if (!commit.ok) throw new Error(`git commit failed: ${commit.stderr}`)
  const rev = await runGit(sh, cwd, ['rev-parse', 'HEAD'])
  return rev.stdout.trim()
}

/** 把分支 --no-ff 合并回主分支。冲突时抛错（coordinator 协调）。 */
export async function mergeBranch(sh: ShellAdapter, repo: string, branch: string): Promise<void> {
  const r = await runGit(sh, repo, ['merge', '--no-ff', '-m', `merge team branch ${branch}`, branch])
  if (!r.ok) throw new Error(`git merge failed: ${r.stderr}`)
}

/** 删除已完成任务的 worktree。 */
export async function removeWorktree(sh: ShellAdapter, repo: string, path: string): Promise<void> {
  const r = await runGit(sh, repo, ['worktree', 'remove', '--force', path])
  if (!r.ok) throw new Error(`git worktree remove failed: ${r.stderr}`)
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/fxy/Documents/dsh-workspace/dsh-plugins/lbx-agent-team && pnpm build && node --test test/git.test.mjs
```
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add lbx-agent-team/src/git.ts lbx-agent-team/test/git.test.mjs && git commit -m "feat: git worktree lifecycle helpers"

### Task 7: 角色预设 prompt roles.ts

**Files:**
- Create: `lbx-agent-team/src/roles.ts`

- [ ] **Step 1: 写 roles.ts（四个角色的完整 prompt 文本）**

```ts
/** 角色预设 prompt：spawn 成员子代理时注入。占位 `{specPath}` / `{stateRoot}` / `{teamId}` / `{taskSubject}` 由 members.ts 替换。 */

export interface RolePromptContext {
  specPath: string
  stateRoot: string
  teamId: string
  taskSubject?: string
}

export const ROLE_PROMPTS: Record<string, (ctx: RolePromptContext) => string> = {
  planner: ({ specPath, stateRoot, teamId }) => [
    'You are the PLANNER member of an LBX Agent Team led by the captain (the main session).',
    'Your job: read the spec at {specPath} and produce a task list.',
    'Rules:',
    '1. Read the spec file completely.',
    '2. Break it into independent, testable tasks. Each task: subject, description, dependencies (task ids), verification (exact command or method), and a suggested assignee (pool or dedicated).',
    '3. Do NOT implement anything. Do NOT modify the spec.',
    '4. Call lbx_agent_team_create_task once per task, then lbx_agent_team_send_message to the captain with a summary and the artifact you generated via lbx_agent_team_artifact (kind=tasklist).',
    '5. If the spec is unclear, ask the captain via lbx_agent_team_send_message instead of guessing.',
  ].join('\n'),

  checker: ({ stateRoot, teamId }) => [
    'You are the CHECKER member of an LBX Agent Team. You guard code quality. You NEVER write code.',
    'Your job: review tasks submitted to you (status in_review) and report a verdict.',
    'Rules:',
    '1. Read the task, its diff/commit, and the spec section it implements.',
    '2. Check: matches spec, no placeholders/TODOs, error handling present, naming consistent, no regressions.',
    '3. Call lbx_agent_team_submit_review with verdict APPROVE or REQUEST_CHANGES and a findings path/description.',
    '4. REQUEST_CHANGES findings must be specific (file, line, issue, suggestion).',
    '5. Review files live under {stateRoot}/{teamId}/artifacts/reviews/.',
  ].join('\n'),

  tester: ({ stateRoot, teamId }) => [
    'You are the TESTER member of an LBX Agent Team. You validate implemented tasks; you do NOT fix code.',
    'Your job: for each committed task, run its verification and report PASS/FAIL.',
    'Rules:',
    '1. Read the task (lbx_agent_team_status) to get its verification command/method.',
    '2. Execute the verification using your available tools (bash for commands; browser tooling if the task specifies E2E steps).',
    '3. Call lbx_agent_team_test_task with result PASS or FAIL and a report path.',
    '4. On FAIL, also call lbx_agent_team_issue_create with steps/expected/actual and responsible member name.',
    '5. Reports live under {stateRoot}/{teamId}/artifacts/tests/.',
  ].join('\n'),

  dever: ({ specPath, stateRoot, teamId, taskSubject }) => [
    'You are a DEVELOPER (dever) member of an LBX Agent Team.',
    'Your current task: {taskSubject}. Spec: {specPath}. You work in your own git worktree branch.',
    'Rules:',
    '1. Claim the task with lbx_agent_team_claim_task (pass task id and your name).',
    '2. Implement ONLY the task. Follow existing codebase patterns. No speculative features.',
    '3. After each file change run the project typecheck; fix errors before continuing.',
    '4. When done, call lbx_agent_team_update_task with your output summary — this submits the task for review (in_review).',
    '5. If the checker requests changes, read the findings, fix, and resubmit.',
    '6. After APPROVE, the captain will ask you to confirm the commit message; provide it, then the plugin commits on your behalf. Do not run git commit yourself.',
    '7. Never modify team state files under {stateRoot}.',
  ].join('\n'),
}
```

- [ ] **Step 2: 构建 + 提交**

```bash
cd /Users/fxy/Documents/dsh-workspace/dsh-plugins/lbx-agent-team && pnpm build && git add lbx-agent-team/src/roles.ts && git commit -m "feat: role preset prompts"
```
Expected: 构建通过。

### Task 8: 成员生命周期 members.ts（懒 spawn / followup / interrupt + worktree 挂接）

**Files:**
- Create: `lbx-agent-team/src/members.ts`

参考：`/tmp/dsh-agent-teams/src/members.ts`（spawn 流程、label 前缀、denied tools）。本任务实现**懒 spawn**：成员先登记（id=''，status=pending），第一次需要工作时才调用 spawn。

- [ ] **Step 1: 读参考 members.ts 的 spawn/followup 部分**

读 `/tmp/dsh-agent-teams/src/members.ts` 的 `spawnMember` / 消息投递函数，记录：`ctx.subagents` 的 provider 名、spawn 返回的 continuable child id 获取方式、`followup` 唤醒调用形态。同时读 `/tmp/dsh-agent-teams/src/tools.ts` 中 `agent_teams_add_member` 的实现（member 记录如何落盘）。

- [ ] **Step 2: 实现 members.ts（核心签名与懒 spawn 门）**

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { TeamMember } from './types.ts'
import { ROLE_PROMPTS, type RolePromptContext } from './roles.ts'

/** 成员注册（不 spawn）。调用方在团队锁内更新 team.members。 */
export function registerMember(
  team: { members: TeamMember[]; taskSeq: number },
  input: { name: string; role: string; provider?: string; model?: string; reasoningEffort?: string },
): TeamMember {
  const member: TeamMember = {
    id: '',
    name: input.name,
    role: input.role,
    status: 'pending',
    provider: input.provider,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    joinedAt: Date.now(),
  }
  team.members.push(member)
  return member
}

/**
 * 懒 spawn：成员第一次需要工作时调用。返回续聊子代理会话 id。
 * 照参考 members.ts 的 spawn 流程实现；关键点：
 * - provider 用插件配置（spawn/fork），经 ctx.subagents 的对应 provider；
 * - label 前缀 `lbx-agent-team:${teamId}:${memberName}`；
 * - prompt 由 ROLE_PROMPTS[role] 生成（dever 附带 taskSubject）；
 * - spawn 成功后回填 member.id / provider / model / reasoningEffort / status='idle'；
 * - 给成员的工具集合排除 captain 专用工具（create/add_member/remove_member/reassign/create_task/delete）。
 */
export async function spawnMember(
  ctx: Context,
  opts: { teamId: string; member: TeamMember; roleCtx: RolePromptContext },
): Promise<string> {
  // TODO(实现者)：照参考 /tmp/dsh-agent-teams/src/members.ts 的 spawnMember 完整实现，
  // 本文件保留签名与注释；实现后删除本行与下面 throw。
  throw new Error('not implemented yet')
}

/** 唤醒成员做一轮工作（followup）。 */
export async function wakeMember(ctx: Context, memberId: string, message: string): Promise<void> {
  // 照参考：ctx.subagents.followup(memberId, createUserMessage(message))
}

/** 中断成员当前轮次（reassign 前调用并等待 quiesce）。 */
export async function interruptMember(ctx: Context, memberId: string): Promise<void> {
  // 照参考：ctx.subagents.interrupt(memberId)
}
```

> 注意：本任务实现者在 Step 2 必须**读完参考实现后删除 TODO 并补全**，不要提交含 TODO 的代码（提交前自查 `grep -rn TODO src/` 为空）。

- [ ] **Step 3: 构建 + 自查 + 提交**

```bash
cd /Users/fxy/Documents/dsh-workspace/dsh-plugins/lbx-agent-team && pnpm build && grep -rn "TODO\|not implemented" src/ || true
git add lbx-agent-team/src/members.ts && git commit -m "feat: lazy member spawn with role prompts"
```
Expected: 构建通过；自查无 TODO（若有则补全后再提交）。

### Task 9: 调度器 scheduler.ts（pool 自动领任务）

**Files:**
- Create: `lbx-agent-team/src/scheduler.ts`
- Test: `lbx-agent-team/test/scheduler.test.mjs`

- [ ] **Step 1: 写失败测试（纯函数：从状态计算"谁该领哪个任务"）**

`lbx-agent-team/test/scheduler.test.mjs`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextDispatch } from '../lib/scheduler.js'

test('idle pool dever claims a ready pool task', () => {
  const team = makeTeam({
    members: [{ name: 'dever-1', status: 'idle', role: 'dever' }],
    tasks: [{ id: 't1', status: 'pending', assignee: 'pool', dedicated: false, dependencies: [] }],
  })
  const d = nextDispatch(team, 3)
  assert.deepEqual(d, { member: 'dever-1', taskId: 't1' })
})

test('dedicated task is not claimed by pool', () => {
  const team = makeTeam({
    members: [{ name: 'dever-1', status: 'idle', role: 'dever' }],
    tasks: [{ id: 't1', status: 'pending', assignee: 'pool', dedicated: true, dependencies: [] }],
  })
  assert.equal(nextDispatch(team, 3), undefined)
})

test('no dispatch when deps unsatisfied or no idle member', () => {
  const team = makeTeam({
    members: [{ name: 'dever-1', status: 'working', role: 'dever' }],
    tasks: [{ id: 't1', status: 'pending', assignee: 'pool', dedicated: false, dependencies: ['t0'] }],
  })
  assert.equal(nextDispatch(team, 3), undefined)
})

function makeTeam({ members, tasks }) {
  return { id: 'team', members, tasks }
}
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/fxy/Documents/dsh-workspace/dsh-plugins/lbx-agent-team && pnpm build && node --test test/scheduler.test.mjs
```
Expected: FAIL。

- [ ] **Step 3: 实现 scheduler.ts**

```ts
import type { TeamState } from './types.ts'
import { claimGate } from './pipeline.ts'

export interface Dispatch { member: string; taskId: string }

/**
 * 纯函数：从当前团队状态决定下一笔派发（一个 idle pool dever 领取一个就绪 pool 任务）。
 * 无就绪组合返回 undefined。maxParallelDevers 由调用方保证 pool 大小。
 */
export function nextDispatch(team: TeamState, _maxParallelDevers: number): Dispatch | undefined {
  const idle = team.members.find((m) => m.status === 'idle' && m.role === 'dever')
  if (idle === undefined) return undefined
  const ready = team.tasks.find((t) =>
    t.status === 'pending' && t.assignee === 'pool' && t.dedicated !== true && claimGate(team, t) === undefined)
  if (ready === undefined) return undefined
  return { member: idle.name, taskId: ready.id }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/fxy/Documents/dsh-workspace/dsh-plugins/lbx-agent-team && pnpm build && node --test test/scheduler.test.mjs
```
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add lbx-agent-team/src/scheduler.ts lbx-agent-team/test/scheduler.test.mjs && git commit -m "feat: pool auto-dispatch scheduler"
```

### Task 10: markdown 工件 artifacts.ts

**Files:**
- Create: `lbx-agent-team/src/artifacts.ts`
- Test: `lbx-agent-team/test/artifacts.test.mjs`

- [ ] **Step 1: 写失败测试**

`lbx-agent-team/test/artifacts.test.mjs`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderTasklist, renderFinalReport } from '../lib/artifacts.js'

const team = {
  id: 't1', name: 'demo', specPath: 'docs/specs/demo.md', status: 'active', captainSessionId: 'c',
  createdAt: 1, taskSeq: 1, issueSeq: 0,
  members: [{ id: 'p', name: 'planner', role: 'planner', status: 'idle', joinedAt: 1 }],
  tasks: [{ id: 't1', subject: 'add login', status: 'complete', assignee: 'dever-1', dependencies: [], createdAt: 1, updatedAt: 2 }],
  issues: [],
}

test('renderTasklist lists every task with status', () => {
  const md = renderTasklist(team)
  assert.match(md, /# demo Task List/)
  assert.match(md, /- \[x\] t1: add login/)
  assert.match(md, /\*\*Spec:\*\* docs\/specs\/demo.md/)
})

test('renderFinalReport summarizes pipeline results', () => {
  const md = renderFinalReport(team)
  assert.match(md, /demo Final Report/)
  assert.match(md, /1 complete/)
  assert.match(md, /0 failed/)
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/fxy/Documents/dsh-workspace/dsh-plugins/lbx-agent-team && pnpm build && node --test test/artifacts.test.mjs
```
Expected: FAIL。

- [ ] **Step 3: 实现 artifacts.ts**

```ts
import type { TeamState } from './types.ts'

const DONE = ['complete']
const FAILED = ['failed', 'cancelled']

function statusBox(status: string): string {
  return status === 'complete' ? '[x]' : '[ ]'
}

export function renderTasklist(team: TeamState): string {
  const lines = [
    `# ${team.name} Task List`,
    '',
    `**Spec:** ` + team.specPath,
    `**Generated:** ${new Date().toISOString()}`,
    `**Total Tasks:** ${team.tasks.length}`,
    '',
    ...team.tasks.map((t) => `- ${statusBox(t.status)} ${t.id}: ${t.subject} (${t.status}${t.assignee ? ', ' + t.assignee : ''})`),
    '',
  ]
  return lines.join('\n')
}

export function renderReview(team: TeamState, taskId: string): string {
  const t = team.tasks.find((x) => x.id === taskId)
  const lines = [
    `# Review: ${t?.subject ?? taskId}`,
    '',
    `**Task:** ${taskId}`,
    t?.review ? `**Verdict:** ${t.review.verdict} by ${t.review.reviewer} at ${new Date(t.review.at).toISOString()}` : '**Verdict:** none',
    t?.review?.findingsPath ? `**Findings:** ` + t.review.findingsPath : '',
    '',
  ]
  return lines.join('\n')
}

export function renderTestReport(team: TeamState): string {
  const lines = [
    `# ${team.name} Test Report`,
    '',
    ...team.tasks.map((t) =>
      `- ${t.id}: ${t.test?.result ?? 'not tested'}${t.test?.tester ? ' by ' + t.test.tester : ''}`),
    '',
  ]
  return lines.join('\n')
}

export function renderFinalReport(team: TeamState): string {
  const done = team.tasks.filter((t) => DONE.includes(t.status)).length
  const failed = team.tasks.filter((t) => FAILED.includes(t.status)).length
  const openIssues = team.issues.filter((i) => i.status === 'open').length
  const lines = [
    `# ${team.name} Final Report`,
    '',
    `**Spec:** ` + team.specPath,
    `**Tasks:** ${team.tasks.length} total, ${done} complete, ${failed} failed`,
    `**Issues:** ${openIssues} open`,
    '',
    ...team.tasks.map((t) =>
      `- ${statusBox(t.status)} ${t.id}: ${t.subject} — ${t.status}${t.commit ? ' (commit ' + t.commit.hash.slice(0, 8) + ')' : ''}`),
    '',
  ]
  return lines.join('\n')
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/fxy/Documents/dsh-workspace/dsh-plugins/lbx-agent-team && pnpm build && node --test test/artifacts.test.mjs
```
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add lbx-agent-team/src/artifacts.ts lbx-agent-team/test/artifacts.test.mjs && git commit -m "feat: markdown artifact generation"
```

### Task 11: 工具面 tools.ts（16 个 lbx_agent_team_* 工具）

**Files:**
- Create: `lbx-agent-team/src/tools.ts`（较大，可拆 `src/tools/*.ts` 分模块注册）

参考：`/tmp/dsh-agent-teams/src/tools.ts`（defineTool 用法、requireCaptain/锁/状态读写模式）。

- [ ] **Step 1: 通读参考 tools.ts 的注册骨架**

读 `/tmp/dsh-agent-teams/src/tools.ts` 前 150 行与任意两个工具的完整实现，记录：`defineTool` 签名、`parameters` DSL、`output.schema`、`output.render`、锁获取模式。

- [ ] **Step 2: 实现注册骨架 + 三个代表性工具（完整代码）**

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { join } from 'node:path'
import { readTeam, sanitizeKey, withTeamLock, writeTeam } from './state.ts'
import { claimGate, commitGate, newAttemptId, nextStatus, transitionError } from './pipeline.ts'
import type { Actor, TeamState, TeamTask } from './types.ts'
import { renderFinalReport, renderTasklist } from './artifacts.ts'
import { spawnMember, registerMember } from './members.ts'
import { ensureGitRepo, localShell, shellAdapter } from './git.ts'
import type { ToolsConfig } from './tool-config.ts'

function requireAgent(exec: ToolRunContext): Agent {
  if (!exec.agent) throw new Error('lbx_agent_team tools require a calling agent')
  return exec.agent
}
function workspaceOf(agent: Agent): string { return agent.session.header.cwd ?? process.cwd() }
function stateRootOf(workspace: string, c: ToolsConfig): string { return join(workspace, c.stateDir) }
function actorOf(team: TeamState, agentId: string): Actor {
  if (team.captainSessionId === agentId) return { kind: 'captain' }
  const m = team.members.find((x) => x.id === agentId && x.status !== 'removed')
  if (!m) throw new Error('you are neither the captain nor an active member of this team')
  return { kind: 'member', name: m.name, role: m.role }
}

export function registerLbxAgentTeamTools(ctx: Context, config: ToolsConfig): void {
  // —— 工具 1/16：create ——
  ctx.tools.register(defineTool({
    name: 'lbx_agent_team_create',
    description: 'Create a team. REQUIRES an existing spec file path; the calling session becomes the captain. Fails loudly if the spec file does not exist. Registers the standard roster when autoRoster is on.',
    parameters: {
      name: { type: 'string', description: 'Team name' },
      spec: { type: 'string', description: 'Path to the spec document; must already exist' },
      description: { type: 'string' },
    },
    output: { schema: { type: 'object', properties: { teamId: { type: 'string' } }, required: ['teamId'] } },
    async exec(exec) {
      const agent = requireAgent(exec)
      const { name, spec, description } = exec.input
      const workspace = workspaceOf(agent)
      const stateRoot = stateRootOf(workspace, config)
      const specPath = join(workspace, spec)
      // spec 必填门（D9）
      const { access } = await import('node:fs/promises')
      try { await access(specPath) } catch {
        throw new Error(`spec file not found: ${specPath} — generate the spec document first`)
      }
      // git 前置（D5）
      if (config.gitWorktrees !== false) {
        const sh = shellAdapter(ctx) ?? localShell()
        const repo = await ensureGitRepo(sh, workspace)
        if (!repo.ok) throw new Error(repo.error ?? 'git required')
      }
      const teamId = sanitizeKey(name)
      const team: TeamState = {
        id: teamId, name, specPath, description, captainSessionId: agent.id,
        status: 'active', createdAt: Date.now(), members: [], tasks: [], issues: [],
        taskSeq: 0, issueSeq: 0,
      }
      await withTeamLock(stateRoot, teamId, async () => {
        const existing = await readTeam(stateRoot, teamId)
        if (existing) throw new Error(`team "${teamId}" already exists — pick another name or delete it first`)
        if (config.autoRoster !== false) {
          for (const role of ['planner', 'checker', 'tester'] as const) {
            registerMember(team, { name: role, role })
          }
        }
        await writeTeam(stateRoot, team)
      })
      return { teamId }
    },
  }))

  // —— 工具 5/16：create_task ——
  ctx.tools.register(defineTool({
    name: 'lbx_agent_team_create_task',
    description: 'Add a task to the team task list. assignee: a member name, "pool" (shared dever pool), "new-dever" (spawn a dedicated dever lazily at claim time), or "captain".',
    parameters: {
      subject: { type: 'string', required: true },
      description: { type: 'string' },
      assignee: { type: 'string', default: 'pool' },
      dependencies: { type: 'array', items: { type: 'string' }, default: [] },
      verification: { type: 'string', description: 'Exact command or method the tester will run' },
    },
    output: { schema: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] } },
    async exec(exec) {
      const agent = requireAgent(exec)
      const { subject, description, assignee = 'pool', dependencies = [], verification } = exec.input
      const workspace = workspaceOf(agent)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireCaptainTeam(stateRoot, agent.id)
      return withTeamLock(stateRoot, team.id, async () => {
        const fresh = (await readTeam(stateRoot, team.id))!
        actorOf(fresh, agent.id) // captain-only
        const dedicated = assignee === 'new-dever'
        const taskId = `t${fresh.taskSeq + 1}`
        const task: TeamTask = {
          id: taskId, subject, description,
          status: 'pending',
          assignee: dedicated ? 'pool' : assignee,
          dedicated,
          dependencies: dependencies ?? [],
          verification,
          createdAt: Date.now(), updatedAt: Date.now(),
        }
        fresh.tasks.push(task)
        fresh.taskSeq += 1
        await writeTeam(stateRoot, fresh)
        return { taskId }
      })
    },
  }))

  // —— 工具 9/16：submit_review ——
  ctx.tools.register(defineTool({
    name: 'lbx_agent_team_submit_review',
    description: 'Checker verdict for a task in in_review. APPROVE moves it to approved; REQUEST_CHANGES moves it to changes_requested and increments the review loop counter.',
    parameters: {
      taskId: { type: 'string', required: true },
      verdict: { type: 'string', enum: ['APPROVE', 'REQUEST_CHANGES'], required: true },
      findingsPath: { type: 'string', description: 'Path to the review markdown/notes' },
    },
    output: { schema: { type: 'object', properties: { status: { type: 'string' } }, required: ['status'] } },
    async exec(exec) {
      const agent = requireAgent(exec)
      const { taskId, verdict, findingsPath } = exec.input
      const workspace = workspaceOf(agent)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireParticipantTeam(stateRoot, agent.id)
      return withTeamLock(stateRoot, team.id, async () => {
        const fresh = (await readTeam(stateRoot, team.id))!
        const actor = actorOf(fresh, agent.id)
        const task = fresh.tasks.find((t) => t.id === taskId)
        if (!task) throw new Error(`task ${taskId} not found`)
        const action = verdict === 'APPROVE' ? 'approve' : 'request_changes'
        const gateErr = action === 'approve'
          ? (requireChecker(actor), undefined)
          : (requireChecker(actor), undefined)
        const bad = transitionError(task.status, action)
        if (bad) throw new Error(bad)
        task.status = nextStatus(task.status, action)!
        task.review = { verdict, reviewer: actor.kind === 'member' ? actor.name : 'captain', findingsPath, at: Date.now() }
        if (action === 'request_changes') {
          task.reviewLoop = (task.reviewLoop ?? 0) + 1
          if (task.reviewLoop! >= (config.maxReviewLoop ?? 3)) task.status = 'failed'
        }
        task.updatedAt = Date.now()
        await writeTeam(stateRoot, fresh)
        return { status: task.status }
      })
    },
  }))

  // —— 其余 13 个工具按下方契约表实现（同一骨架：requireAgent → 读团队 → 锁内校验门 → 迁移 → 写回）——
  // 契约表见本任务 Step 3。未在此处给出完整代码的工具，实现时以契约表字段为准。
  registerRemainingTools(ctx, config, { workspaceOf, stateRootOf, actorOf })
}

function requireChecker(_actor: Actor): void {
  // 由 pipeline.approveGate 校验；这里保留角色判断占位，实现时直接调用 approveGate
}

// 以下辅助由 Step 3 定义：requireCaptainTeam / requireParticipantTeam / registerRemainingTools
function requireCaptainTeam(stateRoot: string, captainId: string): Promise<TeamState> { throw new Error('defined in Step 3') }
function requireParticipantTeam(stateRoot: string, callerId: string): Promise<TeamState> { throw new Error('defined in Step 3') }
function registerRemainingTools(_ctx: Context, _c: ToolsConfig, _deps: unknown): void { throw new Error('defined in Step 3') }
```

- [ ] **Step 3: 按契约表实现其余 13 个工具（每个工具一个子任务步骤，实现后删除骨架中的 throw）**

契约表（参数均照 `defineTool` 的 value-schema DSL；required 用内联 `required: true`）：

| 工具 | parameters | 门/行为 | 状态迁移 | 错误（示例文案） |
|---|---|---|---|---|
| `lbx_agent_team_add_member` | name, role(enum+自定义), provider?, model?, reasoningEffort? | captain-only；`maxMembers` 上限；dever 角色 spawn 时若 gitWorktrees 则建 worktree（见 Task 6） | 登记成员（pending） | `member limit ${maxMembers} reached` |
| `lbx_agent_team_remove_member` | member | captain-only；未完成任务 assignee 置 pool | member.status=removed | `member not found` |
| `lbx_agent_team_claim_task` | taskId, member | claimGate（依赖完成）；dedicated 任务只允许其专属 dever（claim 时原子 spawn + 建 worktree + 置 working）；pool 任务由 pool dever 领取 | pending→claimed；生成 attemptId | `dependencies not complete: ...` |
| `lbx_agent_team_update_task` | taskId, output, attemptId, done?(boolean) | 校验 attemptId 匹配；done=true 时 submit | in_progress→in_review（done）；in_progress 内更新 output 不迁移 | `stale attemptId — task was reassigned` |
| `lbx_agent_team_reassign_task` | taskId, to('pool'|member|'captain') | captain-only；撤销旧 attempt、等待原成员安静（interruptMember） | 重置为 pending/claimed 并生成新 attempt | `cannot reassign a complete task` |
| `lbx_agent_team_commit_task` | taskId, message | commitGate（有 APPROVE 记录）；插件在 dever worktree 执行 git commit 并记录 hash（无 shell 时退化为返回精确命令文本，要求 dever 执行后回报 hash 再调用一次） | approved→committed | `task has no APPROVE record` |
| `lbx_agent_team_test_task` | taskId, result('PASS'|'FAIL'), reportPath? | testGate（tester 角色 + committed）；FAIL 时同步创建 open issue（responsible 取任务 assignee） | committed→tested（PASS）/ 保持 committed + issue（FAIL） | `only a tester member may test` |
| `lbx_agent_team_issue_create` | title, severity(enum), taskId?, responsible?, steps?, expected?, actual? | 任一参与者 | 新增 issue（open） | — |
| `lbx_agent_team_issue_resolve` | issueId, commitHash? | captain-only 或 reporter | open→resolved | `issue not found` |
| `lbx_agent_team_send_message` | to('captain'|member名), content | 参与者；目标必须是队长或活动成员 | appendMailbox | `no such member` |
| `lbx_agent_team_status` | (无) | 任一参与者 | 返回快照：成员/任务/issue/阻塞点/待办队列 | — |
| `lbx_agent_team_artifact` | kind('tasklist'|'review'|'testreport'|'final'), taskId? | 任一参与者 | 由 artifacts.ts 渲染并写入 artifactsDir，返回路径 | `unknown artifact kind` |
| `lbx_agent_team_delete` | (无) | captain-only | 归档：team.status=archived，目录移入 archive/ | — |

- [ ] **Step 4: 构建 + 自查（无 TODO/throw 占位）+ 提交**

```bash
cd /Users/fxy/Documents/dsh-workspace/dsh-plugins/lbx-agent-team && pnpm build && grep -rn "not implemented\|defined in Step" src/ || true
git add lbx-agent-team/src/tools.ts && git commit -m "feat: register lbx_agent_team_* tools"
```
Expected: 构建通过；无占位符残留（有则补全后提交）。

### Task 12: slash 命令与手势边界 command.ts

**Files:**
- Create: `lbx-agent-team/src/command.ts`

- [ ] **Step 1: 照参考实现 command.ts**

参考 `/tmp/dsh-agent-teams/src/command.ts`。改名：
- 命令命名空间 `agent-teams` → `lbx-agent-team`；
- 手势边界匹配前缀 `/agent-teams` → `/lbx-agent-team`；
- 命令描述、占位提示文本同步改名；
- 激活后注入的指令文案指向 `lbx_agent_team_create` 等新工具名。

- [ ] **Step 2: 构建 + 提交**

```bash
cd /Users/fxy/Documents/dsh-workspace/dsh-plugins/lbx-agent-team && pnpm build && git add lbx-agent-team/src/command.ts && git commit -m "feat: /lbx-agent-team slash command and gesture boundary"
```

### Task 13: 入口 index.ts（组装全部）

**Files:**
- Modify: `lbx-agent-team/src/index.ts`（Task 2 的最小版 → 完整版）

- [ ] **Step 1: 写完整 index.ts**

照参考 `/tmp/dsh-agent-teams/src/index.ts` 组装，包含：
1. `inject = ['tools', 'llm', 'subagents', 'systemPrompt', 'agents']`（命令/HTTP 按参考惰性挂载）；
2. system prompt 协议段（完整 usageSectionText，文案按 spec §10：create → add_member → create_task → 委派 → status 监控 → delete；写明"必须先有 spec"）；
3. `registerLbxAgentTeamTools(ctx, resolved)`；
4. `slashCommand` 配置为 true 时挂命令 + 手势边界（Task 12）；
5. HTTP 路由（照参考 `/plugins/dsh-agent-teams/state` 模式改 `/plugins/lbx-agent-team/state`；路由 handler 读 JSON 真相 + 活跃子代理活动）；
6. 全部生命周期资源用 `ctx.effect` / `ctx.on` 注册 disposer。

- [ ] **Step 2: 构建 + 自查 + 提交**

```bash
cd /Users/fxy/Documents/dsh-workspace/dsh-plugins/lbx-agent-team && pnpm build && grep -rn "TODO\|agent-teams\|agent_teams" src/index.ts || true
git add lbx-agent-team/src/index.ts && git commit -m "feat: assemble plugin entry with usage protocol and routes"
```
Expected: 构建通过；自查确认无旧名字残留（`agent-teams` / `agent_teams` 应为空）。

### Task 14: 组合验证脚本 verify-composition.mjs

**Files:**
- Create: `lbx-agent-team/scripts/verify-composition.mjs`

- [ ] **Step 1: 写脚本（照参考 scripts/lifecycle-verify.mjs 的 Loader 组合模式）**

脚本内容：
1. 用真实 Loader + 本插件 patch 启动最小组合（含 tools / systemPrompt 的 stub service）；
2. 断言：`lbx_agent_team_create` 工具已注册；system prompt 段存在；`/lbx-agent-team` 命令已注册；
3. 用一个临时 workspace + 临时 git 仓库 + 假 spec 文件，跑 `lbx_agent_team_create` 的 exec（注入假 exec.agent），断言团队 JSON 落盘且名册含 planner/checker/tester；
4. 失败断言进程退出非零。

- [ ] **Step 2: 跑 verify**

```bash
cd /Users/fxy/Documents/dsh-workspace/dsh-plugins/lbx-agent-team && pnpm verify
```
Expected: typecheck、build、node --test、verify-composition 全部通过。

- [ ] **Step 3: 提交**

```bash
git add lbx-agent-team/scripts/verify-composition.mjs && git commit -m "test: composition verification script"

---

## 阶段 B：Client UI（活动面板）

### Task 15: client 骨架 + 活动投影模型 activity-model.ts

**Files:**
- Create: `lbx-agent-team/src/client/index.tsx`（最小入口）、`lbx-agent-team/src/client/activity-model.ts`、`lbx-agent-team/src/css-modules.d.ts`
- Test: `lbx-agent-team/test/activity-model.test.mjs`

- [ ] **Step 1: 写失败测试（投影纯函数）**

`lbx-agent-team/test/activity-model.test.mjs`：

```js
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
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/fxy/Documents/dsh-workspace/dsh-plugins/lbx-agent-team && pnpm build && node --test test/activity-model.test.mjs
```
Expected: FAIL。

- [ ] **Step 3: 实现 activity-model.ts（纯函数，不碰 DOM）**

```ts
export type StageLabel = 'pending' | 'working' | 'review' | 'approved' | 'committed' | 'tested' | 'done' | 'failed' | 'cancelled'

export function taskStages(status: string): StageLabel {
  switch (status) {
    case 'pending': return 'pending'
    case 'claimed': case 'in_progress': case 'changes_requested': return 'working'
    case 'in_review': return 'review'
    case 'approved': return 'approved'
    case 'committed': return 'committed'
    case 'tested': return 'tested'
    case 'complete': return 'done'
    case 'failed': return 'failed'
    case 'cancelled': return 'cancelled'
    default: return 'pending'
  }
}

export interface PanelSummary { total: number; done: number; inReview: number; inProgress: number; failed: number }

export function panelSummary(state: { tasks: Array<{ status: string }> }): PanelSummary {
  const s: PanelSummary = { total: state.tasks.length, done: 0, inReview: 0, inProgress: 0, failed: 0 }
  for (const t of state.tasks) {
    const stage = taskStages(t.status)
    if (stage === 'done') s.done += 1
    else if (stage === 'review') s.inReview += 1
    else if (stage === 'working') s.inProgress += 1
    else if (stage === 'failed') s.failed += 1
  }
  return s
}
```

- [ ] **Step 4: 跑测试确认通过 + 建最小 client 入口 + 构建**

`lbx-agent-team/src/client/index.tsx`：

```tsx
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

export const inject = ['slots']

export function apply(_ctx: ClientContext): void {
  // Task 18 在此注册面板 slot
}
```

`lbx-agent-team/src/css-modules.d.ts`（照参考）：

```ts
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
```

```bash
cd /Users/fxy/Documents/dsh-workspace/dsh-plugins/lbx-agent-team && pnpm build && node --test test/activity-model.test.mjs
```
Expected: 全部 PASS，client bundle 生成 `lib/client.js`。

- [ ] **Step 5: 提交**

```bash
git add lbx-agent-team/src/client lbx-agent-team/test/activity-model.test.mjs && git commit -m "feat: client skeleton and activity projection model"
```

### Task 16: 活动监控 activity-monitor.ts（轮询 host 状态路由）

**Files:**
- Create: `lbx-agent-team/src/client/activity-monitor.ts`

- [ ] **Step 1: 照参考实现轮询器**

参考 `/tmp/dsh-agent-teams/src/client/activity-monitor.ts`。要求：
- 轮询 `/plugins/lbx-agent-team/state`（`no-store`）；
- in-flight guard（上一次未返回不发起下一次）；响应形状校验失败丢弃；
- unmount/dispose 时停止轮询；失败保留最后成功快照；
- 导出：`startActivityPolling` / `subscribeActivityMonitorTargets` / dispose 函数。

- [ ] **Step 2: 构建 + 提交**

```bash
cd /Users/fxy/Documents/dsh-workspace/dsh-plugins/lbx-agent-team && pnpm build && git add lbx-agent-team/src/client/activity-monitor.ts && git commit -m "feat: activity monitor polling"
```

### Task 17: 面板组件（名册/任务/DAG/issue）

**Files:**
- Create: `lbx-agent-team/src/client/TeamPanel.tsx`、`Roster.tsx`、`TaskList.tsx`、`DagView.tsx`、`Issues.tsx`、`TeamPanel.module.css`

- [ ] **Step 1: 实现 TeamPanel 与子组件**

- `TeamPanel`：容器。展示 `panelSummary` 计数徽标、成员名册（角色徽标 + pending/idle/working 状态）、任务列表（pipeline 阶段徽标，颜色分级）、依赖 DAG（`<svg>` 或列表缩进表示依赖）、issue 列表（severity 徽标）；
- 折叠/展开 + 窄屏上限高度 + 内容区滚动（CSS）；
- 纯展示组件，状态经 props 注入（方便测试与 HMR）；无直接 DOM 副作用。

- [ ] **Step 2: 构建 + 提交**

```bash
cd /Users/fxy/Documents/dsh-workspace/dsh-plugins/lbx-agent-team && pnpm build && git add lbx-agent-team/src/client/TeamPanel.tsx lbx-agent-team/src/client/Roster.tsx lbx-agent-team/src/client/TaskList.tsx lbx-agent-team/src/client/DagView.tsx lbx-agent-team/src/client/Issues.tsx lbx-agent-team/src/client/TeamPanel.module.css && git commit -m "feat: activity panel components"
```

### Task 18: client 入口接线（slots + 轮询 + i18n + a11y）

**Files:**
- Modify: `lbx-agent-team/src/client/index.tsx`
- Create: `lbx-agent-team/src/client/locales.ts`

- [ ] **Step 1: 照参考接线 slot**

参考 `/tmp/dsh-agent-teams/src/client/index.tsx` 的 slot 注册方式（`ctx.slots.inject` + `register`），注册活动面板到 conversation 区 dock / overlay。要求：
- 所有注册、listener、style 随 client fiber dispose（返回 disposer）；
- 面板按当前 session 过滤（每 session 分桶）；连接重置只重同步已读对象；
- locales.ts 提供 zh/en 文案（面板标题、阶段徽标文案、aria 标签），随宿主语言实时切换（照参考接入 `@deepseek-ai/dsh-client-locale`）。

- [ ] **Step 2: a11y 自查**

检查项：键盘可达、`:focus-visible`、aria 标签、Escape 收起、reduced motion 支持；hover/focus 只预览，click 才固定。

- [ ] **Step 3: 构建 + 提交**

```bash
cd /Users/fxy/Documents/dsh-workspace/dsh-plugins/lbx-agent-team && pnpm build && git add lbx-agent-team/src/client && git commit -m "feat: wire activity panel into conversation slots with i18n"
```

---

## 阶段 C：验证与分发

### Task 19: 真实组合验证（scratch profile）

**Files:**
- 操作：临时 profile + `dsh` CLI

- [ ] **Step 1: 建 scratch profile 并安装本插件**

```bash
DSH_HOME="$(mktemp -d)" dsh plugin --profile scratch add /Users/fxy/Documents/dsh-workspace/dsh-plugins/lbx-agent-team
DSH_HOME="$DSH_HOME" dsh --profile scratch --dump-config
```
Expected: `--dump-config` 中出现 `lbx-agent-team` 行，id/name/config 正确，注入顺序符合预期。

- [ ] **Step 2: headless 端到端小任务**

在临时 workspace（含 git init + 一个假 spec 文件）执行：

```bash
dsh --profile scratch "用 LBX Agent Team 实现 docs/specs/demo.md（一个极小的任务，如给 README 加一行）"
```
Expected: 插件创建团队 → planner 拆任务 → dever 实现（worktree）→ checker 审批 → commit → tester 验证 → 完成；`.lbx-agent-team/` 状态目录生成；`docs/lbx-agent-team/` 出现任务清单与最终报告 markdown。

- [ ] **Step 3: 记录结果并提交（如发现 bug 回对应任务修复）**

```bash
cd /Users/fxy/Documents/dsh-workspace/dsh-plugins && git add -A && git commit -m "test: end-to-end scratch profile run"
```

### Task 20: 从零安装验证（npm 与 git 两种路径）

**Files:**
- 操作：两个全新临时 DSH_HOME/profile

- [ ] **Step 1: npm 路径**

```bash
DSH_HOME="$(mktemp -d)" dsh plugin --profile web add lbx-agent-team@0.1.0
```
（若尚未发布到 npm，本步骤改为本地 tarball：`pnpm pack` 后 `add <tarball路径>`。）

- [ ] **Step 2: git 路径**

把插件推到你的 Git 仓库后：

```bash
DSH_HOME="$(mktemp -d)" dsh plugin --profile web add github:<owner>/<repo>
```
Expected: 依赖与 `dsh.profile.bundles` 就位；`--dump-config` 出现插件层；所有 exports（`.`、`./client`、`./cordis.patch.yml`、`./package.json`）与 host/client bundle、静态资源存在。

- [ ] **Step 3: 记录结果**

```bash
cd /Users/fxy/Documents/dsh-workspace/dsh-plugins && git add -A && git commit -m "docs: record from-zero install verification results"
```

### Task 21: README 与文档

**Files:**
- Create: `lbx-agent-team/README.md`、`lbx-agent-team/README_ZH.md`、`lbx-agent-team/docs/usage.md`

- [ ] **Step 1: 写 README（照参考 readme-writing-guide 约定）**

必含：一句话介绍、安装命令（npm / 源码构建 / git）、使用示例（`/lbx-agent-team 实现 docs/specs/xxx.md`）、工作方式说明、配置表、使用边界（单队长单团队、状态文件持久化、worktree 要求 git 仓库）、完整工具列表指向 docs/usage.md。

- [ ] **Step 2: 提交**

```bash
git add lbx-agent-team/README.md lbx-agent-team/README_ZH.md lbx-agent-team/docs && git commit -m "docs: README and usage guide"
```

### Task 22: GUI 验证清单

**Files:**
- 操作：真实浏览器 + web profile

- [ ] **Step 1: 浏览器验证**

```bash
dsh web
```
人工/浏览器工具逐项核对：面板出现于对话区（窄屏退回 overlay）；名册/任务阶段/DAG/issue 渲染正确；刷新后状态保留；轮询失败保留最后快照；中英文切换；键盘/焦点/reduced motion。

- [ ] **Step 2: 记录结果**

```bash
cd /Users/fxy/Documents/dsh-workspace/dsh-plugins && git add -A && git commit -m "docs: GUI verification checklist results"
```

---

## 自查记录（写作时完成）

**Spec 覆盖：** §4 数据模型 → Task 3；§5 状态机/硬门 → Task 4；§4.5 持久化 → Task 5；§7.3 worktree → Task 6；§7.1 角色/懒 spawn → Task 7-8；§7.2 调度 → Task 9；§6 工具面 → Task 11（16 个全覆盖）；§10 slash/协议 → Task 12-13；§8 UI → Task 15-18；§13 验证 → Task 14/19/20/22；§12 分发 → Task 20-21。

**占位扫描：** 无 TBD/TODO（Task 8/11 的 TODO/throw 是"实现前占位"，步骤内明确要求提交前删除并自查）。

**类型一致性：** `TeamTask.status` / `PipelineAction` / `taskStages` 的字符串取值与 spec §4.3/§5 一致；工具名统一 `lbx_agent_team_*`；state 函数签名（`readTeam/writeTeam/withTeamLock/appendMailbox`）跨任务一致。

```

```

```
