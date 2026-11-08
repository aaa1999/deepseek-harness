/**
 * Prompt templates for text treatments and screenshot questions.
 *
 * @module @deepseek-ai/dsh-pdf-reader/prompts
 */

import type { AskImageRequest, ExplainRequest } from './types.ts'

/** Book-level context sent with every treatment. */
export interface PromptContext {
  readonly title: string
  /** Human-readable page label, e.g. `第 12 页`; empty omits the page line. */
  readonly pageLabel: string
  /** Human-readable target language name used verbatim in the prompt. */
  readonly targetLanguage: string
}

/** Cap on the selection text sent to the model, in characters. */
export const MAX_SELECTION_CHARS = 2000

/** Cap on the context run sent to the model, in characters. */
export const MAX_CONTEXT_CHARS = 1500

/** Cap on one screenshot question, in characters. */
export const MAX_QUESTION_CHARS = 2000

/** Clip one run to its cap with an ellipsis marker. */
function clip(text: string, cap: number): string {
  return text.length <= cap ? text : `${text.slice(0, cap)}…`
}

/** The book-and-page provenance line shared by every prompt kind. */
function provenance(context: PromptContext): string {
  const book = `书名《${context.title}》`
  return context.pageLabel === '' ? book : `${book}，${context.pageLabel}`
}

/**
 * The system prompt for one text treatment kind.
 * @param kind - treatment being requested.
 * @param context - book-level context.
 * @returns the system prompt text.
 */
export function systemPromptFor(kind: ExplainRequest['kind'], context: PromptContext): string {
  if (kind === 'translate') {
    return [
      `你是一位忠于原作的翻译。读者正在阅读${provenance(context)}的 PDF，会给你一段选中的原文及其上下文。`,
      `把选段翻译成${context.targetLanguage}：忠实原意，保留语气、修辞与人称；术语按文档领域惯用译法。`,
      '只输出译文本身，不要加注释、标题或原文重复。',
    ].join('\n')
  }
  return [
    `你是一位耐心的讲解老师。读者正在阅读${provenance(context)}的 PDF，会给你一段选中的原文及其上下文。`,
    `用${context.targetLanguage}讲解这个选段，按以下结构输出：`,
    '1. 释义：逐个解释关键词和短语在此处的意思（含术语、缩写、典故的来历）',
    '2. 结构：说明句子或公式的结构，指出不常见的用法',
    '3. 用法：这些词句的常见搭配、语域与使用注意',
    '4. 背景：必要时的领域、文化或历史背景，没有则省略本节',
    '选段很短（单词或短语）时省略不适用的部分，保持简洁。',
  ].join('\n')
}

/**
 * The user message for one text treatment.
 * @param request - the browser's selection request.
 * @returns the user message text.
 */
export function userPromptFor(request: ExplainRequest): string {
  const selection = clip(request.text.replace(/\s+/gu, ' ').trim(), MAX_SELECTION_CHARS)
  const context = request.context.replace(/\s+/gu, ' ').trim()
  const lines = [`【选段】\n${selection}`]
  if (context !== '' && context !== selection) lines.push(`【页面上下文】\n${clip(context, MAX_CONTEXT_CHARS)}`)
  return lines.join('\n\n')
}

/**
 * The system prompt for one screenshot question.
 * @param context - book-level context.
 * @returns the system prompt text.
 */
export function shotSystemPrompt(context: PromptContext): string {
  return [
    `你是读者的 PDF 阅读助手。读者正在阅读${provenance(context)}，从页面上截取了一块区域发给你，并附有一个问题。`,
    `读取截图中的文字与图形，用${context.targetLanguage}回答问题。截图里是外文时，翻译要完整准确；问题开放时，解释要具体、贴合这页内容。`,
  ].join('\n')
}

/**
 * The user message text that accompanies one screenshot image.
 * @param request - the browser's screenshot request.
 * @returns the user message text.
 */
export function shotUserPrompt(request: AskImageRequest): string {
  const question = clip(request.question.replace(/\s+/gu, ' ').trim(), MAX_QUESTION_CHARS)
  return `【问题】\n${question === '' ? '解释这张截图中的内容' : question}`
}

/**
 * The canonical default question one empty prompt box sends.
 * @param targetLanguage - human-readable target language name.
 * @returns the default question text.
 */
export function defaultShotQuestion(targetLanguage: string): string {
  return `解释这张截图中的内容，用${targetLanguage}回答`
}
