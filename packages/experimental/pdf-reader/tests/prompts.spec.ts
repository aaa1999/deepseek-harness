/** Prompt templates: text treatments, screenshot questions, and clipping caps. */
import { describe, expect, it } from 'vitest'
import { defaultShotQuestion, MAX_QUESTION_CHARS, shotSystemPrompt, shotUserPrompt, systemPromptFor, userPromptFor } from '../src/prompts.ts'
import type { AskImageRequest, ExplainRequest } from '../src/types.ts'

const context = { title: 'Attention Is All You Need', pageLabel: '第 3 页', targetLanguage: '简体中文' }

const selection: ExplainRequest = {
  bookId: 'b1', page: 3, kind: 'translate',
  text: 'the dominant sequence transduction models',
  context: 'In this work we present the Transformer, a model architecture eschewing recurrence.',
}

describe('prompts', () => {
  it('builds the translate system prompt with book and page provenance', () => {
    const system = systemPromptFor('translate', context)
    expect(system).toContain('《Attention Is All You Need》')
    expect(system).toContain('第 3 页')
    expect(system).toContain('简体中文')
    expect(system).toContain('只输出译文本身')
  })

  it('builds the explain system prompt with the learner structure', () => {
    const system = systemPromptFor('explain', context)
    expect(system).toContain('释义')
    expect(system).toContain('结构')
    expect(system).toContain('用法')
  })

  it('pairs the selection with its page context in the user message', () => {
    const user = userPromptFor(selection)
    expect(user).toContain('【选段】')
    expect(user).toContain('the dominant sequence transduction models')
    expect(user).toContain('【页面上下文】')
  })

  it('omits the context block when it carries nothing new', () => {
    const user = userPromptFor({ ...selection, text: selection.context })
    expect(user).not.toContain('【页面上下文】')
  })

  it('clips long selections instead of overflowing the prompt', () => {
    const user = userPromptFor({ ...selection, text: 'x'.repeat(3000) })
    expect(user.length).toBeLessThan(3000)
    expect(user).toContain('…')
  })

  it('frames screenshot questions with provenance and a default answer', () => {
    const ask: AskImageRequest = {
      bookId: 'b1', page: 3, rect: { x: 0, y: 0, width: 0.5, height: 0.5 },
      annotationId: 'a1', pngBase64: '', question: '这个公式是什么意思？',
    }
    expect(shotSystemPrompt(context)).toContain('PDF 阅读助手')
    expect(shotSystemPrompt(context)).toContain('第 3 页')
    expect(shotUserPrompt(ask)).toContain('这个公式是什么意思？')
    expect(shotUserPrompt({ ...ask, question: '' })).toContain('解释这张截图中的内容')
    expect(defaultShotQuestion('简体中文')).toContain('简体中文')
  })

  it('clips runaway questions at the cap', () => {
    const long = 'x'.repeat(MAX_QUESTION_CHARS + 500)
    expect(shotUserPrompt({ bookId: 'b1', page: 1, rect: { x: 0, y: 0, width: 1, height: 1 }, annotationId: 'a1', pngBase64: '', question: long })).toContain('…')
  })
})
