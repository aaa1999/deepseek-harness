/** Prompt construction: fixed instructions, clipped selection and context. */
import { describe, expect, it } from 'vitest'
import { MAX_SELECTION_CHARS, systemPromptFor, userPromptFor } from '../src/prompts.ts'

describe('prompts', () => {
  it('builds kind-specific system prompts naming the book and target language', () => {
    const context = { title: 'Sample', chapterTitle: 'One', targetLanguage: '简体中文' }
    expect(systemPromptFor('translate', context)).toContain('文学翻译')
    expect(systemPromptFor('translate', context)).toContain('《Sample》')
    expect(systemPromptFor('explain', context)).toContain('讲解')
    expect(systemPromptFor('explain', { ...context, chapterTitle: '' })).not.toContain('「」')
  })

  it('keeps the selection and appends the paragraph only when it adds information', () => {
    const request = { bookId: 'b', chapterIndex: 0, kind: 'translate' as const, text: 'best of times', context: 'It was the best of times.' }
    expect(userPromptFor(request)).toBe('【选段】\nbest of times\n\n【所在段落】\nIt was the best of times.')
    expect(userPromptFor({ ...request, context: '' })).not.toContain('所在段落')
    expect(userPromptFor({ ...request, context: 'best of times' })).not.toContain('所在段落')
  })

  it('clips over-long selections', () => {
    const long = 'a'.repeat(MAX_SELECTION_CHARS + 50)
    expect(userPromptFor({ bookId: 'b', chapterIndex: 0, kind: 'translate', text: long, context: '' })).toContain('…')
  })
})
