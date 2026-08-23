# LBX Agent Team 插件设计

**日期:** 2026-08-23
**状态:** 待用户评审
**关联:** 参考实现 https://github.com/NanmiCoder/dsh-agent-teams

## 1. 背景与目标

### 1.1 问题

用户有一套自设计的多智能体开发团队协议（见 `refs/agents/`：coordinator / planner / checker / dever / tester 五个固定角色，严格 pipeline：拆任务 → 实现 → 审查 → 提交 → 测试 → 验收）。该协议有几个问题：

- 引用路径与运行时环境不符（`.claude/agents/*` 与 `refs/agents/*`、不存在 `docs/superpowers` 结构、工作区非 git 仓库）；
- spawn 协议（`subagent_type/team_name`）与本运行时（DSH）的 `subagent` 工具不匹配；
- 依赖本环境不存在的工具（Chrome DevTools MCP、`simplify` skill）；
- 内部矛盾：并行 devers 与串行 review/test 冲突、checker 直接通信违反经 coordinator 路由的规则、任务独立性要求与依赖链要求矛盾；
- 无循环上限、无任务清单外部评审、git 无分支隔离。

参考插件 `dsh-agent-teams`（NanmiCoder）证明了"DSH 原生插件承载多智能体团队"的可行性：主会话即队长、成员为可续聊子代理、工具 + system prompt 协议段 + slash 命令、JSON 状态持久化、Web 活动面板。但它缺少用户设计的核心价值：**固定角色分工、checker 质量门、git 提交纪律、严格 pipeline**。

### 1.2 目标

将用户的团队协议做成一个**通用的、原生 Tool 型 DSH 插件**，可安装分发给团队内其他成员使用。插件提供：

1. 固定角色名册（planner / checker / tester / dever）+ 可选自定义角色；
2. pipeline 状态机**硬门**：未 APPROVE 不能 commit、未 tested 不能 complete；
3. 多 dever 并行时的 **git worktree + 独立分支**隔离，插件管理 worktree 全生命周期；
4. **懒创建**的成员子代理：成员先登记、子代理在第一次需要工作时才 spawn、任务完成即归档；
5. JSON 状态目录为权威真相 + 关键里程碑自动生成人类可读 markdown 工件；
6. Host + Client 双面：活动面板实时展示名册、pipeline 阶段、依赖 DAG、issue。

### 1.3 非目标（YAGNI）

- 不做 workflow 引擎（编排由 coordinator 模型经工具驱动，复用 DSH 既有 subagent 机制）；
- 不做多进程并发写同一团队的保证（单 DSH 进程内串行，与参考插件一致）；
- 不做 spec 起草功能：必须有 spec 文件，没有则提示用户先生成（用户明确要求）；
- 不做浏览器 E2E 绑定：tester 按任务携带的验证命令/方法执行。

## 2. 关键决策记录

| # | 决策 | 选择 |
|---|------|------|
| D1 | 插件形态 | 原生 Tool 型 DSH 插件（host + client 一步到位） |
| D2 | Coordinator 模型 | 主会话即 Coordinator（参考插件的 captain 模式） |
| D3 | 质量门强制程度 | 状态机硬门：非法状态迁移由代码拒绝 |
| D4 | Dever 生命周期 | 懒创建 + 完成即归档；dedicated / pool 双模式按复杂度选择 |
| D5 | Git 冲突策略 | 每个 dever 一个 worktree + 独立分支，插件管理生命周期 |
| D6 | UI 范围 | Host + Client 活动面板一步到位 |
| D7 | 状态落盘 | JSON 状态目录为主 + 关键工件自动生成 markdown |
| D8 | Tester 验证 | 每任务携带 verification（命令或方法），tester 按需执行 |
| D9 | Spec 输入 | 必须有 spec 文件，没有则提示用户先生成 |
| D10 | 工具面建模 | 方案 C：通用任务工具 + pipeline 状态机硬门 + 少数角色专用动词 |
| D11 | 命名 | 插件 `lbx-agent-team`，工具前缀 `lbx_agent_team_*` |

## 3. 架构总览

### 3.1 形态

npm 分发的双面（host + client）DSH 插件，构建链参照参考插件与官方插件开发规范（`skills/dsh-plugin-development/SKILL.md`）。

```
lbx-agent-team/
├── package.json            # name/exports/main，dsh.bundle.patch + dsh.client 元数据
├── cordis.patch.yml        # insert lbx-agent-team 行（id/name/config）
├── tsconfig.json / tsconfig.client.json   # 双 tsc program（host/client 隔离）
├── tsdown.config.ts        # client bundle（CJS closure + CSS modules + purity gate）
├── src/
│   ├── index.ts            # 入口：inject、Config schema、system prompt 协议段、HTTP 路由、注册工具
│   ├── types.ts            # 数据模型（§4）
│   ├── state.ts            # JSON 持久化 + 进程内锁 + 邮箱（原子写、no-clobber、torn-tail）
│   ├── pipeline.ts         # 状态机与硬门校验（§5）
│   ├── members.ts          # 子代理 spawn/fork + 角色 prompt + worktree 管理（§7）
│   ├── tools.ts            # lbx_agent_team_* 工具（§6）
│   ├── scheduler.ts        # 空闲 pool dever 自动领就绪任务（可配置开关）
│   ├── artifacts.ts        # 由 JSON 真相确定性生成 markdown 工件
│   ├── command.ts          # /lbx-agent-team slash 命令 + 手势边界
│   └── client/             # React 活动面板（§8）
├── docs/                   # README、使用指南、验证指南
├── scripts/verify*.mjs     # 验证脚本
└── assets/                 # 面板图标等静态资源
```

### 3.2 运行模型

- 主会话模型即 **coordinator（captain）**：创建团队、登记名册、拆任务、路由消息、汇总验收；
- planner / checker / tester / dever 是 coordinator spawn 的**可续聊子代理**成员；
- 所有成员经**邮箱**（持久化 inbox jsonl）与 coordinator 或彼此通信；任务状态由工具驱动，成员不直接改状态文件；
- 团队状态落盘 `<workspace>/.lbx-agent-team/<teamId>/`，跨进程重启可恢复（成员子代理会话 id 持久化，可续聊）。

### 3.3 安装与激活

- 安装：`dsh plugin --profile <name> add lbx-agent-team`（npm 或本地路径 / git）；
- 激活：自然语言（"用 LBX Agent Team 做 X"）或 `/lbx-agent-team <目标>` slash 命令；system prompt 协议段在 pre-step 注入确定性激活指令；
- 工具注册进共享 `tools` registry，所有会话可用。

## 4. 数据模型

### 4.1 团队 Team

```ts
interface TeamState {
  id: string            // 净化后的目录 id（稳定身份）
  name: string
  specPath: string      // 必填：spec 文件绝对/相对路径（创建时校验存在）
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
```

### 4.2 成员 Member

```ts
interface TeamMember {
  id: string            // 子代理会话 id（spawn 后填充）
  name: string          // 如 planner / checker / tester / dever-1
  role: 'planner' | 'checker' | 'tester' | 'dever' | string  // 允许自定义角色
  status: 'pending' | 'idle' | 'working' | 'removed'  // pending = 已登记未 spawn
  provider?: string     // spawn 时快照
  model?: string
  reasoningEffort?: string
  worktreePath?: string // dever 专属（worktree 模式）
  branch?: string       // dever 专属
  joinedAt: number
  retiredAt?: number
}
```

### 4.3 任务 Task（pipeline 状态机）

```ts
type TaskStatus =
  | 'pending' | 'claimed' | 'in_progress' | 'in_review'
  | 'approved' | 'committed' | 'tested' | 'complete'
  | 'changes_requested' | 'failed' | 'cancelled'

interface TeamTask {
  id: string
  subject: string
  description?: string
  status: TaskStatus
  assignee?: string     // 成员名 | 'pool' | 'captain'；new-dever 以 dedicated 标记表达
  dedicated?: boolean   // true = 需要专用 dever（懒 spawn）
  dependencies: string[]
  verification?: string // 验证命令或方法描述（tester 执行）
  output?: string
  attempt?: number
  attemptId?: string    // capability；转派/重试作废旧 attempt
  review?: { verdict: 'APPROVE' | 'REQUEST_CHANGES'; reviewer: string; findingsPath?: string; at: number }
  commit?: { hash: string; branch: string; at: number }
  test?: { result: 'PASS' | 'FAIL'; tester: string; reportPath?: string; at: number }
  createdAt: number
  updatedAt: number
}
```

### 4.4 Issue

```ts
interface TeamIssue {
  id: string
  title: string
  severity: 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW'
  status: 'open' | 'resolved'
  taskId?: string
  reporter: string
  responsible?: string   // 成员名；可指向已归档成员（修复时重新 spawn）
  steps?: string
  expected?: string
  actual?: string
  resolution?: { commitHash?: string; at: number }
  createdAt: number
}
```

### 4.5 持久化布局

```
<workspace>/.lbx-agent-team/<teamId>/
├── team.json            # 权威真相（原子写：临时文件 + fsync + rename）
├── inbox/<memberName>.jsonl   # 每成员邮箱（torn-tail 恢复）
├── worktrees/<member>/  # dever worktree（gitWorktrees: true 时）
└── archive/             # 归档团队
```

markdown 工件输出到 `<workspace>/docs/lbx-agent-team/<teamId>/`（任务清单 / review 记录 / 测试报告 / 最终验收报告），由 `lbx_agent_team_artifact` 从 JSON 真相确定性生成。

## 5. pipeline 状态机与硬门

```
pending ──claim──▶ claimed ──start──▶ in_progress ──submit──▶ in_review
in_review ──APPROVE──▶ approved ──commit──▶ committed ──test PASS──▶ tested ──finish──▶ complete
in_review ──REQUEST_CHANGES──▶ changes_requested ──(re-submit)──▶ in_review
任何状态 ──▶ failed / cancelled（终态）
```

**硬门规则（pipeline.ts 校验，非法迁移抛错）：**

| 门 | 条件 |
|----|------|
| claim | 依赖任务全部 `complete`；assignee 匹配（dedicated 任务只能由专属 dever claim） |
| submit → in_review | 实现者为其 dever；携带有效 attemptId |
| APPROVE → approved | 提交者为 checker 角色成员 |
| REQUEST_CHANGES → changes_requested | 同上；退回后原 dever 继续 |
| commit → committed | **必须有 approve 记录** + 有效 commit hash + 插件成功执行 git commit |
| test PASS → tested | 提交者为 tester 角色成员，且任务处于 committed |
| finish → complete | 处于 tested |
| 转派/reassign | 撤销旧 attempt、等待原成员安静后生成新 attempt |

**循环上限**：同一任务 REQUEST_CHANGES 连续 N 次（默认 3，可配置）→ 插件标记 `failed` 并通知 coordinator 上报用户。tester FAIL 转 issue，issue 修复后 tester 重测。

**attemptId capability**：任务每次被 claim/转派生成新 attemptId；成员更新任务必须携带当前 attemptId；陈旧 attemptId 的更新被拒绝（防止迟到结果覆盖）。

## 6. 工具面（lbx_agent_team_*）

| 分类 | 工具 | 职责 |
|---|---|---|
| 团队 | `lbx_agent_team_create` | 必传 spec 路径（不存在则报错"请先生成 spec"）；创建团队、调用者成为 coordinator；autoRoster 时自动登记 planner/checker/tester |
| | `lbx_agent_team_add_member` | role 预设（planner/checker/tester/dever/custom）+ provider/model/effort；dever 可标记 dedicated |
| | `lbx_agent_team_remove_member` | 移除成员，未完成任务转回 pool 并提示 coordinator |
| 任务 | `lbx_agent_team_create_task` | subject/description/dependencies/assignee（成员名 \| pool \| new-dever \| captain）/verification；assignee=new-dever 即 dedicated（存储时归一化为 dedicated 字段） |
| | `lbx_agent_team_claim_task` | dever 领取就绪任务（校验依赖 + 硬门）；dedicated 任务在 claim 时**原子完成 spawn 专用 dever + 建 worktree + 标记 claimed**，然后唤醒该 dever |
| | `lbx_agent_team_update_task` | dever 报进度/输出（需 attemptId）；实现完成 → in_review |
| | `lbx_agent_team_reassign_task` | 转派/收回；撤销旧 attempt 并等待原成员安静 |
| 质量门 | `lbx_agent_team_submit_review` | checker：APPROVE / REQUEST_CHANGES + findings 路径/说明 |
| | `lbx_agent_team_commit_task` | 校验 approve 记录后执行 git commit → committed（记录 hash） |
| | `lbx_agent_team_test_task` | tester：PASS/FAIL + 报告路径 → tested / 失败自动创建 issue |
| | `lbx_agent_team_issue_create` / `lbx_agent_team_issue_resolve` | issue 生命周期 |
| 通信状态 | `lbx_agent_team_send_message` | captain↔member、member↔member 邮箱（持久化、重投） |
| | `lbx_agent_team_status` | 团队快照：成员/任务/issue/阻塞点 |
| | `lbx_agent_team_artifact` | 生成 markdown 工件（任务清单/review/测试报告/最终报告） |
| | `lbx_agent_team_delete` | 归档团队 |

工具实现约束（照官方规范）：

- 所有工具从 `exec.agent` 获取会话/工作区/owner，不猜全局状态；
- 写操作带进程内锁（按 stateRoot + teamId）+ 幂等 + 冲突策略；
- `output.render` 给模型稳定、紧凑、可判定的文本；
- 异步工作观察或转发 `exec.signal`。

## 7. 成员、调度与 git worktree

### 7.1 成员生命周期（懒创建 + 完成即归档，D4）

- 成员在团队文件中**登记**（status=`pending`），子代理在**第一次需要工作时才 spawn**：
  - planner：spec 提交规划时；
  - tester：团队启动、与 planner 并行写测试用例时；
  - checker：首个任务进入 `in_review` 时；
  - dever：任务 `claimed` 时。
- dever 双模式（coordinator 按复杂度选择）：
  - **dedicated**（`assignee: new-dever` + `dedicated: true`）：任务 claimed 时 spawn 专用 dever-N 并建 worktree；任务完成 → dever 归档（worktree 合并并清理）；
  - **pool**：共享 dever 池（默认 dever-1~dever-3，`maxParallelDevers` 封顶）自动领任务；简单任务不铺开子代理。
- 串行链自然表现为"前一个 complete 后一个才 claimed"，活跃子代理数 = 正在执行的任务数；
- 已归档成员若被 issue 追责（responsible 指向归档 dever），修复时基于 issue 上下文**重新 spawn** 修复 dever。

### 7.2 调度器

`autoDispatch: true`（默认）时，idle 的 pool dever 自动领取一个就绪任务并唤醒；dedicated 任务不被 pool 抢占。调度基于真实 `pending/idle/working` 状态，进程内事件驱动，不忙轮询。

### 7.3 git worktree 生命周期（D5）

1. `lbx_agent_team_create` 校验工作区是 git 仓库（`git rev-parse --is-inside-work-tree`），不是则报错提示先 `git init`；
2. spawn dedicated dever 时：插件建 worktree（`<stateDir>/worktrees/<member>/`）+ 独立分支 `team/<teamId>/<taskId>`；
3. dever 在自己的 worktree 里实现 + 跑验证命令；
4. `lbx_agent_team_commit_task`：插件校验 approve 记录 → 在 dever worktree 执行 `git commit`（消息由 dever 提供，作者取 git config）→ 记录 hash；
5. `tested` 后插件把分支合并回主线（`--no-ff`）；冲突时报告 coordinator 协调；
6. `gitWorktrees: false` 时退化为共享工作树 + 串行 commit。

git 执行走 Cordis shell/bash 服务；profile 无该服务时退化为"插件给出精确 git 命令，dever 自己执行并回报 hash"，commit 门仍校验 approve 记录与 hash。

## 8. Client UI（活动面板）

- **内容**：团队名册（角色徽标 + 状态）、任务列表（pipeline 阶段徽标）、依赖 DAG 视图、issue 列表、活动流（谁在做什么）；
- **数据源**：host 提供 `/plugins/lbx-agent-team/state` 路由（JSON 磁盘真相 + 实时子代理活动合并；`Cache-Control: no-store`），面板轮询（in-flight guard、失败保留最后快照）；静态资源经白名单路由 `/plugins/lbx-agent-team/assets`；
- **接入**：conversation 区 dock / `shell.overlay` 浮层（照参考插件实测 slot 模式）；跟随 session、窄屏退回 overlay、键盘/aria/reduced motion 支持；
- 团队归档后保留完整历史（可回看），面板提供归档视图。

## 9. 使用流程（端到端）

```
用户: "/lbx-agent-team 实现 docs/specs/xxx-design.md" 或自然语言
  → 校验 spec 存在（没有则提示先写 spec）
  → coordinator 创建团队 + autoRoster 登记 planner/checker/tester
  → planner spawn 读 spec 拆任务（写任务清单工件）; tester spawn 并行写测试用例
  → 任务创建（pool / new-dever），依赖就绪后 claimed 时 spawn dever（worktree）
  → dever 实现 → update_task → in_review
  → checker spawn → submit_review（APPROVE / REQUEST_CHANGES，循环上限超限上报）
  → commit（硬门）→ tester 验证（verification 命令）→ tested
  → 分支合并回主线 → 最终验收报告工件 → 用户验收 → 团队归档
```

## 10. 系统提示词与 slash 命令

- system prompt 协议段（order 117，可配置）写明：何时用、create → add_member → create_task → 委派 → 监控（status）→ 汇总 → delete 的协议；成员创建零交互（沿用队长 provider/model/effort，用户明确指定才传参）；
- `/lbx-agent-team <目标>` 封闭命名空间 slash 命令 + 手势边界（headless 也生效）；`slashCommand: false` 可关闭，仅保留自然语言触发。

## 11. 配置

```yaml
- id: lbx-agent-team
  config:
    stateDir: .lbx-agent-team   # 状态根
    memberProvider: spawn       # spawn | fork
    memberModel:                # 可选全成员模型覆盖
    maxMembers: 12
    maxParallelDevers: 3        # 并行 dever 上限
    autoRoster: true            # 创建团队自动登记 planner/checker/tester
    autoDispatch: true          # 空闲 pool dever 自动领任务
    gitWorktrees: true          # dever worktree 隔离
    artifactsDir: docs/lbx-agent-team  # markdown 工件输出
    maxReviewLoop: 3            # REQUEST_CHANGES 连续上限
    promptSectionOrder: 117
    slashCommand: true
```

## 12. 分发

- npm publish（`lbx-agent-team`）+ GitHub git 安装路径（`dsh plugin --profile <name> add github:<owner>/<repo>`）；
- README 提供经全新 profile 验证的安装命令；文档含使用指南、验证指南、插件开发说明；
- 附带 `dsh-plugin-development` 类开发 skill 可选（阶段 2）。

## 13. 验证计划

- 单元：状态机迁移/硬门、文件往返/锁/归档恢复、client 投影纯函数；
- 组合：scratch profile + `dsh --dump-config` 断言 bundle 层/行 id/注入顺序；headless 跑一个小任务断言端到端 pipeline；
- 从零安装：npm 与 git 两种路径，全新临时 DSH_HOME/profile；
- GUI：真实浏览器验证面板（名册/路由/刷新/宽窄屏/焦点/reduced motion）；HMR/dispose 安全测试。

## 14. 已知限制

- 单 DSH 进程内串行写；多进程同时改同一团队不保证一致（与参考插件一致）；
- 状态为磁盘真相，模型偶发不按协议更新状态时面板如实展示（协议层可加提示）；
- worktree 模式要求工作区为 git 仓库；
- 跨 LLM provider 异构分工依赖成员 spawn 时的 provider/model 显式指定，不自动做负载均衡。

## 15. 里程碑

- **M1（本 spec 范围）**：host 工具 + 状态机 + 成员/worktree 管理 + system prompt + slash 命令 + markdown 工件 + client 活动面板 + 验证矩阵 + 分发（npm/git）。
- **M2（后续）**：可选开发 skill 打包、面板交互增强（操作按钮）、多团队对比视图。
