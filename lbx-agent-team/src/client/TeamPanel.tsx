/**
 * TeamPanel: pure presentational container for the lbx-agent-team activity
 * panel (Task 17).
 *
 * Renders one team snapshot as a collapsible card: a header with the team
 * name, an `activity-model.panelSummary` count badge strip, and — when
 * expanded — the Roster, TaskList, DagView and Issues sections inside a
 * scrollable body. The body height is capped by CSS (narrow screens get a
 * stricter cap) so long rosters/task lists scroll instead of growing forever.
 *
 * Collapse state is controlled by props when `collapsed`/`onToggleCollapsed` are provided and falls back to a local toggle
 * otherwise, so the component stays fully testable and HMR-friendly: no DOM
 * access, no effects, no global state. All copy flows through the optional
 * `t` locale seat (Task 18); without one an English fallback keeps the
 * component renderable standalone.
 */

import { useCallback, useId, useState, type ReactNode } from 'react'
import { panelSummary, type PanelSummary } from './activity-model.ts'
import type { ActivityTask, ActivityTeam } from './activity-monitor.ts'
import type { CaptainAction, ReassignActionOptions } from './action-messages.ts'
import { enFallbackTranslate, type LbxAgentTeamLocaleKey, type LbxAgentTeamTranslate } from './locales.ts'
import { DagView } from './DagView.tsx'
import { Issues } from './Issues.tsx'
import { Roster } from './Roster.tsx'
import { TaskList } from './TaskList.tsx'
import css from './TeamPanel.module.css'

export interface TeamPanelProps {
  /** One live or archived team snapshot. */
  readonly team: ActivityTeam
  /** Controlled collapsed state; when omitted the panel toggles internally. */
  readonly collapsed?: boolean
  /** Controlled toggle callback (paired with `collapsed`). */
  readonly onToggleCollapsed?: () => void
  /** Initial internal state when `collapsed` is not provided. */
  readonly defaultCollapsed?: boolean
  /** Optional extra header content (e.g. panel-level actions). */
  readonly headerExtra?: ReactNode
  /** Optional locale translate seat; English fallback when absent. */
  readonly t?: LbxAgentTeamTranslate
  /** Captain view: pass through to TaskList so per-task action buttons render. */
  readonly isCaptain?: boolean
  /** Active member names offered as reassign targets (pool/captain are implicit). */
  readonly reassignTargets?: readonly string[]
  /** Captain action click handler; the caller owns message injection. */
  readonly onAction?: (
    action: CaptainAction,
    task: ActivityTask,
    options?: ReassignActionOptions,
  ) => void | Promise<boolean>
}

export interface SummaryBadgesProps {
  /** The bucketed count projection from activity-model. */
  readonly summary: PanelSummary
  /** Optional locale translate seat; English fallback when absent. */
  readonly t?: LbxAgentTeamTranslate
}

const SUMMARY_BUCKETS: ReadonlyArray<readonly [bucket: Exclude<keyof PanelSummary, 'total'>, label: LbxAgentTeamLocaleKey]> = [
  ['done', 'stage.done'],
  ['inProgress', 'stage.working'],
  ['inReview', 'stage.review'],
  ['failed', 'stage.failed'],
  ['waiting', 'stage.pending'],
  ['other', 'stage.other'],
]

/** One count badge per panelSummary bucket, tone-graded by bucket. */
export function SummaryBadges({ summary, t }: SummaryBadgesProps) {
  const translate = t ?? enFallbackTranslate
  return (
    <span className={css.summaryBadges}>
      <span className={css.summaryBadge} data-bucket="total">
        {summary.total}
        <span className={css.summaryBadgeLabel}>{translate('bucket.total')}</span>
      </span>
      {SUMMARY_BUCKETS.map(([bucket, label]) => (
        <span key={bucket} className={css.summaryBadge} data-bucket={bucket} data-count={summary[bucket]}>
          {summary[bucket]}
          <span className={css.summaryBadgeLabel}>{translate(label)}</span>
        </span>
      ))}
    </span>
  )
}

/** Collapse chevron; rotates 90° while the panel is expanded. */
function Chevron({ open }: { readonly open: boolean }) {
  return (
    <svg
      className={css.chevron}
      data-open={open}
      width="9"
      height="9"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M3.5 2l3 3-3 3" />
    </svg>
  )
}

/** One team activity card: summary badges + collapsible roster/tasks/DAG/issues. */
export function TeamPanel({
  team,
  collapsed,
  onToggleCollapsed,
  defaultCollapsed = false,
  headerExtra,
  t,
  isCaptain = false,
  reassignTargets,
  onAction,
}: TeamPanelProps) {
  const translate = t ?? enFallbackTranslate
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed)
  const isCollapsed = collapsed ?? internalCollapsed
  const toggleCollapsed = useCallback((): void => {
    if (onToggleCollapsed !== undefined) {
      onToggleCollapsed()
      return
    }
    setInternalCollapsed((current) => !current)
  }, [onToggleCollapsed])
  // panelSummary takes a mutable task list; the snapshot is readonly, so copy
  // the array at the call boundary (cheap, snapshot-sized).
  const summary = panelSummary({ tasks: [...team.tasks] })
  // Stable id for the collapsible body. Derived from useId (Task 17 review
  // minor) rather than the teamId alone: multiple panels can surface the same
  // team generation (live + archived), so a teamId-derived id would collide.
  // useId is instance-unique, so aria-controls always names the right body.
  const generatedId = useId()
  const bodyId = `lbx-agent-team-${generatedId.replace(/[^a-zA-Z0-9_-]+/g, '')}-body`
  return (
    <section
      className={css.panel}
      data-panel
      data-team-id={team.teamId}
      data-team-status={team.status}
      data-collapsed={isCollapsed || undefined}
    >
      <header className={css.panelHead}>
        <button
          type="button"
          className={css.toggleButton}
          onClick={toggleCollapsed}
          aria-expanded={!isCollapsed}
          aria-controls={isCollapsed ? undefined : bodyId}
          aria-label={isCollapsed ? translate('team.expand', { name: team.name }) : translate('team.collapse', { name: team.name })}
          title={isCollapsed ? translate('team.expandShort') : translate('team.collapseShort')}
        >
          <Chevron open={!isCollapsed} />
        </button>
        <span className={css.panelTitle} title={team.name}>{team.name}</span>
        {team.status === 'archived' && <span className={css.archivedPill}>{translate('team.archived')}</span>}
        {headerExtra}
      </header>
      <div className={css.summaryRow}>
        <SummaryBadges summary={summary} t={translate} />
      </div>
      {!isCollapsed && (
        <div className={css.body} id={bodyId} data-panel-body>
          <Roster members={team.members} t={translate} />
          <TaskList
            tasks={team.tasks}
            t={translate}
            isCaptain={isCaptain}
            reassignTargets={reassignTargets}
            onAction={onAction}
          />
          <DagView tasks={team.tasks} t={translate} />
          <Issues issues={team.issues} t={translate} />
        </div>
      )}
    </section>
  )
}
