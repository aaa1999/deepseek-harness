// @vitest-environment jsdom
/** Reader panel components: shelf interactions, note cards, chapter rendering, paper toggle. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, createEvent, fireEvent, render } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { Annotation, BookRow } from '@deepseek-ai/dsh-experimental-epub-reader/types'
import { LibraryView } from '../src/client/LibraryView.tsx'
import { NotesColumn } from '../src/client/NotesColumn.tsx'
import { ReaderView } from '../src/client/ReaderView.tsx'
// Registers the 'epub.reader' locale namespace so PropsLocale resolves the `t` seat.
import type {} from '../src/client/index.ts'
import type { EpubReaderState } from '../src/client/controller.ts'
import { zh } from '../src/client/locales.ts'

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('scrollIntoView', vi.fn())
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

/** One shelf row the library view tests reuse. */
const book: BookRow = {
  bookId: 'b1', title: 'Sample Book', author: 'A. Author', language: 'en', coverUrl: null,
  chapterCount: 2, progress: { chapterIndex: 1, ratio: 0.5 }, importedAt: 1,
}

/** One saved annotation the notes column tests reuse. */
const note: Annotation = {
  id: 'a1', chapterIndex: 0, start: 4, end: 10, quote: 'was th', createdAt: 5,
  results: [{ kind: 'translate', text: '曾是', model: 'test-model', createdAt: 6 }],
}

/** The panel state snapshot the view tests start from. */
function stateFixture(overrides: Partial<EpubReaderState> = {}): EpubReaderState {
  return {
    view: 'library',
    library: { status: 'ready', error: '' },
    books: [book],
    importing: false,
    importError: '',
    open: {
      bookId: 'b1', title: 'Sample Book', chapterCount: 2, chapterIndex: 0, chapterTitle: 'One',
      html: '<p>It was <em>best</em> of times.</p><script>alert(1)</script>', toc: [{ title: 'One', chapterIndex: 0 }],
      loading: false, error: null, restoreRatio: 0,
    },
    annotations: [],
    streams: {},
    storage: { open: false, directory: '', configurable: false, busy: false, error: '', saved: false, models: [], modelProvider: '', modelId: '', defaultProvider: '', defaultModel: '' },
    ...overrides,
  }
}

/** One store-backed `useReader` plus the plain action faces the views test. */
function faces(state: EpubReaderState) {
  const store = createSnapshotStore(state)
  return {
    useReader: bindSnapshotSelector(store),
    store,
    actions: {
      importFiles: vi.fn(), removeBook: vi.fn(), openBook: vi.fn(), closeBook: vi.fn(),
      selectChapter: vi.fn(), stepChapter: vi.fn(), noteScroll: vi.fn(), treat: vi.fn(),
      retryAnnotation: vi.fn(), deleteAnnotation: vi.fn(), copyText: vi.fn(),
      captureSelectionNote: vi.fn(), captureAnnotationNote: vi.fn(), openMenu: vi.fn(),
      openStorageSettings: vi.fn(), closeStorageSettings: vi.fn(), saveStorageSettings: vi.fn(), saveTreatmentModel: vi.fn(),
    },
    t: makeTranslate(zh),
  }
}

/** Render the library view from one fixture so test bodies stay on interactions. */
function renderLibrary(f: ReturnType<typeof faces>) {
  return render(<LibraryView
    useReader={f.useReader} importFiles={f.actions.importFiles} removeBook={f.actions.removeBook}
    openBook={f.actions.openBook} openStorageSettings={f.actions.openStorageSettings}
    closeStorageSettings={f.actions.closeStorageSettings} saveStorageSettings={f.actions.saveStorageSettings}
    saveTreatmentModel={f.actions.saveTreatmentModel} t={f.t}
  />)
}

/** Render the notes column for one chapter from one fixture. */
function renderNotes(f: ReturnType<typeof faces>, chapterIndex: number) {
  return render(<NotesColumn
    useReader={f.useReader} chapterIndex={chapterIndex} locate={vi.fn()}
    retryAnnotation={f.actions.retryAnnotation} deleteAnnotation={f.actions.deleteAnnotation}
    copyText={f.actions.copyText} captureAnnotationNote={f.actions.captureAnnotationNote} t={f.t}
  />)
}

/** Render the reading view from one fixture. */
function renderReader(f: ReturnType<typeof faces>) {
  return render(<ReaderView
    useReader={f.useReader} closeBook={f.actions.closeBook} selectChapter={f.actions.selectChapter}
    stepChapter={f.actions.stepChapter} noteScroll={f.actions.noteScroll} treat={f.actions.treat}
    captureSelectionNote={f.actions.captureSelectionNote} openStorageSettings={f.actions.openStorageSettings}
    closeStorageSettings={f.actions.closeStorageSettings} saveStorageSettings={f.actions.saveStorageSettings}
    saveTreatmentModel={f.actions.saveTreatmentModel} retryAnnotation={f.actions.retryAnnotation}
    deleteAnnotation={f.actions.deleteAnnotation} copyText={f.actions.copyText}
    captureAnnotationNote={f.actions.captureAnnotationNote} openMenu={f.actions.openMenu} t={f.t}
  />)
}

it('renders the shelf with progress and opens a book on card click', () => {
  const f = faces(stateFixture())
  const view = renderLibrary(f)
  expect(view.getByText('Sample Book')).toBeTruthy()
  expect(view.getByText('A. Author · 2 章')).toBeTruthy()
  expect(view.getByText('已读 50%')).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: /Sample Book/ }))
  expect(f.actions.openBook).toHaveBeenCalledWith('b1')
})

it('confirms a shelf removal before deleting the book', () => {
  const f = faces(stateFixture())
  const view = renderLibrary(f)
  const first = view.getAllByRole('button', { name: zh.remove })[0]!
  fireEvent.click(first)
  fireEvent.click(view.getByRole('button', { name: zh.remove }))
  expect(f.actions.removeBook).toHaveBeenCalledWith('b1')
})

it('hands dropped files to the import face', () => {
  const f = faces(stateFixture())
  const view = renderLibrary(f)
  const file = new File(['book'], 'book.epub')
  fireEvent.drop(view.container.firstElementChild!, { dataTransfer: { files: [file] } })
  expect(f.actions.importFiles).toHaveBeenCalledWith([file])
})

it('opens the storage settings from the shelf button', () => {
  const f = faces(stateFixture())
  const view = renderLibrary(f)
  fireEvent.click(view.getByRole('button', { name: zh.settings }))
  expect(f.actions.openStorageSettings).toHaveBeenCalledOnce()
})

it('edits and saves the storage directory from the settings panel', () => {
  const f = faces(stateFixture({
    storage: { open: true, directory: '/Books/reader', configurable: true, busy: false, error: '', saved: false, models: [], modelProvider: '', modelId: '', defaultProvider: '', defaultModel: '' },
  }))
  const view = renderLibrary(f)
  const field = view.getByLabelText(zh.storageDirectory) as HTMLInputElement
  expect(field.value).toBe('/Books/reader')
  fireEvent.change(field, { target: { value: '/Books/elsewhere' } })
  fireEvent.click(view.getByRole('button', { name: zh.saveStorage }))
  expect(f.actions.saveStorageSettings).toHaveBeenCalledWith('/Books/elsewhere')
  fireEvent.click(view.getByRole('button', { name: zh.backToLibrary }))
  expect(f.actions.closeStorageSettings).toHaveBeenCalledOnce()
})

it('shows the unavailable notice when the profile cannot edit config', () => {
  const f = faces(stateFixture({
    storage: { open: true, directory: '/Books/reader', configurable: false, busy: false, error: '', saved: false, models: [], modelProvider: '', modelId: '', defaultProvider: '', defaultModel: '' },
  }))
  const view = renderLibrary(f)
  expect(view.getByText(zh.storageUnavailable)).toBeTruthy()
})

it('picks a treatment model from the catalog and clears back to the default', () => {
  const f = faces(stateFixture({
    storage: {
      open: true, directory: '/Books/reader', configurable: true, busy: false, error: '', saved: false,
      models: [
        { provider: 'deepseek-official', model: 'deepseek-chat', name: 'DeepSeek Chat' },
        { provider: 'deepseek-official', model: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
      ],
      modelProvider: '', modelId: '', defaultProvider: 'deepseek-official', defaultModel: 'deepseek-chat',
    },
  }))
  const view = renderLibrary(f)
  const select = view.getByLabelText(zh.treatmentModel) as HTMLSelectElement
  expect(select.value).toBe('')
  expect(view.getByText(zh.followDefaultWith.replace('{selection}', 'deepseek-official · deepseek-chat'))).toBeTruthy()
  expect(view.getByText('deepseek-official · DeepSeek Reasoner')).toBeTruthy()

  fireEvent.change(select, { target: { value: 'deepseek-official::deepseek-reasoner' } })
  expect(f.actions.saveTreatmentModel).toHaveBeenCalledWith('deepseek-official', 'deepseek-reasoner')

  fireEvent.change(select, { target: { value: '' } })
  expect(f.actions.saveTreatmentModel).toHaveBeenLastCalledWith('', '')
})

it('shows one card per saved note with its treatment and actions', () => {
  const f = faces(stateFixture({ view: 'reader', annotations: [note] }))
  const view = renderNotes(f, 0)
  expect(view.getByText('was th')).toBeTruthy()
  expect(view.getByText('曾是')).toBeTruthy()
  expect(view.getByText('test-model')).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: zh.regenerate }))
  expect(f.actions.retryAnnotation).toHaveBeenCalledWith('a1')
  fireEvent.click(view.getByRole('button', { name: zh.copy }))
  expect(f.actions.copyText).toHaveBeenCalledWith('曾是')
  fireEvent.click(view.getByRole('button', { name: zh.saveNote }))
  expect(f.actions.captureAnnotationNote).toHaveBeenCalledWith('a1')
  expect(view.getByRole('button', { name: zh.noted })).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: zh.delete }))
  expect(f.actions.deleteAnnotation).toHaveBeenCalledWith('a1')
})

it('marks an in-flight treatment with the streaming hint and no locate actions', () => {
  const f = faces(stateFixture({
    view: 'reader',
    streams: { 'live-1': { kind: 'explain', startedAt: 9, text: '', model: '', error: null, saving: false } },
  }))
  const view = renderNotes(f, 0)
  expect(view.getByText(zh.streaming)).toBeTruthy()
  expect(view.queryByRole('button', { name: zh.locate })).toBeNull()
  expect(view.queryByRole('button', { name: zh.delete })).toBeNull()
})

it('renders the sanitized chapter body and drops scripts the Host sanitizer already removed', () => {
  const f = faces(stateFixture({ view: 'reader' }))
  const view = renderReader(f)
  const chapter = view.container.querySelector('[data-epub-chapter]')!
  expect(chapter.querySelector('script')).toBeNull()
  expect(chapter.textContent).toContain('It was best of times.')
  fireEvent.click(view.getByRole('button', { name: zh.nextChapter }))
  expect(f.actions.stepChapter).toHaveBeenCalledWith(1)
})

it('toggles the paper tint and persists the choice', () => {
  const f = faces(stateFixture({ view: 'reader' }))
  const view = renderReader(f)
  const reading = view.container.querySelector('[data-epub-reading]')!
  const toggle = view.getByRole('button', { name: zh.paper })
  expect(reading.getAttribute('data-paper')).toBe('on')
  expect(toggle.getAttribute('aria-pressed')).toBe('true')

  fireEvent.click(toggle)
  expect(reading.getAttribute('data-paper')).toBe('off')
  expect(toggle.getAttribute('aria-pressed')).toBe('false')
  expect(localStorage.getItem('epub-reader:paper')).toBe('off')

  fireEvent.click(toggle)
  expect(reading.getAttribute('data-paper')).toBe('on')
  expect(localStorage.getItem('epub-reader:paper')).toBe('on')
})

it('restores a persisted off preference on mount', () => {
  localStorage.setItem('epub-reader:paper', 'off')
  const f = faces(stateFixture({ view: 'reader' }))
  const view = renderReader(f)
  expect(view.container.querySelector('[data-epub-reading]')!.getAttribute('data-paper')).toBe('off')
})

it('toggles the sans typeface and persists the choice', () => {
  const f = faces(stateFixture({ view: 'reader' }))
  const view = renderReader(f)
  const reading = view.container.querySelector('[data-epub-reading]')!
  const toggle = view.getByRole('button', { name: zh.font })
  expect(reading.getAttribute('data-font')).toBe('sans')
  expect(toggle.getAttribute('aria-pressed')).toBe('true')

  fireEvent.click(toggle)
  expect(reading.getAttribute('data-font')).toBe('serif')
  expect(toggle.getAttribute('aria-pressed')).toBe('false')
  expect(localStorage.getItem('epub-reader:font')).toBe('serif')

  fireEvent.click(toggle)
  expect(reading.getAttribute('data-font')).toBe('sans')
  expect(localStorage.getItem('epub-reader:font')).toBe('sans')
})

it('restores a persisted serif typeface on mount', () => {
  localStorage.setItem('epub-reader:font', 'serif')
  const f = faces(stateFixture({ view: 'reader' }))
  const view = renderReader(f)
  expect(view.container.querySelector('[data-epub-reading]')!.getAttribute('data-font')).toBe('serif')
})

it('flips pages through the edge arrows, crossing chapters at the ends', () => {
  const f = faces(stateFixture({ view: 'reader' }))
  const view = renderReader(f)
  fireEvent.click(view.getByRole('button', { name: zh.nextPage }))
  expect(f.actions.stepChapter).toHaveBeenLastCalledWith(1, 0)
  fireEvent.click(view.getByRole('button', { name: zh.previousPage }))
  expect(f.actions.stepChapter).toHaveBeenLastCalledWith(-1, 1)
})

it('flips pages from the arrow keys on the focused reading pane', () => {
  const f = faces(stateFixture({ view: 'reader' }))
  const view = renderReader(f)
  const pane = view.container.querySelector('[data-epub-reading]')!
  fireEvent.keyDown(pane, { key: 'ArrowRight' })
  expect(f.actions.stepChapter).toHaveBeenLastCalledWith(1, 0)
  fireEvent.keyDown(pane, { key: 'ArrowLeft' })
  expect(f.actions.stepChapter).toHaveBeenLastCalledWith(-1, 1)
  fireEvent.keyDown(pane, { key: 'ArrowRight', ctrlKey: true })
  expect(f.actions.stepChapter).toHaveBeenCalledTimes(2)
})

it('claims the right-click in the reading pane even without a capturable selection', () => {
  const f = faces(stateFixture({ view: 'reader' }))
  const view = renderReader(f)
  const pane = view.container.querySelector('[data-epub-reading]')!
  const event = createEvent.contextMenu(pane)
  fireEvent(pane, event)
  expect(event.defaultPrevented).toBe(true)
  expect(f.actions.openMenu).not.toHaveBeenCalled()
})

it('claims the right-click over a selection that crosses outside the chapter body', () => {
  const f = faces(stateFixture({ view: 'reader' }))
  const view = renderReader(f)
  const pane = view.container.querySelector('[data-epub-reading]')!
  const title = view.container.querySelector('h1')!.firstChild as Text
  const prose = view.container.querySelector('[data-epub-chapter] p')!.firstChild as Text
  const selection = document.getSelection()!
  const range = document.createRange()
  range.setStart(title, 0)
  range.setEnd(prose, 2)
  selection.removeAllRanges()
  selection.addRange(range)
  const event = createEvent.contextMenu(pane)
  fireEvent(pane, event)
  expect(event.defaultPrevented).toBe(true)
  expect(f.actions.openMenu).not.toHaveBeenCalled()
  selection.removeAllRanges()
})

it('opens the treatment menu on right-click over a selection inside the chapter body', () => {
  const f = faces(stateFixture({ view: 'reader' }))
  const view = renderReader(f)
  const pane = view.container.querySelector('[data-epub-reading]')!
  const prose = view.container.querySelector('[data-epub-chapter] p')!.firstChild as Text
  const selection = document.getSelection()!
  const range = document.createRange()
  range.setStart(prose, 0)
  range.setEnd(prose, 7)
  selection.removeAllRanges()
  selection.addRange(range)
  fireEvent.contextMenu(pane, { clientX: 10, clientY: 12 })
  expect(f.actions.openMenu).toHaveBeenCalledOnce()
  expect(f.actions.openMenu.mock.calls[0]![0]).toEqual({
    kind: 'epubSelection',
    value: { bookId: 'b1', chapterIndex: 0, start: 0, end: 7, text: 'It was ', context: 'It was best of times.' },
  })
  expect(f.actions.openMenu.mock.calls[0]![1]).toEqual({ x: 10, y: 12 })
  selection.removeAllRanges()
})

it('claims the context-menu key even without a capturable selection', () => {
  const f = faces(stateFixture({ view: 'reader' }))
  const view = renderReader(f)
  const pane = view.container.querySelector('[data-epub-reading]')!
  const event = createEvent.keyDown(pane, { key: 'ContextMenu' })
  fireEvent(pane, event)
  expect(event.defaultPrevented).toBe(true)
  expect(f.actions.openMenu).not.toHaveBeenCalled()
})
