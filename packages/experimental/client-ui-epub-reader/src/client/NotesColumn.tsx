/** The notes column: one card per highlight with its streamed or saved treatments. */
import { useState } from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { Annotation, ExplainKind } from '@deepseek-ai/dsh-experimental-epub-reader/types'
import type { NoteStream } from './controller.ts'
import type { EpubReaderInjected } from './contract.ts'
import { NS } from './locales.ts'
import css from './reader.module.css'

/** Faces the notes column renders with. */
export type NotesProps = PropsLocale<typeof NS>
  & InjectFace<Pick<EpubReaderInjected, 'hooks' | 'retryAnnotation' | 'deleteAnnotation' | 'copyText' | 'captureAnnotationNote'>>
  & {
    /** Chapter index the reading column shows; other chapters' cards stay dimmed as history. */
    readonly chapterIndex: number
    /** Scroll the reading column to one annotation's saved range. */
    readonly locate: (id: string) => void
  }

/** One card's presentation: the saved annotation overlaid by its live stream. */
interface CardFace { readonly annotation?: Annotation; readonly stream?: NoteStream }

/** One treatment row a card lists. */
interface ResultRow {
  readonly kind: ExplainKind
  readonly text: string
  readonly model: string
  readonly live: boolean
  readonly error: string | null
}

/** Kind label of one treatment row. */
function kindLabel(kind: ExplainKind, translate: string, explain: string): string {
  return kind === 'translate' ? translate : explain
}

/**
 * The highlight cards of the open book, newest first: each shows its quote,
 * every saved treatment, and the in-flight one underneath.
 * @param props - locale face, state hook, card actions, and the locate callback.
 * @returns the notes column.
 */
export function NotesColumn({
  useReader, chapterIndex, locate, retryAnnotation, deleteAnnotation, copyText, captureAnnotationNote, t,
}: NotesProps) {
  const annotations = useReader(state => state.annotations)
  const streams = useReader(state => state.streams)
  const [copied, setCopied] = useState('')
  const [noted, setNoted] = useState('')
  const cards = new Map<string, CardFace>()
  for (const annotation of [...annotations].reverse()) cards.set(annotation.id, { annotation })
  for (const [id, stream] of Object.entries(streams)) cards.set(id, { ...cards.get(id), stream })
  const ordered = [...cards.entries()].sort((left, right) => {
    const recency = (card: CardFace): number => Math.max(card.annotation?.createdAt ?? 0, card.stream?.startedAt ?? 0)
    return recency(right[1]) - recency(left[1])
  })
  return <section className={css.notes} aria-label={t('notes')}>
    <h2 className={css.notesTitle}>{t('notes')}</h2>
    {ordered.length === 0 ? <p className={css.hint}>{t('notesEmpty')}</p> : null}
    {ordered.map(([id, card]) => {
      const annotation = card.annotation
      const rows: readonly ResultRow[] = card.stream === undefined
        ? (annotation?.results ?? []).map(result => ({ ...result, live: false, error: null }))
        : annotation === undefined || annotation.results.length === 0
          ? [{ kind: card.stream.kind, text: card.stream.text, model: card.stream.model, live: true, error: card.stream.error }]
          : [...annotation.results.map(result => ({ ...result, live: false, error: null })),
            { kind: card.stream.kind, text: card.stream.text, model: card.stream.model, live: true, error: card.stream.error }]
      // Copy targets the live stream while one runs, else the newest saved result.
      const copySource = card.stream?.text !== undefined && card.stream.text !== ''
        ? card.stream.text
        : annotation?.results.at(-1)?.text ?? ''
      return <article key={id} className={annotation?.chapterIndex === chapterIndex ? css.card : `${css.card} ${css.cardPast}`}>
        <blockquote className={css.quote}>{annotation?.quote ?? ''}</blockquote>
        {rows.map((row, index) => <div key={index} className={row.live ? css.resultLive : css.result}>
          <span className={css.resultKind}>{kindLabel(row.kind, t('translate'), t('explain'))}</span>
          {row.error !== null
            ? <p className={css.resultError}>{t('failed', { message: row.error })}</p>
            : <p className={css.resultText} data-epub-result>{row.text === '' && row.live ? t('streaming') : row.text}</p>}
          {row.model !== '' ? <span className={css.resultModel}>{row.model}</span> : null}
        </div>)}
        {card.stream?.saving === true ? <p className={css.hint}>{t('saving')}</p> : null}
        <div className={css.cardActions}>
          {annotation !== undefined
            ? <>
              <button type="button" onClick={() => { locate(annotation.id) }}>{t('locate')}</button>
              <button type="button" onClick={() => { retryAnnotation(id) }}>{t('regenerate')}</button>
            </> : null}
          {copySource !== ''
            ? <button type="button" onClick={() => {
              copyText(copySource)
              setCopied(id)
              setTimeout(() => { setCopied(current => current === id ? '' : current) }, 1500)
            }}>{copied === id ? t('copied') : t('copy')}</button> : null}
          {annotation !== undefined
            ? <button type="button" onClick={() => {
              captureAnnotationNote(id)
              setNoted(id)
              setTimeout(() => { setNoted(current => current === id ? '' : current) }, 1500)
            }}>{noted === id ? t('noted') : t('saveNote')}</button> : null}
          {annotation !== undefined
            ? <button type="button" className={css.danger} onClick={() => { deleteAnnotation(id) }}>{t('delete')}</button> : null}
        </div>
      </article>
    })}
  </section>
}
