/** Browser entry for the Reading panel: bookshelf, chapter reader, and selection treatments. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ContextMenuTarget, ContextMenuTargetMap, MenuContribution, MenuPoint } from '@deepseek-ai/dsh-client-ui-context-menu/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-remote-access/client'
import type {} from '@deepseek-ai/dsh-epub-reader/remote'
import epubReaderRemote from '@deepseek-ai/dsh-epub-reader/remote'
import type { ExplainKind } from '@deepseek-ai/dsh-epub-reader/types'
import type {} from './contract.ts'
import type { EpubReaderInjected, EpubSelectionValue } from './contract.ts'
import { ReaderController } from './controller.ts'
import { PanelIcon } from './PanelIcon.tsx'
import { ReaderPanel } from './ReaderPanel.tsx'
import { en, NS, zh, type EpubReaderKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Reading panel copy. */
    'epub.reader': EpubReaderKey
  }
}

/** The id shared by the sidebar entry and the main panel it opens. */
export const PANEL_ID = 'epubReader' as MainPanelId

/** Services the entry itself needs; the panel scope adds the mounted Remote namespace. */
export const inject = ['remote', 'slots', 'locale']

/**
 * Activate the Reading panel: mount the experimental `epubReader` Remote
 * namespace, then register the sidebar entry, the main panel, and the
 * selection treatments while the current Peer may read the library.
 * @param ctx - Client Context carrying the declared `inject` services.
 * @returns disposer joining the Remote withdrawal and the UI effects.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'client-ui-epub-reader: dictionaries')
  const t = ctx.locale.bind(NS)
  const disposeRemote = await ctx.remote.$mount(epubReaderRemote)
  const ui = ctx.inject(['remote.epubReader', 'slots', 'locale', 'contextMenus', 'remoteAccess'], (scope: ClientContext) => {
    const controller = new ReaderController(scope)
    scope.effect(() => () => { controller.dispose() }, 'client-ui-epub-reader: controller')
    scope.remoteAccess.whenAccess('epubReader/list', function* () {
      void controller.loadLibrary()
      const selectionMenu: MenuContribution<'epubSelection'> = {
        id: 'epub-reader.treat',
        target: 'epubSelection',
        order: 0,
        resolve: (selection: ContextMenuTargetMap['epubSelection']) => [
          {
            id: 'translate', label: t('translate'),
            run: () => { controller.treat(selection, 'translate') },
          },
          {
            id: 'explain', label: t('explain'),
            run: () => { controller.treat(selection, 'explain') },
          },
          {
            id: 'note', label: t('sendToNotes'),
            run: () => { controller.captureSelectionNote(selection) },
          },
        ],
      }
      yield scope.effect(() => scope.contextMenus.register(selectionMenu), 'client-ui-epub-reader: selection menu')
      yield scope.slots.inject('main', () => scope.slots.register({
        name: 'main',
        key: PANEL_ID,
        locale: NS,
        inject: (): EpubReaderInjected => ({
          hooks: { reader: controller.store },
          importFiles: (files: readonly File[]) => { controller.importFiles(files) },
          removeBook: (bookId: string) => { controller.removeBook(bookId) },
          openBook: (bookId: string) => { controller.openBook(bookId) },
          closeBook: () => { controller.closeBook() },
          selectChapter: (chapterIndex: number, restoreRatio?: number) => { controller.selectChapter(chapterIndex, restoreRatio) },
          stepChapter: (delta: number, restoreRatio?: number) => { controller.stepChapter(delta, restoreRatio) },
          noteScroll: (ratio: number) => { controller.noteScroll(ratio) },
          treat: (selection: EpubSelectionValue, kind: ExplainKind) => { controller.treat(selection, kind) },
          retryAnnotation: (id: string) => { controller.retryAnnotation(id) },
          deleteAnnotation: (id: string) => { controller.deleteAnnotation(id) },
          captureSelectionNote: (selection: EpubSelectionValue) => { controller.captureSelectionNote(selection) },
          captureAnnotationNote: (id: string) => { controller.captureAnnotationNote(id) },
          openStorageSettings: () => { controller.openStorageSettings() },
          closeStorageSettings: () => { controller.closeStorageSettings() },
          saveStorageSettings: (directory: string) => { controller.saveStorageSettings(directory) },
          saveTreatmentModel: (provider: string, model: string) => { controller.saveTreatmentModel(provider, model) },
          openMenu: (target: ContextMenuTarget, point: MenuPoint): void => { scope.contextMenus.open(target, point) },
          copyText: (text: string): void => {
            try { void navigator.clipboard.writeText(text) } catch { /* the browser denied clipboard access */ }
          },
        }),
      }, ReaderPanel))
      yield scope.slots.inject('sidebar.panellist', () => scope.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 30,
        locale: NS,
        label: () => t('panel'),
      }, PanelIcon))
    })
  })
  try { await ui } catch (error) { await ui.dispose(); await disposeRemote(); throw error }
  return async () => { await ui.dispose(); await disposeRemote() }
}
