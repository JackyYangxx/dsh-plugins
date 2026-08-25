/**
 * Captain action directive injection (M2-B).
 *
 * The official browser path for sending a user prompt into a session is the
 * conversation service (`ctx.conversation.send`, dsh-client-ui-conversation),
 * but it is SCOPE-ADDRESSED: it reads the session tag off the calling
 * context and fails loud on root contexts. The runtime documents the exact
 * resolution — `ctx.sessions.scope(id).conversation` (see the
 * ConversationController.scopeId error text) — so this module mints the
 * agent scope for the captain session id, then sends the directive as an
 * ordinary queued user prompt: the same path a composer Enter takes. The
 * message therefore arrives as a genuine `source.kind === 'user'` message,
 * visible in the chat and scanned by the /lbx-agent-team gesture boundary
 * (which ignores it, since the directive is not a slash line).
 *
 * When the conversation service is absent (a minimal composition without the
 * ui-conversation plugin), the fallback is the session face's own `prompt`
 * verb with the same queued delivery mode.
 *
 * Pure side-effect module: takes the client context and returns a boolean
 * outcome, so it is unit-testable with a stub ctx.
 *
 * IMPORTANT: a true outcome confirms only that the host ACCEPTED the prompt.
 * It is not an execution confirmation — the panel has no feedback loop into
 * the captain's tool calls; the next activity poll reflects the resulting
 * task state.
 */

import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-session'

/**
 * Inject one directive into the captain session as a queued user prompt.
 * @param ctx - the client root context (sessions + conversation services).
 * @param sessionId - the captain session id (agent/session share one id axis).
 * @param message - the directive text to send verbatim.
 * @returns true when the prompt was accepted by the host, false when the
 * session scope is unavailable or the send fails (caller surfaces feedback).
 */
export async function injectCaptainActionMessage(
  ctx: ClientContext,
  sessionId: string,
  message: string,
): Promise<boolean> {
  // captainSessionId from the host snapshot is on the same id axis as the
  // dsh-session SessionId brand, so the cast is safe (same string space).
  const actx = ctx.sessions.scope(sessionId as SessionId)
  if (actx === undefined) return false

  // Primary path: the scope-addressed conversation service — the composer
  // send path, queue delivery.
  const conversation = actx.conversation
  if (conversation !== undefined) {
    try {
      await conversation.send(message)
      return true
    } catch (error) {
      console.warn('[lbx-agent-team] action directive send failed:', error)
      return false
    }
  }

  // Fallback: direct session prompt (same queued user-message delivery).
  const session = ctx.sessions.sessionOf(actx)
  if (session === undefined) return false
  try {
    const result = await session.prompt([{ type: 'text', text: message }], 'queue')
    return result.ok === true
  } catch (error) {
    console.warn('[lbx-agent-team] action directive prompt failed:', error)
    return false
  }
}
