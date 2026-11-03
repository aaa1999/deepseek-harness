/** Browser entry for the optional voice-chat Remote pair and composer controls. */
import type { Context } from '@deepseek-ai/cordis'
import speechRemote from '@deepseek-ai/dsh-experimental-api-speech-to-text/remote'
import synthesisRemote from '@deepseek-ai/dsh-experimental-api-text-to-speech/remote'
import { mountVoiceChat } from './mount.ts'

export { inject } from './mount.ts'

/**
 * Activate the experimental voice-chat contribution.
 * @param ctx - Client runtime.
 * @returns complete UI and Remote disposer.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return await mountVoiceChat(ctx, speechRemote, synthesisRemote)
}
