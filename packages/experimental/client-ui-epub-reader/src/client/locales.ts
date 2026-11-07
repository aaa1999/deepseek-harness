/** EPUB reader Web dictionaries. */

/** Locale namespace owned by the EPUB reader Web UI. */
export const NS = 'epub.reader'

/** Simplified Chinese dictionary and key source. */
export const zh = {
  panel: '阅读',
  import: '导入 EPUB',
  importing: '导入中…',
  empty: '书架还没有书，导入一本 EPUB 开始阅读',
  loading: '正在加载书架…',
  loadFailed: '书架加载失败：{message}',
  retry: '重试',
  cancel: '取消',
  remove: '删除',
  removeConfirm: '删除这本书和它的全部划线笔记？',
  unknownAuthor: '未知作者',
  chapters: '{count} 章',
  continueReading: '继续读',
  backToLibrary: '返回书架',
  previousChapter: '上一章',
  nextChapter: '下一章',
  chapterOf: '第 {current} / {total} 章',
  chapterLoading: '正在加载章节…',
  chapterFailed: '章节加载失败：{message}',
  notes: '笔记',
  notesEmpty: '在正文中划选词句，右键「翻译 / 解释」，结果会保存在这里',
  translate: '翻译',
  explain: '解释',
  streaming: '生成中…',
  saving: '保存中…',
  failed: '生成失败：{message}',
  copy: '复制',
  copied: '已复制',
  delete: '删除',
  regenerate: '重新生成',
  locate: '定位原文',
  progressPercent: '已读 {percent}%',
} satisfies Record<string, string>

/** EPUB reader locale key union. */
export type EpubReaderKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en: Record<EpubReaderKey, string> = {
  panel: 'Reading',
  import: 'Import EPUB',
  importing: 'Importing…',
  empty: 'No books yet. Import an EPUB to start reading.',
  loading: 'Loading the bookshelf…',
  loadFailed: 'Failed to load the bookshelf: {message}',
  retry: 'Retry',
  cancel: 'Cancel',
  remove: 'Remove',
  removeConfirm: 'Remove this book and all of its highlights?',
  unknownAuthor: 'Unknown author',
  chapters: '{count} chapters',
  continueReading: 'Continue',
  backToLibrary: 'Back to bookshelf',
  previousChapter: 'Previous chapter',
  nextChapter: 'Next chapter',
  chapterOf: 'Chapter {current} / {total}',
  chapterLoading: 'Loading chapter…',
  chapterFailed: 'Failed to load the chapter: {message}',
  notes: 'Notes',
  notesEmpty: 'Select a passage in the text, right-click it, and choose Translate or Explain. Results are kept here.',
  translate: 'Translate',
  explain: 'Explain',
  streaming: 'Generating…',
  saving: 'Saving…',
  failed: 'Generation failed: {message}',
  copy: 'Copy',
  copied: 'Copied',
  delete: 'Delete',
  regenerate: 'Regenerate',
  locate: 'Locate in text',
  progressPercent: '{percent}% read',
}
