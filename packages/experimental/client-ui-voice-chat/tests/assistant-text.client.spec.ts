/** Speakable assistant text extraction from the Session event window. */
import { expect, it } from 'vitest'
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import { latestAssistantText } from '../src/client/assistant-text.ts'

function assistant(seq: number, text: string, interrupted = false): SessionEventLikeEntry {
  return { type: 'event', event: { type: 'assistant/message', seq, time: seq, interrupted: interrupted ? true : undefined,
    data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text }] }, stream: [] } } as never }
}

it('returns the newest nonblank assistant text', () => {
  expect(latestAssistantText([assistant(1, '第一句'), assistant(2, '第二句')])).toEqual({ seq: 2, text: '第二句' })
})

it('skips interrupted messages and text-free content', () => {
  expect(latestAssistantText([assistant(1, 'x', true), assistant(2, '完整')])).toEqual({ seq: 2, text: '完整' })
  expect(latestAssistantText([assistant(3, '   '), assistant(2, '完整')])).toEqual({ seq: 2, text: '完整' })
  expect(latestAssistantText([assistant(3, '')])).toBeUndefined()
})

it('joins multiple text blocks and ignores transient rows', () => {
  const multi: SessionEventLikeEntry = { type: 'event', event: { type: 'assistant/message', seq: 5, time: 5,
    data: { turn: 1, step: 1, message: { role: 'assistant', content: [
      { type: 'text', text: '第一段' }, { type: 'reasoning', text: '隐藏' }, { type: 'text', text: '第二段' },
    ] }, stream: [] } } as never }
  expect(latestAssistantText([multi, { type: 'transient', event: { type: 'assistant/live-chunk', seq: 6, time: 6, data: {} } } as never])).toEqual({ seq: 5, text: '第一段\n第二段' })
  expect(latestAssistantText([])).toBeUndefined()
})
