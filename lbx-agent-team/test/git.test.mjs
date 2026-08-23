import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commitAll, createWorktree, ensureGitRepo, mergeBranch } from '../lib/git.js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const shell = {
  exec: async (cmd, cwd) => {
    const r = await run(cmd, { cwd, shell: true })
    return { ok: true, stdout: r.stdout, stderr: r.stderr }
  },
}

let root
test.before(async () => { root = await mkdtemp(join(tmpdir(), 'lbx-git-')) })
test.after(async () => { await rm(root, { recursive: true, force: true }) })

test('worktree lifecycle: create, commit, merge back', async () => {
  const repo = join(root, 'repo')
  await shell.exec('mkdir -p repo', root)
  await shell.exec('git init -b main', repo)
  await shell.exec('git config user.email t@t.t', repo)
  await shell.exec('git config user.name t', repo)
  await shell.exec('echo base > base.txt && git add -A && git commit -m base', repo)

  const wt = join(root, 'wt')
  await createWorktree(shell, { repo, path: wt, branch: 'team/t1/t1', base: 'main' })
  await shell.exec('echo work > base.txt', wt)
  const hash = await commitAll(shell, wt, 'feat: work')
  assert.match(hash, /^[0-9a-f]{40}$/)

  await mergeBranch(shell, repo, 'team/t1/t1')
  const out = await shell.exec('cat base.txt', repo)
  assert.match(out.stdout, /work/)
})
