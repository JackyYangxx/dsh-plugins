# Task 20 验证报告：从零安装验证（tarball 与 git 两路径）

**日期：** 2026-08-24
**环境：** macOS（darwin）· node v24.14.0 · pnpm 10.12.1 · dsh CLI 0.1.1-rc.2（/Users/fxy/.npm-global/bin/dsh）· git（本地）
**插件：** lbx-agent-team 0.1.0（已 build，lib/ 完整）
**分支：** feat/lbx-agent-team（基线 452b169）
**范围：** 按任务要求**不发布 npm**，改为本地 tarball（pnpm pack）与临时 git 仓库（git+file://）两条从零安装路径；两个全新临时 DSH_HOME，web profile 模板（`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`）。

## 摘要

| 步骤 | 结果 |
|---|---|
| Step 1 tarball 安装（`dsh plugin --profile web add <tgz>`） | ✅ 通过（无 peer 安装、无冲突） |
| Step 1 断言（manifest 依赖 + `dsh.profile.bundles` + dump-config 插件层） | ✅ 通过 |
| Step 1 exports 解析（`.`、`./client`、`./cordis.patch.yml`、`./package.json`） | ✅ 通过 |
| Step 1 启动冒烟（headless boot：HTTP 200 + `__DSH_BOOT__` entry + client route） | ✅ 通过 |
| Step 2 git 安装（`git+file://` 临时仓库，含强制提交的 lib/） | ✅ 通过 |
| Step 2 断言 + exports + 启动冒烟 | ✅ 通过 |
| Step 3 包完整性（files 列表逐项） | ⚠️ lib/cordis.patch.yml 存在；assets/、README.md、README_ZH.md 缺失（记录如下） |
| 插件自带 verify-composition.mjs | ✅ 全部组合检查通过 |

两路径安装结果**完全一致**（profile manifest 结构、bundle 层、dump-config 层、client 注册、启动 wiring 相同）。

## Step 1：tarball 路径（npm 未发布 → 本地 tarball）

### 打包

```bash
cd lbx-agent-team && pnpm pack --out /tmp/lbx-verify/lbx-agent-team-0.1.0.tgz
```

- 产物：`/tmp/lbx-verify/lbx-agent-team-0.1.0.tgz`（102424 字节）。
- 内容：`cordis.patch.yml`、`lib/`（58 个文件：host 模块 + client bundle `client.js` + `lib/client/` 模块 + `lib/types/` 类型声明 + sourcemap）、`package.json`。
- `assets/`、`README.md`、`README_ZH.md` 因不存在被 **pnpm 静默跳过**（无警告），见 CONCERNS。

### 安装

```bash
H1="$(mktemp -d)"
DSH_HOME="$H1" dsh plugin --profile web add /tmp/lbx-verify/lbx-agent-team-0.1.0.tgz
```

- profile 首次使用自动初始化（web 模板 `PROFILE_TEMPLATES.web = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]`）。
- `pnpm-workspace.yaml` 固定 `autoInstallPeers: false` → 只安装插件 tarball 本体，**未触发任何 peer 安装**，无 peer 冲突、无 registry 访问（避开 Task 19 记录的 npmmirror 陈旧镜像问题）。
- reconcile：插件声明 `dsh.bundle.patch`，自动追加进 `dsh.profile.bundles`。

### 断言（全部通过）

profile manifest（`$H1/profiles/web/package.json`）：

```json
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": {
    "lbx-agent-team": "file:/tmp/lbx-verify/lbx-agent-team-0.1.0.tgz"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "lbx-agent-team"
      ]
    }
  }
}
```

dump-config 插件层（`DSH_HOME="$H1" dsh --profile web --dump-config`，exit 0）：

```yaml
# == lbx-agent-team
- id: lbx-agent-team
  name: lbx-agent-team
  config:
    stateDir: .lbx-agent-team
    memberProvider: spawn
```

- 注入顺序：dsh-base 各层 → dsh-web-app 层 → **lbx-agent-team 层**（dump 行 504，位于 web-app 之后）。✅
- exports 解析（从安装位置 `node_modules/lbx-agent-team` 用 `createRequire().resolve`）：

| export | 解析结果 |
|---|---|
| `.` | `lib/index.js` ✅ |
| `./client` | `lib/client.js` ✅ |
| `./cordis.patch.yml` | `cordis.patch.yml` ✅ |
| `./package.json` | `package.json` ✅ |

- host bundle `lib/index.js`、client bundle `lib/client.js` 均存在；client bundle 注册 id = `"lbx-agent-team"`（`__ModuleLoader__.load({ id: "lbx-agent-team", ...`）✅。
- 静态资源：`assets/` 不存在——插件源码明确注释"intentionally omitted: the plugin ships no assets/ directory yet"（src/index.ts:354 / lib/index.js:266），符合预期，无缺失引用。✅

### 启动冒烟（headless 可验证范围内）

```bash
DSH_HOME="$H1" dsh --profile web --host 127.0.0.1 --port 3092 --no-open &
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3092/   # → 200
```

- 启动日志：`dsh web: http://127.0.0.1:3092`，进程正常常驻。
- 首页 HTML 的 `globalThis["__DSH_BOOT__"]` entries 包含插件条目，**inject 列表与 package.json `dsh.client.inject` 完全一致**：

```json
{"id":"lbx-agent-team","url":"/plugins/lbx-agent-team/client.js?rev=d3f95cfa68dd","inject":["@deepseek-ai/dsh-client-locale","@deepseek-ai/dsh-client-runtime","@deepseek-ai/dsh-client-ui-conversation","@deepseek-ai/dsh-client-ui-layout"]}
```

- client 路由 `/plugins/lbx-agent-team/client.js` → HTTP 200，内容以 `window.__ModuleLoader__.load({ id: "lbx-agent-team", ...` 开头。✅

## Step 2：git 路径（SKILL.md §8.4 模式）

### 临时 git 仓库构建（lib/ 处理——本路径关键点）

`lib/` 被插件 `.gitignore` 忽略（`lib/`、`node_modules/`、`dist/`…），**正常 `git add -A` 不会提交构建产物**；而 exports 全部指向 `lib/`，git 分发时 lib/ 必须存在。方案（已如实采用）：

```bash
GITREPO=/tmp/lbx-verify/git-repo
rsync -a --exclude node_modules --exclude .git --exclude '*.tgz' ./ "$GITREPO/"   # 复制插件可发布内容
cd "$GITREPO"
git init -q && git config user.email/user.name ...
git add -A
git add -f lib        # 强制包含被 .gitignore 忽略的构建产物
git commit -m "chore: lbx-agent-team 0.1.0 publishable snapshot for git-path verification"
# → ee1bb6238256305e08e97cffa7bbd3cd74951911（58 个 lib 文件已提交）
```

- 临时仓库内容 = 插件 checkout 减去 node_modules/.git/tgz（含 package.json、pnpm-lock.yaml、cordis.patch.yml、src/、test/、docs/、scripts/ 及强制加入的 lib/）。
- 插件无 `prepare`/`install`/`postinstall` 脚本 → 无需 profile `pnpm-workspace.yaml` 的 `allowBuilds` 门禁（SKILL.md §8.4 提到的前提不适用）。

### 安装

```bash
H2="$(mktemp -d)"
DSH_HOME="$H2" dsh plugin --profile web add git+file:///tmp/lbx-verify/git-repo
```

- pnpm 克隆临时仓库（lockfile 记录 `resolution: {commit: ee1bb62…, repo: file:///tmp/lbx-verify/git-repo, type: git}`），安装包名与 `package.json.name` 一致。
- **pnpm 对 git 依赖同样按 package.json `files` 白名单过滤**：安装结果只含 `lib/`、`cordis.patch.yml`、`package.json`（docs/ 等未列入 files 的内容不进安装结果）——与 tarball 内容集一致，符合预期。

### 断言（全部通过，与 Step 1 完全一致）

- manifest：`"lbx-agent-team": "git+file:///tmp/lbx-verify/git-repo"`；bundles = `["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "lbx-agent-team"]`。
- dump-config 插件层 id/name/config（stateDir、memberProvider）✅；层顺序 base → web-app → lbx-agent-team ✅。
- 4 个 exports 全部解析 ✅；host/client bundle 存在 ✅；client bundle 注册 id = `lbx-agent-team` ✅。
- 启动冒烟：HTTP 200、`__DSH_BOOT__` entry（inject 一致）、`/plugins/lbx-agent-team/client.js` 200 ✅。

## Step 3：包完整性（files 列表逐项）

```jsonc
// package.json
"files": ["lib", "assets", "cordis.patch.yml", "README.md", "README_ZH.md"]
```

| files[] 条目 | 存在？ | 说明 |
|---|---|---|
| `lib` | ✅ | 58 个构建产物齐全（host + client + types） |
| `cordis.patch.yml` | ✅ | 与 package name 一致（`name: lbx-agent-team`） |
| `assets` | ❌ | 目录不存在；插件源码注释为有意缺省（无静态资源），files 中为占位条目 |
| `README.md` | ❌ | 未创建（属 Task 21） |
| `README_ZH.md` | ❌ | 未创建（属 Task 21） |

- pnpm pack 对缺失条目**静默跳过、无警告**（npm publish 同样如此）；npm registry 上会表现为无 README。
- exports 指向的目标（`lib/index.js`、`lib/client.js`、`lib/types/index.d.ts`、`lib/types/client/index.d.ts`、`cordis.patch.yml`）全部存在 ✅。
- 插件自带 `node scripts/verify-composition.mjs`：**all composition checks passed**（usage section、slash command、手势边界、create/roster/state 路由、webless mount、late web binding 等全部 PASS）。

## 发现的问题 / 关注点（CONCERNS）

1. **lib/ 的 git 分发问题（本路径最大关注点，需长期决策）：** `lib/` 被 `.gitignore` 忽略，git 安装（`git+file://` 或未来 `github:<owner>/<repo>`）拿不到构建产物，exports 指向的 `lib/index.js`/`lib/client.js` 会缺失、`--dump-config` fail loud。本次以 `git add -f lib`（或复制构建产物入临时仓库）绕过并验证通过。**建议**：正式发布前二选一——(a) 把 lib/ 移出 .gitignore（源码仓库直接含构建产物，最符合"git 分发即用"）；或 (b) 增加 `prepare` 脚本 + 在安装文档中要求 profile `pnpm-workspace.yaml` 配 `allowBuilds`（SKILL.md §8.4 前提），git 安装时自动 build。npm tarball 路径不受影响（files 已含 lib）。
2. **README 缺失（Task 21 覆盖）：** `README.md`/`README_ZH.md` 未创建，files 列表中两个条目缺失，npm pack 静默跳过。npm 发布时 registry 页面将无 README，且从零安装文档（README 中的安装命令）尚未就位——Task 21 完成后需回归一次本验证（§8.4 要求"按 README 的精确命令安装"）。
3. **assets/ 占位条目：** 插件当前无静态资源（源码注释明确有意省略），files 里的 `assets` 是前向占位，pnpm pack 静默跳过、无副作用。可在 assets 落地前移除该条目，或保留并在文档说明。
4. **peer 双实例组合（继承 Task 19 已知项，非阻塞）：** 插件 peerDependencies 全部 optional + profile `autoInstallPeers: false` → 安装零 peer、零冲突；运行时 `@deepseek-ai/dsh-*` 由宿主 CLI 闭包 flat-module fallback 解析（rc.2），插件 devDeps 为 rc.8。本次仅做组合/dump/启动冒烟，未跑真实 LLM 会话（Task 19 已覆盖真实组合 E2E）；双实例风险点记录在 Task 19 报告中。
5. **无 registry 依赖：** tarball 与 git 两条路径均不访问 npm registry，完全绕开 Task 19 记录的 npmmirror 陈旧镜像问题。

## 结论

- **tarball 路径与 git 路径从零安装均验证通过**：全新 DSH_HOME + web profile 模板下，安装（零 peer）、reconcile（`dsh.profile.bundles` 就位）、dump-config 插件层（id/name/config/注入顺序）、4 个 exports、host/client bundle、client 注册、启动 wiring（HTTP 200 + `__DSH_BOOT__` entry + client 路由）全部符合预期，两路径结果一致。
- git 分发唯一结构性前提是 **lib/ 必须随仓库分发**（本次以强制提交验证），README 缺失属 Task 21，其余为记录性关注点，无阻塞性缺陷。
- 临时产物（tarball、两个 DSH_HOME、临时 git 仓库）已全部清理。
