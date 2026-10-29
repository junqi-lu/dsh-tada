// dsh-tada — the notification bell in the Harness Settings navigation.
//
// A `settings.section` registration only carries id/order/label to the shell
// (ui-settings-general), and that shell picks a nav glyph per id, falling back
// to the generic settings gear for ids it does not know — this plugin's
// `dsh-tada-content` included. `icon` is registered as a forward-compatible
// hint, but on hosts that ignore it the glyph has to be put on screen from the
// plugin side, the way `@michengai/dsh-skills-manager` does it: mark the nav
// button whose label is ours, hide the shell's own <svg>, and paint an
// independent bell through `::before` + a CSS mask. The mask keeps the bell in
// `currentColor`, so active/hover styling stays the shell's business, and it
// survives third-party skins that restyle or replace the host icon.
//
// The Settings panel is portaled and unmounted on close, so a MutationObserver
// re-marks the freshly created row; matching is by exact label text so no other
// dialog row is ever decorated, and a locale change re-matches the new text.
// Everything degrades to the stock gear: without a DOM or MutationObserver the
// marker is simply never applied, and the disposer removes every marker so
// unloading the plugin restores the gear.

/** Attribute the stylesheet keys the bell swap on; React never touches it. */
export const NAV_ICON_ATTRIBUTE = 'data-tada-nav-icon'

/** Every settings-nav row: the shell portal renders nav > button rows. */
const NAV_ROW_SELECTOR = '[role="dialog"] nav button'

/** Stylesheet id, so repeated installs (hot reload) share one <style> tag. */
const STYLE_ID = 'dsh-tada-settings-nav-icon'

/**
 * Bell outline in the Harness icon language: a 24-unit viewBox with a 2-unit
 * stroke, which the 16px mask box scales to the shell's 1.3px icon stroke.
 */
const BELL_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"',
  ' stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">',
  '<path d="M10.268 21a2 2 0 0 0 3.464 0"/>',
  '<path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8',
  'A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
  '</svg>',
].join('')

/** The bell as a mask source, so the glyph paints in the row's text color. */
const BELL_MASK = `url("data:image/svg+xml,${encodeURIComponent(BELL_SVG)}")`

/** Swap the shell glyph for the bell on the marked row only. */
const STYLE = [
  `[${NAV_ICON_ATTRIBUTE}] > svg { display: none !important; }`,
  `[${NAV_ICON_ATTRIBUTE}]::before {`,
  "  content: '';",
  '  flex: none;',
  '  width: 16px;',
  '  height: 16px;',
  '  background-color: currentColor;',
  `  -webkit-mask: ${BELL_MASK} center / contain no-repeat;`,
  `  mask: ${BELL_MASK} center / contain no-repeat;`,
  '  -webkit-mask-repeat: no-repeat;',
  '  mask-repeat: no-repeat;',
  '  -webkit-mask-position: center;',
  '  mask-position: center;',
  '  -webkit-mask-size: 16px 16px;',
  '  mask-size: 16px 16px;',
  '}',
].join('\n')

/** Put the bell stylesheet in the page once. */
function ensureStyle(doc) {
  if (typeof doc.getElementById !== 'function') return
  if (doc.getElementById(STYLE_ID) !== null) return
  const tag = doc.createElement('style')
  tag.id = STYLE_ID
  tag.textContent = STYLE
  ;(doc.head ?? doc.documentElement).appendChild(tag)
}

/** The page's registered nav label, which may follow the page language. */
function readLabel(label) {
  try {
    return String(typeof label === 'function' ? label() : label ?? '').trim()
  } catch {
    return ''
  }
}

/** Exact-label match; an empty label never decorates a row. */
function isOurRow(button, label) {
  return label !== '' && String(button.textContent ?? '').trim() === label
}

/**
 * Mark the matching nav row and unmark any row that no longer matches, so a
 * same-named row elsewhere and a language switch both settle to one bell.
 */
function syncRow(button, label) {
  if (isOurRow(button, label)) {
    if (typeof button.getAttribute === 'function' && button.getAttribute(NAV_ICON_ATTRIBUTE) === '') return false
    button.setAttribute(NAV_ICON_ATTRIBUTE, '')
    return true
  }
  if (typeof button.hasAttribute === 'function' && button.hasAttribute(NAV_ICON_ATTRIBUTE)) {
    button.removeAttribute(NAV_ICON_ATTRIBUTE)
    return true
  }
  return false
}

/**
 * Decorate the notification section's Settings-nav row with a bell, keeping it
 * in sync while the dialog is re-created and the page language changes.
 *
 * @param label Current nav label, e.g. `() => '通知'`.
 * @returns Disposer that unmarks every row (the gear comes back).
 */
export function installNotificationNavIcon(label) {
  if (typeof document === 'undefined') return () => {}
  const doc = document
  if (typeof doc.querySelectorAll !== 'function' || !(doc.body ?? doc.documentElement)) return () => {}
  try {
    ensureStyle(doc)
  } catch {
    return () => {}
  }

  let stopped = false
  let queued = false

  const sync = () => {
    queued = false
    if (stopped) return
    const wanted = readLabel(label)
    const rows = doc.querySelectorAll(NAV_ROW_SELECTOR)
    for (let index = 0; index < rows.length; index += 1) {
      try {
        syncRow(rows[index], wanted)
      } catch {
        /* one odd row must not stop the sweep */
      }
    }
  }

  // Coalesce mutation bursts (the dialog commits many nodes) into one sweep.
  const schedule = () => {
    if (queued || stopped) return
    queued = true
    if (typeof queueMicrotask === 'function') queueMicrotask(sync)
    else Promise.resolve().then(sync)
  }

  sync()
  let observer = null
  try {
    if (typeof MutationObserver === 'function') {
      observer = new MutationObserver(schedule)
      observer.observe(doc.body ?? doc.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      })
    }
  } catch {
    observer = null
  }

  return () => {
    stopped = true
    queued = false
    try {
      observer?.disconnect()
    } catch {
      /* already disconnected */
    }
    observer = null
    const marked = doc.querySelectorAll(`[${NAV_ICON_ATTRIBUTE}]`)
    for (let index = 0; index < marked.length; index += 1) {
      try {
        marked[index].removeAttribute(NAV_ICON_ATTRIBUTE)
      } catch {
        /* already detached */
      }
    }
  }
}
