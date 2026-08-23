# Multi-Agent Team Memory

## Team Structure

| Role | Agent Name | Responsibility |
|------|-----------|---------------|
| Coordinator | `coordinator` | Routes all messages between agents, manages task flow |
| Planner | `planner` | Splits specs into independent, testable tasks |
| Checker | `checker` | Reviews code quality, design consistency, files issues locally |
| Developer | `dever-{N}` | Implements tasks, self-reviews with simplify, git commits, fixes own issues |
| Tester | `tester` | Writes E2E tests from spec, runs tests, assigns issues to responsible dever |

## Team Operation Protocol

```
User approves SPEC
    ↓
coordinator → planner: "Split spec into tasks"
coordinator → tester: "Write E2E test cases from spec"
    ↓
[planner + tester run in parallel]
planner → writes → docs/superpowers/tasks/{date}-{feature}-tasklist.md
tester → writes → docs/superpowers/tests/{date}-{feature}-test-cases.md
    ↓
tester submits test cases to checker: "Review test cases"
    ↓
[checker APPROVE] → test cases approved
[checker REQUEST_CHANGES] → tester revises → re-review
    ↓
[Task list + Test cases approved]
    ↓
coordinator → dever-1, dever-2, ...: "Implement assigned tasks"
    ↓
dever-N completes Task → checker: "Review code"
    ↓
checker → writes → docs/superpowers/reviews/{date}-{task}-review.md
    ↓
[if issues] checker → dever-N: "Fix issues listed in review file"
[if pass] checker → dever-N: "Approve, commit to git"
    ↓
dever-N commits → tester: "Test Task"
    ↓
tester runs E2E test for Task
    ↓
[if issue] tester → coordinator: "Issue found in Task"
coordinator → responsible dever-N: "Fix issue"
    ↓
[if responsible dever-N unknown] → spawn new dever-K to fix
dever-K or responsible dever-N fixes → tester re-tests
    ↓
[all tests pass] tester → coordinator: "Task verified"
    ↓
[all tasks done] tester final comprehensive test
    ↓
tester → tester writes test report: docs/superpowers/tests/{date}-{feature}-test-report.md
tester → submits test report to checker: "Review test report"
    ↓
[checker APPROVE] → tester → coordinator: "All tests passed"
[checker REQUEST_CHANGES] → tester revises test report → re-review
    ↓
coordinator → user: "Ready for acceptance"
```

## File Naming Conventions

| File Type | Path Pattern |
|-----------|--------------|
| Spec | `docs/superpowers/specs/{date}-{feature}-design.md` |
| Task List | `docs/superpowers/tasks/{date}-{feature}-tasklist.md` |
| Code Review | `docs/superpowers/reviews/{date}-{task}-review.md` |
| Test Cases | `docs/superpowers/tests/{date}-{feature}-test-cases.md` |
| Test Report | `docs/superpowers/tests/{date}-{feature}-test-report.md` |
| Test Issue | `docs/superpowers/issues/{date}-{issue}-issue.md` |
| Agent Log | `docs/superpowers/logs/{agent}/{date}-{agent}-log.md` |

## Coordination Rules

1. **No agent talks to another without coordinator routing**
2. **All inter-agent communication via SendMessage to coordinator**
3. **Coordinator NEVER implements code or tests**
4. **Checker NEVER modifies code directly**
5. **Dever commits ONLY after checker approval**
6. **One dever per task** — Each task spawns a dedicated `dever-{N}` instance
7. **Tester assigns issues to the responsible dever** — coordinator routes the assignment
8. **Fallback: spawn new dever** — If responsible dever cannot be identified, spawn `dever-K` to fix
9. **Test report required** — After all tests pass, tester writes report and submits to checker for approval
10. **All issues must be resolved** — Feature only ready for acceptance when ALL issues are closed