import { test } from 'node:test'
import assert from 'node:assert/strict'
import { injectCaptainActionMessage } from '../lib/client/action-injector.js'

/**
 * Minimal client-context stub: the injector only touches ctx.sessions.scope
 * (+ sessionOf as the fallback path) and the scoped conversation service.
 */

const MESSAGE = '[lbx-agent-team action: cancel] Captain, cancel task t3.'
const SESSION_ID = 'session-captain'

function scopeCtx({ actx }) {
  return {
    sessions: {
      scope() { return actx },
      sessionOf() { return actx?.sessionFace },
    },
  }
}

test('injects through the scope-addressed conversation service', async () => {
  const sent = []
  const actx = {
    conversation: { async send(text) { sent.push(text) } },
    sessionFace: undefined,
  }
  const ok = await injectCaptainActionMessage(scopeCtx({ actx }), SESSION_ID, MESSAGE)
  assert.equal(ok, true)
  assert.deepEqual(sent, [MESSAGE])
})

test('falls back to the session prompt when the conversation service is absent', async () => {
  const calls = []
  const actx = {
    conversation: undefined,
    sessionFace: {
      async prompt(content, mode) {
        calls.push({ content, mode })
        return { ok: true }
      },
    },
  }
  const ok = await injectCaptainActionMessage(scopeCtx({ actx }), SESSION_ID, MESSAGE)
  assert.equal(ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].mode, 'queue')
  assert.deepEqual(calls[0].content, [{ type: 'text', text: MESSAGE }])
})

test('returns false when no session scope resolves', async () => {
  let scoped = 0
  const ctx = {
    sessions: {
      scope() { scoped += 1; return undefined },
      sessionOf() { return undefined },
    },
  }
  const ok = await injectCaptainActionMessage(ctx, SESSION_ID, MESSAGE)
  assert.equal(ok, false)
  assert.equal(scoped, 1)
})

test('returns false when the conversation send rejects', async () => {
  const actx = {
    conversation: { async send() { throw new Error('transport down') } },
    sessionFace: undefined,
  }
  const ok = await injectCaptainActionMessage(scopeCtx({ actx }), SESSION_ID, MESSAGE)
  assert.equal(ok, false)
})

test('returns false when the session prompt rejects', async () => {
  const actx = {
    conversation: undefined,
    sessionFace: { async prompt() { throw new Error('host gone') } },
  }
  const ok = await injectCaptainActionMessage(scopeCtx({ actx }), SESSION_ID, MESSAGE)
  assert.equal(ok, false)
})

test('returns false when the host rejects the prompt (ok: false)', async () => {
  const actx = {
    conversation: undefined,
    sessionFace: { async prompt() { return { ok: false } } },
  }
  const ok = await injectCaptainActionMessage(scopeCtx({ actx }), SESSION_ID, MESSAGE)
  assert.equal(ok, false)
})
