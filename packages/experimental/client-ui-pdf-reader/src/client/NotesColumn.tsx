/** The notes column: one card per text highlight and screenshot question. */
import { useMemo, useState } from 'react'
import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ExplainKind, PdfAnnotation } from '@deepseek-ai/dsh-pdf-reader/types'
import type { ShotStream, TextStream } from './controller.ts'
import type { PdfReaderInjected } from './contract.ts'
import { NS } from './locales.ts'
import css from './reader.module.css'

/** Faces the notes column renders with. */
export type NotesProps = PropsLocale<typeof NS>
  & InjectFace<Pick<PdfReaderInjected, 'hooks' | 'retryTextAnnotation' | 'deleteAnnotation' | 'copyText'>>
  & {
    /** Page the reading column shows; other pages' cards stay dimmed as history. */
    readonly page: number
    /** Jump one annotation's page into view. */
    readonly locate: (id: string) => void
    /** Re-run one saved screenshot question with a fresh crop. */
    readonly retryShot: (id: string) => void
  }

/** One card's presentation: the saved annotation overlaid by its live stream. */
interface CardFace {
  readonly annotation?: PdfAnnotation
  readonly textStream?: TextStream
  readonly shotStream?: ShotStream
}

/** One answer row a card lists. */
interface ResultRow {
  readonly kind: ExplainKind | 'shot'
  readonly text: string
  readonly model: string
  readonly live: boolean
  readonly error: string | null
}

/** Kind label of one answer row. */
function kindLabel(kind: ResultRow['kind'], translate: string, explain: string, shot: string): string {
  return kind === 'translate' ? translate : kind === 'explain' ? explain : shot
}

/**
 * The annotation cards of the open book, newest first: text cards show their
 * quote and treatments, shot cards show the crop thumbnail, the question, and
 * the streamed answer.
 * @param props - locale face, state hook, card actions, and the locate callback.
 * @returns the notes column.
 */
export function NotesColumn({
  useReader, page, locate, retryTextAnnotation, retryShot, deleteAnnotation, copyText, t,
}: NotesProps) {
  const annotations = useReader(state => state.annotations)
  const streams = useReader(state => state.streams)
  const shots = useReader(state => state.shots)
  const [copied, setCopied] = useState('')
  const markdownLabels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: t('copy'), copiedLabel: t('copied') },
    footnotes: t('footnotes'),
  }), [t])
  const cards = new Map<string, CardFace>()
  for (const annotation of [...annotations].reverse()) cards.set(annotation.id, { annotation })
  for (const [id, stream] of Object.entries(streams)) cards.set(id, { ...cards.get(id), textStream: stream })
  for (const [id, stream] of Object.entries(shots)) cards.set(id, { ...cards.get(id), shotStream: stream })
  const ordered = [...cards.entries()].sort((left, right) => {
    const recency = (card: CardFace): number => Math.max(
      card.annotation?.createdAt ?? 0,
      card.textStream?.startedAt ?? 0,
      card.shotStream?.startedAt ?? 0,
    )
    return recency(right[1]) - recency(left[1])
  })
  return <section className={css.notes} aria-label={t('notes')}>
    <h2 className={css.notesTitle}>{t('notes')}</h2>
    {ordered.length === 0 ? <p className={css.hint}>{t('notesEmpty')}</p> : null}
    {ordered.map(([id, card]) => {
      const annotation = card.annotation
      const isShot = annotation?.kind === 'shot' || (annotation === undefined && card.shotStream !== undefined)
      const liveText = card.textStream
      const rows: readonly ResultRow[] = card.shotStream !== undefined
        ? [{ kind: 'shot', text: card.shotStream.text, model: card.shotStream.model, live: true, error: card.shotStream.error }]
        : liveText !== undefined
          ? (annotation !== undefined && annotation.kind === 'text' && annotation.results.length > 0
            ? [...annotation.results.map(result => ({ ...result, live: false, error: null })),
              { kind: liveText.kind, text: liveText.text, model: liveText.model, live: true, error: liveText.error }]
            : [{ kind: liveText.kind, text: liveText.text, model: liveText.model, live: true, error: liveText.error }])
          : annotation !== undefined && annotation.kind === 'text'
            ? annotation.results.map(result => ({ ...result, live: false, error: null }))
            : annotation !== undefined && annotation.kind === 'shot' && annotation.answer !== null
              ? [{ kind: 'shot', text: annotation.answer.text, model: annotation.answer.model, live: false, error: null }]
              : []
      // Copy targets the live stream while one runs, else the newest saved answer.
      const copySource = card.shotStream?.text !== undefined && card.shotStream.text !== ''
        ? card.shotStream.text
        : card.textStream?.text !== undefined && card.textStream.text !== ''
          ? card.textStream.text
          : annotation !== undefined && annotation.kind === 'text'
            ? annotation.results.at(-1)?.text ?? ''
            : annotation !== undefined && annotation.kind === 'shot'
              ? annotation.answer?.text ?? ''
              : ''
      const thumbnail = card.shotStream?.imageUrl
        || (annotation !== undefined && annotation.kind === 'shot' ? annotation.imageUrl : '')
      const question = card.shotStream?.question
        ?? (annotation !== undefined && annotation.kind === 'shot' ? annotation.question : '')
      const annotationPage = annotation?.page ?? page
      return <article key={id} className={annotationPage === page ? css.card : `${css.card} ${css.cardPast}`}>
        {isShot
          ? <div className={css.shotCard}>
            {thumbnail !== ''
              ? <img className={css.shotImage} src={thumbnail} alt="" loading="lazy" />
              : <span className={css.shotPending} aria-hidden="true">✂</span>}
            {question !== '' ? <p className={css.shotQuestion}>{question}</p> : null}
          </div>
          : <blockquote className={css.quote}>{annotation !== undefined && annotation.kind === 'text' ? annotation.quote : ''}</blockquote>}
        {rows.map((row, index) => <div key={index} className={row.live ? css.resultLive : css.result}>
          <span className={css.resultKind}>{kindLabel(row.kind, t('translate'), t('explain'), t('shot'))}</span>
          {row.error !== null
            ? <p className={css.resultError}>{t('failed', { message: row.error })}</p>
            : row.text === '' && row.live
              ? <p className={css.resultText}>{t('streaming')}</p>
              : <div className={css.resultText} data-pdf-result>
                <MarkdownText text={row.text} streaming={row.live} omitHtml variant="compact" labels={markdownLabels} />
              </div>}
          {row.model !== '' ? <span className={css.resultModel}>{row.model}</span> : null}
        </div>)}
        {(card.textStream?.saving === true || card.shotStream?.saving === true) ? <p className={css.hint}>{t('saving')}</p> : null}
        <div className={css.cardActions}>
          {annotation !== undefined
            ? <>
              <button type="button" onClick={() => { locate(annotation.id) }}>{t('locate')}</button>
              {annotation.kind === 'text'
                ? <button type="button" onClick={() => { retryTextAnnotation(id) }}>{t('regenerate')}</button>
                : <button type="button" onClick={() => { retryShot(id) }}>{t('regenerate')}</button>}
            </> : null}
          {copySource !== ''
            ? <button type="button" onClick={() => {
              copyText(copySource)
              setCopied(id)
              setTimeout(() => { setCopied(current => current === id ? '' : current) }, 1500)
            }}>{copied === id ? t('copied') : t('copy')}</button> : null}
          {annotation !== undefined
            ? <button type="button" className={css.danger} onClick={() => { deleteAnnotation(id) }}>{t('delete')}</button> : null}
        </div>
      </article>
    })}
  </section>
}
