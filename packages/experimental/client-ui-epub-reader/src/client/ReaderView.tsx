/** The reading view: chapter body, chapter navigation, and the notes column. */
import { useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { EpubReaderInjected, EpubSelectionValue } from './contract.ts'
import { NS } from './locales.ts'
import { applyHighlights, captureSelection, clearHighlights, mapText, rangeOf, type TextMap } from './anchor.ts'
import { NotesColumn } from './NotesColumn.tsx'
import css from './reader.module.css'

/** Faces the reading view renders with. */
export type ReaderProps = PropsLocale<typeof NS>
  & InjectFace<Omit<EpubReaderInjected, 'importFiles' | 'removeBook' | 'openBook'>>

/** An empty text map until a chapter body renders. */
const EMPTY_MAP: TextMap = { spans: [], total: 0 }

/**
 * The two-column reader: sanitized chapter prose on the left, highlight cards
 * on the right. Selections inside the chapter body open the shared context
 * menu; the reading position saves as a debounced ratio.
 * @param props - locale face, the state hook, chapter navigation, treatment, and menu faces.
 * @returns the reading view.
 */
export function ReaderView({
  useReader, closeBook, selectChapter, stepChapter, noteScroll, retryAnnotation, deleteAnnotation,
  copyText, openMenu, t,
}: ReaderProps) {
  const open = useReader(state => state.open)
  const annotations = useReader(state => state.annotations)
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const text = useRef<TextMap>(EMPTY_MAP)
  const [ratio, setRatio] = useState(0)

  const sanitized = useMemo(() => DOMPurify.sanitize(open?.html ?? ''), [open?.html])

  // A fresh chapter body: re-map offsets, drop stale highlights, restore position.
  useEffect(() => {
    if (open === null || open.html === '') return
    const body = content.current
    const pane = scroller.current
    if (body === null || pane === null) return
    text.current = mapText(body)
    if (open.restoreRatio > 0) {
      const extent = pane.scrollHeight - pane.clientHeight
      pane.scrollTop = extent > 0 ? open.restoreRatio * extent : 0
    } else {
      pane.scrollTop = 0
    }
    setRatio(0)
    return () => { clearHighlights() }
  }, [open?.html, open?.chapterIndex, open?.restoreRatio])

  // Saved highlights repaint whenever annotations arrive or change.
  useEffect(() => {
    if (open === null || open.html === '') return
    const ranges = annotations
      .filter(annotation => annotation.chapterIndex === open.chapterIndex)
      .map(annotation => rangeOf(text.current, annotation.start, annotation.end))
      .filter((range): range is Range => range !== null)
    applyHighlights(ranges)
  }, [annotations, open?.chapterIndex, open?.html])

  /** Scroll the reading column onto one annotation's range. */
  const locate = (id: string): void => {
    const annotation = annotations.find(row => row.id === id)
    if (annotation === undefined) return
    const range = rangeOf(text.current, annotation.start, annotation.end)
    range?.startContainer.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  /** The selection target of the shared context menu, or undefined outside the chapter body. */
  const capture = (): EpubSelectionValue | undefined => {
    if (open === null || content.current === null) return undefined
    const found = captureSelection(content.current, text.current)
    if (found === null) return undefined
    return { bookId: open.bookId, chapterIndex: open.chapterIndex, ...found }
  }

  if (open === null) return <div className={css.reader}><p className={css.hint}>{t('loading')}</p></div>
  return <div className={css.reader}>
    <header className={css.readerBar}>
      <button type="button" onClick={() => { closeBook() }}>{t('backToLibrary')}</button>
      <span className={css.readerTitle}>{open.title}{open.chapterTitle === '' ? '' : ` · ${open.chapterTitle}`}</span>
      <select
        className={css.chapterSelect} value={open.chapterIndex} disabled={open.toc.length === 0}
        aria-label={t('chapterOf', { current: open.chapterIndex + 1, total: open.chapterCount })}
        onChange={(event) => { selectChapter(Number(event.target.value)) }}
      >
        {open.toc.length === 0 ? <option value={open.chapterIndex}>{t('chapterOf', { current: open.chapterIndex + 1, total: open.chapterCount })}</option> : null}
        {open.toc.map(entry => <option key={`${entry.chapterIndex}-${entry.title}`} value={entry.chapterIndex}>{entry.title}</option>)}
      </select>
    </header>
    <div className={css.columns}>
      <div
        ref={scroller} className={css.reading} tabIndex={0} data-epub-reading
        onScroll={(event) => {
          const pane = event.currentTarget
          const extent = pane.scrollHeight - pane.clientHeight
          const next = extent > 0 ? pane.scrollTop / extent : 0
          setRatio(next)
          noteScroll(next)
        }}
        onContextMenu={(event) => {
          const target = capture()
          if (target === undefined) return
          event.preventDefault()
          openMenu({ kind: 'epubSelection', value: target }, { x: event.clientX, y: event.clientY })
        }}
        onKeyDown={(event) => {
          if (event.defaultPrevented || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return
          if (!(event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))) return
          const target = capture()
          if (target === undefined) return
          event.preventDefault()
          const rect = event.currentTarget.getBoundingClientRect()
          openMenu({ kind: 'epubSelection', value: target }, { x: rect.left, y: rect.bottom })
        }}
      >
        {open.loading ? <p className={css.hint}>{t('chapterLoading')}</p> : null}
        {open.error !== null ? <p className={css.hint}>{t('chapterFailed', { message: open.error })}</p> : null}
        <h1 className={css.chapterTitle}>{open.chapterTitle}</h1>
        <div ref={content} className={css.chapter} data-epub-chapter dangerouslySetInnerHTML={{ __html: sanitized }} />
      </div>
      <NotesColumn
        useReader={useReader} chapterIndex={open.chapterIndex} locate={locate}
        retryAnnotation={retryAnnotation} deleteAnnotation={deleteAnnotation} copyText={copyText} t={t}
      />
    </div>
    <footer className={css.readerFooter}>
      <button type="button" disabled={open.chapterIndex === 0 || open.loading} onClick={() => { stepChapter(-1) }}>{t('previousChapter')}</button>
      <span>{t('chapterOf', { current: open.chapterIndex + 1, total: open.chapterCount })}</span>
      <button type="button" disabled={open.chapterIndex + 1 >= open.chapterCount || open.loading} onClick={() => { stepChapter(1) }}>{t('nextChapter')}</button>
      <span>{t('progressPercent', { percent: Math.round(ratio * 100) })}</span>
    </footer>
  </div>
}
