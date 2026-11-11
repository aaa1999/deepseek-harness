/** The reading view: one rendered page, its text layer, the screenshot tool, and the notes column. */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { IconChevronLeftOutlineRegular, IconChevronRightOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PdfAnnotation } from '@deepseek-ai/dsh-pdf-reader/types'
import type { PdfDocument } from './pdf/document.ts'
import { renderPdfPage, renderThumbnail } from './pdf/document.ts'
import { openPdf, type PdfSession } from './pdf/runtime.ts'
import { outlinePages, pdfTextRenderer } from './pdf/text.ts'
import { paintHighlights, captureSelection, clearHighlights, mapText, rangeOf, type TextMap } from './anchor.ts'
import { canvasToBase64Png, cropCanvas, rectFromStroke, strokeIsMeaningful, type StrokePoint, type StrokeRect } from './shot.ts'
import { NotesColumn } from './NotesColumn.tsx'
import { COLOR_FILL, HIGHLIGHT_COLORS } from './contract.ts'
import { NS } from './locales.ts'
import type { PdfReaderInjected, PdfSelectionValue } from './contract.ts'
import css from './reader.module.css'

/** Faces the reading view renders with. */
export type ReaderProps = PropsLocale<typeof NS>
  & InjectFace<Omit<PdfReaderInjected, 'importFiles' | 'removeBook' | 'openBook'>>

/** An empty text map until a page's text layer renders. */
const EMPTY_MAP: TextMap = { spans: [], total: 0 }

/** The question the translate quick action sends. */
const TRANSLATE_SHOT_QUESTION = '翻译截图中出现的所有文字为简体中文，逐行保持原有排版'

/** A message safe to show for any thrown failure. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Whether one PDF metadata title beats the import file name. */
function usableTitle(title: unknown): string {
  if (typeof title !== 'string') return ''
  const trimmed = title.trim()
  return trimmed.length >= 2 && !/^untitled$/iu.test(trimmed) ? trimmed.slice(0, 300) : ''
}

/** The base page size at the 96/72 scale, before zoom. */
interface BaseSize { readonly width: number; readonly height: number }

/**
 * The single-page reader: the rendered page and its selectable text layer on
 * the left, annotation cards on the right. Text selections open the shared
 * context menu; the screenshot tool drags a region and asks a question.
 * @param props - locale face, state hook, navigation, treatment, and menu faces.
 * @returns the reading view.
 */
export function ReaderView({
  useReader, documents, closeBook, selectPage, stepPage, setZoom, setReadingMode, setPenColor, annotate, askShot, loadShotCatalog,
  retryTextAnnotation, retryShotAnnotation, deleteAnnotation, setAnnotationColor, copyText, openMenu, t,
}: ReaderProps) {
  const open = useReader(state => state.open)
  const annotations = useReader(state => state.annotations)
  const penColor = useReader(state => state.penColor)
  const [penPaletteOpen, setPenPaletteOpen] = useState(false)
  const shotCatalog = useReader(state => state.shotCatalog)
  const shotEffective = useReader(state => state.shotEffective)
  const mode = useReader(state => state.mode)
  const scroller = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const textHost = useRef<HTMLDivElement>(null)
  const highlightLayer = useRef<HTMLDivElement>(null)
  /** The selection captured at highlight-button mousedown, before the click collapses it. */
  const pendingHighlight = useRef<PdfSelectionValue | null>(null)
  const text = useRef<TextMap>(EMPTY_MAP)
  const textPage = useRef(0)
  const pendingRender = useRef(Promise.resolve())
  const [document$, setDocument] = useState<PdfDocument | null>(null)
  const [base, setBase] = useState<BaseSize | null>(null)
  const [renderTick, setRenderTick] = useState(0)
  const [failure, setFailure] = useState<string | null>(null)
  const [fitMode, setFitMode] = useState(true)
  const fittedFor = useRef('')
  const [shotMode, setShotMode] = useState<'idle' | 'armed' | 'dragging' | 'asking'>('idle')
  const [stroke, setStroke] = useState<{ from: StrokePoint; to: StrokePoint } | null>(null)
  const [shotRect, setShotRect] = useState<StrokeRect | null>(null)
  const [question, setQuestion] = useState('')
  const [modelChoice, setModelChoice] = useState('')
  const [pageInput, setPageInput] = useState('')
  const pointer = useRef({ x: 0, y: 0 })
  const pan = useRef<{ raf: number; dy: number } | null>(null)

  const bookId = open?.bookId ?? ''
  const page = open?.page ?? 1
  const zoom = open?.zoom ?? 1

  /** The displayed page box the stroke coordinates live in. */
  const boxSize = useCallback((): { width: number; height: number } | null => {
    const node = box.current
    if (node === null) return null
    const rect = node.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 ? { width: rect.width, height: rect.height } : null
  }, [])

  // Open the stored bytes with PDF.js; one session per book.
  useEffect(() => {
    if (open === null || !open.ready) {
      setDocument(null)
      setBase(null)
      setFailure(null)
      return
    }
    let disposed = false
    const lifetime = new AbortController()
    setDocument(null)
    setBase(null)
    setFailure(null)
    let session: PdfSession | null = null
    void documents.readBytes(open.bookId).then((bytes) => {
      if (disposed || lifetime.signal.aborted || bytes === null) return
      session = openPdf(bytes as Uint8Array<ArrayBuffer>, lifetime.signal, (error) => {
        if (!lifetime.signal.aborted) setFailure(errorText(error))
      })
      void session.document.then(
        (doc) => {
          if (disposed || lifetime.signal.aborted) return
          setDocument(doc)
          void afterDocumentOpen(doc, open.bookId, open.title, open.metaReported)
        },
        (error: unknown) => {
          if (!lifetime.signal.aborted && !disposed) setFailure(errorText(error))
        },
      )
    }, (error) => {
      if (!lifetime.signal.aborted && !disposed) setFailure(errorText(error))
    })
    const afterDocumentOpen = async (doc: PdfDocument, id: string, fallbackTitle: string, metaReported: boolean): Promise<void> => {
      if (!metaReported) {
        try {
          const metadata = await doc.getMetadata().catch(() => null) as { info?: { Title?: unknown } } | null
          void documents.reportMeta(id, {
            title: usableTitle(metadata?.info?.Title) || fallbackTitle,
            pageCount: doc.numPages,
            outline: await outlinePages(doc),
          })
        } catch { /* the first-open report is best-effort */ }
      }
      try {
        const thumbnail = await renderThumbnail(doc, 1, 360, lifetime.signal)
        const encoded = thumbnail === null ? null : await canvasToBase64Png(thumbnail)
        if (encoded !== null && !lifetime.signal.aborted) documents.saveCover(id, encoded)
      } catch { /* a missing thumbnail degrades the shelf only */ }
      if (!lifetime.signal.aborted) documents.loadAnnotations()
    }
    return () => {
      disposed = true
      lifetime.abort()
      void session?.dispose()
    }
  }, [bookId, open?.ready]) // eslint-disable-line react-hooks/exhaustive-deps

  // Render the current page; the text layer builds once per page and scales with zoom.
  useEffect(() => {
    if (document$ === null || open === null) return
    const node = canvas.current
    const host = textHost.current
    if (node === null || host === null) return
    const lifetime = new AbortController()
    setFailure(null)
    const buildText = textPage.current !== page
    let newText: ReturnType<ReturnType<typeof pdfTextRenderer>> | undefined
    if (buildText) {
      clearHighlights(highlightLayer.current)
      host.replaceChildren()
      text.current = EMPTY_MAP
    }
    pendingRender.current = pendingRender.current.then(async () => {
      lifetime.signal.throwIfAborted()
      const buffer = node.ownerDocument.createElement('canvas')
      try {
        const size = await renderPdfPage(document$, page, buffer, lifetime.signal, window.devicePixelRatio * zoom,
          buildText ? (pdfPage, viewport) => {
            newText = pdfTextRenderer(host)(pdfPage, viewport)
            return newText
          } : undefined)
        lifetime.signal.throwIfAborted()
        const context = node.getContext('2d')
        if (context === null) throw new Error('PDF canvas has no 2d context')
        node.width = buffer.width
        node.height = buffer.height
        context.drawImage(buffer, 0, 0)
        if (newText !== undefined) {
          text.current = mapText(host)
          textPage.current = page
        }
        setBase({ width: size.width, height: size.height })
        setRenderTick(tick => tick + 1)
      } finally {
        buffer.width = buffer.height = 0
        if (textPage.current !== page) newText?.cancel()
      }
    }).catch((error: unknown) => {
      if (!lifetime.signal.aborted) setFailure(errorText(error))
    })
    return () => { lifetime.abort() }
  }, [document$, page, zoom]) // eslint-disable-line react-hooks/exhaustive-deps

  // Release the text layer with the view.
  useEffect(() => () => {
    clearHighlights(highlightLayer.current)
    stopPan()
    textPage.current = 0
  }, [])

  /** Repaint saved highlights from the page's current layout; the rectangles are snapshot geometry. */
  const repaintHighlights = useCallback(() => {
    if (open === null) return
    const layer = highlightLayer.current
    if (layer === null) return
    const entries = annotations
      .filter((annotation): annotation is Extract<PdfAnnotation, { kind: 'text' }> =>
        annotation.kind === 'text' && annotation.page === open.page)
      .map(annotation => ({
        range: rangeOf(text.current, annotation.start, annotation.end),
        color: annotation.color ?? 'yellow',
      }))
      .filter((entry): entry is { range: Range; color: 'yellow' | 'green' | 'blue' | 'pink' | 'purple' } => entry.range !== null)
    paintHighlights(layer, entries, COLOR_FILL)
  }, [annotations, open])

  // Saved highlights repaint whenever annotations, the page, or its text change.
  useEffect(() => {
    if (open === null) return
    repaintHighlights()
    // The painted rectangles are snapshot geometry: every zoom step and render
    // must repaint them, or the markers drift off their words.
  }, [repaintHighlights, renderTick, zoom]) // eslint-disable-line react-hooks/exhaustive-deps

  // Page-box resizes (pane width changes, fit-mode reflows) also invalidate the
  // snapshot geometry, even when no render tick follows them.
  useEffect(() => {
    const node = box.current
    if (node === null) return
    const observer = new ResizeObserver(() => { repaintHighlights() })
    observer.observe(node)
    return () => { observer.disconnect() }
  }, [repaintHighlights])

  // Fit mode keeps the page inside the reading column until the reader zooms
  // manually; scroll fits the width, flip fits the height.
  useEffect(() => {
    if (!fitMode || base === null || open === null) return
    const pane = scroller.current
    if (pane === null) return
    const fitted = mode === 'flip'
      ? Math.min(3, Math.max(0.5, (pane.clientHeight - 48) / base.height))
      : Math.min(3, Math.max(0.5, (pane.clientWidth - 48) / base.width))
    if (Math.abs(fitted - open.zoom) < 0.01) return
    setZoom(fitted)
  }, [fitMode, base, open?.zoom, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Leave fit mode on manual zoom; re-arm it on a fresh book. */
  const manualZoom = (next: number): void => {
    setFitMode(false)
    setZoom(Math.min(5, Math.max(0.3, next)))
  }

  useEffect(() => { setFitMode(true); fittedFor.current = bookId }, [bookId])
  // A mode switch refits: the other axis becomes the binding one.
  useEffect(() => { setFitMode(true) }, [mode])

  // Ctrl/⌘ + wheel zooms the reading pane; the browser's pinch gesture also
  // arrives as a ctrl-wheel, so it keeps working on trackpads.
  useEffect(() => {
    const pane = scroller.current
    if (pane === null || open === null) return
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1
      manualZoom(open.zoom * factor)
    }
    pane.addEventListener('wheel', onWheel, { passive: false })
    return () => { pane.removeEventListener('wheel', onWheel) }
  }, [open?.zoom]) // eslint-disable-line react-hooks/exhaustive-deps

  /** The selection target of the shared context menu, or undefined outside the text layer. */
  const capture = (): PdfSelectionValue | undefined => {
    if (open === null || textHost.current === null) return undefined
    const found = captureSelection(textHost.current, text.current)
    if (found === null) return undefined
    return { bookId: open.bookId, page: open.page, ...found }
  }

  /** Send one screenshot question from the committed region. */
  const sendShot = (ask: string): void => {
    const node = canvas.current
    const size = boxSize()
    if (node === null || size === null || shotRect === null || open === null) return
    const cropped = cropCanvas(node, shotRect, size)
    if (cropped === null) return
    const separator = modelChoice.indexOf('::')
    const provider = modelChoice === '' ? undefined : modelChoice.slice(0, separator)
    const model = modelChoice === '' ? undefined : modelChoice.slice(separator + 2)
    const run = (async () => {
      const encoded = await canvasToBase64Png(cropped)
      if (encoded === null) return
      askShot({
        bookId: open.bookId, page: open.page, rect: shotRect, pngBase64: encoded, question: ask,
        ...(provider !== undefined && model !== undefined ? { provider, model } : {}),
      })
      cancelShot()
    })()
    void run
  }

  /** Leave the screenshot modes behind. */
  const cancelShot = (): void => {
    stopPan()
    setShotMode('idle')
    setStroke(null)
    setShotRect(null)
    setQuestion('')
  }

  /** Stop the drag's auto-pan loop. */
  function stopPan(): void {
    if (pan.current !== null) {
      cancelAnimationFrame(pan.current.raf)
      pan.current = null
    }
  }

  /** Extend the live stroke from the last pointer position against the scrolled page box. */
  const trackStroke = useCallback((): void => {
    const rect = box.current?.getBoundingClientRect()
    if (rect === undefined) return
    setStroke(current => current === null ? current : {
      ...current,
      to: { x: pointer.current.x - rect.left, y: pointer.current.y - rect.top },
    })
  }, [])

  /** Keep scrolling toward the pointer while it hugs the reading pane's edge. */
  const startPan = (dy: number): void => {
    if (pan.current !== null) {
      pan.current.dy = dy
      return
    }
    const step = (): void => {
      const pane = scroller.current
      if (pane === null) { pan.current = null; return }
      pane.scrollTop += dy
      trackStroke()
      pan.current = { raf: requestAnimationFrame(step), dy }
    }
    pan.current = { raf: requestAnimationFrame(step), dy }
  }

  /** Auto-pan while the dragging pointer rides the pane's top or bottom edge. */
  const panIfNeeded = (clientY: number): void => {
    const pane = scroller.current
    if (pane === null) return
    const rect = pane.getBoundingClientRect()
    const edge = 48
    if (clientY < rect.top + edge) startPan(-Math.min(14, rect.top + edge - clientY))
    else if (clientY > rect.bottom - edge) startPan(Math.min(14, clientY - (rect.bottom - edge)))
    else stopPan()
  }

  /** Enter the armed mode, prefetching the vision models the ask box lists. */
  const armShot = (): void => {
    setShotMode('armed')
    loadShotCatalog()
  }

  /** Retry one saved screenshot: jump to its page first, then re-ask with a fresh crop. */
  const retryShot = (id: string): void => {
    if (open === null) return
    const shot = annotations.find(row => row.kind === 'shot' && row.id === id)
    if (shot === undefined || shot.kind !== 'shot') return
    if (shot.page !== open.page) {
      selectPage(shot.page)
      return
    }
    const node = canvas.current
    const size = boxSize()
    if (node === null || size === null) return
    const cropped = cropCanvas(node, shot.rect, size)
    if (cropped === null) return
    const run = (async () => {
      const encoded = await canvasToBase64Png(cropped)
      if (encoded !== null) retryShotAnnotation(id, { pngBase64: encoded, question: shot.question })
    })()
    void run
  }

  /** Jump one annotation's page into view and scroll its text back into sight. */
  const locate = (id: string): void => {
    const annotation = annotations.find(row => row.id === id)
    if (annotation === undefined || open === null) return
    if (annotation.page !== open.page) selectPage(annotation.page)
    if (annotation.kind !== 'text') return
    const range = rangeOf(text.current, annotation.start, annotation.end)
    const target = range?.startContainer.parentElement
    if (target != null) {
      const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' })
    }
  }

  if (open === null) return <div className={css.reader}><p className={css.hint}>{t('pageLoading')}</p></div>

  const noTextLayer = base !== null && text.current.total === 0
  const displayed = base === null ? undefined : { width: base.width * zoom, height: base.height * zoom }
  // The measured box the shot overlay scales against; one read per render.
  const pageSize = boxSize()
  const rubber = stroke === null || pageSize === null ? null : rectFromStroke(stroke.from, stroke.to, pageSize)
  const overlay = shotMode === 'asking' && shotRect !== null ? shotRect : rubber

  return <div className={css.reader}>
    <header className={css.readerBar}>
      <button type="button" onClick={() => { closeBook() }}>{t('backToLibrary')}</button>
      <span className={css.readerTitle}>{open.title}</span>
      <select
        className={css.outlineSelect} value="" disabled={open.outline.length === 0}
        aria-label={t('outline')}
        onChange={(event) => { const to = Number(event.target.value); if (Number.isFinite(to)) selectPage(to); event.currentTarget.value = '' }}
      >
        <option value="">{open.outline.length === 0 ? t('pageOf', { current: open.page, total: Math.max(open.pageCount, 1) }) : t('outline')}</option>
        {open.outline.map((entry, index) => <option key={`${index}-${entry.title}`} value={entry.page}>{`${entry.page} · ${entry.title}`}</option>)}
      </select>
      <div className={css.zoomControls} role="group" aria-label={`${t('zoomOut')} / ${t('zoomIn')}`}>
        <button type="button" onClick={() => { manualZoom(open.zoom - 0.25) }} aria-label={t('zoomOut')}>−</button>
        <button type="button" onClick={() => { setFitMode(true) }} title={t('zoomFitTitle')}>{Math.round(open.zoom * 100)}%</button>
        <button type="button" onClick={() => { manualZoom(open.zoom + 0.25) }} aria-label={t('zoomIn')}>＋</button>
      </div>
      <button
        type="button" className={css.shotButton}
        aria-pressed={mode === 'flip'}
        title={t('readingMode')}
        onClick={() => { setReadingMode(mode === 'flip' ? 'scroll' : 'flip') }}
      >
        {mode === 'flip' ? `⇄ ${t('modeFlip')}` : `⇅ ${t('modeScroll')}`}
      </button>
      <button
        type="button" className={css.shotButton} aria-pressed={shotMode === 'armed' || shotMode === 'dragging'}
        title={t('shotHint')} onClick={() => { if (shotMode === 'idle') armShot(); else cancelShot() }}
      >
        ✂ {t('shot')}
      </button>
    </header>
    <div className={css.columns}>
      <div className={css.readingWrap}>
        <div
          ref={scroller} className={css.reading} tabIndex={0} data-pdf-reading
          onContextMenu={(event) => {
            const target = capture()
            if (target === undefined) return
            event.preventDefault()
            openMenu({ kind: 'pdfSelection', value: target }, { x: event.clientX, y: event.clientY })
          }}
          onKeyDown={(event) => {
            if (event.defaultPrevented || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return
            if (event.key === 'Escape' && shotMode !== 'idle') { event.preventDefault(); cancelShot(); return }
            if (event.key === 's' || event.key === 'S') { event.preventDefault(); if (shotMode === 'idle') armShot(); else cancelShot(); return }
            if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); stepPage(1); return }
            if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); stepPage(-1); return }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              const pane = event.currentTarget
              if (pane.scrollHeight > pane.clientHeight + 1) {
                event.preventDefault()
                pane.scrollBy({ top: event.key === 'ArrowDown' ? pane.clientHeight * 0.9 : -pane.clientHeight * 0.9 })
              }
              return
            }
            if (event.key === '+' || event.key === '=') { event.preventDefault(); manualZoom(open.zoom + 0.25); return }
            if (event.key === '-') { event.preventDefault(); manualZoom(open.zoom - 0.25); return }
          }}
        >
          {open.error !== null ? <p className={css.hint} role="alert">{t('pageFailed', { message: open.error })}</p> : null}
          {failure !== null ? <p className={css.hint} role="alert">{t('pageFailed', { message: failure })}</p> : null}
          {document$ === null && open.error === null && failure === null ? <p className={css.hint} role="status">{t('pageLoading')}</p> : null}
          {noTextLayer && document$ !== null ? <p className={css.hint}>{t('noTextHint')}</p> : null}
          {shotMode === 'armed' ? <p className={css.hint} role="status">{t('shotHint')} · Esc {t('shotCancel')}</p> : null}
          <div
            ref={box}
            className={`${css.pageBox} ${shotMode === 'armed' || shotMode === 'dragging' ? css.pageBoxCrosshair : ''}`}
            style={displayed === undefined ? undefined : ({ width: `${displayed.width}px`, height: `${displayed.height}px` } as CSSProperties)}
            data-pdf-page={open.page}
            onPointerDown={(event) => {
              if (shotMode !== 'armed' || event.button !== 0) return
              const size = boxSize()
              if (size === null) return
              event.preventDefault()
              event.currentTarget.setPointerCapture(event.pointerId)
              const rect = box.current?.getBoundingClientRect()
              const local = { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
              pointer.current = { x: event.clientX, y: event.clientY }
              setStroke({ from: local, to: local })
              setShotMode('dragging')
            }}
            onPointerMove={(event) => {
              if (shotMode !== 'dragging') return
              pointer.current = { x: event.clientX, y: event.clientY }
              const rect = box.current?.getBoundingClientRect()
              setStroke(current => current === null ? current : {
                ...current,
                to: { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) },
              })
              panIfNeeded(event.clientY)
            }}
            onPointerUp={(event) => {
              if (shotMode !== 'dragging') return
              stopPan()
              event.currentTarget.releasePointerCapture(event.pointerId)
              const size = boxSize()
              const rect = stroke !== null && size !== null ? rectFromStroke(stroke.from, stroke.to, size) : null
              if (rect !== null && size !== null && strokeIsMeaningful(rect, size)) {
                setShotRect(rect)
                setShotMode('asking')
              }
              else cancelShot()
            }}
            onPointerCancel={() => {
              if (shotMode === 'dragging') cancelShot()
            }}
          >
            <canvas ref={canvas} className={css.pageCanvas} role="img" aria-label={t('pageOf', { current: open.page, total: Math.max(open.pageCount, 1) })} />
            <div
              ref={textHost} className={css.textHost}
              style={base === null ? undefined : ({ width: `${base.width}px`, height: `${base.height}px`, scale: String(zoom) } as CSSProperties)}
              data-pdf-text
            />
            <div ref={highlightLayer} className={css.highlightLayer} aria-hidden="true" />
            {overlay !== null && pageSize !== null
              ? <div
                className={css.shotOverlay} aria-hidden="true"
                style={{
                  left: `${overlay.x * pageSize.width}px`,
                  top: `${overlay.y * pageSize.height}px`,
                  width: `${overlay.width * pageSize.width}px`,
                  height: `${overlay.height * pageSize.height}px`,
                }}
              />
              : null}
            {shotMode === 'asking' && shotRect !== null && pageSize !== null
              ? <div
                className={css.shotAsk} role="dialog" aria-label={t('shot')}
                style={{ left: `${Math.min(shotRect.x * pageSize.width, pageSize.width - 280)}px`, top: `${Math.min((shotRect.y + shotRect.height) * pageSize.height + 8, Math.max(pageSize.height - 120, 0))}px` }}
              >
                <input
                  className={css.shotInput} value={question} autoFocus
                  placeholder={t('shotAskPlaceholder')}
                  onChange={(event) => { setQuestion(event.target.value) }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') { event.preventDefault(); cancelShot() }
                    if (event.key === 'Enter') { event.preventDefault(); sendShot(question) }
                  }}
                />
                {shotCatalog.length > 0
                  ? <select
                    className={css.shotModelSelect} value={modelChoice}
                    aria-label={t('shotModelLabel')}
                    onChange={(event) => { setModelChoice(event.target.value) }}
                  >
                    <option value="">{shotEffective === ''
                      ? t('followShotSetting')
                      : t('followShotSettingWith', { selection: shotEffective })}</option>
                    {shotCatalog.map(entry =>
                      <option key={`${entry.provider}::${entry.model}`} value={`${entry.provider}::${entry.model}`}>
                        {`${entry.provider} · ${entry.name}`}
                      </option>)}
                  </select>
                  : null}
                <div className={css.shotActions}>
                  <button type="button" onClick={() => { sendShot('') }}>{t('shotExplain')}</button>
                  <button type="button" onClick={() => { sendShot(TRANSLATE_SHOT_QUESTION) }}>{t('shotTranslate')}</button>
                  <button type="button" className={css.importButtonLike} onClick={() => { sendShot(question) }}>{t('shotSend')}</button>
                  <button type="button" onClick={() => { cancelShot() }}>{t('cancel')}</button>
                </div>
              </div>
              : null}
          </div>
        </div>
        <button
          type="button" className={`${css.pageArrow} ${css.pageArrowLeft}`}
          aria-label={t('previousPage')} aria-disabled={open.page <= 1}
          onClick={() => { stepPage(-1) }}
        >
          <IconChevronLeftOutlineRegular size={18} />
        </button>
        <button
          type="button" className={`${css.pageArrow} ${css.pageArrowRight}`}
          aria-label={t('nextPage')} aria-disabled={open.page >= open.pageCount && open.pageCount > 0}
          onClick={() => { stepPage(1) }}
        >
          <IconChevronRightOutlineRegular size={18} />
        </button>
      </div>
      <NotesColumn
        useReader={useReader} page={open.page} locate={locate}
        retryTextAnnotation={retryTextAnnotation} retryShot={retryShot} deleteAnnotation={deleteAnnotation}
        setAnnotationColor={setAnnotationColor}
        copyText={copyText} t={t}
      />
    </div>
    <footer className={css.readerFooter}>
      <div className={css.penGroup}>
        {penPaletteOpen
          ? <div className={css.penPalette} role="group" aria-label={t('colorLabel')}>
            {HIGHLIGHT_COLORS.map(color => <button
              key={color}
              type="button"
              className={`${css.colorDot} ${penColor === color ? css.colorDotActive : ''}`}
              style={{ background: COLOR_FILL[color] }}
              aria-label={t('colorLabel')}
              aria-pressed={penColor === color}
              onClick={() => { setPenColor(color) }}
            />)}
          </div>
          : null}
        <button
          type="button"
          className={css.penSwatch}
          aria-label={t('colorLabel')}
          aria-expanded={penPaletteOpen}
          onClick={() => { setPenPaletteOpen(open => !open) }}
        >
          <span className={css.penSwatchDot} style={{ background: COLOR_FILL[penColor] }} aria-hidden="true" />
          ▾
        </button>
        <button
          type="button"
          onMouseDown={() => {
            // Chrome collapses the text selection as the button's mousedown
            // default; grab it first or the click below would find nothing.
            pendingHighlight.current = capture() ?? null
          }}
          onClick={() => {
            const target = pendingHighlight.current ?? capture()
            pendingHighlight.current = null
            if (target === undefined) return
            annotate(target)
            document.getSelection()?.removeAllRanges()
            setPenPaletteOpen(false)
          }}
        >{t('highlight')}</button>
      </div>
      <button type="button" disabled={open.page <= 1} onClick={() => { stepPage(-1) }}>{t('previousPage')}</button>
      <span>{t('pageOf', { current: open.page, total: Math.max(open.pageCount, 1) })}</span>
      <button type="button" disabled={open.page >= open.pageCount && open.pageCount > 0} onClick={() => { stepPage(1) }}>{t('nextPage')}</button>
      <form
        className={css.jumpForm} onSubmit={(event) => {
          event.preventDefault()
          const target = Number(pageInput)
          if (Number.isFinite(target) && pageInput !== '') selectPage(target)
          setPageInput('')
        }}
      >
        <input
          className={css.jumpInput} value={pageInput} placeholder={t('jumpPage')} inputMode="numeric"
          aria-label={t('jumpPage')}
          onChange={(event) => { setPageInput(event.target.value.replace(/[^\d]/gu, '')) }}
        />
      </form>
      <span>{t('progressPercent', { percent: open.pageCount > 1 ? Math.round(((open.page - 1) / (open.pageCount - 1)) * 100) : 0 })}</span>
    </footer>
  </div>
}
