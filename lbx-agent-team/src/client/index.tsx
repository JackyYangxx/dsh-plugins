/**
 * Browser client entry for lbx-agent-team (Task 18).
 *
 * Wires the activity panel into the shell's additive `shell.overlay` list
 * slot, following the dsh-agent-teams reference: `ctx.slots.inject` waits
 * for the ui-layout declaration, then `ctx.slots.register` contributes the
 * panel as one additive entry (a fresh id, never replacing shipped entries).
 * The panel polls the host `/plugins/lbx-agent-team/state` route through the
 * shared activity-monitor and buckets teams per current session.
 *
 * Every registration is fiber-scoped and dies with the client fiber:
 * `ctx.effect` owns the locale dictionaries, `ctx.slots.inject` owns the
 * slot contribution (its disposer is collected on fiber unload), and the
 * panel's own polling controller stops when the panel unmounts.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only imports: pulling the browser locale service (ctx.locale) and the
// ui-layout slot declarations into the program. Value imports would trip the
// tsdown client purity gate; type-only imports are erased from the bundle.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { ActivityPanel } from './ActivityPanel.tsx'
import {
  en, LBX_AGENT_TEAM_LOCALE_NAMESPACE, zh, type LbxAgentTeamLocaleKey,
} from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** LBX agent-team activity panel copy. */
    lbxAgentTeam: LbxAgentTeamLocaleKey
  }
}

/** Required services: slot registration, current-session tracking, locale. */
export const inject = ['slots', 'sessions', 'locale']

/** Register the activity monitor in the shell's additive overlay. */
export function apply(ctx: ClientContext): void {
  ctx.effect(
    () => ctx.locale.register(LBX_AGENT_TEAM_LOCALE_NAMESPACE, { zh, en }),
    'lbx-agent-team: dictionaries',
  )
  const Panel = ({ t }: PropsLocale<'lbxAgentTeam'>) => (
    <ActivityPanel sessionsList={ctx.sessions.list} t={t} />
  )
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'lbx-agent-team-activity',
    order: 80,
    label: 'LBX Agent Team activity',
    locale: LBX_AGENT_TEAM_LOCALE_NAMESPACE,
  }, Panel))
}
