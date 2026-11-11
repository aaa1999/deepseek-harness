/** Browser entry for the PDF panel: bookshelf, single-page reader, and annotations. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ContextMenuTarget, ContextMenuTargetMap, MenuContribution, MenuPoint } from '@deepseek-ai/dsh-client-ui-context-menu/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-remote-access/client'
import type {} from '@deepseek-ai/dsh-pdf-reader/remote'
import pdfReaderRemote from '@deepseek-ai/dsh-pdf-reader/remote'
import type { ExplainKind, HighlightColor } from '@deepseek-ai/dsh-pdf-reader/types'
import type {} from './contract.ts'
import type { PdfReaderInjected, PdfSelectionValue, ShotAsk } from './contract.ts'
import { ReaderController } from './controller.ts'
import { PanelIcon } from './PanelIcon.tsx'
import { ReaderPanel } from './ReaderPanel.tsx'
import { en, NS, zh, type PdfReaderKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** PDF reader panel copy. */
    'pdf.reader': PdfReaderKey
  }
}

/** The id shared by the sidebar entry and the main panel it opens. */
export const PANEL_ID = 'pdfReader' as MainPanelId

/**
 * The window CustomEvent a sibling plugin dispatches to land one shelf row in
 * the reader: `detail` carries `{ bookId }`. The web-capture relay uses it to
 * open a freshly captured snapshot without reaching into this package.
 */
export const OPEN_BOOK_EVENT = 'dsh-pdf-reader:open'

/** Services the entry itself needs; the panel scope adds the mounted Remote namespace. */
export const inject = ['remote', 'slots', 'locale']

/**
 * Activate the PDF panel: mount the experimental `pdfReader` Remote
 * namespace, then register the sidebar entry, the main panel, and the
 * selection treatments while the current Peer may read the library.
 * @param ctx - Client Context carrying the declared `inject` services.
 * @returns disposer joining the Remote withdrawal and the UI effects.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'client-ui-pdf-reader: dictionaries')
  const t = ctx.locale.bind(NS)
  const disposeRemote = await ctx.remote.$mount(pdfReaderRemote)
  const ui = ctx.inject(['remote.pdfReader', 'slots', 'locale', 'contextMenus', 'remoteAccess'], (scope: ClientContext) => {
    const controller = new ReaderController(scope)
    scope.effect(() => () => { controller.dispose() }, 'client-ui-pdf-reader: controller')
    // The web-capture relay's success path: switch here already happened through
    // ctx.layout; this event lands the shelf's newest row straight in the reader.
    const onOpenRequest = (event: Event): void => {
      const bookId = (event as CustomEvent<{ bookId?: unknown }>).detail.bookId
      if (typeof bookId === 'string' && bookId !== '') controller.openBook(bookId)
    }
    window.addEventListener(OPEN_BOOK_EVENT, onOpenRequest)
    scope.effect(() => () => { window.removeEventListener(OPEN_BOOK_EVENT, onOpenRequest) }, 'client-ui-pdf-reader: open-request listener')
    scope.remoteAccess.whenAccess('pdfReader/list', function* () {
      void controller.loadLibrary()
      const selectionMenu: MenuContribution<'pdfSelection'> = {
        id: 'pdf-reader.treat',
        target: 'pdfSelection',
        order: 0,
        resolve: (selection: ContextMenuTargetMap['pdfSelection']) => [
          {
            id: 'highlight', label: t('highlight'),
            run: () => { controller.annotate(selection) },
          },
          {
            id: 'translate', label: t('translate'),
            run: () => { controller.treat(selection, 'translate' satisfies ExplainKind) },
          },
          {
            id: 'explain', label: t('explain'),
            run: () => { controller.treat(selection, 'explain' satisfies ExplainKind) },
          },
        ],
      }
      yield scope.effect(() => scope.contextMenus.register(selectionMenu), 'client-ui-pdf-reader: selection menu')
      yield scope.slots.inject('main', () => scope.slots.register({
        name: 'main',
        key: PANEL_ID,
        locale: NS,
        inject: (): PdfReaderInjected => ({
          hooks: { reader: controller.store },
          documents: {
            readBytes: (bookId: string) => controller.readBytes(bookId),
            reportMeta: (bookId: string, report) => { void controller.reportMeta(bookId, report) },
            saveCover: (bookId: string, pngBase64: string) => { void controller.saveCover(bookId, pngBase64) },
            loadAnnotations: () => { void controller.loadAnnotations() },
          },
          importFiles: (files: readonly File[]) => { controller.importFiles(files) },
          removeBook: (bookId: string) => { controller.removeBook(bookId) },
          openBook: (bookId: string) => { controller.openBook(bookId) },
          closeBook: () => { controller.closeBook() },
          selectPage: (page: number) => { controller.selectPage(page) },
          stepPage: (delta: number) => { controller.stepPage(delta) },
          setZoom: (zoom: number) => { controller.setZoom(zoom) },
          setReadingMode: (mode: 'scroll' | 'flip') => { controller.setReadingMode(mode) },
          setPenColor: (color: HighlightColor) => { controller.setPenColor(color) },
          treat: (selection: PdfSelectionValue, kind: ExplainKind) => { controller.treat(selection, kind) },
          annotate: (selection: PdfSelectionValue) => { controller.annotate(selection) },
          setAnnotationColor: (id: string, color: HighlightColor) => { controller.setAnnotationColor(id, color) },
          askShot: (ask: ShotAsk) => { controller.askShot(ask) },
          loadShotCatalog: () => { void controller.loadShotCatalog() },
          retryTextAnnotation: (id: string) => { controller.retryTextAnnotation(id) },
          retryShotAnnotation: (id: string, fresh: { pngBase64: string; question: string }) => {
            const state = controller.store.getSnapshot()
            const shot = state.annotations.find(row => row.kind === 'shot' && row.id === id)
            if (shot !== undefined && shot.kind === 'shot') controller.retryShotAnnotation(id, fresh, shot.page, shot.rect)
          },
          deleteAnnotation: (id: string) => { controller.deleteAnnotation(id) },
          openStorageSettings: () => { controller.openStorageSettings() },
          closeStorageSettings: () => { controller.closeStorageSettings() },
          saveStorageSettings: (directory: string) => { controller.saveStorageSettings(directory) },
          saveTreatmentModel: (provider: string, model: string) => { controller.saveTreatmentModel(provider, model) },
          saveShotModel: (provider: string, model: string) => { controller.saveShotModel(provider, model) },
          openMenu: (target: ContextMenuTarget, point: MenuPoint): void => { scope.contextMenus.open(target, point) },
          copyText: (text: string): void => {
            try { void navigator.clipboard.writeText(text) } catch { /* the browser denied clipboard access */ }
          },
        }),
      }, ReaderPanel))
      yield scope.slots.inject('sidebar.panellist', () => scope.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 31,
        locale: NS,
        label: () => t('panel'),
      }, PanelIcon))
    })
  })
  try { await ui } catch (error) { await ui.dispose(); await disposeRemote(); throw error }
  return async () => { await ui.dispose(); await disposeRemote() }
}
