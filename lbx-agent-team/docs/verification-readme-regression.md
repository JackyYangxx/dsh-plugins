# M2-C 验证报告：README 安装命令回归（源码目录路径）

**日期：** 2026-08-25
**环境：** macOS（darwin）· node v24.14.0 · pnpm 10.12.1 · dsh CLI 0.1.1-rc.2（/Users/fxy/.npm-global/bin/dsh）
**插件：** lbx-agent-team 0.1.0（源码目录，lib/ 已 build）
**分支：** main（M2-C）
**范围：** 按 README「源码构建路径」的安装命令——`pnpm install && pnpm build && dsh plugin --profile web add "$PWD"`——在独立 DSH_HOME（`mktemp -d`）+ scratch web profile 做一次从零安装回归；验证 `--dump-config` 出现插件层 + 启动冒烟。

## 摘要

| 步骤 | 结果 |
|---|---|
| `pnpm install`（README Development / Layer 1 命令） | ✅ 通过（幂等，无变更，exit 0） |
| `pnpm build`（README Development / Layer 1 命令） | ✅ 通过（tsc host + client + tsdown，exit 0） |
| `dsh plugin --profile web add "$PWD"`（全新 DSH_HOME + web profile） | ✅ 通过（profile 自动初始化；`link:` 依赖；零 peer 安装） |
| `dsh --profile web --dump-config` 出现插件层 | ✅ 通过（第 504–509 行；**无 artifactsDir**） |
| 启动冒烟（`--no-open`：HTTP 200 + client 路由 200 + boot entry） | ✅ 通过 |

## 命令序列（与 README 完全一致）

README「Layer 2」安装命令（源码目录路径）：

```sh
export PATH=/usr/local/bin:/Users/fxy/.npm-global/bin:$PATH
cd /path/to/dsh-plugins/lbx-agent-team
pnpm install
pnpm build
H="$(mktemp -d)"                             # 独立 DSH_HOME
DSH_HOME="$H" dsh plugin --profile web add "$PWD"
DSH_HOME="$H" dsh --profile web --dump-config   # 应出现 lbx-agent-team 层
```

## 结果明细

### 安装

- `pnpm install`：依赖已就绪，无变更，exit 0。
- `pnpm build`：tsc（host + client）类型检查与 `tsdown` client bundle 全部通过，exit 0。
- `dsh plugin --profile web add "$PWD"`：
  - profile 首次使用自动初始化（web 模板 `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`）。
  - 插件以 `link:` 协议接入源码目录：`+ lbx-agent-team link:/Users/fxy/Documents/dsh-workspace/dsh-plugins/lbx-agent-team`；profile `autoInstallPeers: false` → **零 peer 安装、零冲突**（peerDependencies 全部 optional + 无 registry 访问，与 Task 20 结论一致）。
  - manifest 追加 `dsh.profile.bundles` = `["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "lbx-agent-team"]`。

### dump-config 断言

```yaml
# == lbx-agent-team
- id: lbx-agent-team
  name: lbx-agent-team
  config:
    stateDir: .lbx-agent-team
    memberProvider: spawn
```

- 插件层出现于 dump 第 504–509 行（web-app 之后），✅。
- **`config` 下不再有 `artifactsDir`** —— M2-C 配置移除生效，dump 不再渲染该键，✅。

### 启动冒烟

```sh
DSH_HOME="$H" dsh --profile web --host 127.0.0.1 --port 3127 --no-open &
```

- 首页 HTTP 200；client 路由 `/plugins/lbx-agent-team/client.js` HTTP 200。
- 首页 HTML 含插件 boot entry：`"id":"lbx-agent-team"`（`client.js?rev=…`）。
- 冒烟进程已停止（`kill`），端口释放。

## 关注点（CONCERNS）

- **启动时序**：冒烟首次尝试（单条命令内后台 + 循环 curl）40s 未达 HTTP（服务器已打 `dsh web: http://127.0.0.1:3127` 但监听就绪晚于预期）；以 `lsof` 确认监听后 curl 立即 200。属启动时序，非功能缺陷。
- **`link:` 安装形态**：源码目录路径安装为 `link:` 依赖（指向源码目录，自带 `node_modules` 与 `lib/`）；`--dump-config` 与启动均正常。与 Task 20 的 tarball / `git+file://` 路径结果一致（三者均零 peer、无 registry）。
- 本报告未在 README「Documentation」表登记（保持 README diff 精准），如需要可后续补一行。

## 清理

- 临时 DSH_HOME（/tmp/lbx-m2c-verify）、dump 输出、web 日志、冒烟进程均已清理，无残留。
