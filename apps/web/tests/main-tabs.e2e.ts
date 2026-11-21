// Browser e2e for the main tab strip: opening a Session or the Plugins panel
// opens a tab, tabs switch the main view, closing removes one, and the open
// set survives a reload.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { launchWebScaffold, seedSession, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const FIRST = createChatScrollFixture({ markerPrefix: 'MAIN_TABS_A', title: 'MAIN_TABS_A session', turns: 2 })
const SECOND = createChatScrollFixture({ markerPrefix: 'MAIN_TABS_B', title: 'MAIN_TABS_B session', turns: 2 })

async function openSeededSession(page: Page, marker: string): Promise<void> {
  const searchButton = page.getByRole('button', { name: 'Search sessions' })
  if (await searchButton.getAttribute('aria-expanded') !== 'true') await searchButton.click()
  await page.getByRole('textbox', { name: 'Search session names', exact: true }).fill(marker)
  const results = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
  const deadline = Date.now() + 60_000
  while (await results.count() !== 1) {
    if (Date.now() > deadline) throw new Error('seeded session never appeared in the sidebar search results')
    await page.waitForTimeout(200)
  }
  await results.click()
}

describe('web e2e: main tab strip', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, FIRST.log, 'main-tabs-first-web-e2e')
    await seedSession(scaffold, SECOND.log, 'main-tabs-second-web-e2e')
    browser = await chromium.launch()
    page = await newEnglishPage(browser, 900)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openSeededSession(page, FIRST.markers.user(1))
    await openSeededSession(page, SECOND.markers.user(1))
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('opens one tab per opened Session and the Plugins panel', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-main-tabs-open'))
    const strip = page.getByRole('tablist', { name: 'Open views' })
    await strip.getByRole('tab', { name: FIRST.title, exact: true }).waitFor({ timeout: 30_000 })
    await strip.getByRole('tab', { name: SECOND.title, exact: true }).waitFor({ timeout: 30_000 })
    await page.getByRole('navigation', { name: 'Global panels' })
      .getByRole('button', { name: 'Plugins', exact: true }).click()
    const pluginsTab = strip.getByRole('tab', { name: 'Plugins', exact: true })
    await pluginsTab.waitFor({ timeout: 30_000 })
    expect(await pluginsTab.getAttribute('aria-selected')).toBe('true')
    await page.locator('[data-plugin-panel]').waitFor({ timeout: 30_000 })
    expect(tripwire.pageErrors).toEqual([])
  })

  it('switches the main view through the strip', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-main-tabs-switch'))
    const strip = page.getByRole('tablist', { name: 'Open views' })
    await strip.getByRole('tab', { name: FIRST.title, exact: true }).click()
    await page.getByText(FIRST.markers.assistant(FIRST.turns), { exact: false }).last()
      .waitFor({ timeout: 30_000 })
    expect(await strip.getByRole('tab', { name: FIRST.title }).getAttribute('aria-selected')).toBe('true')
    expect(await page.locator('[data-plugin-panel]').count()).toBe(0)
    await strip.getByRole('tab', { name: 'Plugins', exact: true }).click()
    await page.locator('[data-plugin-panel]').waitFor({ timeout: 30_000 })
    expect(tripwire.pageErrors).toEqual([])
  })

  it('closes a tab and restores the open set after a reload', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-main-tabs-close'))
    const strip = page.getByRole('tablist', { name: 'Open views' })
    const blank = strip.getByRole('tab', { name: 'New Session', exact: true })
    if (await blank.count() === 1) {
      await blank.getByRole('button', { name: 'Close "New Session"' }).click()
      await blank.waitFor({ state: 'detached', timeout: 30_000 })
    }
    await strip.getByRole('tab', { name: FIRST.title, exact: true }).click()
    await page.getByText(FIRST.markers.assistant(FIRST.turns), { exact: false }).last()
      .waitFor({ timeout: 30_000 })
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    const restored = page.getByRole('tablist', { name: 'Open views' })
    await restored.getByRole('tab', { name: FIRST.title, exact: true }).waitFor({ timeout: 30_000 })
    await restored.getByRole('tab', { name: SECOND.title, exact: true }).waitFor({ timeout: 30_000 })
    await restored.getByRole('tab', { name: 'Plugins', exact: true }).waitFor({ timeout: 30_000 })
    expect(await restored.getByRole('tab', { name: 'New Session', exact: true }).count()).toBe(0)
    expect(await restored.getByRole('tab', { name: FIRST.title }).getAttribute('aria-selected')).toBe('true')
    expect(tripwire.pageErrors).toEqual([])
  })
})
