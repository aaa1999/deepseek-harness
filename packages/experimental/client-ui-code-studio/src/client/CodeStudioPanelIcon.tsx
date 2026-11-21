/** The sidebar's code studio entry icon; the sidebar owns the button, label, and selected state around it. */

import type { ReactNode } from 'react'
import { IconCodeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the panel glyph at the size the sidebar asks for.
 * @param props - the sidebar's icon share: the requested edge.
 * @returns the icon element.
 */
export function CodeStudioPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <IconCodeOutlineRegular size={size} />
}
