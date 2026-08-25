# 使用指南（详细）

本文档收纳 lbx-agent-team 的详细使用内容：架构与数据链路、状态文件布局、17 个工具的完整契约（参数 / 硬门 / 错误文案）、任务状态机、配置详解与已知限制。README 只保留简介与快速上手。

## 工作原理

`lbx-agent-team` 复用 DSH 的能力接缝（capability seam），不依赖 workflow 引擎：

| DSH 能力 | 插件用法 |
| --- | --- |
| `ctx.tools` 注册表 | 注册 17 个 `lbx_agent_team_*` 工具（与 `tool-workflow` 同一注册路径） |
| `ctx.subagents.startContinuable()` / `followup` | 创建/唤醒成员：durable 可续聊子代理，带角色 persona |
| `ctx.systemPrompt.section()` | 注册"LBX Agent Team 使用协议"提示段（顺序 `promptSectionOrder`，默认 117） |
| `ctx.commands.register` | 注册 `/lbx-agent-team` 宿主命令（slash 菜单可见） |
| `agent/pre-step` | 手势边界：以 `/lbx-agent-team` 开头的真实用户消息确定性注入激活指令（headless 同样生效） |
| `agent/status` | 成员 turn 结束（idle）时同步团队状态并泵派发（member idle 触发点） |
| Web server 路由 | 活动面板数据路由 `/plugins/lbx-agent-team/state`（`webServer`/`httpServer`、`workspaceRegistry`/`workspace` 双键兼容；webless profile 保持 tool-only 不阻塞启动） |
| 文件系统 | 团队状态持久化在 `<workspace>/<stateDir>/<teamId>/` |
| `ctx.shell` | git worktree / commit / merge（无 shell 服务时 `localShell` 兜底，测试与 headless 用） |

数据链路：工具执行 → 磁盘状态（真相源）→ host 快照路由 → Web 面板轮询渲染。会话日志事件继续写入（审计/重放/复盘）。

任务状态机：`pending → claimed → in_progress → in_review → approved → committed → tested → complete`，另有 `changes_requested` 与终态 `failed` / `cancelled`；状态迁移在白名单内校验。

### 团队状态文件

```text
<workspace>/.lbx-agent-team/<teamId>/
├── team.json            # 团队记录：成员、任务（含依赖/attempt/评审/提交/测试）、issue
├── inbox/               # 邮箱：captain.jsonl + <member>.jsonl（JSONL，容忍 torn tail）
├── artifacts/           # tasklist.md、reviews/<taskId>.md、tests/report.md、final-report.md
└── worktrees/           # dever 工作区：<member>/<taskId>/（分支 team/<teamId>/<taskId>）

<workspace>/.lbx-agent-team/archive/<teamId>/   # delete 归档区（完整历史保留）
```

- `teamId` = 团队名的净化小写形式（`sanitizeKey`：非字母数字点下划线中划线字符替换为 `-`，最长 64 字符）。
- 所有写操作在进程内 per-`(stateRoot, teamId)` 锁中串行化，并以"临时文件 + fsync + rename"原子发布。
- 每次执行携带单调 `attempt` + 唯一 `attemptId`（能力）；转派/移除/接管先使旧 attempt 失效，再中断并等待旧成员安静，因此迟到更新无法覆盖新结果。

## 任务状态机

每个状态允许的动作（`src/pipeline.ts` 白名单）：

| 状态 | 允许动作 | 下一状态 |
| --- | --- | --- |
| `pending` | claim / fail / cancel | claimed / failed / cancelled |
| `claimed` | start / fail / cancel | in_progress / failed / cancelled |
| `in_progress` | submit / fail / cancel | in_review / failed / cancelled |
| `in_review` | approve / request_changes / fail / cancel | approved / changes_requested / failed / cancelled |
| `changes_requested` | submit / fail / cancel | in_review / failed / cancelled |
| `approved` | commit / fail / cancel | committed / failed / cancelled |
| `committed` | test / fail / cancel | tested / failed / cancelled |
| `tested` | finish / fail / cancel | complete / failed / cancelled |
| `complete` / `failed` / `cancelled` | （终态，无动作） | — |

工具到动作的映射：`claim_task` → claim；`update_task`（claimed 上任意更新）→ start；`update_task done:true` → submit；`submit_review APPROVE/REQUEST_CHANGES` → approve / request_changes；`commit_task` → commit；`test_task PASS` → test；`update_task done:true`（队长，tested 上）→ finish；`cancel_task` → cancel。

### 硬门（Hard Gates）

| 门 | 校验 | 错误文案 |
| --- | --- | --- |
| `claimGate` | claim 前所有依赖必须 `complete` | `dependencies not complete: <id1>, <id2>` |
| `approveGate` | 只有 checker 角色成员能 APPROVE / REQUEST_CHANGES | `only a checker member may review` |
| `commitGate` | commit 前必须有 APPROVE 记录 | `task has no APPROVE record` |
| `testGate` | 只有 tester 角色成员能测试，且任务必须 `committed` | `only a tester member may test` / `task must be committed before testing` |
| 白名单迁移 | 状态迁移必须在白名单内 | `cannot <action> a task in status <status>` |
| attempt 能力 | 更新必须携带当前 `attemptId` | `stale attemptId — task was reassigned` |

连续 `REQUEST_CHANGES` 次数超过 `maxReviewLoop`（默认 3）时任务置为 `failed`（`reviewLoop` 计数）。

### 成员状态

`pending`（已登记未 spawn）→ `idle`（已 spawn 等待）→ `working`（正在执行轮次）→ `removed`（已移除/退休）。

- 成员先登记（`id=''`、`status='pending'`），首次需要干活时才惰性 spawn：pool dever 在首次 claim 时 spawn（autoDispatch 也会把 pending pool dever spawn 到 `maxParallelDevers`）；专属 dever 在其任务被 claim 时 spawn。
- 队长专属工具对成员不可见（`toolFilter` 拒绝）：`create`、`add_member`、`remove_member`、`reassign_task`、`create_task`、`cancel_task`、`delete` 共 7 个。
- 成员标签前缀 `lbx-agent-team:<teamId>:<memberName>`。
- LLM 路由快照：成员沿用队长当前 provider/model 时快照其思考强度；provider 或 model 任一改变时自动使用目标模型默认档；显式 `reasoningEffort`（目标模型支持的档位 id，或 `"default"`）优先并在创建前校验。

## 工具契约（17 个）

错误文案均为源码实际抛出（`src/tools/*.ts` + `src/tools/helpers.ts`）。所有工具都需要调用者是队长或活动成员，否则：

- `you are not leading any active team — call lbx_agent_team_create first`（队长路径）
- `you do not lead or belong to any active team yet`（参与人路径）
- `you are neither the captain nor an active member of this team`（身份重推导失败）
- `lbx_agent_team tools require a calling agent`（无调用 agent）

### 团队工具（4 个）

#### `lbx_agent_team_create`

创建团队，调用者成为队长（单队长单团队）。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `name` | ✅ | 团队名（也是稳定 id，净化后） |
| `spec` | ✅ | spec 文档路径（工作区相对或绝对），**必须已存在** |
| `description` | — | 团队目标/用途 |

门：

- spec 文件必须存在：`spec file not found: <path> — generate the spec document first`。
- `gitWorktrees` 开启（默认）时工作区必须是 git 仓库：`workspace is not a git repository — run git init first`。
- 团队 id 未被占用：`team "<id>" already exists — pick another name or delete it first`。
- 队长没有其他活动团队：`you already lead team "<name>" — end it before creating another`。
- 名称非空：`team name must not be empty`；spec 非空：`spec path must not be empty`。

`autoRoster` 开启时自动登记 planner / checker / tester 三个成员（`status=pending`）。

#### `lbx_agent_team_add_member`（队长专用）

登记 durable 成员（惰性 spawn）。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `name` | ✅ | 团队内唯一成员名 |
| `role` | ✅ | `planner` / `checker` / `tester` / `dever` 或自定义角色 |
| `provider` | — | 可选 LLM provider 路由；需与 `model` 同传 |
| `model` | — | 可选模型覆盖 |
| `reasoningEffort` | — | 可选思考强度覆盖 |

门：

- 名称非空：`member name must not be empty`。
- `captain` 为保留名：`member name "captain" is reserved for the captain`。
- 团队内唯一：`member name "<name>" is already used in team "<team>"`。
- 成员上限：`member limit <N> reached`（`maxMembers`）。

dever 成员在 `gitWorktrees` 开启时于 spawn/claim 时创建独立 worktree + 分支。

#### `lbx_agent_team_remove_member`（队长专用）

参数：`member`（✅ 要移除的成员名）。撤销其当前 attempt，把所有未完成任务退回共享池（`assignee=pool`、`pending`、attempt 失效、dedicated 解除、worktree/分支清理），标记成员 removed，并 interrupt + quiesce 其正在进行的轮次。

门：`member not found: "<name>"`。

#### `lbx_agent_team_delete`（队长专用）

无参数。归档团队：`status=archived`、移除成员 worktree（best effort）、标记成员 removed、中断所有已 spawn 成员，并把团队目录原子移动到 `<stateDir>/archive/<teamId>/`。归档后 status/update 工具不再能找到该团队。

### 任务工具（8 个）

#### `lbx_agent_team_create_task`（队长专用）

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `subject` | ✅ | 任务简短标题 |
| `description` | — | 详细要做什么 |
| `assignee` | — | 成员名 / `pool`（默认，共享 dever 池，依赖就绪后自动派发）/ `new-dever`（claim 时惰性 spawn 专属 dever）/ `captain` |
| `dependencies` | — | 必须先 `complete` 的任务 id 数组 |
| `verification` | — | tester 将执行的精确验证命令/方法 |

门：`task subject must not be empty`；依赖必须存在：`dependency "<id>" does not exist in team "<team>"`；assignee 必须是活动成员：`assignee "<name>" is not an active member`。

#### `lbx_agent_team_claim_task`（参与者）

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `taskId` | ✅ | 要领取的任务 id |
| `member` | — | 领取成员名（pool/captain 任务）；专属任务自动推导 dever 名 |

返回 `attempt_id`（该任务后续所有更新的能力凭证，转派后失效）。pool 任务由 pool dever 自己领取，或队长代具名 pool dever 领取；专属任务（`assignee=new-dever`）由队长领取——插件原子完成 spawn 专属 dever + 建 worktree + 置 working + 唤醒；captain 任务由队长领取（无 spawn/worktree）。

门：任务必须 `pending`：`task <id> is not claimable (status <status>)`；依赖必须全部 complete：`dependencies not complete: <id1>, <id2>`；专属任务仅队长可领：`only the captain may claim a dedicated task`。

#### `lbx_agent_team_update_task`（参与者，持 attempt）

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `taskId` | ✅ | 任务 id |
| `output` | — | 进度或最终输出摘要 |
| `attemptId` | — | claim_task 返回的当前 attempt 能力；任务已有 attempt 时必须携带 |
| `done` | — | `true` 提交评审（`in_progress`/`changes_requested` → `in_review`，assignee 转 idle）；队长在 `tested` 任务上传 `done:true` 则完成（`tested` → `complete`，清理 worktree、归档专属 dever） |

门：`stale attemptId — task was reassigned`；迁移白名单：`cannot <action> a task in status <status>`。claimed 上任意更新即 start（`claimed` → `in_progress`）；`in_progress` 上的 output 更新不迁移状态。

#### `lbx_agent_team_reassign_task`（队长专用）

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `taskId` | ✅ | 要重试/转派的任务 |
| `to` | ✅ | `"pool"` / 活动成员名 / `"captain"` |

先撤销未完成任务当前 attempt，再交接；旧 assignee 在新状态写入前被中断并 quiesce，迟到更新以 stale 拒绝。`complete` 任务不可变；`failed`/`cancelled` 任务可借此重试。

#### `lbx_agent_team_submit_review`（checker 专用）

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `taskId` | ✅ | 被评审任务 |
| `verdict` | ✅ | `APPROVE` / `REQUEST_CHANGES` |
| `findingsPath` | — | 评审记录路径（约定在 `artifacts/reviews/` 下） |

门：`only a checker member may review`；任务必须 `in_review`。`APPROVE` → `approved`（可提交）；`REQUEST_CHANGES` → `changes_requested`（assignee 修复后 `update_task done:true` 重提），并累加 `reviewLoop`，超过 `maxReviewLoop` 置 `failed`。

#### `lbx_agent_team_commit_task`（参与者）

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `taskId` | ✅ | 已批准任务 id |
| `message` | ✅ | 提交信息（dever 提供） |
| `commitHash` | — | 无 shell 服务时的手动提交 hash（第二次调用） |

在任务 dever 的 worktree（captain 任务用工作区）执行 `git add -A` + `git commit` 并记录 hash；空 diff 容忍（记录当前 HEAD hash）。需要 DSH shell 服务；没有时返回 `manual:true` + 待执行命令列表，调用者执行后带 `commitHash` 再次调用。hash 必须匹配 `/^[0-9a-f]{40}$/`：`invalid commit hash: <hash>`。

门：`task has no APPROVE record`；任务必须 `approved`（`cannot commit a task in status <status>`）。

#### `lbx_agent_team_test_task`（tester 专用）

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `taskId` | ✅ | 已 committed 任务 id |
| `result` | ✅ | `PASS` / `FAIL` |
| `reportPath` | — | 测试报告路径（约定在 `artifacts/tests/` 下） |

`PASS` → `tested`，worktree 模式下把分支 `--no-ff` 合并回主线（冲突报告进队长邮箱）；`FAIL` → 任务保持 `committed` 并同步开出 HIGH issue（assignee = 任务 assignee）。

门：`only a tester member may test`；`task must be committed before testing`。

#### `lbx_agent_team_cancel_task`（队长专用）

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `taskId` | ✅ | 要取消的任务 id |
| `reason` | — | 取消原因（记录到 `task.reason`） |

把未完成任务迁移到终态 `cancelled`，并记录 `cancelledAt` / `cancelledBy` / `reason`。若成员持有任务（claimed/in_progress）：成员置 idle，运行中则 interrupt + quiesce；本轮派发泵跳过该成员（不自动派发新任务，队长自行安排）。专属任务清理 worktree + 分支；专属 dever 已 spawn 且无其他未完成任务时归档（`removed` + `retiredAt`）。其他 idle dever 仍可领取就绪任务。

门：终态不可取消：`cannot cancel a task in status <status>`；任务不存在：`task not found: <id>`。

### 通信 / 状态 / 工件工具（5 个）

#### `lbx_agent_team_issue_create`（任何活动参与者）

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `title` | ✅ | 简短标题 |
| `severity` | ✅ | `BLOCKER` / `HIGH` / `MEDIUM` / `LOW` |
| `taskId` | — | 关联任务 id（须存在） |
| `responsible` | — | 负责修复的成员；默认取任务 assignee |
| `steps` / `expected` / `actual` | — | 复现步骤 / 期望 / 实际 |

`lbx_agent_team_test_task` 在 FAIL 时自动创建 issue；本工具用于手动上报。门：`issue title must not be empty`；`task not found: <id>`。

#### `lbx_agent_team_issue_resolve`（队长或报告人）

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `issueId` | ✅ | 要解决的 issue id |
| `commitHash` | — | 可选修复提交 hash（40 hex） |

门：`issue not found: <id>`；`only the captain or the issue reporter may resolve this issue`；`issue <id> is already <status>`；`invalid commit hash: <hash>`。`open` → `resolved`。

#### `lbx_agent_team_send_message`（任何活动参与者）

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `to` | ✅ | `"captain"` 或成员名 |
| `content` | ✅ | 消息文本 |

消息持久化到收件人邮箱；成员收件人同时被唤醒（best effort），消息成为其下一轮次。通过 `lbx_agent_team_status` 检查自己的收件箱。

#### `lbx_agent_team_status`（任何活动参与者）

无参数。返回团队快照：members、tasks、issues、blockers（依赖未完成的任务）、readyQueue（依赖已就绪的 pending 任务）、调用者未读收件箱。轮询此工具观察进度。

#### `lbx_agent_team_artifact`（任何活动参与者）

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `kind` | ✅ | `tasklist` / `review` / `testreport` / `final` |
| `taskId` | kind=review 时必填 | 评审对应的任务 id |

从团队 JSON 真相确定性生成 markdown 工件并写入 `<stateDir>/<teamId>/artifacts/`（`tasklist.md`、`reviews/<taskId>.md`、`tests/report.md`、`final-report.md`），返回写入路径。

## 配置详解

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `stateDir` | `.lbx-agent-team` | 团队状态目录名（工作区下） |
| `memberProvider` | `spawn` | 成员子 Agent 运行后端（`spawn` / `fork`）——不是 LLM provider |
| `memberModel` | — | 所有成员的模型默认覆盖 |
| `maxMembers` | `12` | 成员上限（不含队长） |
| `maxParallelDevers` | `3` | 并行 pool dever 上限（调度器按此保证 pool 大小） |
| `autoRoster` | `true` | create 时自动登记 planner/checker/tester |
| `autoDispatch` | `true` | 就绪 pool 任务自动派发给 idle dever |
| `gitWorktrees` | `true` | dever 使用独立 git worktree；`false` 时共享工作树（无 worktree 操作） |
| `artifactsDir` | `docs/lbx-agent-team` | **保留项**：工件实际写入 `<stateDir>/<teamId>/artifacts/`（源码注释明确如此） |
| `maxReviewLoop` | `3` | 连续 REQUEST_CHANGES 上限，达到上限即置 failed |
| `promptSectionOrder` | `117` | usage 提示段顺序 |
| `slashCommand` | `true` | 注册 `/lbx-agent-team` slash 命令 + 手势边界；`false` 只保留自然语言触发 |

最终 LLM 路由优先级：成员显式 `provider` + `model` / `model` → `memberModel` → 队长当前路由。

## 使用协议

提示段指导模型按协议执行：建团队（`lbx_agent_team_create`）→ 按角色拉成员（`add_member`）→ 拆任务并声明依赖（`create_task`）→ 共享调度器自动领取并唤醒空闲成员 → 队长监控/引导 → 阻塞时先安全转派或接管（`reassign_task`）→ 汇报后归档（`delete`）。成员之间通过 `send_message` 直达，无需队长中转；所有任务状态更新携带当前 `attemptId`。

## 已知限制

- **共享工作树提交路径的误收风险**：队长任务 / `gitWorktrees: false` / worktree 创建失败回退时，提交在主工作区执行 `git add -A`，会扫入无关未跟踪文件（Task 19 e2e 曾撞到，见验证记录 CONCERNS #4）。建议优先 worktree 流程；共享树回退路径的暂存收紧计划在 M2。

- **一个队长同一时间只能带一个活动团队。** 必须先结束当前团队才能创建第二个。
- **状态为文件级持久化，在单个 DSH 进程内串行化。** 多个进程同时修改同一团队不保证一致。
- **`gitWorktrees` 需要工作区是 git 仓库。** 非 git 仓库时 `create` 报 `workspace is not a git repository — run git init first`；可设 `gitWorktrees: false` 关闭。
- **spec 文件必填。** 创建团队前 `docs/specs/xxx.md` 必须已存在，`create` 校验缺失即报错。
- **模型不总是严格走工具"仪式"。** 模型可能完成工作却没按协议更新任务状态；面板如实展示磁盘真相，队长以 `lbx_agent_team_status` / 状态文件为准汇总。
- **peer 双实例组合（Task 19/20 关注点，非阻塞）。** 插件从自身 `node_modules` 解析 `@deepseek-ai/dsh-*`（devDeps `0.1.0-rc.8`），宿主 CLI 闭包为 `0.1.1-rc.2`（dsh-base/headless 经 flat-module fallback 解析）；同一进程内出现两套版本实例。实测工具调用、注入、状态机全部正常，但这是发布前需评估对齐的风险点。
- **git 安装缺 `lib/` 的隐蔽失败（Task 20 实测）。** `lib/` 被 .gitignore 忽略；不带构建产物的 git 安装：`dsh plugin add` 成功（files 白名单中缺失条目静默跳过）、`--dump-config` 也成功（只组合 patch YAML、不 import 模块），失败发生在**启动/插件树加载**：

  ```text
  Error: dsh: plugin tree failed to load: failed to apply loader entry include (cordis:include):
    failed to import loader entry lbx-agent-team (lbx-agent-team):
    Cannot find module '.../lbx-agent-team/lib/index.js' imported from ...
  Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../lbx-agent-team/lib/index.js'
  ```

  **排查：** `ls <profile>/node_modules/lbx-agent-team/lib` 为空即定位。**解决：** 安装含 `lib/` 的 tag / Release 快照（推荐，Task 20 决策 c），或私有仓库 `git add -f lib` 提交构建产物（方案 a）；不建议 prepare 脚本方案（b），它重新引入 registry 依赖与逐消费者 allowBuilds 手动门禁。
- **registry 镜像陈旧（环境）。** `registry.npmmirror.com` 对 `@deepseek-ai/dsh-headless` 解析出 `0.0.1-rc.1` 且其依赖 404，安装失败。使用官方 registry 或本地链接安装（tarball/git 路径完全绕开 registry）。
- **载体任务遗留（Task 19 观察）。** 内部为唤醒成员而建的"评审/验证载体任务"在流程收尾后可能停在 `in_review`；其产物已落盘不影响交付，可作后续迭代优化点。
- **headless 需要 LLM 配置。** 无 API key 时会话无法真实执行。
- **`artifactsDir` 尚未接线。** 工件实际落在 `<stateDir>/<teamId>/artifacts/`，而非 `config.artifactsDir`。

## 验证

- **离线与组合：** `pnpm install && pnpm build && pnpm verify`（构建 + `node --test` 单元测试 + `scripts/verify-composition.mjs` 组合验证：17 工具注册、usage 提示段、slash 命令/手势边界、create 冒烟、state 路由、webless mount）。
- **真实 e2e：** 见 `docs/verification-scratch-profile.md`（Task 19：scratch profile + 真实 LLM 全流程）与 `docs/verification-from-zero-install.md`（Task 20：tarball 与 git 从零安装）。