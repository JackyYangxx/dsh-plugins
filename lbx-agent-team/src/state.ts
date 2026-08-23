import { createHash } from 'node:crypto'
import { mkdir, open, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { TeamMessage, TeamState } from './types.ts'

const locks = new Map<string, Promise<unknown>>()

/** 净化为用户可读的目录 id。 */
export function sanitizeKey(name: string): string {
  const cleaned = name.trim().toLowerCase()
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  if (cleaned === '' || cleaned === '.' || cleaned === '..') {
    return 'team-' + createHash('sha1').update(name).digest('hex').slice(0, 8)
  }
  return cleaned.slice(0, 64)
}

/** 进程内锁：同一 (stateRoot, teamId) 的写操作串行。 */
export async function withTeamLock<T>(stateRoot: string, teamId: string, fn: () => Promise<T>): Promise<T> {
  const key = `team:${stateRoot}:${teamId}`
  const prev = locks.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  locks.set(key, gate)
  await prev
  try {
    return await fn()
  } finally {
    release()
    if (locks.get(key) === gate) locks.delete(key)
  }
}

export async function readTeam(stateRoot: string, teamId: string): Promise<TeamState | undefined> {
  try {
    const raw = await readFile(join(stateRoot, teamId, 'team.json'), 'utf8')
    return JSON.parse(raw) as TeamState
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return undefined
    throw err
  }
}

/** 原子发布：临时文件 + fsync + rename（同目录）。 */
export async function writeTeam(stateRoot: string, team: TeamState): Promise<void> {
  const dir = join(stateRoot, team.id)
  await mkdir(dir, { recursive: true })
  const tmp = join(dir, `team.json.tmp-${process.pid}-${Date.now()}`)
  const final = join(dir, 'team.json')
  const fh = await open(tmp, 'w')
  try {
    await fh.writeFile(JSON.stringify(team, null, 2))
    await fh.sync()
  } finally {
    await fh.close()
  }
  await rename(tmp, final)
}

export async function appendMailbox(
  stateRoot: string, teamId: string, member: string, message: TeamMessage,
): Promise<void> {
  const dir = join(stateRoot, teamId, 'inbox')
  await mkdir(dir, { recursive: true })
  const fh = await open(join(dir, `${member}.jsonl`), 'a')
  try {
    await fh.writeFile(JSON.stringify(message) + '\n')
    await fh.sync()
  } finally {
    await fh.close()
  }
}

/** 读邮箱；容忍末尾 torn line（半行 JSON 直接丢弃）。 */
export async function readMailbox(
  stateRoot: string, teamId: string, member: string,
): Promise<TeamMessage[]> {
  let raw: string
  try {
    raw = await readFile(join(stateRoot, teamId, 'inbox', `${member}.jsonl`), 'utf8')
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return []
    throw err
  }
  const out: TeamMessage[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      out.push(JSON.parse(trimmed) as TeamMessage)
    } catch {
      // torn tail：忽略
    }
  }
  return out
}
