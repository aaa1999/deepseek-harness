/** The Reading main panel: switches the bookshelf and the open book's reader. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { EpubReaderInjected } from './contract.ts'
import { NS } from './locales.ts'
import { LibraryView } from './LibraryView.tsx'
import { ReaderView } from './ReaderView.tsx'

/** Faces the main panel receives. */
export type ReaderPanelProps = PropsRuntime<'main'> & PropsLocale<typeof NS> & InjectFace<EpubReaderInjected>

/**
 * One keyed `main` occupant: the shelf while no book is open, the two-column
 * reader while one is.
 * @param props - the complete reader injection plus the bound locale face.
 * @returns the active reader view.
 */
export function ReaderPanel(props: ReaderPanelProps) {
  const view = props.useReader(state => state.view)
  if (view === 'reader') return <ReaderView {...props} />
  return <LibraryView {...props} />
}
