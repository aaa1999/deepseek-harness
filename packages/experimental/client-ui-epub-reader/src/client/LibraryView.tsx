/** The bookshelf view: import, shelf grid, and per-book continue and remove. */
import { useRef, useState } from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { BookRow } from '@deepseek-ai/dsh-experimental-epub-reader/types'
import type { EpubReaderInjected } from './contract.ts'
import { NS } from './locales.ts'
import css from './reader.module.css'

/** Faces the bookshelf renders with. */
export type LibraryProps = PropsLocale<typeof NS>
  & InjectFace<Pick<EpubReaderInjected, 'hooks' | 'importFiles' | 'removeBook' | 'openBook'>>

/** Percent of the saved chapter position, rounded for the shelf row. */
function percentOf(book: BookRow): number {
  return Math.round(Math.min(1, Math.max(0, book.progress.ratio)) * 100)
}

/**
 * The shelf: an import target that accepts clicks and drops, then a grid of
 * cover cards carrying each book's progress.
 * @param props - locale face, the state hook, and import, removal, and open callbacks.
 * @returns the bookshelf view.
 */
export function LibraryView({ useReader, importFiles, removeBook, openBook, t }: LibraryProps) {
  const input = useRef<HTMLInputElement>(null)
  const [confirming, setConfirming] = useState('')
  const [dropping, setDropping] = useState(false)
  const library = useReader(state => state.library)
  const books = useReader(state => state.books)
  const importing = useReader(state => state.importing)
  const importError = useReader(state => state.importError)
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
        ref={input} type="file" accept=".epub,application/epub+zip" multiple hidden
        onChange={(event) => {
          importFiles(Array.from(event.target.files ?? []))
          event.target.value = ''
        }}
      />
    </header>
    {library.status === 'loading' ? <p className={css.hint}>{t('loading')}</p> : null}
    {importError !== '' ? <p className={css.hint}>{t('loadFailed', { message: importError })}</p> : null}
    {library.status === 'failed' ? <p className={css.hint}>{t('loadFailed', { message: library.error })}</p> : null}
    {library.status === 'ready' && books.length === 0 ? <p className={css.hint}>{t('empty')}</p> : null}
    <ul className={dropping ? `${css.shelf} ${css.shelfDropping}` : css.shelf}>
      {books.map(book => <li key={book.bookId} className={css.bookCard}>
        <button type="button" className={css.bookOpen} onClick={() => { setConfirming(''); openBook(book.bookId) }}>
          {book.coverUrl === null
            ? <span className={css.coverFallback} aria-hidden="true">{book.title.slice(0, 1)}</span>
            : <img className={css.cover} src={book.coverUrl} alt="" loading="lazy" />}
          <span className={css.bookTitle}>{book.title}</span>
          <span className={css.bookMeta}>
            {book.author === '' ? t('unknownAuthor') : book.author} · {t('chapters', { count: book.chapterCount })}
          </span>
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
  </div>
}
