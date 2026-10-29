import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildWebPayload,
  createWebChannel,
  deliverNotification,
  normalizeConfig,
  planNotificationDelivery,
} from '../index.js'
import { fakeChannel, routedChannel, ssePayloads } from './helpers.mjs'

/* ------------------------------------------------------------------ */
/* Delivery routing                                                    */
/* ------------------------------------------------------------------ */

test('planNotificationDelivery implements the focus/conversation matrix', () => {
  const config = normalizeConfig()
  const page = (overrides = {}) => ({
    id: 'page',
    permission: 'granted',
    focused: false,
    activeSessionId: null,
    seenAt: 1,
    ...overrides,
  })

  // Focused and reading the very conversation that finished → stay quiet.
  assert.deepEqual(planNotificationDelivery([page({ focused: true, activeSessionId: 's1' })], 's1', config), {
    mode: 'suppressed',
    recipients: [],
    reason: 'the conversation is open and focused in the app',
  })

  // Focused elsewhere → in-app toast, even without OS notification permission.
  assert.deepEqual(
    planNotificationDelivery([page({ id: 'a', focused: true, activeSessionId: 's2', permission: 'default' })], 's1', config),
    { mode: 'in-app', recipients: ['a'] },
  )
  assert.deepEqual(planNotificationDelivery([page({ id: 'a', focused: true, activeSessionId: null })], undefined, config), {
    mode: 'in-app',
    recipients: ['a'],
  })

  // Unfocused (even with the same conversation still retained) → system notification.
  assert.deepEqual(planNotificationDelivery([page({ id: 'a', activeSessionId: 's1' })], 's1', config), {
    mode: 'system',
    recipients: ['a'],
  })

  // Several background pages: only the most recently active one raises a banner.
  assert.deepEqual(
    planNotificationDelivery(
      [page({ id: 'old', seenAt: 10 }), page({ id: 'new', seenAt: 20 })],
      undefined,
      config,
    ),
    { mode: 'system', recipients: ['new'] },
  )

  // No usable page → unavailable; there is no second delivery channel.
  const unavailable = {
    mode: 'unavailable',
    recipients: [],
    reason: 'no connected Web GUI page can show this notification',
  }
  assert.deepEqual(planNotificationDelivery([page({ permission: 'denied' })], undefined, config), unavailable)
  assert.deepEqual(planNotificationDelivery([], undefined, config), unavailable)

  // Opt-outs: suppression off → in-app; in-app off → OS banner.
  assert.deepEqual(
    planNotificationDelivery([page({ id: 'a', focused: true, activeSessionId: 's1' })], 's1', normalizeConfig({ suppressActiveSession: false })),
    { mode: 'in-app', recipients: ['a'] },
  )
  assert.deepEqual(
    planNotificationDelivery([page({ id: 'a', focused: true, activeSessionId: 's2' })], 's1', normalizeConfig({ inAppNotifications: false })),
    { mode: 'system', recipients: ['a'] },
  )
})

test('buildWebPayload carries the delivery channel, action labels, dismissal, and hold time', () => {
  const system = buildWebPayload({ kind: 'turn-end', title: 'T', body: 'B' }, { sessionId: 's1', actionLabel: 'Open' })
  assert.equal(system.channel, 'system')
  assert.equal(system.actionLabel, 'Open')
  assert.equal('holdMs' in system, false)
  assert.equal(system.sessionId, 's1')
  // The dismissal mode travels on system frames too: a stale Host view can be
  // converted into an in-app toast at display time.
  assert.equal(system.dismiss, 'auto')
  assert.equal(system.dismissLabel, '')

  const inApp = buildWebPayload(
    { kind: 'turn-end', title: 'T', body: 'B' },
    { channel: 'in-app', actionLabel: '查看', dismissLabel: '关闭', holdMs: 6000 },
  )
  assert.equal(inApp.channel, 'in-app')
  assert.equal(inApp.actionLabel, '查看')
  assert.equal(inApp.dismiss, 'auto')
  assert.equal(inApp.dismissLabel, '关闭')
  assert.equal(inApp.holdMs, 6000)
  assert.equal(inApp.title, 'T')
  assert.equal(inApp.body, 'B')
  assert.equal(typeof inApp.id, 'string')

  const manual = buildWebPayload(
    { kind: 'turn-end', title: 'T', body: 'B' },
    { channel: 'in-app', dismiss: 'manual', dismissLabel: '关闭', holdMs: 5000 },
  )
  assert.equal(manual.dismiss, 'manual')
  assert.equal(manual.holdMs, 5000)
})

test('deliverNotification routes to suppression, in-app, and system notifications', async () => {
  const config = normalizeConfig()

  // 1. Focused on the same conversation → nothing is delivered at all.
  {
    const { channel, responses } = routedChannel([{ clientId: 'page-a', permission: 'granted', focused: true, activeSessionId: 's1' }])
    const outcome = await deliverNotification(
      { kind: 'turn-end', title: 'T', body: 'B' },
      { config, channel, sessionId: 's1', actionLabel: '查看' },
    )
    assert.equal(outcome.delivered, false)
    assert.equal(outcome.backend, 'suppressed')
    assert.equal(ssePayloads(responses[0]).length, 0)
  }

  // 2. Focused on another conversation → in-app frame to that page only.
  {
    const { channel, responses } = routedChannel([{ clientId: 'page-a', permission: 'default', focused: true, activeSessionId: 's2' }])
    const outcome = await deliverNotification(
      { kind: 'turn-end', title: 'T', body: 'B' },
      { config, channel, sessionId: 's1', actionLabel: '查看' },
    )
    assert.deepEqual(outcome, { delivered: true, backend: 'in-app' })
    const payloads = ssePayloads(responses[0])
    assert.equal(payloads.length, 1)
    assert.equal(payloads[0].channel, 'in-app')
    assert.equal(payloads[0].title, 'T')
    assert.equal(payloads[0].body, 'B')
    assert.equal(payloads[0].sessionId, 's1')
    assert.equal(payloads[0].actionLabel, '查看')
    assert.equal(payloads[0].dismiss, 'auto')
    assert.equal(payloads[0].holdMs, config.inAppHoldMs)
  }

  // 2b. Manual dismissal is a config decision the page receives in the frame.
  {
    const { channel, responses } = routedChannel([{ clientId: 'page-a', permission: 'default', focused: true, activeSessionId: 's2' }])
    const manualConfig = normalizeConfig({ inAppToastDismiss: 'manual', inAppHoldMs: 8000 })
    const outcome = await deliverNotification(
      { kind: 'turn-end', title: 'T', body: 'B' },
      { config: manualConfig, channel, sessionId: 's1', actionLabel: '查看', dismissLabel: '关闭' },
    )
    assert.deepEqual(outcome, { delivered: true, backend: 'in-app' })
    const payload = ssePayloads(responses[0])[0]
    assert.equal(payload.dismiss, 'manual')
    assert.equal(payload.dismissLabel, '关闭')
    assert.equal(payload.holdMs, 8000)
  }

  // 3. Unfocused (even with the conversation retained) → one system notification.
  {
    const { channel, responses } = routedChannel([
      { clientId: 'page-old', permission: 'granted', focused: false, activeSessionId: 's1', seenAt: 10 },
      { clientId: 'page-new', permission: 'granted', focused: false, seenAt: 20 },
    ])
    const outcome = await deliverNotification(
      { kind: 'turn-end', title: 'T', body: 'B' },
      { config, channel, sessionId: 's1' },
    )
    assert.deepEqual(outcome, { delivered: true, backend: 'web' })
    assert.equal(ssePayloads(responses[0]).length, 0)
    const payloads = ssePayloads(responses[1])
    assert.equal(payloads.length, 1)
    assert.equal(payloads[0].channel, 'system')
  }

  // 4. No page connected → honest failure; there is no second channel.
  {
    const outcome = await deliverNotification(
      { title: 'T', body: 'B' },
      { config, channel: createWebChannel() },
    )
    assert.equal(outcome.delivered, false)
    assert.equal(outcome.backend, 'web')
    assert.match(outcome.reason, /no connected Web GUI page/)
  }

  // 5. Web notifications disabled → no delivery channel at all.
  {
    const outcome = await deliverNotification(
      { title: 'T', body: 'B' },
      { config: normalizeConfig({ webNotifications: false }), channel: createWebChannel() },
    )
    assert.equal(outcome.delivered, false)
    assert.equal(outcome.backend, 'web')
    assert.match(outcome.reason, /web notifications are disabled/)
  }

  // 6. Missing channel object → same honest failure.
  {
    const outcome = await deliverNotification({ title: 'T', body: 'B' }, { config })
    assert.equal(outcome.delivered, false)
    assert.match(outcome.reason, /no connected Web GUI page/)
  }

  // 7. A channel that accepts the payload reports the routed backend; one that
  //    cannot deliver reports the failure.
  {
    const webChannel = fakeChannel(1)
    const outcome = await deliverNotification(
      { kind: 'turn-end', title: 'T', body: 'B' },
      { config, channel: webChannel, sessionId: 's1' },
    )
    assert.deepEqual(outcome, { delivered: true, backend: 'web' })
    assert.equal(webChannel.payloads[0].channel, 'system')

    const deadChannel = fakeChannel(0)
    const failed = await deliverNotification({ title: 'T', body: 'B' }, { config, channel: deadChannel })
    assert.equal(failed.delivered, false)
    assert.match(failed.reason, /could not receive/)
  }

  // 8. Quiet hours, disabled, and empty bodies are gated before routing.
  {
    const quiet = await deliverNotification(
      { body: 'B' },
      { config: normalizeConfig({ quietHours: '22:00-08:00' }), channel: createWebChannel(), now: new Date(2026, 0, 1, 23, 0) },
    )
    assert.equal(quiet.backend, 'quiet-hours')
    const forced = await deliverNotification(
      { body: 'B' },
      {
        config: normalizeConfig({ quietHours: '22:00-08:00' }),
        channel: createWebChannel(),
        now: new Date(2026, 0, 1, 23, 0),
        force: true,
      },
    )
    assert.equal(forced.backend, 'web')
    assert.match(forced.reason, /no connected Web GUI page/)
    const disabled = await deliverNotification({ body: 'B' }, { config: normalizeConfig({ enabled: false }) })
    assert.equal(disabled.backend, 'disabled')
    const empty = await deliverNotification({ body: '   ' }, { config, channel: createWebChannel() })
    assert.equal(empty.delivered, false)
    assert.match(empty.reason, /empty/)
  }
})
