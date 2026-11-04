/** `sessionNodes` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'turn.save': '保存该轮为节点',
  'turn.saved': '已保存该轮',
  'hero.label': '从节点新建',
  'hero.selectLabel': '从已存节点新建会话',
  'dock.titlePlaceholder': '节点标题',
  'dock.save': '保存',
  'dock.nodesLabel': '已存节点',
  'dock.none': '暂无节点',
  'dock.fork': '从此节点新建会话',
  'dock.delete': '删除节点',
  'section.title': '保存的节点',
  'section.empty': '暂无节点',
  'section.fork': '从节点新建会话',
  'section.rename': '重命名节点',
  'section.delete': '删除节点',
} satisfies Record<string, string>

/** The sessionNodes namespace key union. */
export type SessionNodesKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Session-node surfaces: the sidebar section, the per-turn pin, the New Session picker, and the composer dock. */
    sessionNodes: SessionNodesKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en: Record<SessionNodesKey, string> = {
  'turn.save': 'Save this turn as a node',
  'turn.saved': 'Turn saved',
  'hero.label': 'From a node',
  'hero.selectLabel': 'New session from a saved node',
  'dock.titlePlaceholder': 'Node title',
  'dock.save': 'Save',
  'dock.nodesLabel': 'Saved nodes',
  'dock.none': 'No nodes yet',
  'dock.fork': 'Fork a new session from this node',
  'dock.delete': 'Delete node',
  'section.title': 'Saved nodes',
  'section.empty': 'No saved nodes yet',
  'section.fork': 'Fork a new session from this node',
  'section.rename': 'Rename node',
  'section.delete': 'Delete node',
}
