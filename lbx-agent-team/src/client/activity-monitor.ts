/**
 * Shared, demand-driven state for the LbxAgentTeam browser monitor.
 *
 * One polling loop per current session drives `/plugins/lbx-agent-team/state`
 * (no-store) and publishes live + archived team snapshots to the activity
 * panel and conversation cards. A failed or malformed tick is dropped — the
 * last successful snapshot stays visible while the host restarts or the
 * network blips, and the next scheduled tick retries. Disposing the returned
 * controller (panel unmount / session no longer current) stops the timer and
 * aborts the in-flight request.
 */

/** One member row of a host snapshot. */
export interface ActivityMember {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly status: 'pending' | 'idle' | 'working' | 'removed'
  readonly activity: 'working' | 'idle' | 'unknown'
}

/** One task row of a host snapshot. */
export interface ActivityTask {
  readonly id: string
  readonly subject: string
  readonly status:
    | 'pending' | 'claimed' | 'in_progress' | 'in_review'
    | 'approved' | 'committed' | 'tested' | 'complete'
    | 'changes_requested' | 'failed' | 'cancelled'
  readonly assignee: string
  readonly dependencies: readonly string[]
}

/** One issue row of a host snapshot. */
export interface ActivityIssue {
  readonly id: string
  readonly title: string
  readonly severity: 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW'
  readonly status: 'open' | 'resolved'
}

/** One team snapshot (mirrors the host TeamActivitySnapshot). */
export interface ActivityTeam {
  readonly workspace: string
  readonly teamId: string
  readonly name: string
  readonly description?: string
  readonly captainSessionId: string
  readonly status: 'active' | 'archived'
  readonly createdAt: number
  readonly members: readonly ActivityMember[]
  readonly tasks: readonly ActivityTask[]
  readonly issues: readonly ActivityIssue[]
}

/** A successfully-created conversation card that currently needs updates. */
export interface ActivityMonitorTarget {
  readonly key: string
  readonly sessionId: string
  readonly teamId: string
}

/** Latest shared response data for both the floater and conversation cards. */
export interface ActivitySnapshots {
  readonly teams: readonly ActivityTeam[]
  readonly archivedTeams: readonly ActivityTeam[]
}

interface RegisteredTarget extends ActivityMonitorTarget {
  refs: number
  active: boolean
}

const targets = new Map<string, RegisteredTarget>()
const targetListeners = new Set<() => void>()
const snapshotListeners = new Set<() => void>()
let targetSnapshot: readonly ActivityMonitorTarget[] = []
let activitySnapshots: ActivitySnapshots = { teams: [], archivedTeams: [] }

function targetKey(sessionId: string, teamId: string): string {
  return `${sessionId}\u0000${teamId}`
}

function publishTargets(): void {
  targetSnapshot = [...targets.values()]
    .filter((target) => target.active)
    .map(({ key, sessionId, teamId }) => ({ key, sessionId, teamId }))
  for (const listener of targetListeners) listener()
}

/** Subscribe to the active monitor-target list (React external-store shape). */
export function subscribeActivityMonitorTargets(listener: () => void): () => void {
  targetListeners.add(listener)
  return () => { targetListeners.delete(listener) }
}

/** Read the stable active-target snapshot. */
export function getActivityMonitorTargetsSnapshot(): readonly ActivityMonitorTarget[] {
  return targetSnapshot
}

/**
 * Register one successful LbxAgentTeam card as a monitoring demand.
 *
 * The returned cleanup is reference-counted so multiple cards and React
 * StrictMode remounts cannot stop another card's monitor.
 */
export function monitorAgentTeam(sessionId: string, teamId: string): () => void {
  const owner = sessionId.trim()
  const id = teamId.trim()
  if (owner === '' || id === '') return () => {}
  const key = targetKey(owner, id)
  const existing = targets.get(key)
  if (existing === undefined) {
    targets.set(key, { key, sessionId: owner, teamId: id, refs: 1, active: true })
    publishTargets()
  } else {
    existing.refs += 1
    if (!existing.active) {
      existing.active = true
      publishTargets()
    }
  }
  let released = false
  return () => {
    if (released) return
    released = true
    const current = targets.get(key)
    if (current === undefined) return
    current.refs -= 1
    if (current.refs <= 0) {
      targets.delete(key)
      if (current.active) publishTargets()
    }
  }
}

/** Stop polling targets whose final archived snapshot has been captured. */
export function settleActivityMonitorTargets(keys: ReadonlySet<string>): void {
  let changed = false
  for (const key of keys) {
    const target = targets.get(key)
    if (target?.active !== true) continue
    target.active = false
    changed = true
  }
  if (changed) publishTargets()
}

/** Subscribe to the shared live/archive snapshot. */
export function subscribeActivitySnapshots(listener: () => void): () => void {
  snapshotListeners.add(listener)
  return () => { snapshotListeners.delete(listener) }
}

/** Read the stable shared live/archive snapshot. */
export function getActivitySnapshotsSnapshot(): ActivitySnapshots {
  return activitySnapshots
}

/** Publish one or both successful state-route responses. */
export function updateActivitySnapshots(update: Partial<ActivitySnapshots>): void {
  const next = {
    teams: update.teams ?? activitySnapshots.teams,
    archivedTeams: update.archivedTeams ?? activitySnapshots.archivedTeams,
  }
  if (next.teams === activitySnapshots.teams && next.archivedTeams === activitySnapshots.archivedTeams) return
  activitySnapshots = next
  for (const listener of snapshotListeners) listener()
}

/**
 * Shape-validate one state-route payload. Returns `null` when `teams` is not
 * an array so the poll controller can drop the malformed response instead of
 * overwriting the last successful snapshot.
 */
export function parseActivityState(body: unknown): readonly ActivityTeam[] | null {
  if (typeof body !== 'object' || body === null) return null
  const teams = (body as { teams?: unknown }).teams
  return Array.isArray(teams) ? (teams as readonly ActivityTeam[]) : null
}

/** Pure selection: which live team ids the discovery session captains. */
export function discoveryTeamKeys(
  liveTeams: readonly ActivityTeam[],
  discoverySessionId: string | undefined,
): ReadonlySet<string> {
  const sessionId = discoverySessionId?.trim() ?? ''
  if (sessionId === '') return new Set()
  return new Set(
    liveTeams
      .filter((team) => team.captainSessionId === sessionId)
      .map((team) => team.teamId),
  )
}

/** Pure selection: requested monitor targets absent from the live snapshot. */
export function missingMonitorTargets(
  monitorTargets: readonly ActivityMonitorTarget[],
  liveTeams: readonly ActivityTeam[],
): readonly ActivityMonitorTarget[] {
  return monitorTargets.filter((target) => !liveTeams.some((team) =>
    team.captainSessionId === target.sessionId && team.teamId === target.teamId,
  ))
}

/** Poll cadence for the live host snapshot route. */
export const ACTIVITY_POLL_MS = 1000
/**
 * Low-frequency probe cadence while a cardless discovery session still owns
 * no team. The probe keeps the panel able to pick up a team created later in
 * that session (e.g. a run_code-wrapped lbx_agent_team_create) without
 * turning every ordinary session into a one-second filesystem scan.
 */
export const ACTIVITY_PROBE_MS = 5000
/** Host route serving live and archived team snapshots. */
export const ACTIVITY_STATE_URL = '/plugins/lbx-agent-team/state'

interface ActivityFetchResponse {
  readonly ok: boolean
  json(): Promise<unknown>
}

/** Injectable browser primitives used by the poll controller and its tests. */
export interface ActivityPollingRuntime {
  /**
   * Current captain session to discover after a cold client/host restart.
   * This one-time scope restores teams whose older conversation log has no
   * LbxAgentTeam card capable of registering an explicit monitor target.
   */
  readonly discoverySessionId?: string
  readonly fetchState?: (
    url: string,
    init: { readonly cache: 'no-store'; readonly signal: AbortSignal },
  ) => Promise<ActivityFetchResponse>
  readonly schedule?: (callback: () => void, intervalMs: number) => unknown
  readonly cancel?: (timer: unknown) => void
  readonly publishSnapshots?: (update: Partial<ActivitySnapshots>) => void
  readonly settleTargets?: (keys: ReadonlySet<string>) => void
}

/** Handle returned by one current-session polling loop. */
export interface ActivityPollingController {
  /** The immediate first pass, exposed so offline verification can await it. */
  readonly firstTick: Promise<void>
  /** Idempotently stop the timer and abort the current request. */
  stop(): void
}

/**
 * Start the single polling loop for the current session's requested targets.
 *
 * With neither targets nor a discovery session this is deliberately inert.
 * Explicit card targets poll at the live cadence from the start. A discovery
 * session performs an immediate live+archive restore pass, then — while it
 * still owns no team — probes on a low-frequency cadence, so a team created
 * later in that session (e.g. a run_code-wrapped lbx_agent_team_create) is
 * discovered without a manual reload, without turning every ordinary session
 * into a one-second filesystem scan. The moment a team for the discovery
 * session appears, the controller upgrades to the live one-second cadence for
 * the rest of its lifetime. The caller — the session view, which stops the
 * controller when the session is no longer current — bounds the lifetime, and
 * archive state is refreshed when a target or a previously discovered live
 * team disappears.
 */
export function startActivityPolling(
  monitorTargets: readonly ActivityMonitorTarget[],
  runtime: ActivityPollingRuntime = {},
): ActivityPollingController {
  const discoverySessionId = runtime.discoverySessionId?.trim()
  if (monitorTargets.length === 0 && (discoverySessionId === undefined || discoverySessionId === '')) {
    return { firstTick: Promise.resolve(), stop: () => {} }
  }
  const fetchState = runtime.fetchState ?? ((url, init) => fetch(url, init))
  const schedule = runtime.schedule ?? ((callback, intervalMs) => setInterval(callback, intervalMs))
  const cancel = runtime.cancel ?? ((timer) => { clearInterval(timer as ReturnType<typeof setInterval>) })
  const publishSnapshots = runtime.publishSnapshots ?? updateActivitySnapshots
  const settleTargets = runtime.settleTargets ?? settleActivityMonitorTargets
  let cancelled = false
  let inFlight = false
  // Explicit card targets are demanded work: start at the live cadence. A
  // discovery session starts probing low-frequency and upgrades on detection.
  let hot = monitorTargets.length > 0
  let discoveryComplete = false
  let discoveredLiveKeys: ReadonlySet<string> = new Set()
  let controller: AbortController | undefined
  let timer: unknown
  const intervalMs = (): number => (hot ? ACTIVITY_POLL_MS : ACTIVITY_PROBE_MS)
  const reschedule = (): void => {
    cancel(timer)
    timer = schedule(() => { void tick() }, intervalMs())
  }
  const tick = async (): Promise<void> => {
    if (inFlight || cancelled) return
    inFlight = true
    controller = new AbortController()
    try {
      const liveResponse = await fetchState(ACTIVITY_STATE_URL, {
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!liveResponse.ok) return
      const liveTeams = parseActivityState(await liveResponse.json())
      if (cancelled || liveTeams === null) return
      publishSnapshots({ teams: liveTeams })
      const previousDiscoveredKeys = discoveredLiveKeys
      discoveredLiveKeys = discoveryTeamKeys(liveTeams, discoverySessionId)
      // A discovery session found its first team: upgrade from the low-frequency
      // probe to the live cadence for the rest of the controller lifetime.
      if (!hot && discoveredLiveKeys.size > 0) {
        hot = true
        reschedule()
      }
      const discoveredTeamArchived = [...previousDiscoveredKeys]
        .some((teamId) => !discoveredLiveKeys.has(teamId))
      const missing = missingMonitorTargets(monitorTargets, liveTeams)
      const needsDiscoveryArchive = discoverySessionId !== undefined
        && discoverySessionId !== ''
        && !discoveryComplete
      if (missing.length === 0 && !needsDiscoveryArchive && !discoveredTeamArchived) return

      // Archives are immutable per team generation. A successful fallback
      // retires every missing explicit target, including legacy cards whose
      // host archive no longer exists; a discovery session that already
      // upgraded keeps polling, and a still-probing one keeps probing, so a
      // team created later in the same session stays discoverable.
      const archivedResponse = await fetchState(`${ACTIVITY_STATE_URL}?archived=1`, {
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!archivedResponse.ok) return
      const archivedTeams = parseActivityState(await archivedResponse.json())
      if (cancelled || archivedTeams === null) return
      publishSnapshots({ archivedTeams })
      discoveryComplete = true
      settleTargets(new Set(missing.map((target) => target.key)))
    } catch (error: unknown) {
      if ((error as { name?: unknown })?.name === 'AbortError') return
      // Host restarting; keep the last snapshot and retry on the next tick.
    } finally {
      inFlight = false
    }
  }
  const firstTick = tick()
  if (timer === undefined) timer = schedule(() => { void tick() }, intervalMs())
  return {
    firstTick,
    stop: () => {
      if (cancelled) return
      cancelled = true
      controller?.abort()
      cancel(timer)
    },
  }
}
