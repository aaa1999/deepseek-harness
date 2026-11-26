/** Tweets panel copy owned by the locale dictionaries. */

/** Locale namespace of the tweet panel. */
export const NS = 'tweet'

/** Chinese copy; its keys define the dictionary type. */
export const zh = {
  'panel.name': '推文',
  'panel.description': '图文分离地发布个人推文，数据存在所选工作区内',
  'workspace.select': '选择工作空间',
  'workspace.empty': '没有可用的工作空间，请先在工作区面板添加',
  'workspace.noneSelected': '先选择一个工作空间',
  'workspace.open': '指定工作目录',
  'workspace.openPlaceholder': '输入文件夹绝对路径，如 /Users/you/Desktop/notes',
  'workspace.openConfirm': '打开',
  'composer.placeholder': '写下你的推文…（截图可直接粘贴）',
  'composer.publish': '发布',
  'composer.publishing': '发布中…',
  'composer.empty': '写点什么，或添加至少一张图片',
  'composer.addImages': '添加图片',
  'composer.readFailed': '图片读取失败：{message}',
  'composer.removeImage': '移除图片',
  'post.expand': '展开',
  'post.collapse': '收起',
  'post.edited': '已编辑',
  'post.edit': '编辑',
  'post.delete': '删除',
  'post.deleteConfirm': '确认删除',
  'post.cancel': '取消',
  'post.save': '保存',
  'post.saving': '保存中…',
  'post.editPlaceholder': '修改文字…',
  'comment.section': '评论',
  'comment.placeholder': '写下评论…',
  'comment.submit': '评论',
  'comment.expand': '展开全部{count}条评论',
  'comment.collapse': '收起评论',
  'feed.loading': '加载中…',
  'feed.failed': '加载失败：{message}',
  'feed.empty': '还没有发布过推文',
  'action.failed': '操作失败：{message}',
  'image.dialog': '图片预览',
  'image.close': '关闭',
  'image.loading': '图片加载中…',
  'time.clock.md': '{m}月{d}日',
  'time.clock.ymd': '{y}年{m}月{d}日',
} as const

/** English copy. */
export const en: Record<keyof typeof zh, string> = {
  'panel.name': 'Tweet',
  'panel.description': 'Publish personal takes with separately laid out images, stored inside the chosen workspace',
  'workspace.select': 'Choose a workspace',
  'workspace.empty': 'No workspaces available; add one in the workspaces panel first',
  'workspace.noneSelected': 'Select a workspace to start',
  'workspace.open': 'Set working directory',
  'workspace.openPlaceholder': 'Absolute folder path, e.g. /Users/you/Desktop/notes',
  'workspace.openConfirm': 'Open',
  'composer.placeholder': 'Share a take… (paste screenshots directly)',
  'composer.publish': 'Publish',
  'composer.publishing': 'Publishing…',
  'composer.empty': 'Write something or add at least one image',
  'composer.addImages': 'Add images',
  'composer.readFailed': 'Reading the image failed: {message}',
  'composer.removeImage': 'Remove image',
  'post.expand': 'More',
  'post.collapse': 'Less',
  'post.edited': 'edited',
  'post.edit': 'Edit',
  'post.delete': 'Delete',
  'post.deleteConfirm': 'Confirm delete',
  'post.cancel': 'Cancel',
  'post.save': 'Save',
  'post.saving': 'Saving…',
  'post.editPlaceholder': 'Edit the text…',
  'comment.section': 'Comments',
  'comment.placeholder': 'Write a comment…',
  'comment.submit': 'Comment',
  'comment.expand': 'Show all {count} comments',
  'comment.collapse': 'Show fewer',
  'feed.loading': 'Loading…',
  'feed.failed': 'Loading failed: {message}',
  'feed.empty': 'Nothing published yet',
  'action.failed': 'The action failed: {message}',
  'image.dialog': 'Image preview',
  'image.close': 'Close',
  'image.loading': 'Loading image…',
  'time.clock.md': '{m}/{d}',
  'time.clock.ymd': '{y}-{m}-{d}',
}

/** Dictionary keys of the tweet panel. */
export type TweetsLocaleKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Tweets panel copy. */
    'tweet': TweetsLocaleKey
  }
}
