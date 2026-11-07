/** Decorative occupant for the Reading sidebar entry. */
import { IconDeliverDocRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the document glyph at the size the sidebar asks for; the sidebar owns
 * its accessible navigation label.
 * @param props - the sidebar's icon share: the requested edge and selection state.
 * @returns decorative document icon.
 */
export function PanelIcon({ size }: PropsRuntime<'sidebar.panellist'>) {
  return <IconDeliverDocRegular size={size} />
}
