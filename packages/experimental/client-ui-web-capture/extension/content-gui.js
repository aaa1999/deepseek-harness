/**
 * DSH Web Capture content script for the DSH GUI origin: a dumb pipe between
 * extension messages and the relay plugin's window messages. It relays
 * envelopes opaquely and injects the page's localStorage pairing token as
 * they cross, so the token never leaves this origin.
 */

const ACK_SOURCE = 'dsh-web-capture-ack'
const TOKEN_KEY = 'dsh:web-capture:token'
/** How long one relayed envelope may wait for the plugin's reply. */
const RELAY_REPLY_TIMEOUT_MS = 90_000

/** The one relayed envelope awaiting its page reply. */
let pending = null

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.kind === 'dsh-web-capture/ping') {
    sendResponse({ ok: readToken() !== null })
    return
  }
  if (message?.kind === 'dsh-web-capture/relay') {
    relayIntoPage(message.envelope, sendResponse)
    return true
  }
})

window.addEventListener('message', event => {
  if (event.source !== window || pending === null) return
  const data = event.data
  if (data?.source !== ACK_SOURCE || data.captureId !== pending.captureId) return
  if (data.kind === 'ack' && data.seq === pending.seq) settle(data)
  else if (data.kind === 'result') settle(data)
})

/** Post one envelope into the page, token attached, holding the reply channel open. */
function relayIntoPage(envelope, sendResponse) {
  if (typeof envelope?.captureId !== 'string' || envelope.captureId === '') {
    sendResponse({ kind: 'relay-error', message: 'the envelope is malformed' })
    return
  }
  if (pending !== null) {
    sendResponse({ kind: 'relay-error', message: 'another envelope is still pending' })
    return
  }
  pending = {
    captureId: envelope.captureId,
    seq: envelope.kind === 'chunk' ? envelope.seq : -1,
    timer: setTimeout(() => {
      const held = pending
      pending = null
      held?.sendResponse({ kind: 'relay-timeout' })
    }, RELAY_REPLY_TIMEOUT_MS),
    sendResponse,
  }
  window.postMessage({ ...envelope, token: readToken() ?? '' }, window.location.origin)
}

/** Answer the extension with one settled plugin reply. */
function settle(reply) {
  const held = pending
  pending = null
  clearTimeout(held.timer)
  held.sendResponse(reply)
}

/** The relay plugin's pairing token, or null when the plugin has not run yet. */
function readToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}
