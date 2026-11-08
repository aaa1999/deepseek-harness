/**
 * DSH Web Capture background: snapshots the active page into a PDF through
 * the Chrome DevTools Protocol (screen-media rendering, background colors,
 * custom paper) and files the bytes into the DSH GUI's relay plugin through
 * the GUI tab's content script.
 *
 * Delivery stays same-origin on purpose: the extension never talks to the
 * DSH HTTP API (its cross-origin browser requests are refused by the Host's
 * trust fence); the GUI page's own plugin makes the Remote import call. The
 * pairing token never leaves the GUI origin either — the content script
 * injects it into every envelope it relays.
 */

import {
  A4_PAPER, CHUNK_CHARS, chunkBase64, decodedByteLength, deepScrollPlan, longPaper, planChunks,
} from './shared/capture-params.js'

/** Persisted capture settings; width 0 keeps the page's own viewport width. */
const SETTINGS_DEFAULTS = { mode: 'long', width: 0, guiUrl: 'http://127.0.0.1:3080' }
/** How long a freshly opened GUI tab may take to boot its relay plugin. */
const GUI_READY_TIMEOUT_MS = 30_000
/** Poll cadence while waiting for the GUI relay. */
const GUI_READY_POLL_MS = 500
/** Settling pause after a device-metrics override, before measuring. */
const RELAYOUT_SETTLE_MS = 600
/** Dwell at each deep-capture scroll position, letting lazy loaders run. */
const DEEP_DWELL_MS = 350
/** Whole-capture budget of one deep-capture scroll pass. */
const DEEP_BUDGET_MS = 25_000
/** The style element id the print patch rides in on. */
const PATCH_STYLE_ID = 'dsh-web-capture-print'

const RELAY_PING = 'dsh-web-capture/ping'
const RELAY_SEND = 'dsh-web-capture/relay'

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.kind !== 'capture') return undefined
  captureAndDeliver(message).then(sendResponse, error => {
    sendResponse({ ok: false, code: 'unexpected', message: textOf(error) })
  })
  return true
})

/** Read the capture request, run the CDP snapshot, and deliver its PDF. */
async function captureAndDeliver(request) {
  const mode = request.mode === 'a4' ? 'a4' : 'long'
  const width = Number.isSafeInteger(request.width) && request.width > 0 ? request.width : 0
  const deep = request.deep !== false
  const guiUrl = typeof request.guiUrl === 'string' && request.guiUrl !== '' ? request.guiUrl : SETTINGS_DEFAULTS.guiUrl

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.id === undefined || !/^https?:/u.test(tab.url ?? '')) {
    return failure('no-tab', '没有可捕获的网页标签页（浏览器内置页面无法捕获）')
  }
  let capture
  try {
    capture = await snapshot({ tabId: tab.id }, { mode, width, deep, fallbackTitle: tab.title ?? '' })
  } catch (error) {
    return debuggerFailure(error)
  }
  const plan = planChunks(capture.base64.length, CHUNK_CHARS)
  if (!plan.ok) {
    return failure('too-large', `PDF 需要 ${plan.totalChunks} 个分片，超过上限 ${plan.limit}`)
  }
  const delivered = await deliver({ ...capture, url: tab.url ?? '', guiUrl, totalChunks: plan.totalChunks })
  await badge(delivered.ok)
  return delivered
}

/** One CDP snapshot: attach, scroll and freeze, patch, print, and detach. */
async function snapshot(target, { mode, width, deep, fallbackTitle }) {
  await chrome.debugger.attach(target, '1.3')
  let page
  let printed
  try {
    if (width > 0) {
      await send(target, 'Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 0, mobile: false })
      await sleep(RELAYOUT_SETTLE_MS)
    }
    if (deep) {
      const early = await measure(target)
      await deepScroll(target, deepScrollPlan(early.scrollHeight, early.viewportHeight))
    }
    await freezeDynamicMedia(target)
    page = await measure(target)
    await injectPatch(target, mode)
    await send(target, 'Emulation.setEmulatedMedia', { media: 'screen' })
    const paper = mode === 'a4' ? A4_PAPER : longPaper(page.scrollWidth, page.scrollHeight)
    printed = await send(target, 'Page.printToPDF', {
      landscape: false,
      printBackground: true,
      ...paper,
      marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
      preferCSSPageSize: false,
      scale: 1,
      generateTaggedPDF: true,
    })
  } finally {
    if (width > 0) await send(target, 'Emulation.clearDeviceMetricsOverride', {}).catch(() => {})
    await chrome.debugger.detach(target).catch(() => {})
  }
  const base64 = printed?.data
  if (typeof base64 !== 'string' || base64 === '' || !Number.isFinite(decodedByteLength(base64))) {
    throw typedError('empty-pdf', '浏览器没有产出可用的 PDF，请重试')
  }
  const title = (page.title !== '' ? page.title : fallbackTitle).trim().slice(0, 300)
  return { mode, base64, byteLength: decodedByteLength(base64), title }
}

/** Full-document geometry and title in one evaluation. */
async function measure(target) {
  const expression = `JSON.stringify((() => {
    const doc = document.documentElement, body = document.body
    return {
      scrollWidth: Math.max(doc.scrollWidth, body ? body.scrollWidth : 0),
      scrollHeight: Math.max(doc.scrollHeight, body ? body.scrollHeight : 0),
      viewportHeight: window.innerHeight,
      title: document.title,
    }
  })())`
  const evaluation = await send(target, 'Runtime.evaluate', { expression, returnByValue: true })
  let metrics = {}
  try { metrics = JSON.parse(evaluation?.result?.value ?? '{}') } catch { /* treat as unreadable */ }
  return {
    scrollWidth: Number(metrics.scrollWidth) || 0,
    scrollHeight: Number(metrics.scrollHeight) || 0,
    viewportHeight: Number(metrics.viewportHeight) || 0,
    title: typeof metrics.title === 'string' ? metrics.title : '',
  }
}

/** Walk the page once so lazy loaders fetch what the print will need. */
async function deepScroll(target, positions) {
  const deadline = Date.now() + DEEP_BUDGET_MS
  for (const position of positions) {
    if (Date.now() > deadline) break
    await send(target, 'Runtime.evaluate', { expression: `window.scrollTo(0, ${Math.round(position)})` })
    await sleep(DEEP_DWELL_MS)
  }
  await send(target, 'Runtime.evaluate', { expression: 'window.scrollTo(0, 0)' })
  await sleep(RELAYOUT_SETTLE_MS)
}

/** Replace canvas and video elements with frozen frames the print engine renders. */
async function freezeDynamicMedia(target) {
  const expression = `(() => {
    const out = { canvas: 0, video: 0, skipped: 0 }
    const swap = (node, dataUrl, width, height) => {
      const img = document.createElement('img')
      img.src = dataUrl
      img.setAttribute('data-dsh-web-capture-frozen', '1')
      img.style.width = node.style.width !== '' ? node.style.width : width + 'px'
      img.style.height = node.style.height !== '' ? node.style.height : height + 'px'
      node.replaceWith(img)
    }
    for (const canvas of Array.from(document.querySelectorAll('canvas'))) {
      try { swap(canvas, canvas.toDataURL('image/png'), canvas.width, canvas.height); out.canvas += 1 }
      catch { out.skipped += 1 }
    }
    for (const video of Array.from(document.querySelectorAll('video'))) {
      try {
        const frame = document.createElement('canvas')
        frame.width = video.videoWidth || 300
        frame.height = video.videoHeight || 150
        frame.getContext('2d').drawImage(video, 0, 0, frame.width, frame.height)
        swap(video, frame.toDataURL('image/png'), frame.width, frame.height)
        out.video += 1
      } catch { out.skipped += 1 }
    }
    return JSON.stringify(out)
  })()`
  const evaluation = await send(target, 'Runtime.evaluate', { expression, returnByValue: true }).catch(() => undefined)
  let frozen = {}
  try { frozen = JSON.parse(evaluation?.result?.value ?? '{}') } catch { /* keep counts zero */ }
  return frozen
}

/** The print patch: keep colors, and in A4 mode discourage mid-element breaks. */
async function injectPatch(target, mode) {
  const rules = ['html{-webkit-print-color-adjust:exact;print-color-adjust:exact;}']
  if (mode === 'a4') rules.push('img,svg,video,canvas,table,pre,blockquote,figure{break-inside:avoid;}')
  const expression = `(() => {
    const style = document.createElement('style')
    style.id = ${JSON.stringify(PATCH_STYLE_ID)}
    style.textContent = ${JSON.stringify(rules.join('\n'))}
    document.documentElement.appendChild(style)
    return true
  })()`
  await send(target, 'Runtime.evaluate', { expression })
}

/** Find or open the GUI tab, wait for its relay plugin, and stream the capture. */
async function deliver({ mode, base64, byteLength, title, url, guiUrl, totalChunks }) {
  let origin
  try { origin = new URL(guiUrl).origin } catch { return failure('gui-url', 'DSH GUI 地址无效，请检查弹窗里的设置') }
  let guiTabId
  try {
    const matches = await chrome.tabs.query({ url: `${origin}/*` })
    if (matches.length > 0 && matches[0].id !== undefined) guiTabId = matches[0].id
    else {
      const opened = await chrome.tabs.create({ url: guiUrl, active: false })
      if (opened?.id === undefined) throw new Error('creating the GUI tab returned no tab')
      guiTabId = opened.id
    }
  } catch (error) {
    return failure('gui-open', `打开 DSH GUI 失败：${textOf(error)}`)
  }
  if (await waitGuiReady(guiTabId) === null) {
    return failure('gui-plugin-missing', 'GUI 已打开但 web-capture 插件未响应：请确认插件已安装并刷新 GUI 页面')
  }

  let relayed
  try {
    relayed = await streamCapture(guiTabId, { mode, base64, byteLength, title, url, totalChunks })
  } catch (error) {
    return failure(error?.code === 'gui-lost' ? 'gui-lost' : 'deliver', textOf(error))
  }
  return relayed.ok === true
    ? { ok: true, bookId: relayed.bookId ?? '', title: relayed.title ?? title }
    : failure(relayed.code ?? 'deliver', relayed.message ?? '传送被拒绝')
}

/** Stream one reassembled capture: begin, then every chunk, expecting the terminal reply. */
async function streamCapture(guiTabId, { mode, base64, byteLength, title, url, totalChunks }) {
  const captureId = crypto.randomUUID()
  // The token field is empty on purpose: the GUI content script fills in the
  // page's localStorage pairing token as it relays, so the extension never sees it.
  const beginReply = await relaySend(guiTabId, {
    source: 'dsh-web-capture', kind: 'begin', token: '', captureId,
    title, url, mode, byteLength, totalChunks,
    capturedAt: Date.now(),
  })
  if (beginReply.kind === 'result') return beginReply.ok ? beginReply : beginReply.error ?? { code: 'import-failed', message: '导入被拒绝' }
  if (beginReply.kind !== 'ack') throw typedError('gui-lost', 'begin 阶段应答异常')

  const chunks = chunkBase64(base64)
  for (const chunk of chunks) {
    const reply = await relaySend(guiTabId, {
      source: 'dsh-web-capture', kind: 'chunk', token: '', captureId,
      seq: chunk.seq, data: chunk.data,
    })
    if (chunk.seq === chunks.length - 1) {
      if (reply.kind === 'result') {
        return reply.ok ? reply : reply.error ?? { code: 'import-failed', message: '导入被拒绝' }
      }
      throw typedError('gui-lost', '最后一个分片没有收到导入结果')
    }
    if (reply.kind === 'result' && reply.ok === false) return reply.error ?? { code: 'import-failed', message: '导入被拒绝' }
    if (reply.kind !== 'ack' || reply.seq !== chunk.seq) throw typedError('gui-lost', `分片 ${chunk.seq} 的应答异常`)
  }
  throw typedError('gui-lost', '分片流意外结束')
}

/** Poll the GUI tab until its content script reports the relay plugin paired. */
async function waitGuiReady(guiTabId) {
  const deadline = Date.now() + GUI_READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const pong = await chrome.tabs.sendMessage(guiTabId, { kind: RELAY_PING })
      if (pong?.ok === true) return pong
    } catch { /* the tab or its content script is not ready yet */ }
    await sleep(GUI_READY_POLL_MS)
  }
  return null
}

/** One round trip into the GUI page; transport failures become typed failures. */
async function relaySend(guiTabId, envelope) {
  let reply
  try {
    reply = await chrome.tabs.sendMessage(guiTabId, { kind: RELAY_SEND, envelope })
  } catch (error) {
    throw typedError('gui-lost', `GUI 页面通道中断：${textOf(error)}`)
  }
  if (reply?.kind === 'relay-timeout' || reply?.kind === 'relay-error') {
    throw typedError('gui-lost', `GUI 页面通道${reply.kind === 'relay-timeout' ? '超时' : '拒绝'}：${reply.message ?? ''}`)
  }
  return reply ?? {}
}

/** Map one debugger-stage exception onto the popup's failure shape. */
function debuggerFailure(error) {
  const message = textOf(error)
  if (error?.code !== undefined && error?.code !== 'debugger') return failure(error.code, message)
  if (/another client (is already )?attach/iu.test(message)) {
    return failure('devtools-open', '该页面正被 DevTools 占用，请关闭它的 DevTools 窗口后重试')
  }
  if (/cannot attach|not attached|invalid tab/iu.test(message)) {
    return failure('no-tab', '无法附加到该标签页，请切换到普通网页后重试')
  }
  return failure('debugger', `捕获失败：${message}`)
}

/** One CDP command over the attached debugger. */
function send(target, method, params = {}) {
  return chrome.debugger.sendCommand(target, method, params)
}

/** A thrown error carrying a popup failure code. */
function typedError(code, message) {
  return Object.assign(new Error(message), { code })
}

/** A typed popup failure. */
function failure(code, message) {
  return { ok: false, code, message }
}

/** Flash the action badge with the capture outcome. */
async function badge(ok) {
  try {
    await chrome.action.setBadgeText({ text: ok ? '✓' : '!' })
    await chrome.action.setBadgeBackgroundColor({ color: ok ? '#2f9e44' : '#d9480f' })
    setTimeout(() => { void chrome.action.setBadgeText({ text: '' }) }, 4000)
  } catch { /* the action may be unavailable in some contexts */ }
}

/** Message text of any thrown value. */
function textOf(error) {
  return String(error?.message ?? error)
}

/** Promise-based sleep. */
function sleep(ms) {
  return new Promise(resolve => { setTimeout(resolve, ms) })
}

/** The defaults popup inputs start from. */
export const settingsDefaults = SETTINGS_DEFAULTS
