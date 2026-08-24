/**
 * Roster: pure presentational member list for the lbx-agent-team activity
 * panel (Task 17).
 *
 * Renders one row per `ActivityMember` with a role badge and a
 * pending/idle/working/removed status badge. All data arrives through props —
 * no DOM access, no effects, no internal data sources — so the component
 * renders identically under test and in the live panel, and survives HMR with
 * the panel state owned by its parent. Copy flows through the optional `t`
 * locale seat (Task 18); without one an English fallback keeps the component
 * renderable standalone.
 */

import { enFallbackTranslate, type LbxAgentTeamLocaleKey, type LbxAgentTeamTranslate } from './locales.ts'
import type { ActivityMember } from './activity-monitor.ts'
import css from './TeamPanel.module.css'

export interface RosterProps {
  /** Member rows in host snapshot order. */
  readonly members: readonly ActivityMember[]
  /** Section caption shown in the section header. */
  readonly caption?: string
  /** Optional locale translate seat; English fallback when absent. */
  readonly t?: LbxAgentTeamTranslate
}

const MEMBER_STATUS_LABEL: Record<ActivityMember['status'], LbxAgentTeamLocaleKey> = {
  pending: 'member.status.pending',
  idle: 'member.status.idle',
  working: 'member.status.working',
  removed: 'member.status.removed',
}

/** Member roster: name, role badge and status badge. */
export function Roster({ members, caption, t }: RosterProps) {
  const translate = t ?? enFallbackTranslate
  const title = caption ?? translate('roster.caption')
  return (
    <section className={css.section} data-panel-section="roster">
      <header className={css.sectionHead}>
        <span className={css.sectionTitle}>{title}</span>
        <span className={css.sectionCount}>{members.length}</span>
      </header>
      {members.length === 0
        ? <p className={css.emptyHint}>{translate('roster.empty')}</p>
        : (
          <ul className={css.roster}>
            {members.map((member) => (
              <li
                key={member.id}
                className={css.memberRow}
                data-status={member.status}
                data-activity={member.activity}
              >
                <span className={css.memberName} title={member.name}>{member.name}</span>
                <span className={css.roleBadge}>{member.role}</span>
                <span className={css.statusBadge} data-status={member.status}>{translate(MEMBER_STATUS_LABEL[member.status])}</span>
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}
