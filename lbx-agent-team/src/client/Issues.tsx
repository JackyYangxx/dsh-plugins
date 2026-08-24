/**
 * Issues: pure presentational issue list for the lbx-agent-team activity
 * panel (Task 17).
 *
 * Each row shows a severity badge (BLOCKER/HIGH/MEDIUM/LOW), the issue title
 * and its open/resolved status. No DOM access or effects.
 */

import type { ActivityIssue } from './activity-monitor.ts'
import css from './TeamPanel.module.css'

export interface IssuesProps {
  /** Issue rows in host snapshot order. */
  readonly issues: readonly ActivityIssue[]
  /** Section caption shown in the section header. */
  readonly caption?: string
}

/** Issue list: severity badge, title and status. */
export function Issues({ issues, caption = 'Issues' }: IssuesProps) {
  return (
    <section className={css.section} data-panel-section="issues">
      <header className={css.sectionHead}>
        <span className={css.sectionTitle}>{caption}</span>
        <span className={css.sectionCount}>{issues.length}</span>
      </header>
      {issues.length === 0
        ? <p className={css.emptyHint}>No issues.</p>
        : (
          <ul className={css.issueList}>
            {issues.map((issue) => (
              <li
                key={issue.id}
                className={css.issueRow}
                data-severity={issue.severity}
                data-status={issue.status}
              >
                <span className={css.severityBadge} data-severity={issue.severity}>{issue.severity}</span>
                <span className={css.issueTitle} title={issue.title}>{issue.title}</span>
                <span className={css.issueStatus} data-status={issue.status}>{issue.status}</span>
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}
