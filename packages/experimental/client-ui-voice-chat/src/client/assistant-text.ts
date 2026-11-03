/** Latest spoken-eligible assistant text extracted from the Session event window. */
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'

/** The newest durable assistant message with speakable text. */
export interface LatestAssistantText {
  readonly seq: number
  readonly text: string
}

/**
 * Walk the event window backwards for the latest assistant message whose text
 * blocks join to a nonblank transcript; interrupted messages are skipped.
 * @param entries - current contiguous event window.
 * @returns the newest speakable message, or undefined.
 */
export function latestAssistantText(entries: readonly SessionEventLikeEntry[]): LatestAssistantText | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (entry === undefined) continue
    if (entry.type !== 'event' || entry.event.type !== 'assistant/message') continue
    if (entry.event.data.interrupted === true) continue
    const text = entry.event.data.message.content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text'
        && typeof (block as { text?: unknown }).text === 'string')
      .map(block => block.text)
      .join('\n')
      .trim()
    if (text !== '') return { seq: entry.event.seq, text }
  }
  return undefined
}
