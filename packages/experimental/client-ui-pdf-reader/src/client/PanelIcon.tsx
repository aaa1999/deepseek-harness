/** Decorative occupant for the PDF reader sidebar entry. */
import { FileTypeIcon } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the PDF glyph at the size the sidebar asks for; the sidebar owns
 * its accessible navigation label.
 * @param props - the sidebar's icon share: the requested edge and selection state.
 * @returns decorative PDF file icon.
 */
export function PanelIcon({ size }: PropsRuntime<'sidebar.panellist'>) {
  return <FileTypeIcon kind="pdf" size={size} />
}
