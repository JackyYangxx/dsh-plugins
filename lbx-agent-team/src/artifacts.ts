import type { TeamState } from './types.ts'

const DONE = ['complete']
const FAILED = ['failed', 'cancelled']

function statusBox(status: string): string {
  return status === 'complete' ? '[x]' : '[ ]'
}

export function renderTasklist(team: TeamState): string {
  const lines = [
    `# ${team.name} Task List`,
    '',
    `**Spec:** ` + team.specPath,
    `**Generated:** ${new Date().toISOString()}`,
    `**Total Tasks:** ${team.tasks.length}`,
    '',
    ...team.tasks.map((t) => `- ${statusBox(t.status)} ${t.id}: ${t.subject} (${t.status}${t.assignee ? ', ' + t.assignee : ''})`),
    '',
  ]
  return lines.join('\n')
}

export function renderReview(team: TeamState, taskId: string): string {
  const t = team.tasks.find((x) => x.id === taskId)
  const lines = [
    `# Review: ${t?.subject ?? taskId}`,
    '',
    `**Task:** ${taskId}`,
    t?.review ? `**Verdict:** ${t.review.verdict} by ${t.review.reviewer} at ${new Date(t.review.at).toISOString()}` : '**Verdict:** none',
    t?.review?.findingsPath ? `**Findings:** ` + t.review.findingsPath : '',
    '',
  ]
  return lines.join('\n')
}

export function renderTestReport(team: TeamState): string {
  const lines = [
    `# ${team.name} Test Report`,
    '',
    ...team.tasks.map((t) =>
      `- ${t.id}: ${t.test?.result ?? 'not tested'}${t.test?.tester ? ' by ' + t.test.tester : ''}`),
    '',
  ]
  return lines.join('\n')
}

export function renderFinalReport(team: TeamState): string {
  const done = team.tasks.filter((t) => DONE.includes(t.status)).length
  const failed = team.tasks.filter((t) => FAILED.includes(t.status)).length
  const openIssues = team.issues.filter((i) => i.status === 'open').length
  const lines = [
    `# ${team.name} Final Report`,
    '',
    `**Spec:** ` + team.specPath,
    `**Tasks:** ${team.tasks.length} total, ${done} complete, ${failed} failed`,
    `**Issues:** ${openIssues} open`,
    '',
    ...team.tasks.map((t) =>
      `- ${statusBox(t.status)} ${t.id}: ${t.subject} — ${t.status}${t.commit ? ' (commit ' + t.commit.hash.slice(0, 8) + ')' : ''}`),
    '',
  ]
  return lines.join('\n')
}
