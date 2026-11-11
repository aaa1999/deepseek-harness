// @vitest-environment jsdom
/** Reader view: the reading pane always claims the right-click, with or without a capturable selection. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, createEvent, fireEvent, render } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
// PDF.js enters the reader through these two modules; the pane-ownership test never opens a document.
vi.mock('../src/client/pdf/runtime.ts', () => ({ openPdf: vi.fn() }))
vi.mock('../src/client/pdf/text.ts', () => ({ outlinePages: vi.fn(async () => []), pdfTextRenderer: vi.fn() }))
import { ReaderView } from '../src/client/ReaderView.tsx'
// Registers the 'pdf.reader' locale namespace so PropsLocale resolves the `t` seat.
import type {} from '../src/client/index.ts'
import type { PdfReaderState } from '../src/client/controller.ts'
import { zh } from '../src/client/locales.ts'

beforeEach(() => {
  vi.stubGlobal('scrollIntoView', vi.fn())
  Element.prototype.scrollIntoView = vi.fn()
  // The shared lane setup installs this for jsdom; keep the spec self-sufficient when run alone.
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** The panel state snapshot the reading view starts from: a book open but its bytes not yet ready. */
function stateFixture(): PdfReaderState {
  return {
    view: 'reader',
    mode: 'scroll',
    penColor: 'yellow',
    library: { status: 'ready', error: '' },
    books: [],
    importing: false,
    importError: '',
    open: {
      bookId: 'b1', title: 'Sample Paper', pageCount: 3, page: 1, outline: [], zoom: 1,
      ready: false, metaReported: false, error: null,
    },
    annotations: [],
    streams: {},
    shots: {},
    shotCatalog: [],
    shotEffective: '',
    storage: {
      open: false, directory: '', configurable: false, busy: false, error: '', saved: false, models: [],
      modelProvider: '', modelId: '', shotProvider: '', shotModel: '', defaultProvider: '', defaultModel: '',
    },
  }
}

/** One store-backed `useReader` plus the plain action faces the view tests. */
function faces(state: PdfReaderState) {
  const store = createSnapshotStore(state)
  return {
    useReader: bindSnapshotSelector(store),
    actions: {
      closeBook: vi.fn(), selectPage: vi.fn(), stepPage: vi.fn(), setZoom: vi.fn(), setReadingMode: vi.fn(),
      setPenColor: vi.fn(), treat: vi.fn(), annotate: vi.fn(), setAnnotationColor: vi.fn(), askShot: vi.fn(),
      loadShotCatalog: vi.fn(), retryTextAnnotation: vi.fn(), retryShotAnnotation: vi.fn(), deleteAnnotation: vi.fn(),
      copyText: vi.fn(), openMenu: vi.fn(), openStorageSettings: vi.fn(), closeStorageSettings: vi.fn(),
      saveStorageSettings: vi.fn(), saveTreatmentModel: vi.fn(), saveShotModel: vi.fn(),
    },
    documents: { readBytes: vi.fn(), reportMeta: vi.fn(), saveCover: vi.fn(), loadAnnotations: vi.fn() },
    t: makeTranslate(zh),
  }
}

/** Render the reading view from one fixture so test bodies stay on interactions. */
function renderReader(f: ReturnType<typeof faces>) {
  return render(<ReaderView
    useReader={f.useReader} documents={f.documents} closeBook={f.actions.closeBook} selectPage={f.actions.selectPage}
    stepPage={f.actions.stepPage} setZoom={f.actions.setZoom} setReadingMode={f.actions.setReadingMode}
    setPenColor={f.actions.setPenColor} treat={f.actions.treat} annotate={f.actions.annotate} askShot={f.actions.askShot}
    loadShotCatalog={f.actions.loadShotCatalog} retryTextAnnotation={f.actions.retryTextAnnotation}
    retryShotAnnotation={f.actions.retryShotAnnotation} deleteAnnotation={f.actions.deleteAnnotation}
    setAnnotationColor={f.actions.setAnnotationColor} copyText={f.actions.copyText} openMenu={f.actions.openMenu}
    openStorageSettings={f.actions.openStorageSettings} closeStorageSettings={f.actions.closeStorageSettings}
    saveStorageSettings={f.actions.saveStorageSettings} saveTreatmentModel={f.actions.saveTreatmentModel}
    saveShotModel={f.actions.saveShotModel} t={f.t}
  />)
}

it('claims the right-click in the reading pane even without a capturable selection', () => {
  const f = faces(stateFixture())
  const view = renderReader(f)
  const pane = view.container.querySelector('[data-pdf-reading]')!
  expect(pane).toBeTruthy()
  const event = createEvent.contextMenu(pane)
  fireEvent(pane, event)
  expect(event.defaultPrevented).toBe(true)
  expect(f.actions.openMenu).not.toHaveBeenCalled()
})
