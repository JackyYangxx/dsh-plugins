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

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { ClientContext, ObservableSnapshot, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import {
  getActivityMonitorTargetsSnapshot,
  getActivitySnapshotsSnapshot,
  startActivityPolling,
  subscribeActivityMonitorTargets,
  subscribeActivitySnapshots,
  type ActivityTask,
  type ActivityTeam,
} from './activity-monitor.ts'
import {
  buildActionMessage,
  type CaptainAction,
  type ReassignActionOptions,
} from './action-messages.ts'
import { injectCaptainActionMessage } from './action-injector.ts'
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
  /** Client root context; drives captain action-message injection (M2-B). */
  readonly ctx: ClientContext
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

/** How long the injection-failure notice stays visible. */
const INJECT_FAILURE_MS = 2600

export function ActivityPanel({ sessionsList, t, ctx }: ActivityPanelProps): ReactNode {
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

  // User-closed gate: once the user manually collapses the panel (X or a
  // second Escape) it stays closed until activity appears again (0 -> >0
  // transition) or the current session changes. lastHadActivityRef also
  // implements the settle window: activity that already exists at first paint
  // (restored sessions) does not auto-open the panel; only newly appearing
  // activity does.
  const userClosedRef = useRef(false)
  const lastHadActivityRef = useRef(visibleCount > 0)
  const currentRef = useRef(current)

  // Auto-expand once activity appears; fold back after the grace period once
  // every team of the current session has ended. open stays in the deps so
  // the autoclose timer can react to a manual close, but setOpen(true) is
  // gated: it never fires while the user has closed the panel (C1).
  useEffect(() => {
    const hadActivity = visibleCount > 0
    if (hadActivity) {
      // 0 -> >0 transition: fresh activity resets the user gate AND is the
      // only case that auto-opens (settle window: activity already present
      // at first paint only shows the reopen badge, never pops the panel).
      const wasInactive = !lastHadActivityRef.current
      if (wasInactive) {
        userClosedRef.current = false
      }
      lastHadActivityRef.current = true
      if (wasInactive && !userClosedRef.current) {
        setOpen(true)
      }
      return
    }
    lastHadActivityRef.current = false
    userClosedRef.current = false
    if (!open) return
    const timer = setTimeout(() => {
      setOpen(false)
      setCollapsedKeys(new Set())
    }, AUTOCLOSE_GRACE_MS)
    return () => { clearTimeout(timer) }
  }, [visibleCount, open])

  // Session navigation: leaving the current session collapses the panel
  // immediately (no 2s empty-state linger) and resets the open gates so the
  // next session's activity is treated as fresh (I1).
  useLayoutEffect(() => {
    if (currentRef.current === current) return
    currentRef.current = current
    userClosedRef.current = false
    lastHadActivityRef.current = false
    setOpen(false)
    setCollapsedKeys(new Set())
  }, [current])

  const toggleTeam = useCallback((key: string): void => {
    setCollapsedKeys((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const closePanel = useCallback((): void => {
    userClosedRef.current = true
    setOpen(false)
    setCollapsedKeys(new Set())
  }, [])

  const reopenPanel = useCallback((): void => {
    userClosedRef.current = false
    setOpen(true)
  }, [])

  // Captain action injection (M2-B): buttons are shown only for the current
  // session's own captain teams; clicking one builds the directive and sends
  // it into the captain session as an ordinary queued user message. A failed
  // injection surfaces a transient notice; the button's optimistic "sent"
  // state is reverted by the handler's false outcome.
  const [injectFailedKey, setInjectFailedKey] = useState<string | null>(null)
  useEffect(() => {
    if (injectFailedKey === null) return
    const timer = setTimeout(() => { setInjectFailedKey(null) }, INJECT_FAILURE_MS)
    return () => { clearTimeout(timer) }
  }, [injectFailedKey])

  const handleTeamAction = useCallback((
    action: CaptainAction,
    task: ActivityTask,
    team: ActivityTeam,
    options?: ReassignActionOptions,
  ): Promise<boolean> => {
    const message = buildActionMessage(action, task.id, team.name, options)
    const outcome = injectCaptainActionMessage(ctx, team.captainSessionId, message)
    void outcome.then((ok) => {
      if (!ok) setInjectFailedKey(`${action}:${task.id}`)
    })
    return outcome
  }, [ctx])

  // Keyboard collapse: Escape folds every expanded team; when all teams are
  // already folded a second Escape closes the panel entirely.
  const visibleKeys = useMemo(
    () => new Set([...visibleTeams, ...visibleArchived].map(teamKey)),
    [visibleTeams, visibleArchived],
  )
  const allCollapsed = visibleKeys.size > 0
    && [...visibleKeys].every((key) => collapsedKeys.has(key))
  // Escape handling is registered once per open with stable refs so the 1Hz
  // snapshot refresh never re-registers the listener; Escape also
  // preventDefaults so it does not fight the host shell (M4).
  const allCollapsedRef = useRef(allCollapsed)
  const visibleKeysRef = useRef(visibleKeys)
  const closePanelRef = useRef(closePanel)
  allCollapsedRef.current = allCollapsed
  visibleKeysRef.current = visibleKeys
  closePanelRef.current = closePanel
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      const isTypingTarget = target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (isTypingTarget) return
      event.preventDefault()
      if (allCollapsedRef.current) {
        closePanelRef.current()
        return
      }
      setCollapsedKeys(visibleKeysRef.current)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [open])

  if (!open) {
    // Collapsed: show a small reopen badge while this session still has
    // activity, so the panel is never unreachable after a manual close (I2).
    if (visibleCount === 0) return null
    return (
      <button
        type="button"
        className={css.panelBadge}
        onClick={reopenPanel}
        aria-label={t('panel.reopenAria', { count: visibleCount })}
        title={t('panel.reopenAria', { count: visibleCount })}
        data-lbx-agent-team-badge
      >
        {visibleCount}
      </button>
    )
  }

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
              {[
                ...visibleTeams.map((team) => ({ team, archived: false })),
                ...visibleArchived.map((team) => ({ team, archived: true })),
              ].map(({ team, archived }) => {
                const key = teamKey(team)
                const isCaptain = !archived && team.captainSessionId === current
                const panel = (
                  <TeamPanel
                    team={team}
                    collapsed={collapsedKeys.has(key)}
                    onToggleCollapsed={() => { toggleTeam(key) }}
                    t={t}
                    isCaptain={isCaptain}
                    reassignTargets={isCaptain
                      ? team.members.filter((member) => member.status !== 'removed').map((member) => member.name)
                      : undefined}
                    onAction={isCaptain
                      ? (action, task, options) => handleTeamAction(action, task, team, options)
                      : undefined}
                  />
                )
                if (!archived) {
                  return <Fragment key={key}>{panel}</Fragment>
                }
                return (
                  <div key={key} className={css.archivedWrap} data-historic>
                    <span className={css.archiveLabel}>{t('panel.archived')}</span>
                    {panel}
                  </div>
                )
              })}
            </>
          )}
      </div>
      {injectFailedKey !== null && (
        <p className={css.injectNotice} data-lbx-agent-team-inject-failed>{t('action.injectFailed')}</p>
      )}
    </aside>
  )
}
