import type { TeamState } from './types.ts'

const DONE = ['complete']
const FAILED = ['failed', 'cancelled']

/** 行内转义：把换行等控制符替换为空格，防止自由文本注入伪造列表项/标题。 */
function escapeInline(s: string): string {
  return s.replace(/[\n\r]/g, ' ')
}

export function statusBox(status: string): string {
  return status === 'complete' ? '[x]' : '[ ]'
}

/** 状态派生时间（确定性）：队内最后更新的时间戳，代替墙钟。 */
function generatedAt(team: TeamState): string {
  const latest = Math.max(team.createdAt, ...team.tasks.map((t) => t.updatedAt))
  return new Date(latest).toISOString()
}

export function renderTasklist(team: TeamState): string {
  const lines = [
    `# ${escapeInline(team.name)} Task List`,
    '',
    `**Spec:** ` + escapeInline(team.specPath),
    `**Generated:** ${generatedAt(team)}`,
    `**Total Tasks:** ${team.tasks.length}`,
    '',
    ...team.tasks.map((t) => `- ${statusBox(t.status)} ${t.id}: ${escapeInline(t.subject)} (${t.status}${t.assignee ? ', ' + escapeInline(t.assignee) : ''})`),
    '',
  ]
  return lines.join('\n')
}

export function renderReview(team: TeamState, taskId: string): string {
  const t = team.tasks.find((x) => x.id === taskId)
  const lines = [
    `# Review: ${escapeInline(t?.subject ?? taskId)}`,
    '',
    `**Task:** ${taskId}`,
    t?.review
      ? `**Verdict:** ${t.review.verdict} by ${escapeInline(t.review.reviewer)} at ${new Date(t.review.at).toISOString()}`
      : '**Verdict:** none',
  ]
  if (t?.review?.findingsPath) {
    lines.push(`**Findings:** ${escapeInline(t.review.findingsPath)}`)
  }
  lines.push('')
  return lines.join('\n')
}

export function renderTestReport(team: TeamState): string {
  const lines = [
    `# ${escapeInline(team.name)} Test Report`,
    '',
    ...team.tasks.map((t) =>
      `- ${t.id}: ${t.test?.result ?? 'not tested'}${t.test?.tester ? ' by ' + escapeInline(t.test.tester) : ''}${t.test?.reportPath ? ' (' + escapeInline(t.test.reportPath) + ')' : ''}`),
    '',
  ]
  return lines.join('\n')
}

export function renderFinalReport(team: TeamState): string {
  const done = team.tasks.filter((t) => DONE.includes(t.status)).length
  const failed = team.tasks.filter((t) => FAILED.includes(t.status)).length
  const openIssues = team.issues.filter((i) => i.status === 'open').length
  const lines = [
    `# ${escapeInline(team.name)} Final Report`,
    '',
    `**Spec:** ` + escapeInline(team.specPath),
    `**Tasks:** ${team.tasks.length} total, ${done} complete, ${failed} failed`,
    `**Issues:** ${openIssues} open`,
    '',
    ...team.tasks.map((t) =>
      `- ${statusBox(t.status)} ${t.id}: ${escapeInline(t.subject)} — ${t.status}${t.commit ? ' (commit ' + t.commit.hash.slice(0, 8) + ')' : ''}`),
    '',
  ]
  return lines.join('\n')
}
