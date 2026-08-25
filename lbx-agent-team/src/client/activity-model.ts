/**
 * Pure client projections over the host pipeline task state.
 * No DOM access — safe to run under plain node.
 */

/** Display stage for a task in the activity panel. */
export type StageLabel = 'pending' | 'working' | 'review' | 'approved' | 'committed' | 'tested' | 'done' | 'failed' | 'cancelled'

/**
 * Every task status the host pipeline can currently emit. Keeping this union
 * and the STAGE_OF map in lockstep means adding a host status fails the client
 * build (strict + noUncheckedIndexedAccess) until a stage is chosen here.
 */
export type TaskStatusLiteral =
  | 'pending' | 'claimed' | 'in_progress' | 'in_review' | 'approved'
  | 'committed' | 'tested' | 'complete' | 'changes_requested' | 'failed' | 'cancelled'

/** Exhaustive status → stage map; a missing key is a compile error. */
const STAGE_OF: Record<TaskStatusLiteral, StageLabel> = {
  pending: 'pending',
  claimed: 'working',
  in_progress: 'working',
  in_review: 'review',
  approved: 'approved',
  committed: 'committed',
  tested: 'tested',
  complete: 'done',
  changes_requested: 'working',
  failed: 'failed',
  cancelled: 'cancelled',
}

/**
 * Maps a pipeline status to its display stage (the singular stage a task
 * currently occupies). Unknown statuses — host states added after this client
 * shipped — fall back to 'pending': their tasks temporarily land in the
 * waiting bucket until the map above is extended.
 */
export function taskStages(status: string): StageLabel {
  return STAGE_OF[status as TaskStatusLiteral] ?? 'pending'
}

/**
 * Bucketed counts projected from a task list.
 * Invariant: total === done + inReview + inProgress + failed + waiting + other
 * — BUCKET_OF is exhaustive over StageLabel, so every task lands in exactly
 * one bucket.
 */
export interface PanelSummary {
  total: number
  done: number
  inReview: number
  inProgress: number
  failed: number
  /** waiting — 'pending' stage: unclaimed / not yet started. */
  waiting: number
  /** other — approved + committed + tested + cancelled (transient/inactive). */
  other: number
}

/** Stage → summary bucket. claimed maps to 'working' (a claimed task is being
 *  handled), so only 'pending' lands in waiting. */
const BUCKET_OF: Record<StageLabel, Exclude<keyof PanelSummary, 'total'>> = {
  pending: 'waiting',
  working: 'inProgress',
  review: 'inReview',
  approved: 'other',
  committed: 'other',
  tested: 'other',
  done: 'done',
  failed: 'failed',
  cancelled: 'other',
}

export function panelSummary(state: { tasks: Array<{ status: string }> }): PanelSummary {
  const s: PanelSummary = { total: state.tasks.length, done: 0, inReview: 0, inProgress: 0, failed: 0, waiting: 0, other: 0 }
  for (const t of state.tasks) {
    s[BUCKET_OF[taskStages(t.status)]] += 1
  }
  return s
}