/**
 * Issues: pure presentational issue list for the lbx-agent-team activity
 * panel (Task 17).
 *
 * Each row shows a severity badge (BLOCKER/HIGH/MEDIUM/LOW), the issue title
 * and its open/resolved status. No DOM access or effects. Copy flows through
 * the optional `t` locale seat (Task 18); without one an English fallback
 * keeps the component renderable standalone.
 */

import { enFallbackTranslate, type LbxAgentTeamLocaleKey, type LbxAgentTeamTranslate } from './locales.ts'
import type { ActivityIssue } from './activity-monitor.ts'
import css from './TeamPanel.module.css'

export interface IssuesProps {
  /** Issue rows in host snapshot order. */
  readonly issues: readonly ActivityIssue[]
  /** Section caption shown in the section header. */
  readonly caption?: string
  /** Optional locale translate seat; English fallback when absent. */
  readonly t?: LbxAgentTeamTranslate
}

/** Exhaustive severity → locale key; a new severity fails the build here. */
const SEVERITY_LABEL: Record<ActivityIssue['severity'], LbxAgentTeamLocaleKey> = {
  BLOCKER: 'severity.BLOCKER',
  HIGH: 'severity.HIGH',
  MEDIUM: 'severity.MEDIUM',
  LOW: 'severity.LOW',
}

/** Exhaustive issue status → locale key. */
const ISSUE_STATUS_LABEL: Record<ActivityIssue['status'], LbxAgentTeamLocaleKey> = {
  open: 'issue.open',
  resolved: 'issue.resolved',
}

/** Issue list: severity badge, title and status. */
export function Issues({ issues, caption, t }: IssuesProps) {
  const translate = t ?? enFallbackTranslate
  const title = caption ?? translate('issues.caption')
  return (
    <section className={css.section} data-panel-section="issues">
      <header className={css.sectionHead}>
        <span className={css.sectionTitle}>{title}</span>
        <span className={css.sectionCount}>{issues.length}</span>
      </header>
      {issues.length === 0
        ? <p className={css.emptyHint}>{translate('issues.empty')}</p>
        : (
          <ul className={css.issueList}>
            {issues.map((issue) => (
              <li
                key={issue.id}
                className={css.issueRow}
                data-severity={issue.severity}
                data-status={issue.status}
              >
                <span className={css.severityBadge} data-severity={issue.severity}>{translate(SEVERITY_LABEL[issue.severity])}</span>
                <span className={css.issueTitle} title={issue.title}>{issue.title}</span>
                <span className={css.issueStatus} data-status={issue.status}>{translate(ISSUE_STATUS_LABEL[issue.status])}</span>
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}
