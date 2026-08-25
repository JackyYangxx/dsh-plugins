# Task 22 验证清单：GUI 验证（真实浏览器 + web profile）

**日期：** 2026-08-25
**环境：** macOS（darwin）· node v24.14.0 · Chrome 151（headless=new，CDP 驱动）· dsh CLI 0.1.1-rc.2（/Users/fxy/.npm-global/bin/dsh）
**插件：** lbx-agent-team 0.1.0（源码路径链接安装，lib/ 已构建并通过 verify-composition.mjs）
**分支：** feat/lbx-agent-team（基线 cb7c5e1，验证前后无源码改动）
**验证方法：** 独立 DSH_HOME（mktemp）+ 全新 web profile（dsh-base + dsh-web-app + lbx-agent-team）+ 独立端口 3101 + 无头 Chrome（--remote-debugging-port=9333）经 CDP 逐项核对。

## 摘要

| 清单项 | 结果 |
|---|---|
| 安装 + 启动冒烟（dsh --profile web --no-open） | PASS |
| 探针：/（HTML + __DSH_BOOT__ 注入） | PASS |
| 探针：/plugins/lbx-agent-team/client.js（HTTP 200） | PASS |
| 探针：/plugins/lbx-agent-team/state（{"teams":[]}） | PASS |
| 面板出现于对话区（shell.overlay 右 dock） | PASS（真实浏览器） |
| 名册 / 任务阶段 / DAG / issue 渲染 | PASS（构造真实快照） |
| 刷新后状态保留 | PASS |
| 轮询失败保留最后快照 | PASS（杀服务 → 快照保留 → 恢复） |
| 中英文切换 | PASS（zh 默认 / en 经设置切换，双向） |
| 键盘 / 焦点 / reduced motion | PARTIAL（reduced-motion 通过；焦点/aria 属性通过；Escape/Tab 全遍历为手动项） |
| 窄屏行为（<=640px 退回 overlay 全宽） | PASS（390px 视口仿真） |
| 归档面板（Ended · Archived history） | PASS |
| 浏览器交互验证（人工目视） | MANUAL（见第四节） |

**结论：** 面板在真实浏览器中按设计渲染、轮询、持久与双语工作；服务器端快照路由数据路径正确。所有可自动化的清单项全部通过，未发现插件缺陷。

## 一、实测环境与方法

### 独立实例（不触碰用户 GUI / profile）

```bash
H="$(mktemp -d /tmp/lbx-gui-check.XXXXXX)"          # 独立 DSH_HOME
DSH_HOME="$H" dsh plugin --profile web add /Users/fxy/Documents/dsh-workspace/dsh-plugins/lbx-agent-team
#   manifest: dependencies.lbx-agent-team = link:<plugin>；bundles = [dsh-base, dsh-web-app, lbx-agent-team]
DSH_HOME="$H" dsh --profile web --host 127.0.0.1 --port 3101 --no-open &
#   启动日志：dsh web: http://127.0.0.1:3101（进程由本会话启动，验证完成后由本会话停止）
```

- 端口 3101 与用户 GUI（3080）不冲突；DSH_HOME 为临时目录，全部随会话清理。
- 浏览器：无头 Chrome（headless=new，CDP 端口 9333），经自研 CDP 驱动（Node 内置 WebSocket）导航/点击/求值。opencli 浏览器桥接扩展未连接（opencli doctor：Daemon OK、Extension MISSING），故未走 opencli 而走直连 CDP。

### 数据路径（面板需要当前会话 + 该会话名下的团队）

- 面板按 captainSessionId 过滤，需一个真实 GUI 会话：完成 onboarding（继续 → 稍后配置）后选择工作区（seed 的 workspace.json 记录，注意 macOS /tmp → /private/tmp 的 realpath 必须一致，否则 workspace-attach-failed）。
- 会话创建后（session-dce2c554-...），将测试快照写入 <workspace>/.lbx-agent-team/<team>/team.json（与 lbx_agent_team_create 的磁盘真相同构：members/tasks/issues/attempts），captainSessionId 指向该会话。**该测试数据为手工构造的渲染 fixture，非 LLM 流程产物**（Task 19 已用真实 LLM 验证端到端流程）。

## 二、探针记录（curl，服务运行中）

| 探针 | 结果 |
|---|---|
| GET / | HTTP 200 · 14783 字节 · <!doctype html> · __DSH_BOOT__ 注入 43 个客户端条目 |
| __DSH_BOOT__ 中 lbx-agent-team 条目 | {"id":"lbx-agent-team","url":"/plugins/lbx-agent-team/client.js?rev=d3f95cfa68dd","inject":["@deepseek-ai/dsh-client-locale","@deepseek-ai/dsh-client-runtime","@deepseek-ai/dsh-client-ui-conversation","@deepseek-ai/dsh-client-ui-layout"]}（与 package.json dsh.client.inject 一致） |
| GET /plugins/lbx-agent-team/client.js?rev=d3f95cfa68dd | HTTP 200 · 62787 字节 · 以 window.__ModuleLoader__.load({ id: "lbx-agent-team", ...}) 开头 |
| GET /plugins/lbx-agent-team/state | HTTP 200 · {"teams":[]} · cache-control: no-store（无团队时） |
| GET /plugins/lbx-agent-team/state?archived=1 | HTTP 200 · {"teams":[]}（无归档时） |
| 写入 fixture 后 state | {"teams":[{workspace, teamId, name, captainSessionId, status, createdAt, members, tasks, issues}]}；removed 成员在活跃快照中被过滤 |

## 三、验证清单（逐项：如何验证 / 预期 / 实测结果）

### 1. 面板出现位置（对话区右侧 dock）

- **如何验证：** 打开 GUI 会话后，检查 [data-lbx-agent-team-activity] 的 DOM 祖先链含 [data-shell-overlay]（AppFrame 的 overlayLayer，渲染于对话/详情列之后）；面板 role="region" + aria-label。
- **预期：** 面板作为 shell.overlay 槽的一个条目（ctx.slots.inject('shell.overlay', ...)，id lbx-agent-team-activity，order 80）出现在对话区右侧 dock；无活动时折叠（空态不渲染 DOM）。
- **实测：** PASS —— overlayAncestor=true（面板位于 [data-shell-overlay] 层内）；role="region"、aria-label="LBX 团队活动面板"；无团队时 activity/badge 均为 0（空态不渲染）。

### 2. 名册渲染

- **如何验证：** fixture 含 5 名成员（planner/checker/tester/dever/removed old-dev）。活跃快照预期只显示 4 名（removed 过滤），每行含 name、role、状态徽标。
- **实测：** PASS —— 中文面板「成员 4」：planner/checker/tester/dever 各「空闲」；old-dev 不在活跃面板；归档视图（见 §11）显示 5 名含「已移除」（历史真相保留，符合设计）。

### 3. 任务阶段渲染

- **如何验证：** fixture 9 个任务覆盖全部阶段（pending/in_progress/in_review/approved/committed/tested/complete/changes_requested）；每行含 id、subject、assignee、阶段徽标。
- **实测：** PASS —— 中文面板「任务 9」：t1 已完成、t2 进行中、t3 评审中、t4 已批准、t5 已提交、t6 已测试、t7 已完成、t9 待开始；汇总徽标「9 总计 / 2 已完成 / 2 进行中 / 1 评审中 / 0 失败 / 1 待开始 / 3 其他」（与 activity-model 桶映射一致，9=2+2+1+0+1+3）。

### 4. DAG 渲染

- **如何验证：** fixture 6 个含依赖的任务（t2<-t1, t3<-t2, t5<-t4, t6<-t5, t7<-t6, t8<-t3）；预期显示依赖计数与每条 <- 边。
- **实测：** PASS —— 「任务依赖 6」，逐条渲染 t2 Implement core module <- t1、t3 ... <- t2 等 6 条依赖边。

### 5. issue 渲染

- **如何验证：** fixture 3 个 issue（BLOCKER open / HIGH resolved / LOW open）；预期严重级与状态徽标。
- **实测：** PASS —— 「问题 3」：「阻塞 Critical login bug 未解决」「高 Performance regression 已解决」「低 Docs typo 未解决」。

### 6. 刷新后状态保留

- **如何验证：** Page.reload 后等待轮询恢复；预期快照从磁盘真相重新读入，面板内容（团队/任务）不丢失。
- **实测：** PASS —— 刷新后面板重新出现且内容完整（Ship v1 等任务仍在）；state 轮询恢复（1s 节奏，网络日志可见连续 200）。

### 7. 轮询失败保留最后快照

- **如何验证：** 保持页面打开，杀掉 dsh web 服务；预期若干失败 tick（fetch 拒绝）后**最后成功快照仍显示**；重启服务后自动恢复。
- **实测：** PASS —— 杀服务后 8 秒（多次 ERR_CONNECTION_REFUSED）：面板内容完整保留（Ship v1 still visible，任务计数不变），无异常抛出、无空白态；重启服务后轮询恢复、内容仍在（panel content after restart: OK）。与 activity-monitor「failed/malformed tick 丢弃、下个 tick 重试」的实现一致。

### 8. 中英文切换

- **如何验证：** 默认 zh（面板文案为中文）；通过设置 RPC（settings.update {ns:"locale", patch:{preference:"en"}}）切到 en 后刷新，面板文案应整体切为英文；再切回 zh。
- **实测：** PASS —— zh 默认（LBX 团队活动 / 成员 / 任务 / 任务依赖 / 问题 / 空闲 / 已完成 等）；en 切换后整体为英文（LBX team activity / Roster / Tasks / Total / Done / Working / Review / Failed / Pending / Other / Idle，hasChinese=false）；切回 zh 正常。中英词典键集完整由类型系统保证（en satisfies Record<LbxAgentTeamLocaleKey, string>）。

### 9. 键盘 / 焦点 / reduced motion

- **如何验证：** ① 键盘：Escape 折叠全部展开团队 → 再次 Escape 收起面板；团队头按钮 Space/Enter 切换 aria-expanded。② 焦点：团队头按钮 aria-expanded / aria-controls 指向面板体 id；:focus-visible 样式存在；close 按钮与 reopen badge 有 aria-label。③ reduced motion：CDP 仿真 prefers-reduced-motion: reduce，预期 CSS 媒体查询把动画/过渡置 0。
- **实测（部分）：** PASS —— 团队头按钮 aria 完整（aria-expanded="true"、aria-controls="lbx-agent-team-r3-body"、aria-label="收起 Probe Team"），点击切换折叠正确；关闭按钮（收起活动面板）→ 面板收起 → reopen badge 出现（文案「1 个团队活动，点击展开」，计数 1）→ 点击 badge 重新展开；reduced-motion 仿真后 matchMedia('(prefers-reduced-motion: reduce)').matches === true，面板与切换按钮 computed transition-duration: 0s（媒体查询生效）。
  - MANUAL —— **Escape 折叠 / 完整 Tab 遍历**：GUI 持续把焦点还给输入框（composer），而 Escape 处理器按设计跳过 typing target（INPUT/TEXTAREA/contenteditable），实测在输入框聚焦时按 Escape 被有意忽略（无副作用、不误关）——符合预期，但「焦点移到非输入控件后按 Escape 折叠」需人工浏览器核对；Escape 分支为组件内联逻辑（无单测），需人工浏览器核对。

### 10. 窄屏行为（<=640px）

- **如何验证：** CDP Emulation.setDeviceMetricsOverride 到 390x844（mobile）；预期 @media (max-width: 640px) 规则生效：面板 max-width: none（全宽）、内容区纵向滚动。
- **实测：** PASS —— 390px 视口下面板矩形 366x506（约全宽）、max-width: none（媒体查询命中）、内容区 overflow-y: auto；position: absolute（overlay 层内悬浮）。桌面宽下恢复 max-width: calc(100vw - 36px)。

### 11. 附加实测（面板交互生命周期）

- 活动出现自动展开（0→>0 触发）；活动已存在时首帧不弹窗（settle window，reopen badge 可达）——刷新后若首帧快照已就绪显示 badge、否则按新活动自动展开，均为设计内行为。
- 关闭 → badge（可点击 reopen）→ 再展开闭环通过（见 §9）。
- 归档：将团队目录移入 archive/ 且 status=archived 后，live 路由 {"teams":[]}、?archived=1 返回归档快照；面板显示「Ended · Archived history」标签 + Archived pill，归档名册含已移除成员（历史完整）。
- 全程（导航/onboarding/选工作区/建会话/面板交互/杀服务/切换语言/仿真）无 Runtime.exceptionThrown、无插件相关 console.error。

## 四、需人工浏览器验证的项（原因）

1. **面板视觉布局目检**（徽标配色、DAG 连线排布、滚动条、窄屏手感）：本次为 CDP 的 DOM/文本/computed-style 级验证，无法替代人眼；截图证据已留存于验证会话 /tmp（未入库）。
2. **Escape 折叠的交互路径**：GUI 默认把焦点留在 composer，Escape 在 typing target 聚焦时被有意忽略；「点击面板头 → 焦点离开输入 → Escape 折叠/收起」需人工按一遍。
3. **Tab 键全遍历顺序**（面板按钮 → 团队头 → 面板体）：App 会回抢 composer 焦点，自动遍历不稳定；建议人工 Tab 验证焦点环与 :focus-visible 视觉。
4. **真实 LLM 团队流程在面板上的实时演变**（成员 working 徽标随真实子代理跳动、任务阶段推进、issue 出现）：本次使用手工 fixture 验证渲染，Task 19 已在 headless 下验证真实全流程，二者拼接即为完整覆盖；人工可在真实 GUI 跑一个团队观察。
5. **多团队 / 多会话并存、跨会话隔离**（其他会话的团队不泄漏进当前会话面板）：逻辑与单测覆盖（activity-monitor 按 captainSessionId 分桶），建议人工开第二个会话复核。

## 五、CONCERNS / 记录

1. **测试数据为手工 fixture**（非 LLM 产物）：面板渲染路径的输入为按磁盘真相结构手工构造的 team.json。真实 lbx_agent_team_create 产物结构已被 Task 19/20 与 verify-composition.mjs 覆盖，渲染 fixture 与真实结构同构，风险低。
2. **opencli 浏览器桥接不可用**（环境）：opencli doctor 显示 daemon 正常、扩展未连接；已改用 Chrome CDP 直连完成全部浏览器操作。若未来会话需 opencli，需先装扩展。
3. **workspace 记录需 realpath**：seed workspace.json 时路径必须为 fs.realpath 规范化值（macOS /tmp → /private/tmp），否则会话创建报 workspace-attach-failed。这是测试环境细节，与插件无关。
4. **onboarding 首帧语言**：GUI 默认按浏览器语言（zh）展示；切换语言后需刷新/设置生效，属宿主行为。
5. **归档视图显示 removed 成员**（历史完整）为设计意图（assembleTeamSnapshot(historic=true) 不过滤 removed），非缺陷。

## 六、结论

- **服务器侧**：独立 web profile 中插件安装、启动、__DSH_BOOT__ 注入、client bundle 路由、state 路由（空态与数据态、live/archived、no-store）全部符合预期。
- **浏览器侧**：面板在真实 Chrome 中按设计出现在对话区右侧 shell.overlay dock；名册/任务阶段/DAG/issue/汇总徽标渲染正确；自动展开、关闭 → badge → 重开闭环、刷新保留、轮询失败保留最后快照、中英双语、reduced-motion、窄屏全宽均实测通过；全程无插件异常。
- **人工项**（视觉目检、Escape/Tab 交互、真实 LLM 实时面板、多会话隔离）已逐一列出原因与方法，作为 Task 22 收尾后的人工复核清单。
- 未发现插件缺陷；临时实例（DSH_HOME、端口 3101、无头 Chrome 9333、fixture）已由本会话停止并清理。