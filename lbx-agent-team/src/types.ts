/** 任务生命周期状态（pipeline 顺序）。 */
export type TaskStatus =
  | 'pending' | 'claimed' | 'in_progress' | 'in_review'
  | 'approved' | 'committed' | 'tested' | 'complete'
  | 'changes_requested' | 'failed' | 'cancelled'

export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ['complete', 'failed', 'cancelled']

export type MemberRole = 'planner' | 'checker' | 'tester' | 'dever' | (string & {})

export type MemberStatus = 'pending' | 'idle' | 'working' | 'removed'

export interface TeamMember {
  id: string            // 子代理会话 id（spawn 后填充；pending 时为 ''）
  name: string
  role: MemberRole
  status: MemberStatus
  provider?: string
  model?: string
  reasoningEffort?: string
  worktreePath?: string
  branch?: string
  joinedAt: number
  retiredAt?: number
}

export interface TeamTask {
  id: string
  subject: string
  description?: string
  status: TaskStatus
  assignee?: string     // 成员名 | 'pool' | 'captain'
  dedicated?: boolean   // true = 需要专用 dever（懒 spawn）
  dependencies: string[]
  verification?: string
  output?: string
  attempt?: number
  attemptId?: string
  reviewLoop?: number   // 连续 REQUEST_CHANGES 计数（超 maxReviewLoop 置 failed）
  review?: { verdict: 'APPROVE' | 'REQUEST_CHANGES'; reviewer: string; findingsPath?: string; at: number }
  commit?: { hash: string; branch: string; at: number }
  test?: { result: 'PASS' | 'FAIL'; tester: string; reportPath?: string; at: number }
  createdAt: number
  updatedAt: number
}

export interface TeamIssue {
  id: string
  title: string
  severity: 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW'
  status: 'open' | 'resolved'
  taskId?: string
  reporter: string
  responsible?: string
  steps?: string
  expected?: string
  actual?: string
  resolution?: { commitHash?: string; at: number }
  createdAt: number
}

export interface TeamState {
  id: string
  name: string
  specPath: string
  description?: string
  captainSessionId: string
  status: 'active' | 'archived'
  createdAt: number
  members: TeamMember[]
  tasks: TeamTask[]
  issues: TeamIssue[]
  taskSeq: number
  issueSeq: number
}

export interface TeamMessage {
  id: string
  from: string
  to: string
  content: string
  ts: number
  readAt?: number
}

export type Actor = { kind: 'captain' } | { kind: 'member'; name: string; role: string }
