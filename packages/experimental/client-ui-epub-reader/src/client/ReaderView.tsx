/** The reading view: chapter body, chapter navigation, and the notes column. */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import DOMPurify from 'dompurify'
import { IconChevronLeftOutlineRegular, IconChevronRightOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { EpubReaderInjected, EpubSelectionValue } from './contract.ts'
import {
  readPaperPreference, readSansFontPreference, readZoomPreference, writePaperPreference, writeSansFontPreference,
  writeZoomPreference, ZOOM_STEPS,
} from './preference.ts'
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
  copyText, captureAnnotationNote, openMenu, t,
}: ReaderProps) {
  const open = useReader(state => state.open)
  const annotations = useReader(state => state.annotations)
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const text = useRef<TextMap>(EMPTY_MAP)
  const [ratio, setRatio] = useState(0)
  const [paper, setPaper] = useState(readPaperPreference)
  const [sansFont, setSansFont] = useState(readSansFontPreference)
  const [zoom, setZoom] = useState(readZoomPreference)

  /** Toggle the paper reading tint and persist the choice. */
  const togglePaper = (): void => {
    setPaper((current) => {
      writePaperPreference(!current)
      return !current
    })
  }

  /** Toggle the reading typeface (PingFang-led sans ↔ serif) and persist the choice. */
  const toggleFont = (): void => {
    setSansFont((current) => {
      writeSansFontPreference(!current)
      return !current
    })
  }

  /** Step the zoom one stop along its ladder and persist the stop. */
  const stepZoom = (direction: 1 | -1): void => {
    setZoom((current) => {
      const index = Math.min(Math.max(ZOOM_STEPS.indexOf(current) + direction, 0), ZOOM_STEPS.length - 1)
      const next = ZOOM_STEPS[index] ?? 1
      writeZoomPreference(next)
      return next
    })
  }

  /** Reset the zoom to the default stop and persist it. */
  const resetZoom = (): void => {
    setZoom(1)
    writeZoomPreference(1)
  }

  /** The zoom factor as a custom property the prose type and its em-based spacing scale by. */
  const zoomStyle = { '--epub-zoom': String(zoom) } as CSSProperties

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

  /**
   * Flip one page: a viewport-height step within the chapter, crossing into
   * the adjacent chapter at the ends. Going back lands at the previous
   * chapter's end, the way a bound book turns.
   */
  const flip = (direction: 1 | -1): void => {
    const pane = scroller.current
    if (pane === null) return
    const extent = pane.scrollHeight - pane.clientHeight
    if (extent <= 0
      || (direction === 1 && pane.scrollTop >= extent - 1)
      || (direction === -1 && pane.scrollTop <= 1)) {
      stepChapter(direction, direction === -1 ? 1 : 0)
      return
    }
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    pane.scrollBy({ top: direction * pane.clientHeight, behavior: reduced ? 'auto' : 'smooth' })
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
      <button type="button" className={css.paperButton} aria-pressed={paper} onClick={togglePaper}>{t('paper')}</button>
      <button type="button" className={css.fontButton} aria-pressed={sansFont} onClick={toggleFont}>{t('font')}</button>
      <button
        type="button" className={css.zoomStepButton} disabled={zoom === ZOOM_STEPS[0]}
        aria-label={t('zoomOut')} onClick={() => { stepZoom(-1) }}
      >−</button>
      <button
        type="button" className={css.zoomResetButton} title={t('zoomReset')} onClick={resetZoom}
      >{Math.round(zoom * 100)}%</button>
      <button
        type="button" className={css.zoomStepButton} disabled={zoom === ZOOM_STEPS[ZOOM_STEPS.length - 1]}
        aria-label={t('zoomIn')} onClick={() => { stepZoom(1) }}
      >+</button>
    </header>
    <div className={css.columns}>
      <div className={css.readingWrap}>
        <div
          ref={scroller} className={css.reading} style={zoomStyle} tabIndex={0} data-epub-reading data-paper={paper ? 'on' : 'off'} data-font={sansFont ? 'sans' : 'serif'}
          onScroll={(event) => {
            const pane = event.currentTarget
            const extent = pane.scrollHeight - pane.clientHeight
            const next = extent > 0 ? pane.scrollTop / extent : 0
            setRatio(next)
            noteScroll(next)
          }}
          onContextMenu={(event) => {
            // The reading pane always owns the right-click: the browser menu never opens here.
            event.preventDefault()
            const target = capture()
            if (target === undefined) return
            openMenu({ kind: 'epubSelection', value: target }, { x: event.clientX, y: event.clientY })
          }}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && !event.altKey) {
              // Ctrl/⌘ + −/0 zoom the prose itself instead of the whole page.
              if (event.key === '+' || event.key === '=') { event.preventDefault(); stepZoom(1); return }
              if (event.key === '-') { event.preventDefault(); stepZoom(-1); return }
              if (event.key === '0') { event.preventDefault(); resetZoom(); return }
            }
            if (event.defaultPrevented || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return
            if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); flip(1); return }
            if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); flip(-1); return }
            if (!(event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))) return
            event.preventDefault()
            const target = capture()
            if (target === undefined) return
            const rect = event.currentTarget.getBoundingClientRect()
            openMenu({ kind: 'epubSelection', value: target }, { x: rect.left, y: rect.bottom })
          }}
        >
          {open.loading ? <p className={css.hint}>{t('chapterLoading')}</p> : null}
          {open.error !== null ? <p className={css.hint}>{t('chapterFailed', { message: open.error })}</p> : null}
          <h1 className={css.chapterTitle}>{open.chapterTitle}</h1>
          <div ref={content} className={css.chapter} data-epub-chapter dangerouslySetInnerHTML={{ __html: sanitized }} />
        </div>
        <button
          type="button" className={`${css.pageArrow} ${css.pageArrowLeft}`}
          aria-label={t('previousPage')} aria-disabled={open.chapterIndex === 0 && open.loading}
          onClick={() => { flip(-1) }}
        >
          <IconChevronLeftOutlineRegular size={18} />
        </button>
        <button
          type="button" className={`${css.pageArrow} ${css.pageArrowRight}`}
          aria-label={t('nextPage')} aria-disabled={open.chapterIndex + 1 >= open.chapterCount && open.loading}
          onClick={() => { flip(1) }}
        >
          <IconChevronRightOutlineRegular size={18} />
        </button>
      </div>
      <NotesColumn
        useReader={useReader} chapterIndex={open.chapterIndex} locate={locate}
        retryAnnotation={retryAnnotation} deleteAnnotation={deleteAnnotation} copyText={copyText}
        captureAnnotationNote={captureAnnotationNote} t={t}
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
