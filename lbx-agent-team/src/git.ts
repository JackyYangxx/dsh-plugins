import type { Context } from '@deepseek-ai/cordis'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

export interface ShellResult { ok: boolean; stdout: string; stderr: string }
export interface ShellAdapter { exec(cmd: string, cwd: string): Promise<ShellResult> }

/** 从 ctx 取 shell 服务（bash/shell/terminal），无则 undefined。 */
export function shellAdapter(ctx: Context): ShellAdapter | undefined {
  for (const key of ['bash', 'shell', 'terminal'] as const) {
    const svc = (ctx as unknown as Record<string, unknown>)[key] as
      | { exec(cmd: string, opts?: { cwd?: string }): Promise<{ code?: number; stdout?: string; stderr?: string }> }
      | undefined
    if (svc && typeof svc.exec === 'function') {
      return {
        exec: async (cmd, cwd) => {
          const r = await svc.exec(cmd, { cwd })
          return { ok: (r.code ?? 0) === 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
        },
      }
    }
  }
  return undefined
}

/** 无 ctx 时的直连兜底（测试与 headless 用）。 */
export function localShell(): ShellAdapter {
  return {
    exec: async (cmd, cwd) => {
      try {
        const r = await execFileP(cmd, { cwd, shell: true })
        return { ok: true, stdout: r.stdout, stderr: r.stderr }
      } catch (e) {
        const err = e as { stdout?: string; stderr?: string }
        return { ok: false, stdout: err.stdout ?? '', stderr: err.stderr ?? String(e) }
      }
    },
  }
}

export async function runGit(sh: ShellAdapter, cwd: string, args: string[]): Promise<ShellResult> {
  return sh.exec(`git ${args.map((a) => JSON.stringify(a)).join(' ')}`, cwd)
}

/** 校验 cwd 是 git 仓库；不是则返回错误信息。 */
export async function ensureGitRepo(sh: ShellAdapter, cwd: string): Promise<{ ok: boolean; error?: string }> {
  const r = await runGit(sh, cwd, ['rev-parse', '--is-inside-work-tree'])
  if (!r.ok || r.stdout.trim() !== 'true') return { ok: false, error: 'workspace is not a git repository — run git init first' }
  return { ok: true }
}

/** 在 repo 建 worktree（新分支 branch，基于 base）。 */
export async function createWorktree(
  sh: ShellAdapter,
  opts: { repo: string; path: string; branch: string; base: string },
): Promise<void> {
  const r = await runGit(sh, opts.repo, ['worktree', 'add', '-b', opts.branch, opts.path, opts.base])
  if (!r.ok) throw new Error(`git worktree add failed: ${r.stderr}`)
}

/** 在 worktree 全量提交，返回 commit hash。 */
export async function commitAll(sh: ShellAdapter, cwd: string, message: string): Promise<string> {
  const add = await runGit(sh, cwd, ['add', '-A'])
  if (!add.ok) throw new Error(`git add failed: ${add.stderr}`)
  const commit = await runGit(sh, cwd, ['commit', '-m', message])
  if (!commit.ok) throw new Error(`git commit failed: ${commit.stderr}`)
  const rev = await runGit(sh, cwd, ['rev-parse', 'HEAD'])
  return rev.stdout.trim()
}

/** 把分支 --no-ff 合并回主分支。冲突时抛错（coordinator 协调）。 */
export async function mergeBranch(sh: ShellAdapter, repo: string, branch: string): Promise<void> {
  const r = await runGit(sh, repo, ['merge', '--no-ff', '-m', `merge team branch ${branch}`, branch])
  if (!r.ok) throw new Error(`git merge failed: ${r.stderr}`)
}

/** 删除已完成任务的 worktree。 */
export async function removeWorktree(sh: ShellAdapter, repo: string, path: string): Promise<void> {
  const r = await runGit(sh, repo, ['worktree', 'remove', '--force', path])
  if (!r.ok) throw new Error(`git worktree remove failed: ${r.stderr}`)
}
