/**
 * Prompt templates for selection translation and explanation.
 *
 * @module @deepseek-ai/dsh-epub-reader/prompts
 */

import type { ExplainRequest } from './types.ts'

/** Book-level context sent with every treatment. */
export interface PromptContext {
  readonly title: string
  readonly chapterTitle: string
  /** Human-readable target language name used verbatim in the prompt. */
  readonly targetLanguage: string
}

/** Cap on the selection text sent to the model, in characters. */
export const MAX_SELECTION_CHARS = 2000

/** Cap on the context paragraph sent to the model, in characters. */
export const MAX_CONTEXT_CHARS = 1500

/** Clip one run to its cap with an ellipsis marker. */
function clip(text: string, cap: number): string {
  return text.length <= cap ? text : `${text.slice(0, cap)}…`
}

/**
 * The system prompt for one treatment kind.
 * @param kind - treatment being requested.
 * @param context - book-level context.
 * @returns the system prompt text.
 */
export function systemPromptFor(kind: ExplainRequest['kind'], context: PromptContext): string {
  const book = `书名《${context.title}》${context.chapterTitle === '' ? '' : `，章节「${context.chapterTitle}」`}`
  if (kind === 'translate') {
    return [
      `你是一位忠于原作的文学翻译。读者正在阅读${book}，会给你一段原文选段及其所在段落。`,
      `把选段翻译成${context.targetLanguage}：忠实原意，保留语气、修辞与人称；诗歌保留分行。`,
      '只输出译文本身，不要加注释、标题或原文重复。',
    ].join('\n')
  }
  return [
    `你是一位面向外语学习者的讲解老师。读者正在阅读${book}，会给你一段原文选段及其所在段落。`,
    `用${context.targetLanguage}讲解这个选段，按以下结构输出：`,
    '1. 释义：逐个解释关键词和短语在此处的意思（含音译名、俚语、典故的来历）',
    '2. 语法：说明句子的语法结构，指出不常见的用法',
    '3. 用法：这些词句的常见搭配、语域（正式/口语/方言）与使用注意',
    '4. 背景：必要时的文化、历史或作品背景，没有则省略本节',
    '选段很短（单词或短语）时省略不适用的部分，保持简洁。',
  ].join('\n')
}

/**
 * The user message for one treatment.
 * @param request - the browser's selection request.
 * @returns the user message text.
 */
export function userPromptFor(request: ExplainRequest): string {
  const selection = clip(request.text.replace(/\s+/gu, ' ').trim(), MAX_SELECTION_CHARS)
  const paragraph = request.context.replace(/\s+/gu, ' ').trim()
  const lines = [`【选段】\n${selection}`]
  if (paragraph !== '' && paragraph !== selection) lines.push(`【所在段落】\n${clip(paragraph, MAX_CONTEXT_CHARS)}`)
  return lines.join('\n\n')
}
