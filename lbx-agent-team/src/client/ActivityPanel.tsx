/**
 * ActivityPanel: the lbx-agent-team browser monitor (Task 18).
 *
 * A root-scoped `shell.overlay` entry that follows the current conversation
 * session. One polling loop per current session (activity-monitor's
 * `startActivityPolling`) drives the shared live/archived snapshots; teams
 * are bucketed by captain session so other sessions' teams never leak into
 * this surface; each team renders as a collapsible TeamPanel. The panel
 * auto-opens when activity appears and closes after a grace period once
 * every team ends; Escape folds every expanded team (a second Escape closes
 * the panel), and each team's header button exposes the same collapse
 * control with proper aria state.
 *
 * Connection resets need no listener here: the polling loop is stateless per
 * tick (no-store fetch), so after a reset the next tick simply re-reads the
 * state route and republishes the same objects. The component owns no global
 * state — data arrives through props or the shared activity-monitor store —
 * and every subscription/polling controller is released on unmount.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { ObservableSnapshot, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import {
  getActivityMonitorTargetsSnapshot,
  getActivitySnapshotsSnapshot,
  startActivityPolling,
  subscribeActivityMonitorTargets,
  subscribeActivitySnapshots,
  type ActivityTeam,
} from './activity-monitor.ts'
import { TeamPanel } from './TeamPanel.tsx'
import type { LbxAgentTeamTranslate } from './locales.ts'
import css from './ActivityPanel.module.css'

/** Grace before the panel closes once no team remains (mirrors reference). */
const AUTOCLOSE_GRACE_MS = 2000

export interface ActivityPanelProps {
  /** Session-list observable from `ctx.sessions` (current-session tracking). */
  readonly sessionsList: ObservableSnapshot<SessionListState>
  /** Locale translate seat provided by the slot machinery. */
  readonly t: LbxAgentTeamTranslate
}

/** Stable key for one team surface; the status prefix keeps live and archive
 *  generations of the same teamId apart. */
function teamKey(team: ActivityTeam): string {
  return `${team.status}:${team.captainSessionId}:${team.teamId}`
}

/** Collapse chevron for the panel header close control. */
function ChevronDown() {
  return (
    <svg className={css.panelCloseIcon} width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <path d="M2 3.5l3 3 3-3" />
    </svg>
  )
}

export function ActivityPanel({ sessionsList, t }: ActivityPanelProps): ReactNode {
  const current = useSyncExternalStore(
    sessionsList.subscribe,
    sessionsList.getSnapshot,
  ).current
  const monitorTargets = useSyncExternalStore(
    subscribeActivityMonitorTargets,
    getActivityMonitorTargetsSnapshot,
  )
  const { teams, archivedTeams } = useSyncExternalStore(
    subscribeActivitySnapshots,
    getActivitySnapshotsSnapshot,
  )
  const [open, setOpen] = useState(false)
  const [collapsedKeys, setCollapsedKeys] = useState<ReadonlySet<string>>(() => new Set())

  // Per-session bucketing of polling demand: only this session's captain
  // targets keep a monitor alive.
  const currentTargets = useMemo(
    () => (current === undefined ? [] : monitorTargets.filter((target) => target.sessionId === current)),
    [current, monitorTargets],
  )

  // One polling loop per current session; the controller stops when the
  // session is no longer current or the panel unmounts.
  useEffect(() => {
    if (current === undefined) return
    const controller = startActivityPolling(currentTargets, { discoverySessionId: current })
    return () => { controller.stop() }
  }, [current, currentTargets])

  // Teams follow the current session: live snapshots and archived snapshots
  // are visible only while their captain session is current.
  const visibleTeams = useMemo(
    () => (current === undefined ? [] : teams.filter((team) => team.captainSessionId === current)),
    [teams, current],
  )
  const visibleArchived = useMemo(
    () => (current === undefined ? [] : archivedTeams.filter((team) =>
      team.captainSessionId === current
      && !teams.some((live) => live.captainSessionId === current && live.teamId === team.teamId),
    )),
    [archivedTeams, current, teams],
  )
  const visibleCount = visibleTeams.length + visibleArchived.length

  // Auto-expand once activity appears; fold back after the grace period once
  // every team of the current session has ended.
  useEffect(() => {
    if (visibleCount > 0) {
      setOpen(true)
      return
    }
    if (!open) return
    const timer = setTimeout(() => {
      setOpen(false)
      setCollapsedKeys(new Set())
    }, AUTOCLOSE_GRACE_MS)
    return () => { clearTimeout(timer) }
  }, [visibleCount, open])

  const toggleTeam = useCallback((key: string): void => {
    setCollapsedKeys((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const closePanel = useCallback((): void => {
    setOpen(false)
    setCollapsedKeys(new Set())
  }, [])

  // Keyboard collapse: Escape folds every expanded team; when all teams are
  // already folded a second Escape closes the panel entirely.
  const visibleKeys = useMemo(
    () => new Set([...visibleTeams, ...visibleArchived].map(teamKey)),
    [visibleTeams, visibleArchived],
  )
  const allCollapsed = visibleKeys.size > 0
    && [...visibleKeys].every((key) => collapsedKeys.has(key))
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (allCollapsed) {
        closePanel()
        return
      }
      setCollapsedKeys(visibleKeys)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [open, allCollapsed, visibleKeys, closePanel])

  if (!open) return null

  const busy = visibleTeams.some((team) =>
    team.members.some((member) => member.activity === 'working'),
  )
  return (
    <aside
      className={css.panel}
      data-lbx-agent-team-activity
      role="region"
      aria-label={t('panel.aria')}
    >
      <header className={css.panelHead}>
        <span className={css.panelTitle}>
          {t('panel.title')}
          <span className={css.panelDot} data-busy={busy || undefined} aria-hidden />
        </span>
        <span className={css.panelCount} aria-label={t('panel.countAria', { count: visibleCount })}>
          {visibleCount}
        </span>
        <button
          type="button"
          className={css.panelClose}
          onClick={closePanel}
          aria-label={t('panel.close')}
          title={t('panel.close')}
        >
          <ChevronDown />
        </button>
      </header>
      <div className={css.teams}>
        {visibleCount === 0
          ? <p className={css.emptyHint}>{t('panel.empty')}</p>
          : (
            <>
              {visibleTeams.map((team) => {
                const key = teamKey(team)
                return (
                  <TeamPanel
                    key={key}
                    team={team}
                    collapsed={collapsedKeys.has(key)}
                    onToggleCollapsed={() => { toggleTeam(key) }}
                    t={t}
                  />
                )
              })}
              {visibleArchived.map((team) => {
                const key = teamKey(team)
                return (
                  <div key={key} className={css.archivedWrap} data-historic>
                    <span className={css.archiveLabel}>{t('panel.archived')}</span>
                    <TeamPanel
                      team={team}
                      collapsed={collapsedKeys.has(key)}
                      onToggleCollapsed={() => { toggleTeam(key) }}
                      t={t}
                    />
                  </div>
                )
              })}
            </>
          )}
      </div>
    </aside>
  )
}
