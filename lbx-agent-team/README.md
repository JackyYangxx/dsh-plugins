<p align="right">
  <strong>English</strong> · <a href="./README_ZH.md">简体中文</a>
</p>

# LBX Agent Team

**Turn one DeepSeek Harness session into a coordinator-led multi-agent development team.** The current session becomes the **captain**; it assembles durable sub-agents — planner / checker / dever / tester — splits a spec into dependency-aware tasks, and drives them through a hard-gated pipeline (implement → review → commit → test → complete) with git-worktree isolation, persistent state, an automatic shared-task scheduler, and a live Web activity panel.

<p align="center">
  <img src="https://img.shields.io/badge/DeepSeek%20Harness-plugin-202724" alt="DeepSeek Harness plugin">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT license">
</p>

> [!NOTE]
> `lbx-agent-team` is **not published to npm yet**. This README documents the verified local distribution paths — build from source, local tarball, and git install — with the exact commands that were validated on real instances.

## Highlights

| Capability | What it changes |
| --- | --- |
| **Coordinator-led team** | The current session is the captain: it builds the team, assigns roles, and consolidates the final result. |
| **Hard-gated pipeline** | Tasks move through `pending → claimed → in_progress → in_review → approved → committed → tested → complete`; every transition is validated against a whitelist and hard gates (dependencies complete before claim, only a checker may review, no commit without APPROVE, only a tester may test). |
| **Durable members** | Members are continuable DSH sub-agents spawned lazily and woken on demand — no resident processes. |
| **git worktree isolation** | Each dever task works in its own git worktree + branch; a tester PASS merges it back with `--no-ff`, conflicts go to the captain's mailbox. |
| **Persistent state** | Team, tasks, issues, attempt capabilities and mailboxes live on disk under `<workspace>/.lbx-agent-team/`; the Web panel reads that disk truth merged with live sub-agent activity. |
| **Web activity panel** | Real-time roster, segmented progress, and an interactive task DAG — see [Web UI](#web-ui). |

## Install

> [!NOTE]
> Requires an existing [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) installation (`dsh` CLI).

The plugin is not on npm yet; all three paths below were verified end to end on fresh profiles (Task 19 / Task 20 records live in `docs/`).

### 1. Build from source (verified)

```sh
cd /path/to/dsh-plugins/lbx-agent-team
pnpm install
pnpm build                 # produces lib/ (host + client bundles)
dsh plugin --profile web add "$PWD"
```

Run `pnpm build` again after changing the source; the local install stays linked to this checkout. Validate the composed profile, restart DSH, then refresh the Web UI:

```sh
dsh --profile web --dump-config   # the lbx-agent-team layer should appear
dsh web
```

> [!NOTE]
> `dsh plugin` writes the plugin into the profile's `package.json` / manifest and appends its bundle to `dsh.profile.bundles`. **Restart the dsh service** for the plugin to load.

### 2. Local tarball (verified)

```sh
cd /path/to/dsh-plugins/lbx-agent-team
pnpm pack --out /tmp/lbx-agent-team-0.1.0.tgz
dsh plugin --profile web add /tmp/lbx-agent-team-0.1.0.tgz
```

Verified: a fresh profile installs without peer resolution or conflicts, all four `exports` resolve, and the web server boots with the plugin's client bundle served.

### 3. Git install (private-repo fallback verified; release snapshot is the recommended — but not yet published — path)

- **Release snapshot (recommended — Task 20 decision):** publish a tag or a Release tarball that contains a built `lib/`, then install by tag:

  ```sh
  dsh plugin --profile web add github:<owner>/<repo>#<tag>
  ```

  or point at the Release tarball URL. The plugin's `lib/` is git-ignored, so the tag must be produced by the publish script (build → assemble publishable content → `git add -f lib` → tag).

- **Private repository fallback (verified):** commit `lib/` into the repository (`git add -f lib`) and install the repo directly:

  ```sh
  dsh plugin --profile web add git+<repo-url>
  ```

  Verified with `git+file://` against a temporary repo containing the forced `lib/` commit.

> [!WARNING]
> If the installed source has **no `lib/`**, `dsh plugin add` and `--dump-config` succeed silently and the failure appears only at **startup** with `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../lbx-agent-team/lib/index.js'`. Diagnose with `ls <profile>/node_modules/lbx-agent-team/lib` — an empty result means the source was installed without build artifacts. See [Known limitations](#known-limitations).

## Usage

The spec must exist **before** you create a team — `lbx_agent_team_create` validates the file and fails loudly otherwise. Use any existing design document (e.g. `docs/superpowers/specs/2026-08-23-lbx-agent-team-design.md`) or a minimal markdown spec: a `# <title>` heading plus a few requirement bullets are enough.

**In the Web GUI** — type the slash command with a goal, or simply describe the goal in natural language:

```text
/lbx-agent-team 实现 docs/specs/xxx.md
```

The submitted line is preserved in the chat; the gesture boundary activates the captain protocol deterministically.

**Headless CLI** (verified end to end with a real LLM, Task 19):

```sh
dsh --profile scratch "用 LBX Agent Team 实现 docs/specs/demo.md"
```

## How it works

1. The current session calls `lbx_agent_team_create` (or the slash command triggers it) and becomes the **captain**; `autoRoster` registers planner / checker / tester.
2. The captain adds devers — named members (`lbx_agent_team_add_member`, role `dever`) or dedicated tasks (`assignee=new-dever`, spawned lazily at claim). Members spawn only when they first need work.
3. The planner reads the spec and proposes a task list (artifact + message); the captain creates tasks with explicit `dependencies` and a `verification` method.
4. The shared scheduler dispatches every ready pool task to an idle dever up to `maxParallelDevers`; the dever implements in its own git worktree.
5. Hard gates drive the pipeline: claim requires all dependencies complete → implementation → checker review (`APPROVE` / `REQUEST_CHANGES`, loop-capped at `maxReviewLoop` (reaching it marks the task failed)) → commit (only after `APPROVE`) → tester `PASS` / `FAIL` (only after commit; `FAIL` opens an issue) → the captain completes the task.
6. The captain consolidates the result and archives the team (`lbx_agent_team_delete`), keeping the full record under `<stateDir>/archive/`.

Team state lives under `<workspace>/.lbx-agent-team/<teamId>/` (team.json, inboxes, artifacts, worktrees). Every write is serialized under a per-team in-process lock and published atomically (tmp + fsync + rename).

The plugin reuses DSH capability seams instead of re-inventing them:

| DSH capability | LBX Agent Team usage |
| --- | --- |
| `ctx.tools` registry | 17 `lbx_agent_team_*` tools |
| `ctx.subagents.startContinuable()` / `followup` | durable members spawned lazily and woken on demand |
| `ctx.systemPrompt.section()` | usage protocol section (order `promptSectionOrder`) |
| `ctx.commands.register` | `/lbx-agent-team` host command |
| `agent/pre-step` | deterministic gesture boundary (headless surfaces too) |
| `agent/status` | member idle → sync team state + auto-dispatch pump |
| Web server route | `/plugins/lbx-agent-team/state` (webServer / httpServer dual-key) |
| filesystem | state root `<workspace>/.lbx-agent-team/` |
| `ctx.shell` | git worktree / commit / merge (local fallback for tests & headless) |

Task state machine (whitelist-validated): `pending → claimed → in_progress → in_review → approved → committed → tested → complete`, with `changes_requested` (back to `in_review` on resubmit) and terminal `failed` / `cancelled`.

## Web UI

- The activity panel opens in the top-right once a team is created: captain, segmented progress, status counts, a collapsible roster, and a compact task DAG with real SVG dependency curves.
- It reads the disk truth (`.lbx-agent-team/<teamId>/team.json`) merged with live sub-agent activity from the agent registry; clicking a member opens its continuable session.
- Archived teams stay visible with their full history under `<stateDir>/archive/`.

## Slash command

`/lbx-agent-team <goal>` — registered as a closed-namespace host command and listed in the Web GUI slash menu. Any genuine user message starting with `/lbx-agent-team` (including headless CLI input) activates the protocol through the gesture boundary; mid-sentence mentions stay ordinary prose. Set `slashCommand: false` to disable both surfaces and keep only the natural-language trigger.

## Configuration

Defaults work out of the box. A trusted profile can override behavior:

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

| Field | Default | Description |
| --- | --- | --- |
| `stateDir` | `.lbx-agent-team` | team state directory name (under the workspace) |
| `memberProvider` | `spawn` | member sub-agent runtime backend (`spawn` / `fork`) — **not** an LLM provider |
| `memberModel` | — | optional model default for every member |
| `maxMembers` | `12` | member cap (captain excluded) |
| `maxParallelDevers` | `3` | parallel pool-dever cap |
| `autoRoster` | `true` | register planner/checker/tester automatically at create |
| `autoDispatch` | `true` | auto-dispatch ready pool tasks to idle devers |
| `gitWorktrees` | `true` | devers work in isolated git worktrees (needs a git repo) |
| `artifactsDir` | `docs/lbx-agent-team` | reserved; artifacts currently land in `<stateDir>/<teamId>/artifacts/` |
| `maxReviewLoop` | `3` | consecutive REQUEST_CHANGES cap — task marked failed once the count reaches this value |
| `promptSectionOrder` | `117` | usage prompt-section order |
| `slashCommand` | `true` | register `/lbx-agent-team` + gesture boundary |

Cross-LLM-provider routing is expressed per member through `lbx_agent_team_add_member`'s optional `provider` + `model` (+ `reasoningEffort`) — never through `memberProvider`.

## Boundaries

- **One captain, one active team.** A captain cannot create a second team before ending the first.
- **State is file-backed and serialized within one DSH process.** Concurrent processes editing the same team are not coordinated.
- **`gitWorktrees` requires a git repository** in the workspace; `create` fails loudly otherwise (or set `gitWorktrees: false`).
- **A spec file must exist before creating a team** — `lbx_agent_team_create` validates it.
- Models may occasionally finish work without performing the expected task-state update; the panel shows disk truth, and the captain consolidates via `lbx_agent_team_status` / the state files.

## Tools (17)

| Tool | What it does |
| --- | --- |
| `lbx_agent_team_create` | Create a team; the caller becomes the captain (spec + git repo required) |
| `lbx_agent_team_add_member` | Register a durable member (lazy spawn; optional provider/model/effort) |
| `lbx_agent_team_remove_member` | Remove a member: revoke attempt, requeue unfinished tasks, quiesce live turn |
| `lbx_agent_team_delete` | Archive the team and keep its full record under `archive/` |
| `lbx_agent_team_create_task` | Add a task with dependencies, assignee (`pool` / `new-dever` / member / `captain`) and verification |
| `lbx_agent_team_claim_task` | Claim a ready task (deps complete); returns the `attempt_id` capability |
| `lbx_agent_team_update_task` | Report progress and drive the pipeline (`done:true` submits to review / completes a tested task) |
| `lbx_agent_team_reassign_task` | Captain-only retry/transfer; revokes the old attempt first |
| `lbx_agent_team_submit_review` | Checker verdict: APPROVE or REQUEST_CHANGES (loop-capped) |
| `lbx_agent_team_commit_task` | Commit an approved task in its worktree; manual fallback without a shell service |
| `lbx_agent_team_test_task` | Tester verdict: PASS merges the branch back; FAIL opens an issue |
| `lbx_agent_team_cancel_task` | Captain-only cancel of an unfinished task; records cancelledAt/By/reason, frees the holder (idle + quiesce), cleans a dedicated worktree, skips the freed member in this dispatch round |
| `lbx_agent_team_issue_create` | Record an issue (any participant; tester auto-creates on FAIL) |
| `lbx_agent_team_issue_resolve` | Resolve an open issue (captain or reporter) |
| `lbx_agent_team_send_message` | Send a durable message to the captain or a teammate (wakes the recipient) |
| `lbx_agent_team_status` | Team snapshot: members, tasks, blockers, ready queue, own inbox |
| `lbx_agent_team_artifact` | Deterministic markdown artifacts: tasklist / review / testreport / final report |

Full contracts — parameters, hard gates, error messages, and state transitions — are in [docs/usage.md](./docs/usage.md).

## Verification

**Layer 0 — verified on real instances (facts, not promises):**

- Headless end-to-end with a real LLM (`deepseek-v4-flash`) on a scratch profile (Task 19): full pipeline create → roster → task → dever worktree → checker APPROVE → commit `8239ca8` → tester PASS → `--no-ff` merge `cc1868c` → complete, 0 issues. Record: `docs/verification-scratch-profile.md`.
- Fresh-profile installs via local tarball and `git+file://` (Task 20): zero peer resolution, all four `exports` resolve, boot smoke HTTP 200, client route `/plugins/lbx-agent-team/client.js` 200. Record: `docs/verification-from-zero-install.md`.
- `pnpm verify` green: build + unit tests + composition verification (`scripts/verify-composition.mjs`).

**Layer 1 — offline self-check:**

```sh
cd /path/to/dsh-plugins/lbx-agent-team
pnpm install
pnpm build
pnpm verify
```

**Layer 2 — end-to-end on your instance:**

```sh
dsh plugin --profile web add /path/to/lbx-agent-team
dsh --profile web --dump-config   # the lbx-agent-team layer should appear
dsh web                            # then: /lbx-agent-team 实现 docs/specs/xxx.md
```

## Known limitations

- **Shared-worktree commits stage everything (git add -A).** Tasks handled by the captain, by pool devers with `gitWorktrees: false`, or after a failed worktree creation fall back to committing in the shared workspace — a plain `git add -A` there will sweep unrelated untracked files into the commit. Prefer the dedicated-worktree flow; keep the shared tree clean when using the fallbacks (hardening planned in M2).
- **Not published to npm yet.** Use one of the verified local paths above; `dsh plugin --profile web add lbx-agent-team` from the registry will not work until a future publish.
- **`lib/` must ship with git installs.** Because `lib/` is git-ignored, a git install without build artifacts installs and `--dump-config` fine but fails at **startup** with `Error [ERR_MODULE_NOT_FOUND]` for `lib/index.js`. Fix: install a tag / Release snapshot that contains `lib/` (recommended), or commit `lib/` for private repos.
- **Peer dual-instance combination (documented, non-blocking).** The plugin resolves `@deepseek-ai/dsh-*` from its own `node_modules` (devDeps `0.1.0-rc.8`) while the host CLI closure is `0.1.1-rc.2`; all verified flows work, but this dual-instance layout is a risk to re-evaluate before publishing.
- **Stale registry mirror (environment).** `registry.npmmirror.com` serves stale `@deepseek-ai` packages (e.g. `dsh-headless@0.0.1-rc.1` with a 404 dependency). Use the official registry or install from local links.
- **`artifactsDir` is reserved, not wired.** Artifacts are currently written under `<stateDir>/<teamId>/artifacts/`, not `config.artifactsDir`.
- **Headless runs need LLM credentials.** Without an API key configured the session cannot execute for real.

## Documentation

| Guide | Covers |
| --- | --- |
| [docs/usage.md](./docs/usage.md) | Architecture, state layout, 17 tool contracts, state machine, configuration, known limits |
| [docs/verification-scratch-profile.md](./docs/verification-scratch-profile.md) | Task 19 real verification record |
| [docs/verification-from-zero-install.md](./docs/verification-from-zero-install.md) | Task 20 tarball & git install verification record |

## Development

```sh
pnpm install
pnpm build
pnpm verify
```

## License

Released under the [MIT](https://opensource.org/licenses/MIT) license.