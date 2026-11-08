/** The bookshelf view: import, shelf grid, per-book continue and remove, and settings. */
import { useEffect, useRef, useState } from 'react'
import { FileTypeIcon } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { BookRow } from '@deepseek-ai/dsh-pdf-reader/types'
import type { PdfReaderInjected } from './contract.ts'
import { NS } from './locales.ts'
import css from './reader.module.css'

/** Faces the bookshelf renders with. */
export type LibraryProps = PropsLocale<typeof NS>
  & InjectFace<Pick<PdfReaderInjected,
    'hooks' | 'importFiles' | 'removeBook' | 'openBook' | 'setReadingMode'
    | 'openStorageSettings' | 'closeStorageSettings' | 'saveStorageSettings' | 'saveTreatmentModel' | 'saveShotModel'>>

/** Percent of the saved page position, rounded for the shelf row. */
function percentOf(book: BookRow): number {
  if (book.pageCount <= 1) return book.progress.page >= book.pageCount && book.pageCount > 0 ? 100 : 0
  return Math.round(Math.min(1, Math.max(0, (book.progress.page - 1) / (book.pageCount - 1))) * 100)
}

/**
 * The shelf: an import target that accepts clicks and drops, then a grid of
 * document cards carrying each book's progress. The settings button swaps the
 * grid for the storage-directory and model panel.
 * @param props - locale face, the state hook, and import, removal, open, and settings callbacks.
 * @returns the bookshelf view.
 */
export function LibraryView({
  useReader, importFiles, removeBook, openBook, setReadingMode, openStorageSettings, closeStorageSettings,
  saveStorageSettings, saveTreatmentModel, saveShotModel, t,
}: LibraryProps) {
  const input = useRef<HTMLInputElement>(null)
  const [confirming, setConfirming] = useState('')
  const [dropping, setDropping] = useState(false)
  const library = useReader(state => state.library)
  const books = useReader(state => state.books)
  const importing = useReader(state => state.importing)
  const importError = useReader(state => state.importError)
  const storage = useReader(state => state.storage)
  const mode = useReader(state => state.mode)
  const [directory, setDirectory] = useState('')
  const [modelChoice, setModelChoice] = useState('')
  const [shotChoice, setShotChoice] = useState('')

  // The inputs follow the Host-resolved values whenever the panel opens or the catalog refreshes.
  useEffect(() => {
    if (storage.open) setDirectory(storage.directory)
  }, [storage.open, storage.directory])
  useEffect(() => {
    setModelChoice(storage.modelProvider === '' ? '' : `${storage.modelProvider}::${storage.modelId}`)
  }, [storage.modelProvider, storage.modelId])
  useEffect(() => {
    setShotChoice(storage.shotProvider === '' ? '' : `${storage.shotProvider}::${storage.shotModel}`)
  }, [storage.shotProvider, storage.shotModel])

  /** Split one `provider::model` picker value back into its pair. */
  const splitChoice = (choice: string): [string, string] => {
    const separator = choice.indexOf('::')
    return [choice.slice(0, separator), choice.slice(separator + 2)]
  }

  return <div
    className={css.library}
    onDragOver={(event) => { event.preventDefault(); setDropping(true) }}
    onDragLeave={() => { setDropping(false) }}
    onDrop={(event) => {
      event.preventDefault()
      setDropping(false)
      importFiles(Array.from(event.dataTransfer.files))
    }}
  >
    <header className={css.libraryBar}>
      <button
        type="button" className={css.importButton} disabled={importing}
        onClick={() => { input.current?.click() }}
      >
        {importing ? t('importing') : t('import')}
      </button>
      <input
        ref={input} type="file" accept=".pdf,application/pdf" multiple hidden
        onChange={(event) => {
          importFiles(Array.from(event.target.files ?? []))
          event.target.value = ''
        }}
      />
      <span className={css.libraryBarSpace} />
      <button type="button" className={css.settingsButton} onClick={() => { openStorageSettings() }}>{t('settings')}</button>
    </header>
    {storage.open
      ? <div className={css.storageSettings}>
        <span className={css.storageLabel}>{t('readingMode')}</span>
        <div className={css.modeActions} role="group" aria-label={t('readingMode')}>
          <button type="button" aria-pressed={mode === 'scroll'} onClick={() => { setReadingMode('scroll') }}>{t('modeScroll')}</button>
          <button type="button" aria-pressed={mode === 'flip'} onClick={() => { setReadingMode('flip') }}>{t('modeFlip')}</button>
        </div>
        <label className={css.storageLabel} htmlFor="pdf-storage-directory">{t('storageDirectory')}</label>
        <input
          id="pdf-storage-directory" className={css.storageInput} value={directory}
          placeholder={t('storageHint')} spellCheck={false}
          onChange={(event) => { setDirectory(event.target.value) }}
        />
        <label className={css.storageLabel} htmlFor="pdf-treatment-model">{t('treatmentModel')}</label>
        <select
          id="pdf-treatment-model" className={css.storageInput} value={modelChoice}
          disabled={storage.busy}
          onChange={(event) => {
            const choice = event.target.value
            setModelChoice(choice)
            const [provider, model] = splitChoice(choice)
            saveTreatmentModel(provider, model)
          }}
        >
          <option value="">{storage.defaultModel === ''
            ? t('followDefault')
            : t('followDefaultWith', { selection: `${storage.defaultProvider} · ${storage.defaultModel}` })}</option>
          {storage.models.map(entry =>
            <option key={`${entry.provider}::${entry.model}`} value={`${entry.provider}::${entry.model}`}>
              {`${entry.provider} · ${entry.name}`}
            </option>)}
        </select>
        <label className={css.storageLabel} htmlFor="pdf-shot-model">{t('shotModel')}</label>
        <select
          id="pdf-shot-model" className={css.storageInput} value={shotChoice}
          disabled={storage.busy}
          onChange={(event) => {
            const choice = event.target.value
            setShotChoice(choice)
            const [provider, model] = splitChoice(choice)
            saveShotModel(provider, model)
          }}
        >
          <option value="">{storage.defaultModel === ''
            ? t('followDefault')
            : t('followDefaultWith', { selection: `${storage.defaultProvider} · ${storage.defaultModel}` })}</option>
          {storage.models.filter(entry => entry.vision).map(entry =>
            <option key={`${entry.provider}::${entry.model}`} value={`${entry.provider}::${entry.model}`}>
              {`${entry.provider} · ${entry.name}`}
            </option>)}
        </select>
        {storage.configurable ? null : <p className={css.hint}>{t('storageUnavailable')}</p>}
        {storage.error !== '' ? <p className={css.hint}>{t('loadFailed', { message: storage.error })}</p> : null}
        {storage.saved ? <p className={css.hint}>{t('storageSaved')}</p> : null}
        <div className={css.storageActions}>
          <button
            type="button" className={css.importButton} disabled={storage.busy}
            onClick={() => { saveStorageSettings(directory) }}
          >
            {storage.busy ? t('saving') : t('saveStorage')}
          </button>
          <button type="button" onClick={() => { closeStorageSettings() }}>{t('backToLibrary')}</button>
        </div>
      </div>
      : <>
        {library.status === 'loading' ? <p className={css.hint}>{t('loading')}</p> : null}
        {importError !== '' ? <p className={css.hint}>{t('loadFailed', { message: importError })}</p> : null}
        {library.status === 'failed' ? <p className={css.hint}>{t('loadFailed', { message: library.error })}</p> : null}
        {library.status === 'ready' && books.length === 0 ? <p className={css.hint}>{t('empty')}</p> : null}
        <ul className={dropping ? `${css.shelf} ${css.shelfDropping}` : css.shelf}>
          {books.map(book => <li key={book.bookId} className={css.bookCard}>
            <button type="button" className={css.bookOpen} onClick={() => { setConfirming(''); openBook(book.bookId) }}>
              {book.coverUrl === null
                ? <span className={css.coverFallback} aria-hidden="true"><FileTypeIcon kind="pdf" size={30} /></span>
                : <img className={css.cover} src={book.coverUrl} alt="" loading="lazy" />}
              <span className={css.bookTitle}>{book.title}</span>
              <span className={css.bookMeta}>
                {book.pageCount > 0 ? t('pages', { count: book.pageCount }) : 'PDF'}
              </span>
              {book.source != null
                ? <span className={css.bookSource} title={book.source.url}>
                  {t('sourceLine', { date: new Date(book.source.capturedAt).toLocaleDateString() })}
                </span>
                : null}
              <span className={css.bookProgress}>{t('progressPercent', { percent: percentOf(book) })}</span>
            </button>
            {confirming === book.bookId
              ? <div className={css.bookActions}>
                <button type="button" className={css.danger} onClick={() => { removeBook(book.bookId) }}>{t('remove')}</button>
                <button type="button" onClick={() => { setConfirming('') }}>{t('cancel')}</button>
              </div>
              : <div className={css.bookActions}>
                <button type="button" onClick={() => { setConfirming(book.bookId) }}>{t('remove')}</button>
              </div>}
          </li>)}
        </ul>
      </>}
  </div>
}
