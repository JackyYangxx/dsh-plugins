/**
 * `lbxAgentTeam` namespace dictionaries for every plugin-owned Web surface.
 *
 * The Simplified Chinese dictionary is the key-set source of truth; the
 * English dictionary is checked complete against it by the type system
 * (`satisfies Record<LbxAgentTeamLocaleKey, string>`), so a key added to one
 * without the other fails the client build.
 */

/** Dictionary namespace owned by the lbx-agent-team client plugin. */
export const LBX_AGENT_TEAM_LOCALE_NAMESPACE = 'lbxAgentTeam'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  // Panel shell.
  'panel.title': 'LBX 团队活动',
  'panel.aria': 'LBX 团队活动面板',
  'panel.countAria': '{count} 个团队',
  'panel.close': '收起活动面板',
  'panel.archived': '已结束 · 历史归档',
  'panel.empty': '暂无团队活动',
  // Summary bucket labels (panelSummary projection).
  'bucket.total': '总计',
  // Pipeline stage badges (activity-model StageLabel) + bucket labels.
  'stage.pending': '待开始',
  'stage.working': '进行中',
  'stage.review': '评审中',
  'stage.approved': '已批准',
  'stage.committed': '已提交',
  'stage.tested': '已测试',
  'stage.done': '已完成',
  'stage.failed': '失败',
  'stage.cancelled': '已取消',
  'stage.other': '其他',
  // Team panel a11y and chrome.
  'team.expand': '展开 {name}',
  'team.collapse': '收起 {name}',
  'team.expandShort': '展开',
  'team.collapseShort': '收起',
  'team.archived': '已归档',
  // Section captions and empty hints.
  'roster.caption': '成员',
  'roster.empty': '暂无成员，等待队长组建团队',
  'tasks.caption': '任务',
  'tasks.empty': '暂无任务',
  'dag.caption': '任务依赖',
  'dag.empty': '暂无任务',
  'dag.countTitle': '含依赖的任务数',
  'issues.caption': '问题',
  'issues.empty': '暂无问题',
  // Member status badges.
  'member.status.pending': '待执行',
  'member.status.idle': '空闲',
  'member.status.working': '工作中',
  'member.status.removed': '已移除',
  // Issue severity + status labels.
  'severity.BLOCKER': '阻塞',
  'severity.HIGH': '高',
  'severity.MEDIUM': '中',
  'severity.LOW': '低',
  'issue.open': '未解决',
  'issue.resolved': '已解决',
} satisfies Record<string, string>

/** LbxAgentTeam namespace key union. */
export type LbxAgentTeamLocaleKey = keyof typeof zh

/** English dictionary, checked complete against the Chinese source key set. */
export const en = {
  'panel.title': 'LBX team activity',
  'panel.aria': 'LBX team activity panel',
  'panel.countAria': '{count} teams',
  'panel.close': 'Collapse activity panel',
  'panel.archived': 'Ended · Archived history',
  'panel.empty': 'No team activity',
  'bucket.total': 'Total',
  'stage.pending': 'Pending',
  'stage.working': 'Working',
  'stage.review': 'Review',
  'stage.approved': 'Approved',
  'stage.committed': 'Committed',
  'stage.tested': 'Tested',
  'stage.done': 'Done',
  'stage.failed': 'Failed',
  'stage.cancelled': 'Cancelled',
  'stage.other': 'Other',
  'team.expand': 'Expand {name}',
  'team.collapse': 'Collapse {name}',
  'team.expandShort': 'Expand',
  'team.collapseShort': 'Collapse',
  'team.archived': 'Archived',
  'roster.caption': 'Roster',
  'roster.empty': 'No members yet.',
  'tasks.caption': 'Tasks',
  'tasks.empty': 'No tasks yet.',
  'dag.caption': 'Task dependencies',
  'dag.empty': 'No tasks yet.',
  'dag.countTitle': 'tasks with dependencies',
  'issues.caption': 'Issues',
  'issues.empty': 'No issues.',
  'member.status.pending': 'Pending',
  'member.status.idle': 'Idle',
  'member.status.working': 'Working',
  'member.status.removed': 'Removed',
  'severity.BLOCKER': 'BLOCKER',
  'severity.HIGH': 'HIGH',
  'severity.MEDIUM': 'MEDIUM',
  'severity.LOW': 'LOW',
  'issue.open': 'Open',
  'issue.resolved': 'Resolved',
} satisfies Record<LbxAgentTeamLocaleKey, string>

/** Translation function consumed by pure view helpers. */
export type LbxAgentTeamTranslate = (
  key: LbxAgentTeamLocaleKey,
  params?: Record<string, unknown>,
) => string

/**
 * English fallback translator used by the presentational components when no
 * live `t` seat is provided (standalone renders, tests, HMR isolation). The
 * dictionaries carry identical key sets, so the fallback never misses.
 */
export function enFallbackTranslate(
  key: LbxAgentTeamLocaleKey,
  params?: Record<string, unknown>,
): string {
  let text = en[key]
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}
