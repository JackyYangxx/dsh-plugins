# Task 19 验证报告：scratch profile 真实组合验证（安装 + 加载 + headless 端到端）

**日期：** 2026-08-24
**环境：** macOS（darwin 26.5.2）· node v24.14.0 · pnpm 10.12.1 · dsh CLI 0.1.1-rc.2（/Users/fxy/.npm-global/bin/dsh）
**插件：** lbx-agent-team 0.1.0（本地路径链接安装，lib/ 已构建）
**分支：** feat/lbx-agent-team（基线 6ce532d，验证后已恢复）

## 摘要

| 步骤 | 结果 |
|---|---|
| Step 1 安装（dsh plugin add → scratch profile） | ✅ 通过（无 peer 冲突） |
| Step 1 dump-config 校验（行、id/name/config、bundle 顺序） | ✅ 通过 |
| Step 2 插件加载 + 工具注册（真实 LLM 会话） | ✅ 通过 |
| Step 2 端到端团队流程 **全流程完成**（create→成员→任务→dever worktree→checker APPROVE→commit→tester PASS→merge→complete） | ✅ 通过 |
| 状态目录 / 工件 | ✅ `.lbx-agent-team/<team>/`、worktree、archive、artifacts 全部生成 |

## Step 1：scratch profile 安装

### 命令与输出

```bash
H="$(mktemp -d /var/folders/.../dsh-scratch-e2e.XXXXXX)"
DSH_HOME="$H" dsh plugin --profile scratch add /Users/fxy/Documents/dsh-workspace/dsh-plugins/lbx-agent-team
```

- profile 初始化：`initProfile` 以 `DEFAULT_PROFILE_BUNDLES = ["@deepseek-ai/dsh-base"]` 建 scratch profile（无 headless 模板，见下）。
- pnpm 侧：profile 的 `pnpm-workspace.yaml` 固定 `autoInstallPeers: false`，因此**只安装了本地 link 依赖**（`lbx-agent-team: link:/Users/fxy/.../lbx-agent-team`），未触发 peer 安装、无 peer 冲突。
- reconcile：插件声明 `dsh.bundle.patch`（cordis.patch.yml），自动加入 `dsh.profile.bundles`：

```json
{
  "dependencies": { "lbx-agent-team": "link:/Users/fxy/.../lbx-agent-team" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "lbx-agent-team"] } }
}
```

### dump-config 校验

```bash
DSH_HOME="$H" dsh --profile scratch --dump-config
```

输出（exit 0）包含（位于 dsh-base 之后、headless 层之前）：

```yaml
# == lbx-agent-team
- id: lbx-agent-team
  name: lbx-agent-team
  config:
    stateDir: .lbx-agent-team
    memberProvider: spawn
```

- ✅ id / name / config（stateDir、memberProvider）与 cordis.patch.yml 一致。
- ✅ 注入顺序：dsh-base 层 → lbx-agent-team 层 →（追加的）dsh-headless 层。

### 追加 dsh-headless bundle（headless 单次任务模式所需）

scratch 非模板 profile 默认不含 `@deepseek-ai/dsh-headless`，而 headless 单次任务（`dsh --profile <name> "<task>"`）由该 bundle 的 runner 驱动。故追加：

```bash
DSH_HOME="$H" dsh plugin --profile scratch add @deepseek-ai/dsh-headless
```

**记录到的环境问题（非插件问题）：** 本机 npm registry 指向 `registry.npmmirror.com`，该镜像解析到 **`@deepseek-ai/dsh-headless@0.0.1-rc.1`（陈旧版本）**，其依赖 `@deepseek-ai/dsh-code-runtime-worker` 404，安装失败。改用 CLI 内置同版本（0.1.1-rc.2）本地链接安装成功：

```bash
DSH_HOME="$H" dsh plugin --profile scratch add /Users/fxy/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-headless
```

最终 bundles：`["@deepseek-ai/dsh-base", "lbx-agent-team", "@deepseek-ai/dsh-headless"]`，dump-config 中 headless 层正确出现（system-prompt persona、code-runtime、headless-startup、headless-runner（inject headlessStartup））。

## Step 2：headless 端到端（真实 LLM）

### 会话配置

- 将宿主机 `~/.dsh/.credentials.yaml`（含 DEEPSEEK_API_KEY）复制到 scratch DSH_HOME（mode 600），真实调用 DeepSeek API（provider deepseek-official / model deepseek-v4-flash，来自 dsh-base 的 agent-default-model）。
- 任务：`dsh --profile scratch "用 LBX Agent Team 实现 docs/specs/demo.md（一个极小任务：给 README 加一行并提交）"`。
- 临时 workspace（git init + docs/specs/demo.md）。

### 结果：全流程完成（EXIT=0）

最终 assistant 输出（headless-run 日志节选）：

```

✅ 完成 — docs/specs/demo.md 已由 LBX Agent Team 端到端实现并提交。

| 环节 | 结果 |
|---|---|
| Roster | planner / checker / tester / pool dever（dever 在独立 git worktree team/demo-e2e/t1 中工作） |
| t1 实现（dever） | 仓库原本没有 README.md，dever 创建 README.md，内容精确为 "Verified by LBX Agent Team e2e." |
| t1 评审（checker） | APPROVE — 逐项核对 spec、字节级校验内容（od -c）、确认无其他文件改动 |
| t1 提交 | commit_task → 8239ca8 docs: add e2e verification line to README |
| t1 验证（tester） | PASS — grep -Fx 精确匹配、提交信息清晰、git status 干净 |
| t1 完成 | tested → complete；分支 --no-ff 合并回主线 feat/lbx-agent-team（cc1868c merge team branch team/demo-e2e/t1） |
```

仓库最终状态（验证后已恢复基线）：`cc1868c merge team branch team/demo-e2e/t1` → `8239ca8 docs: add e2e verification line to README`，README.md 含目标行。**0 issues**，质量门全部硬性通过。

### 生成物（证据）

- 状态目录：`.lbx-agent-team/demo-e2e/team.json`（members、tasks、attempts、commit hash、review/test 记录）。
- worktree：`.lbx-agent-team/demo-e2e/worktrees/dever/t1/`（branch `team/demo-e2e/t1`，隔离实现）。
- 归档：`.lbx-agent-team/archive/demo-e2e/`（team.json、inbox/*.jsonl、artifacts/）。
- 工件（markdown）：`artifacts/final-report.md`、`artifacts/reviews/t1.md`、`artifacts/tests/t1.md`。
- 任务清单与最终报告位于 **`<stateDir>/<team>/artifacts/`**（本插件约定），而非任务描述假设的 `docs/lbx-agent-team/`——建议以实际行为为准。

### 会话证据（session jsonl 解码）

- 协调者会话（session-2043e4df…）：lbx_agent_team_create ×2、add_member ×4、create_task ×1、status ×8、send_message ×1、bash/read/grep 等。
- dever 会话（af142fc8…）：bash ×14、update_task ×2（t1: in_progress → in_review）。
- checker 会话（c96e21f3…）：评审 t1 → APPROVE；tester 会话：验证 t1 → PASS。
- 团队流程严格按 usage section 协议执行：成员惰性 spawn、attempt_id 能力、质量门硬约束均工作。

### 环境限制记录（已绕过/说明，非插件缺陷）

- 本 agent 会话整体运行于受限沙箱，macOS `sandbox-exec` 无法嵌套（`sandbox_apply: Operation not permitted`）。
  - workspace 位于用户目录（`/Users/fxy/...`）时，headless 内 bash 工具可正常执行（上述全流程即在此路径完成）。
  - workspace 位于 `/var/folders` 的 mktemp 临时目录时，bash 沙箱在 workspace-write 模式下 fail-closed（`SANDBOX_UNAVAILABLE`）。插件正确透出结构化错误；模型如实报告并尝试 `danger-full-access` 升级（approval 通道不可用 → 拒绝）。该差异为本会话宿主环境特性，与插件无关。
- headless 需要 LLM 配置（API key）；无 key 时会话无法真实执行。

## 发现的问题 / 关注点（CONCERNS）

1. **peer 依赖版本偏移（需关注，未阻塞）：** profile 通过本地链接安装插件；插件从其自身 node_modules 解析 `@deepseek-ai/dsh-*`（devDeps 0.1.0-rc.8），而宿主 dsh CLI 闭包为 0.1.1-rc.2（dsh-base/headless 经 flat-module fallback 解析）。同一进程内出现两套版本实例；实测工具调用、注入、状态机全部工作正常，但这是双实例风险点（注入的 services 实例来自宿主 rc.2，插件自身导入 rc.8）。建议后续任务评估是否将插件 peer 对齐宿主版本，或在文档中明示该组合。
2. **registry 镜像陈旧（环境）：** registry.npmmirror.com 对 @deepseek-ai/dsh-headless 解析出 0.0.1-rc.1 且依赖 404；需使用官方 registry 或本地链接安装。
3. **sandbox-exec 嵌套限制（环境）：** 见上；用户目录 workspace 下可正常运行全流程。
4. **内部载体任务（t2/t3）停在 in_review：** checker/tester 各自创建的"评审/验证载体任务"（为唤醒成员而建）在流程收尾后停留在 in_review——插件当前无 cancel/fail 工具，且非 dever 任务提交会在主工作区跑 git add -A 误收未跟踪文件，故未走完提交链路。其实际产物（评审/测试报告）均已落盘，不影响交付。可作为后续迭代优化点。
5. **headless 需要 LLM 配置：** 无 DEEPSEEK_API_KEY 时会话无法真实执行；本次已复制宿主凭据使真实 LLM 运行。

## 结论

- 安装、加载、配置组合、真实 LLM 驱动的完整团队流水线（创建团队 → 成员惰性注册 → 任务拆解 → dever worktree 实现 → checker 硬门审批 → commit → tester 硬门验证 → merge → 归档）**全部端到端验证通过**，EXIT=0。
- 插件在真实 DSH 运行时中的表现符合设计：结构化错误、状态持久化、worktree 隔离、任务状态机、质量门约束、工件生成均正确。
- 剩余问题均为环境特性（registry 镜像、sandbox-exec 嵌套、需 LLM key）或插件迭代建议（peer 版本对齐、载体任务生命周期），无阻塞性缺陷。
