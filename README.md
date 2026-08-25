# dsh-plugins

DeepSeek Harness (DSH) 插件开发工作区。

本仓库承载 **DSH 原生插件**的开发、验证与分发：当前唯一的交付物是 **`lbx-agent-team`** —— 一个把 DeepSeek Harness 会话变成"多智能体开发团队"的插件（队长 = 主会话，成员 = 可续聊子代理）。

## 仓库内容

| 路径 | 内容 |
|---|---|
| [`lbx-agent-team/`](./lbx-agent-team/) | **DSH 插件本体**（核心交付物）。详见[插件 README](./lbx-agent-team/README_ZH.md) |
| [`docs/superpowers/specs/`](./docs/superpowers/specs/) | 设计文档：`2026-08-23-lbx-agent-team-design.md`（11 条决策、状态机、17 工具、配置） |
| [`docs/superpowers/plans/`](./docs/superpowers/plans/) | 实现计划：`2026-08-23-lbx-agent-team.md`（22 个任务的 TDD 执行计划） |
| [`refs/agents/`](./refs/agents/) | 早期自设计的多智能体团队协议参考（coordinator/planner/checker/dever/tester 角色定义），插件设计的来源 |
| [`AGENTS.md`](./AGENTS.md) | 仓库全局规则（对所有 agent 会话的强制约束） |

## lbx-agent-team 插件一句话

把当前 DSH 会话变成**队长**：拉入 planner / checker / dever / tester 可续聊子代理，把 spec 拆成带依赖的任务，走带硬门的流水线（实现 → 评审 → 提交 → 验证 → 完成），配 git worktree 隔离、文件持久化状态、自动派发与实时 Web 活动面板。

## 快速开始

```bash
# 1. 构建插件
cd lbx-agent-team
pnpm install && pnpm build

# 2. 安装到 DSH profile（本地路径 / tarball / git，详见插件 README）
dsh plugin --profile web add "$PWD"

# 3. 重启 DSH 后使用
#    Web GUI: /lbx-agent-team 实现 docs/specs/xxx.md
#    Headless: dsh --profile web "用 LBX Agent Team 实现 docs/specs/xxx.md"
```

> 必须先有 spec 文档（如本项目的设计文档或任意 markdown 需求），`lbx_agent_team_create` 会校验。

## 开发与验证状态

- **状态**：完整交付，全部验证通过（未发布 npm，纯本地 + 远程仓库）
- **验证闭环**：134 单元测试 + 33 组合检查 + 真实 LLM headless 端到端 + tarball/git 从零安装 + 真实浏览器 GUI + README 命令回归（记录见 `lbx-agent-team/docs/verification-*.md`）
- **工具面**：17 个 `lbx_agent_team_*` 工具；支持 pipeline 硬门、git worktree、懒 spawn、自动派发、面板操作按钮（完成/转派/取消）

## 文档索引

| 文档 | 说明 |
|---|---|
| [插件 README（中）](./lbx-agent-team/README_ZH.md) | 安装 / 使用 / 配置 / 边界 |
| [插件 README（英）](./lbx-agent-team/README.md) | 同上（英文版） |
| [使用指南](./lbx-agent-team/docs/usage.md) | 架构、17 工具契约、状态机、已知限制 |
| [验证记录](./lbx-agent-team/docs/) | scratch-profile / from-zero-install / gui-checklist / readme-regression 四份验证报告 |
| [设计文档](./docs/superpowers/specs/2026-08-23-lbx-agent-team-design.md) | 设计与决策记录 |
| [实现计划](./docs/superpowers/plans/2026-08-23-lbx-agent-team.md) | 22 任务执行计划 |

## 许可

MIT（插件部分；见 [lbx-agent-team](./lbx-agent-team/)）。
