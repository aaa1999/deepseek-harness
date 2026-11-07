/**
 * Chapter XHTML sanitizer: one strict allowlist at the trust boundary.
 *
 * Every chapter document is untrusted external content. The sanitizer parses
 * the XHTML as XML, keeps only allowlisted tags and attributes, drops every
 * reference to a resource the book does not carry, and rewrites kept image
 * references onto the resource Fetch route. The output is body-inner HTML the
 * browser pane renders with the reader's own typography.
 *
 * @module @deepseek-ai/dsh-experimental-epub-reader/sanitize
 */

import { XMLParser } from 'fast-xml-parser'
import { dirOf, resolveHref } from './epub.ts'

/** One node of `preserveOrder` parser output. */
type OrderNode = Record<string, unknown>

/** How the sanitizer treats one tag name. */
type TagPolicy = 'keep' | 'drop' | 'unwrap'

/** Tags whose entire subtree is removed. */
const DROPPED_TAGS = new Set([
  'script', 'style', 'link', 'meta', 'title', 'head', 'iframe', 'object', 'embed', 'form',
  'input', 'button', 'select', 'option', 'textarea', 'video', 'audio', 'source', 'track',
  'canvas', 'map', 'area', 'noscript', 'template', 'frame', 'frameset', 'base', 'applet',
])

/** Tags kept with their children; attributes still filtered. */
const KEPT_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'em', 'strong', 'b', 'i', 'u', 's', 'small',
  'cite', 'q', 'br', 'hr', 'blockquote', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table',
  'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'img', 'figure', 'figcaption', 'div',
  'span', 'section', 'aside', 'header', 'footer', 'pre', 'code', 'sup', 'sub', 'ruby',
  'rt', 'rp', 'svg', 'image', 'del', 'ins', 'mark', 'abbr', 'dfn', 'kbd', 'samp', 'var',
  'wbr', 'address',
])

/** Tags serialized without a closing tag. */
const VOID_TAGS = new Set(['br', 'hr', 'img', 'wbr'])

/** Attribute allowlist per kept tag; `*` applies to every kept tag. */
const KEPT_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  '*': [],
  img: ['src', 'alt', 'width', 'height'],
  image: ['href', 'width', 'height'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
  ol: ['start'],
  svg: ['width', 'height', 'viewBox', 'preserveAspectRatio'],
}

/** Media types the resource route serves, by file extension. */
export const RESOURCE_MEDIA_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
}

/** The image extensions a chapter reference may name. */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.bmp'])

const parser = new XMLParser({ preserveOrder: true, removeNSPrefix: true, ignoreAttributes: false, trimValues: false })

/** Escapes one text run for HTML output. */
function escapeHtml(text: string): string {
  return text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
}

/** Whether one value is a parser order node. */
function isOrderNode(value: unknown): value is OrderNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Tag name of one order node, when the node is an element. */
function tagNameOf(node: OrderNode): string | undefined {
  for (const key of Object.keys(node)) {
    if (key === ':@' || key === '#text') continue
    return key
  }
  return undefined
}

/** Children array of one order node. */
function childrenOf(node: OrderNode, tag: string): OrderNode[] {
  const children = node[tag]
  return Array.isArray(children) ? children.filter(isOrderNode) : []
}

/** Attribute map of one order node. */
function attributesOf(node: OrderNode): Record<string, string> {
  const attrs = node[':@']
  if (!isOrderNode(attrs)) return {}
  const flat: Record<string, string> = {}
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === 'string') flat[key.replace(/^@_/u, '')] = value
  }
  return flat
}

/** How the sanitizer treats one tag. */
function policyOf(tag: string): TagPolicy {
  if (DROPPED_TAGS.has(tag)) return 'drop'
  if (KEPT_TAGS.has(tag)) return 'keep'
  return 'unwrap'
}

/** A resource resolver maps one interior path to a servable URL, or null to drop it. */
type ResolveResource = (reference: string) => string | null

/** Filter one element's attributes down to the allowlist, rewriting references. */
function attributesFor(tag: string, raw: Record<string, string>, baseDir: string, resolveResource: ResolveResource): string {
  const allowed = new Set(KEPT_ATTRIBUTES[tag] ?? KEPT_ATTRIBUTES['*'])
  const parts: string[] = []
  for (const [name, value] of Object.entries(raw)) {
    if (!allowed.has(name)) continue
    if (tag === 'img' && name === 'src') {
      const url = imageReferenceUrl(value, baseDir, resolveResource)
      if (url === null) continue
      parts.push(` src="${escapeHtml(url)}"`)
      continue
    }
    if (tag === 'image' && name === 'href') {
      const url = imageReferenceUrl(value, baseDir, resolveResource)
      if (url === null) continue
      parts.push(` href="${escapeHtml(url)}"`)
      continue
    }
    parts.push(` ${name}="${escapeHtml(value)}"`)
  }
  return parts.join('')
}

/**
 * Resolve one image reference onto the Fetch route; null blocks external and
 * non-image references.
 */
function imageReferenceUrl(reference: string, baseDir: string, resolveResource: ResolveResource): string | null {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/iu.test(reference)) return null
  const path = resolveHref(baseDir, reference)
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase()
  if (!IMAGE_EXTENSIONS.has(extension)) return null
  return resolveResource(path)
}

/**
 * Serialize one parsed node list under the allowlist.
 * @returns the sanitized HTML fragment.
 */
function serializeNodes(nodes: readonly OrderNode[], baseDir: string, resolveResource: ResolveResource): string {
  const parts: string[] = []
  for (const node of nodes) {
    const text = typeof node['#text'] === 'string' ? node['#text'] : undefined
    if (text !== undefined) {
      parts.push(escapeHtml(text))
      continue
    }
    const tag = tagNameOf(node)
    if (tag === undefined) continue
    const policy = policyOf(tag)
    if (policy === 'drop') continue
    const children = childrenOf(node, tag)
    if (policy === 'unwrap') {
      parts.push(serializeNodes(children, baseDir, resolveResource))
      continue
    }
    const attributes = attributesFor(tag, attributesOf(node), baseDir, resolveResource)
    if (VOID_TAGS.has(tag)) {
      parts.push(`<${tag}${attributes}>`)
      continue
    }
    parts.push(`<${tag}${attributes}>${serializeNodes(children, baseDir, resolveResource)}</${tag}>`)
  }
  return parts.join('')
}

/** All element nodes below one node list, in document order. */
function elementsBelow(nodes: readonly OrderNode[], tag: string): OrderNode[] {
  const found: OrderNode[] = []
  const walk = (list: readonly OrderNode[]): void => {
    for (const node of list) {
      const name = tagNameOf(node)
      if (name === undefined) continue
      if (name === tag) found.push(node)
      walk(childrenOf(node, name))
    }
  }
  walk(nodes)
  return found
}

/**
 * Sanitize one chapter document into body-inner HTML.
 * @param xhtml - the chapter's raw XHTML text.
 * @param chapterPath - the chapter's book-interior path, for relative references.
 * @param resolveResource - maps one interior resource path to a servable URL, or null to drop it.
 * @returns the sanitized HTML fragment; empty when nothing survives.
 */
export function sanitizeChapter(xhtml: string, chapterPath: string, resolveResource: ResolveResource): string {
  let document: OrderNode[]
  try {
    document = parser.parse(xhtml) as OrderNode[]
  } catch {
    return ''
  }
  if (!Array.isArray(document)) return ''
  const bodies = elementsBelow(document, 'body')
  const baseDir = dirOf(chapterPath)
  if (bodies.length === 0) return serializeNodes(document, baseDir, resolveResource)
  const html = bodies.map(body => serializeNodes(childrenOf(body, 'body'), baseDir, resolveResource)).join('')
  return html
}
