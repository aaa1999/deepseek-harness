/** DSH Web Capture popup: capture options, persistence, and outcome display. */

const DEFAULTS = { mode: 'long', width: 0, deep: true, guiUrl: 'http://127.0.0.1:3080' }

const modeInputs = Array.from(document.querySelectorAll('input[name="mode"]'))
const widthSelect = document.getElementById('width')
const deepInput = document.getElementById('deep')
const guiUrlInput = document.getElementById('guiUrl')
const captureButton = document.getElementById('capture')
const statusDiv = document.getElementById('status')

document.addEventListener('DOMContentLoaded', load)

async function load() {
  const settings = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) }
  for (const input of modeInputs) input.checked = input.value === settings.mode
  widthSelect.value = String(settings.width)
  deepInput.checked = settings.deep !== false
  guiUrlInput.value = settings.guiUrl
  for (const input of modeInputs) input.addEventListener('change', save)
  widthSelect.addEventListener('change', save)
  deepInput.addEventListener('change', save)
  guiUrlInput.addEventListener('change', save)
  captureButton.addEventListener('click', capture)
}

function currentSettings() {
  const checked = modeInputs.find(input => input.checked) ?? modeInputs[0]
  const width = Number(widthSelect.value)
  return {
    mode: checked.value,
    width: Number.isFinite(width) ? width : 0,
    deep: deepInput.checked,
    guiUrl: guiUrlInput.value.trim() || DEFAULTS.guiUrl,
  }
}

async function save() {
  await chrome.storage.local.set(currentSettings())
}

async function capture() {
  const settings = currentSettings()
  await save()
  captureButton.disabled = true
  status(statusDiv, '', '')
  status(statusDiv, '捕获中…大约需要几秒', '')
  try {
    const reply = await chrome.runtime.sendMessage({ kind: 'capture', ...settings })
    if (reply?.ok === true) status(statusDiv, `已入库：${reply.title || '未命名快照'}`, 'ok')
    else status(statusDiv, `失败（${reply?.code ?? 'unknown'}）：${reply?.message ?? '未返回原因'}`, 'error')
  } catch (error) {
    status(statusDiv, `失败：${String(error?.message ?? error)}`, 'error')
  } finally {
    captureButton.disabled = false
  }
}

function status(node, text, kind) {
  node.textContent = text
  node.className = kind
}
