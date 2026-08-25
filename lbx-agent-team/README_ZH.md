<p align="right">
  <a href="./README.md">English</a> · <strong>简体中文</strong>
</p>

# LBX Agent Team

**把一个 DeepSeek Harness 会话变成由协调者（coordinator）领导的多人开发团队。** 当前会话成为**队长（captain）**：拉入可续聊的子 Agent 成员（planner / checker / dever / tester），把 spec 拆成带依赖的任务，并通过带硬门（hard gate）的流水线（实现 → 评审 → 提交 → 验证 → 完成）驱动交付，全程配 git worktree 隔离、文件持久化状态、自动共享任务调度与实时 Web 活动面板。

<p align="center">
  <img src="https://img.shields.io/badge/DeepSeek%20Harness-plugin-202724" alt="DeepSeek Harness 插件">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT 许可证">
</p>

> [!NOTE]
> `lbx-agent-team` **尚未发布到 npm**。本 README 覆盖已验证的本地分发路径——源码构建、本地 tarball、git 安装——并如实写明每条路径在真实实例上验证过的命令。

## 亮点

| 能力 | 带来的变化 |

| --- | --- |
| **协调者领导团队** | 当前会话就是队长：建队、分配角色、汇总最终结果。 |
| **流水线硬门** | 任务按 `pending → claimed → in_progress → in_review → approved → committed → tested → complete` 流转；每一步迁移都在白名单内校验，并有硬门约束（依赖未完成不能领取、只有 checker 能评审、无 APPROVE 记录不能提交、只有 tester 能测试）。 |
| **可续聊成员** | 成员是 durable 的 DSH 子 Agent，按需惰性 spawn、随时唤醒——没有常驻进程。 |
| **git worktree 隔离** | 每个 dever 任务在独立 worktree + 分支中实现；tester PASS 后用 `--no-ff` 合并回主线，冲突进队长邮箱。 |
| **持久化状态** | 团队、任务、issue、attempt 能力与邮箱都落在磁盘 `<workspace>/.lbx-agent-team/` 下；Web 面板读取这份磁盘真相并与实时子 Agent 活动合并展示。 |
| **Web 活动面板** | 实时名册、分段进度、可交互任务 DAG——见 [Web UI](#web-ui)。 |

## 安装

> [!NOTE]
> 需要先安装 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh` CLI）。

插件尚未发布 npm；以下三条路径均已在全新 profile 上端到端验证（记录见 `docs/` 下的 Task 19 / Task 20 验证报告）。

### 1. 源码构建（已验证）

```sh
cd /path/to/dsh-plugins/lbx-agent-team
pnpm install
pnpm build                 # 产出 lib/（host + client bundle）
dsh plugin --profile web add "$PWD"
```

修改源码后重新执行 `pnpm build`；本地安装会保持链接到当前源码目录。校验组合配置、重启 DSH，然后刷新 Web UI：

```sh
dsh --profile web --dump-config   # 应出现 lbx-agent-team 层
dsh web
```

> [!NOTE]
> `dsh plugin` 把插件写入该 profile 的 `package.json`/manifest，并把 bundle 追加进 `dsh.profile.bundles`。**重启 dsh 服务后**插件才会加载。

### 2. 本地 tarball（已验证）

```sh
cd /path/to/dsh-plugins/lbx-agent-team
pnpm pack --out /tmp/lbx-agent-team-0.1.0.tgz
dsh plugin --profile web add /tmp/lbx-agent-team-0.1.0.tgz
```

已验证：全新 profile 安装零 peer 解析、无冲突；4 个 `exports` 全部可解析；web 服务启动冒烟通过，client bundle 正常服务。

### 3. git 安装（已验证路径；推荐发布快照）

- **发布快照（推荐——Task 20 决策）：** 发布一个包含构建产物 `lib/` 的 tag 或 Release tarball，然后按 tag 安装：

  ```sh
  dsh plugin --profile web add github:<owner>/<repo>#<tag>
  ```

  或直接指向 Release tarball URL。插件的 `lib/` 被 .gitignore 忽略，因此 tag 必须由发布脚本产出（build → 组装可发布内容 → `git add -f lib` → 打 tag）。

- **私有仓库回退（已验证）：** 把 `lib/` 提交进仓库（`git add -f lib`），再直接安装仓库：

  ```sh
  dsh plugin --profile web add git+<repo-url>
  ```

  已用 `git+file://` 对包含强制提交 lib/ 的临时仓库验证通过。

> [!WARNING]
> 若安装的源码**没有 `lib/`**，`dsh plugin add` 与 `--dump-config` 都会静默成功，失败只会在**启动/插件树加载**时出现：`Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../lbx-agent-team/lib/index.js'`。排查：`ls <profile>/node_modules/lbx-agent-team/lib` —— 为空即说明装到了没有构建产物的源码。详见[已知限制](#已知限制)。

## 使用

**必须先有 spec 文件**再创建团队——`lbx_agent_team_create` 会校验文件存在，缺失时报错。示例 spec：`docs/specs/xxx.md`。

**Web GUI** —— 输入 slash 命令加目标，或直接用自然语言描述目标：

```text
/lbx-agent-team 实现 docs/specs/xxx.md
```

该行会原样保留在聊天记录中；手势边界会在 pre-step 确定性注入激活指令，队长协议立即启动。

**headless CLI**（Task 19 已用真实 LLM 端到端验证）：

```sh
dsh --profile scratch "用 LBX Agent Team 实现 docs/specs/demo.md"
```

## 工作方式

1. 当前会话调用 `lbx_agent_team_create`（或 slash 命令触发）并成为**队长**；`autoRoster` 自动登记 planner / checker / tester。
2. 队长补充 dever——具名成员（`lbx_agent_team_add_member`，role `dever`）或专属任务（`assignee=new-dever`，claim 时惰性 spawn）。成员只在第一次需要干活时才 spawn。
3. planner 读 spec 产出任务清单（artifact + 消息）；队长据此创建带显式 `dependencies` 与 `verification` 的任务。
4. 共享调度器把每个就绪的 pool 任务派给一个 idle dever（上限 `maxParallelDevers`）；dever 在独立 git worktree 中实现。
5. 硬门驱动流水线：依赖全部 complete 才能 claim → 实现 → checker 评审（`APPROVE` / `REQUEST_CHANGES`，连续次数上限 `maxReviewLoop`）→ 提交（必须有 `APPROVE` 记录）→ tester `PASS` / `FAIL`（任务必须已 committed；`FAIL` 自动开 issue）→ 队长完成收尾。
6. 队长汇总结果并归档团队（`lbx_agent_team_delete`），完整记录保留在 `<stateDir>/archive/` 下。

团队状态位于 `<workspace>/.lbx-agent-team/<teamId>/`（team.json、邮箱、工件、worktree）。每次写入都在进程内 per-team 锁中串行化，并以原子方式发布（tmp + fsync + rename）。

插件复用 DSH 的能力接缝（capability seam），而不是重新发明：

| DSH 能力 | LBX Agent Team 用法 |
| --- | --- |
| `ctx.tools` 注册表 | 16 个 `lbx_agent_team_*` 工具 |
| `ctx.subagents.startContinuable()` / `followup` | durable 成员：惰性 spawn、按需唤醒 |
| `ctx.systemPrompt.section()` | 使用协议提示段（顺序 `promptSectionOrder`） |
| `ctx.commands.register` | `/lbx-agent-team` 宿主命令 |
| `agent/pre-step` | 确定性手势边界（headless 同样生效） |
| `agent/status` | 成员 idle → 同步团队状态 + autoDispatch 派发泵 |
| Web server 路由 | `/plugins/lbx-agent-team/state`（webServer / httpServer 双键兼容） |
| 文件系统 | 状态根 `<workspace>/.lbx-agent-team/` |
| `ctx.shell` | git worktree / commit / merge（测试与 headless 用本地兜底） |

任务状态机（白名单校验）：`pending → claimed → in_progress → in_review → approved → committed → tested → complete`，另有 `changes_requested`（重提后回到 `in_progress`）与终态 `failed` / `cancelled`。

## Web UI

- 团队创建后右上角出现活动面板：队长、分段进度、状态统计、可折叠成员树、紧凑任务 DAG（真实 SVG 依赖曲线）。
- 面板读取磁盘真相（`.lbx-agent-team/<teamId>/team.json`）并与 agent registry 的实时子 Agent 活动合并；点击成员可打开其可续聊会话。
- 归档团队保留完整历史，在 `<stateDir>/archive/` 下可继续查看。

## Slash 命令

`/lbx-agent-team <目标>` —— 注册为封闭命名空间的宿主命令，Web GUI 的 slash 菜单可见。任何以 `/lbx-agent-team` 开头的真实用户消息（含 headless CLI 输入）都会经手势边界确定性激活协议；句子中间出现的字样仍是普通文本。设 `slashCommand: false` 可同时关闭 slash 命令与手势边界，只保留自然语言触发。

## 配置

默认配置可直接使用。受信任的 Profile 可以覆盖成员行为：

```yaml
- id: lbx-agent-team
  config:
    stateDir: .lbx-agent-team
    memberProvider: spawn
    memberModel: deepseek-v4
    maxMembers: 12
    maxParallelDevers: 3
    gitWorktrees: true
```

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `stateDir` | `.lbx-agent-team` | 团队状态目录名（工作区下） |
| `memberProvider` | `spawn` | 成员子 Agent 运行后端（`spawn` / `fork`）——**不是** LLM provider |
| `memberModel` | — | 所有成员的模型默认覆盖（可选） |
| `maxMembers` | `12` | 成员上限（不含队长） |
| `maxParallelDevers` | `3` | 并行 pool dever 上限 |
| `autoRoster` | `true` | create 时自动登记 planner/checker/tester |
| `autoDispatch` | `true` | 就绪 pool 任务自动派发给 idle dever |
| `gitWorktrees` | `true` | dever 使用独立 git worktree（需要 git 仓库） |
| `artifactsDir` | `docs/lbx-agent-team` | 保留项；工件目前实际写入 `<stateDir>/<teamId>/artifacts/` |
| `maxReviewLoop` | `3` | 连续 REQUEST_CHANGES 上限，超限置 failed |
| `promptSectionOrder` | `117` | usage 提示段顺序 |
| `slashCommand` | `true` | 注册 `/lbx-agent-team` + 手势边界 |

跨 LLM provider 路由通过 `lbx_agent_team_add_member` 的可选 `provider` + `model`（+ `reasoningEffort`）按成员表达——绝不通过 `memberProvider`。

## 使用边界

- **单队长单团队。** 队长必须先结束当前团队，才能创建第二个。
- **状态为文件级持久化，在单个 DSH 进程内串行操作。** 多个进程同时编辑同一团队不保证一致。
- **`gitWorktrees` 要求工作区是 git 仓库**；否则 `create` 会大声报错（或设 `gitWorktrees: false`）。
- **创建团队前 spec 文件必须已存在**——`lbx_agent_team_create` 会校验。
- 模型偶尔可能完成工作却没有按协议更新任务状态；面板如实展示磁盘真相，队长以 `lbx_agent_team_status` / 状态文件为准汇总。

## 工具一览（16 个）

| 工具 | 作用 |
| --- | --- |
| `lbx_agent_team_create` | 创建团队，调用者成为队长（要求 spec 文件 + git 仓库） |
| `lbx_agent_team_add_member` | 登记 durable 成员（惰性 spawn；可选 provider/model/effort） |
| `lbx_agent_team_remove_member` | 移除成员：撤销 attempt、回收未完成任务、静默其正在进行的轮次 |
| `lbx_agent_team_delete` | 归档团队，完整记录保留在 `archive/` 下 |
| `lbx_agent_team_create_task` | 创建带依赖与 assignee（`pool` / `new-dever` / 成员 / `captain`）的任务 |
| `lbx_agent_team_claim_task` | 领取就绪任务（依赖须全部完成）；返回 `attempt_id` 能力 |
| `lbx_agent_team_update_task` | 上报进度并驱动流水线（`done:true` 提交评审 / 完成已 tested 任务） |
| `lbx_agent_team_reassign_task` | 队长专用重试/转派；先撤销旧 attempt |
| `lbx_agent_team_submit_review` | checker 评审：APPROVE 或 REQUEST_CHANGES（有轮次上限） |
| `lbx_agent_team_commit_task` | 在 worktree 中提交已批准任务；无 shell 服务时提供手动回退 |
| `lbx_agent_team_test_task` | tester 判定：PASS 合并分支回主线；FAIL 自动开 issue |
| `lbx_agent_team_issue_create` | 记录 issue（任何参与人；tester FAIL 时自动创建） |
| `lbx_agent_team_issue_resolve` | 解决 open issue（队长或报告人） |
| `lbx_agent_team_send_message` | 给队长或队友发持久化消息（唤醒收件人） |
| `lbx_agent_team_status` | 团队快照：成员、任务、阻塞项、就绪队列、自己的收件箱 |
| `lbx_agent_team_artifact` | 确定性 markdown 工件：tasklist / review / testreport / final |

完整的工具契约——参数、硬门、错误文案与状态迁移——见 [docs/usage.md](./docs/usage.md)。

## 验证

**第 0 层——已在真实实例上验证（事实，不是承诺）：**

- scratch profile + 真实 LLM（`deepseek-v4-flash`）headless 端到端（Task 19）：create → 名册 → 任务 → dever worktree → checker APPROVE → commit `8239ca8` → tester PASS → `--no-ff` merge `cc1868c` → complete，0 issues。记录：`docs/verification-scratch-profile.md`。
- 全新 profile 的本地 tarball 与 `git+file://` 安装（Task 20）：零 peer 解析、4 个 `exports` 全部可解析、启动冒烟 HTTP 200、client 路由 `/plugins/lbx-agent-team/client.js` 200。记录：`docs/verification-from-zero-install.md`。
- `pnpm verify` 全绿：构建 + 单元测试 + 组合验证（`scripts/verify-composition.mjs`）。

**第 1 层——离线自检：**

```sh
cd /path/to/dsh-plugins/lbx-agent-team
pnpm install
pnpm build
pnpm verify
```

**第 2 层——在你的实例上端到端复现：**

```sh
dsh plugin --profile web add /path/to/lbx-agent-team
dsh --profile web --dump-config   # 应出现 lbx-agent-team 层
dsh web                            # 然后：/lbx-agent-team 实现 docs/specs/xxx.md
```

## 已知限制

- **尚未发布 npm。** 请使用上面已验证的本地路径；`dsh plugin --profile web add lbx-agent-team` 在正式发布前不可用。
- **git 安装必须带 `lib/`。** 因为 `lib/` 被 .gitignore 忽略，不带构建产物的 git 安装能装成功、`--dump-config` 也不报错，但**启动时**会以 `Error [ERR_MODULE_NOT_FOUND]`（`lib/index.js`）失败。解决：安装包含 `lib/` 的 tag / Release 快照（推荐），或私有仓库提交 `lib/`。
- **peer 双实例组合（已记录，非阻塞）。** 插件从自身 `node_modules` 解析 `@deepseek-ai/dsh-*`（devDeps `0.1.0-rc.8`），宿主 CLI 闭包为 `0.1.1-rc.2`；已验证流程全部正常，但该双实例布局是发布前需要重新评估的风险点。
- **registry 镜像陈旧（环境）。** `registry.npmmirror.com` 对 `@deepseek-ai` 包解析出陈旧版本（如 `dsh-headless@0.0.1-rc.1` 依赖 404）。请使用官方 registry 或本地链接安装。
- **`artifactsDir` 为保留项、尚未接线。** 工件目前写入 `<stateDir>/<teamId>/artifacts/`，而非 `config.artifactsDir`。
- **headless 运行需要 LLM 凭据。** 未配置 API key 时会话无法真实执行。

## 文档

| 指南 | 内容 |
| --- | --- |
| [docs/usage.md](./docs/usage.md) | 架构、状态布局、16 个工具契约、状态机、配置、已知限制 |
| [docs/verification-scratch-profile.md](./docs/verification-scratch-profile.md) | Task 19 真实验证记录 |
| [docs/verification-from-zero-install.md](./docs/verification-from-zero-install.md) | Task 20 tarball 与 git 安装验证记录 |

## 开发

```sh
pnpm install
pnpm build
pnpm verify
```

## 许可证

[MIT](https://opensource.org/licenses/MIT) 许可证。
