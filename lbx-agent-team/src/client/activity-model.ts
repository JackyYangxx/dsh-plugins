export type StageLabel = 'pending' | 'working' | 'review' | 'approved' | 'committed' | 'tested' | 'done' | 'failed' | 'cancelled'

export function taskStages(status: string): StageLabel {
  switch (status) {
    case 'pending': return 'pending'
    case 'claimed': case 'in_progress': case 'changes_requested': return 'working'
    case 'in_review': return 'review'
    case 'approved': return 'approved'
    case 'committed': return 'committed'
    case 'tested': return 'tested'
    case 'complete': return 'done'
    case 'failed': return 'failed'
    case 'cancelled': return 'cancelled'
    default: return 'pending'
  }
}

export interface PanelSummary { total: number; done: number; inReview: number; inProgress: number; failed: number }

export function panelSummary(state: { tasks: Array<{ status: string }> }): PanelSummary {
  const s: PanelSummary = { total: state.tasks.length, done: 0, inReview: 0, inProgress: 0, failed: 0 }
  for (const t of state.tasks) {
    const stage = taskStages(t.status)
    if (stage === 'done') s.done += 1
    else if (stage === 'review') s.inReview += 1
    else if (stage === 'working') s.inProgress += 1
    else if (stage === 'failed') s.failed += 1
  }
  return s
}
