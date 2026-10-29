import test from 'node:test'
import assert from 'node:assert/strict'

import { NAV_ICON_ATTRIBUTE, installNotificationNavIcon } from '../src/client/nav-icon.js'

/* ------------------------------------------------------------------ */
/* Settings-nav bell                                                   */
/* ------------------------------------------------------------------ */

/** Minimal DOM: enough elements, attributes, and queries for the bell patch. */
function createDom() {
  const head = createElement('head')
  const body = createElement('body')
  const documentElement = createElement('html')
  const document = {
    body,
    head,
    documentElement,
    createElement(tagName) {
      return createElement(tagName)
    },
    getElementById(id) {
      return find(documentElement, (node) => node.attributes.id === id) ?? find(head, (node) => node.attributes.id === id) ?? null
    },
    querySelectorAll(selector) {
      const matches = []
      walk(documentElement, (node) => {
        if (nodeMatches(node, selector)) matches.push(node)
      })
      return matches
    },
  }
  documentElement.appendChild(head)
  documentElement.appendChild(body)
  return document
}

function createElement(tagName) {
  const node = {
    tagName: String(tagName).toUpperCase(),
    childNodes: [],
    parentNode: null,
    attributes: {},
    ownText: '',
  }
  Object.defineProperty(node, 'textContent', {
    get() {
      if (node.childNodes.length === 0) return node.ownText
      return node.childNodes.map((child) => child.textContent).join('')
    },
    set(value) {
      node.ownText = String(value)
      node.childNodes.length = 0
    },
  })
  node.appendChild = (child) => {
    child.parentNode = node
    node.childNodes.push(child)
    return child
  }
  node.removeChild = (child) => {
    const index = node.childNodes.indexOf(child)
    if (index >= 0) node.childNodes.splice(index, 1)
    child.parentNode = null
    return child
  }
  // Mirrors the DOM's reflected `id` property, which installNotificationNavIcon
  // uses for its stylesheet tag.
  Object.defineProperty(node, 'id', {
    get() {
      return node.attributes.id ?? ''
    },
    set(value) {
      node.attributes.id = String(value)
    },
  })
  node.setAttribute = (name, value) => {
    node.attributes[name] = String(value)
  }
  node.getAttribute = (name) => (Object.prototype.hasOwnProperty.call(node.attributes, name) ? node.attributes[name] : null)
  node.hasAttribute = (name) => Object.prototype.hasOwnProperty.call(node.attributes, name)
  node.removeAttribute = (name) => {
    delete node.attributes[name]
  }
  return node
}

function walk(node, visit) {
  visit(node)
  for (const child of node.childNodes) walk(child, visit)
}

function find(node, predicate) {
  let found = null
  walk(node, (candidate) => {
    if (found === null && predicate(candidate)) found = candidate
  })
  return found
}

function ancestry(node) {
  const chain = []
  for (let current = node; current; current = current.parentNode) chain.push(current)
  return chain
}

function nodeMatches(node, selector) {
  if (selector === '[role="dialog"] nav button') {
    if (node.tagName !== 'BUTTON') return false
    const chain = ancestry(node)
    return chain.some((item) => item.tagName === 'NAV') && chain.some((item) => item.attributes.role === 'dialog')
  }
  if (selector === `[${NAV_ICON_ATTRIBUTE}]`) return Object.prototype.hasOwnProperty.call(node.attributes, NAV_ICON_ATTRIBUTE)
  throw new Error(`unsupported test selector ${selector}`)
}

/** A settings dialog: nav rows whose text is the registered label. */
function mountDialog(document, labels) {
  const dialog = createElement('div')
  dialog.setAttribute('role', 'dialog')
  const nav = createElement('nav')
  const rows = labels.map((label) => {
    const button = createElement('button')
    const icon = createElement('svg')
    const text = createElement('span')
    text.textContent = label
    button.appendChild(icon)
    button.appendChild(text)
    nav.appendChild(button)
    return button
  })
  dialog.appendChild(nav)
  document.body.appendChild(dialog)
  return { dialog, rows }
}

/** Fake MutationObserver: tests drive the callback and inspect disconnects. */
function installObserver() {
  const instances = []
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback
      this.observed = []
      this.connected = true
      instances.push(this)
    }
    observe(target, options) {
      this.observed.push({ target, options })
    }
    disconnect() {
      this.connected = false
      this.observed = []
    }
    fire() {
      this.callback([])
    }
  }
  globalThis.MutationObserver = FakeMutationObserver
  return {
    instances,
    dispose() {
      delete globalThis.MutationObserver
    },
  }
}

/** Let the microtask-coalesced sweep run after a simulated mutation. */
function flushMicrotask() {
  return new Promise((resolve) => setImmediate(resolve))
}

function withDom(t, labels) {
  const document = createDom()
  const observer = installObserver()
  globalThis.document = document
  t.after(() => {
    delete globalThis.document
    observer.dispose()
  })
  const mounted = mountDialog(document, labels)
  return { document, observer, ...mounted }
}

test('marks only the notification row of the settings nav with the bell', (t) => {
  const { document, rows } = withDom(t, ['通用', '通知', '模型'])

  const dispose = installNotificationNavIcon('通知')

  assert.equal(rows[1].getAttribute(NAV_ICON_ATTRIBUTE), '')
  assert.equal(rows[0].hasAttribute(NAV_ICON_ATTRIBUTE), false)
  assert.equal(rows[2].hasAttribute(NAV_ICON_ATTRIBUTE), false)

  // The swap stylesheet is injected once and hides the shell glyph for a bell.
  const style = document.getElementById('dsh-tada-settings-nav-icon')
  assert.ok(style, 'expected the bell stylesheet')
  assert.match(style.textContent, /\[data-tada-nav-icon\] > svg \{ display: none !important; \}/)
  assert.match(style.textContent, /mask: url\("data:image\/svg\+xml,/)
  assert.match(style.textContent, /background-color: currentColor/)

  dispose()
})

test('re-marks the row after the settings dialog is re-created', async (t) => {
  const { document, observer, dialog } = withDom(t, ['通用', '通知'])
  const dispose = installNotificationNavIcon(() => '通知')
  const created = mountDialog(document, ['通用', '通知'])
  document.body.removeChild(dialog)

  observer.instances.at(-1).fire()
  await flushMicrotask()

  assert.equal(created.rows[1].getAttribute(NAV_ICON_ATTRIBUTE), '')
  assert.equal(created.rows[0].hasAttribute(NAV_ICON_ATTRIBUTE), false)
  dispose()
})

test('follows the page language and unmarks rows that stop matching', async (t) => {
  const { document, observer, dialog, rows } = withDom(t, ['通用', '通知'])
  let label = '通知'
  const dispose = installNotificationNavIcon(() => label)
  assert.equal(rows[1].getAttribute(NAV_ICON_ATTRIBUTE), '')

  // The page switches language in place: the zh row stops matching and the
  // marker is removed, so the gear comes back until an English row appears.
  label = 'Notifications'
  observer.instances.at(-1).fire()
  await flushMicrotask()
  assert.equal(rows[1].hasAttribute(NAV_ICON_ATTRIBUTE), false)

  // A dialog opened after the switch marks its own English row.
  document.body.removeChild(dialog)
  const english = mountDialog(document, ['General', 'Notifications'])
  observer.instances.at(-1).fire()
  await flushMicrotask()
  assert.equal(english.rows[1].getAttribute(NAV_ICON_ATTRIBUTE), '')
  assert.equal(english.rows[0].hasAttribute(NAV_ICON_ATTRIBUTE), false)
  dispose()
})

test('the disposer restores the gear and stops watching', async (t) => {
  const { document, observer, rows } = withDom(t, ['通用', '通知'])
  const dispose = installNotificationNavIcon('通知')
  const mutationObserver = observer.instances.at(-1)
  assert.equal(mutationObserver.connected, true)

  dispose()

  assert.equal(rows[1].hasAttribute(NAV_ICON_ATTRIBUTE), false)
  assert.equal(mutationObserver.connected, false)
  assert.deepEqual(mutationObserver.observed, [])

  // A later dialog no longer gets decorated.
  document.body.childNodes.length = 0
  const created = mountDialog(document, ['通用', '通知'])
  await flushMicrotask()
  assert.equal(created.rows[1].hasAttribute(NAV_ICON_ATTRIBUTE), false)
})

test('never decorates a row for an empty label or without a DOM', () => {
  const document = createDom()
  const observer = installObserver()
  globalThis.document = document
  try {
    const { rows } = mountDialog(document, ['通知'])
    const dispose = installNotificationNavIcon(() => '')
    assert.equal(rows[0].hasAttribute(NAV_ICON_ATTRIBUTE), false)
    dispose()

    delete globalThis.document
    assert.doesNotThrow(() => installNotificationNavIcon('通知')())
  } finally {
    delete globalThis.document
    observer.dispose()
  }
})
