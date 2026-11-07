/**
 * Pure EPUB structure parsing over an in-memory file map.
 *
 * @module @deepseek-ai/dsh-experimental-epub-reader/epub
 */

import { XMLParser } from 'fast-xml-parser'
import type { TocEntry } from './types.ts'

/** One spine document in reading order. */
export interface SpineChapter {
  /** Book-interior path of the XHTML document. */
  readonly path: string
  /** Fallback title used when the TOC names nothing for this chapter. */
  readonly title: string | null
}

/** The structural answer one parsed EPUB yields. */
export interface ParsedEpub {
  readonly title: string
  readonly author: string
  readonly language: string
  /** Spine documents in reading order. */
  readonly chapters: readonly SpineChapter[]
  /** TOC entries resolved onto spine indexes. */
  readonly toc: readonly TocEntry[]
  /** Book-interior path of the cover image, when one is declared. */
  readonly coverPath: string | null
}

/** Files of one EPUB archive, keyed by their interior ZIP path. */
export type EpubFiles = ReadonlyMap<string, Uint8Array>

/** Error raised for an archive that is not a usable EPUB. */
export class EpubFormatError extends Error {
  override name = 'EpubFormatError'

  constructor(reason: string) {
    super(`Invalid EPUB: ${reason}`)
  }
}

const XHTML_MEDIA_TYPES = new Set(['application/xhtml+xml', 'text/html'])

/** Parser configuration shared by every XML document an EPUB carries. */
const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  isArray: name => ['rootfile', 'item', 'itemref', 'title', 'creator', 'language', 'meta', 'nav', 'a', 'li', 'navPoint'].includes(name),
})

/** Decode one archive member as UTF-8 text. */
function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/u, '')
}

/** First array-or-scalar member of an element that repeats. */
function listOf<T>(value: T[] | T | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value]
}

/** Attribute or text child of one parsed element, when present. */
function attrOf(node: unknown, name: string): string | undefined {
  if (typeof node !== 'object' || node === null) return undefined
  const value = (node as Record<string, unknown>)[`@_${name}`]
  return typeof value === 'string' ? value : undefined
}

/** Normalize one href against the directory of the document that references it. */
export function resolveHref(baseDir: string, href: string): string {
  const withoutFragment = href.split('#')[0] ?? ''
  if (withoutFragment === '') return ''
  const stacked = [...baseDir.split('/').filter(segment => segment !== '' && segment !== '.'), ...withoutFragment.split('/')]
  const resolved: string[] = []
  for (const segment of stacked) {
    if (segment === '.' || segment === '') continue
    if (segment === '..') resolved.pop()
    else resolved.push(segment)
  }
  return resolved.join('/')
}

/** Directory portion of one interior path, as `resolveHref` takes it. */
export function dirOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}

/** The first text content of an element, joining nested runs. */
function textOf(node: unknown): string {
  if (typeof node === 'string') return node
  if (typeof node !== 'object' || node === null) return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === '#text') parts.push(...listOf(value).filter(part => typeof part === 'string'))
    else if (!key.startsWith('@_')) for (const child of listOf(value)) parts.push(textOf(child))
  }
  return parts.join('').replace(/\s+/gu, ' ').trim()
}

interface OpfManifestItem {
  readonly id: string
  readonly href: string
  readonly mediaType: string
  readonly properties: string
  readonly path: string
}

interface OpfShape {
  package?: {
    metadata?: Record<string, unknown>
    manifest?: { item?: unknown[] }
    spine?: { itemref?: unknown[] } & Record<string, unknown>
  }
}

/** Collect every `a` element below one parsed node, in document order. */
function anchorsBelow(node: unknown, sink: { href: string; text: string }[]): void {
  if (Array.isArray(node)) {
    for (const child of node) anchorsBelow(child, sink)
    return
  }
  if (typeof node !== 'object' || node === null) return
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'a') {
      for (const anchor of listOf(value)) {
        const href = attrOf(anchor, 'href')
        if (typeof href === 'string' && href !== '') sink.push({ href, text: textOf(anchor) })
      }
    }
    if (!key.startsWith('@_') && key !== 'a') anchorsBelow(value, sink)
  }
}

/** Flatten one NCX navMap into ordered label/source pairs. */
function ncxPoints(node: unknown, sink: { href: string; text: string }[]): void {
  for (const point of listOf((node as { navPoint?: unknown } | undefined)?.navPoint)) {
    const record = point as { navLabel?: unknown; content?: unknown; navPoint?: unknown }
    const text = textOf(record.navLabel)
    const src = attrOf(record.content, 'src')
    if (typeof src === 'string' && src !== '') sink.push({ href: src, text })
    ncxPoints(record, sink)
  }
}

/**
 * Parse container, package document, and TOC of one EPUB file map.
 * @param files - archive members keyed by interior path.
 * @returns the book's structural description.
 * @throws {EpubFormatError} when the archive lacks a usable EPUB structure.
 */
export function parseEpub(files: EpubFiles): ParsedEpub {
  const containerBytes = files.get('META-INF/container.xml')
  if (containerBytes === undefined) throw new EpubFormatError('missing META-INF/container.xml')
  const container = parser.parse(decodeText(containerBytes)) as { container?: { rootfiles?: { rootfile?: unknown[] } } }
  const rootFiles = listOf(container.container?.rootfiles?.rootfile)
  const opfPath = rootFiles.map(file => attrOf(file, 'full-path')).find(path => path !== undefined && files.has(path))
  if (opfPath === undefined) throw new EpubFormatError('container names no readable root file')

  const opfBytes = files.get(opfPath)
  if (opfBytes === undefined) throw new EpubFormatError('container names no readable root file')
  const opf = (parser.parse(decodeText(opfBytes)) as OpfShape).package
  if (opf === undefined) throw new EpubFormatError('package document has no package element')
  const opfDir = dirOf(opfPath)
  const metadata = opf.metadata ?? {}

  const manifestById = new Map<string, OpfManifestItem>()
  for (const raw of listOf(opf.manifest?.item)) {
    const id = attrOf(raw, 'id'), href = attrOf(raw, 'href')
    if (id === undefined || href === undefined) continue
    const mediaType = attrOf(raw, 'media-type') ?? ''
    manifestById.set(id, {
      id,
      href,
      mediaType,
      properties: attrOf(raw, 'properties') ?? '',
      path: resolveHref(opfDir, href),
    })
  }
  if (manifestById.size === 0) throw new EpubFormatError('package manifest is empty')

  const chapterPaths: string[] = []
  for (const itemref of listOf(opf.spine?.itemref)) {
    const idref = attrOf(itemref, 'idref')
    const item = idref === undefined ? undefined : manifestById.get(idref)
    if (item === undefined || !XHTML_MEDIA_TYPES.has(item.mediaType)) continue
    chapterPaths.push(item.path)
  }
  if (chapterPaths.length === 0) throw new EpubFormatError('spine names no XHTML document')

  // TOC source: EPUB3 nav property, else the NCX the spine names.
  const navItem = [...manifestById.values()].find(item => item.properties.split(/\s+/u).includes('nav'))
  const anchors: { href: string; text: string }[] = []
  let tocSourcePath: string | undefined
  const navBytes = navItem === undefined ? undefined : files.get(navItem.path)
  if (navItem !== undefined && navBytes !== undefined) {
    tocSourcePath = navItem.path
    anchorsBelow(parser.parse(decodeText(navBytes)), anchors)
  } else {
    const tocId = typeof opf.spine?.['@_toc'] === 'string' ? opf.spine['@_toc'] : undefined
    const ncxItem = tocId === undefined ? undefined : manifestById.get(tocId)
    const ncxPath = ncxItem === undefined
      ? [...manifestById.values()].find(item => item.mediaType === 'application/x-dtbncx+xml')?.path
      : ncxItem.path
    const ncxBytes = ncxPath === undefined ? undefined : files.get(ncxPath)
    if (ncxBytes !== undefined) {
      tocSourcePath = ncxPath
      const ncxRoot = parser.parse(decodeText(ncxBytes)) as { ncx?: { navMap?: unknown } }
      ncxPoints(ncxRoot.ncx?.navMap, anchors)
    }
  }
  const tocBaseDir = tocSourcePath === undefined ? opfDir : dirOf(tocSourcePath)

  const chapterIndexByPath = new Map(chapterPaths.map((path, index) => [path, index]))
  const toc: TocEntry[] = []
  const titled = new Map<number, string>()
  for (const anchor of anchors) {
    const chapterIndex = chapterIndexByPath.get(resolveHref(tocBaseDir, anchor.href))
    if (chapterIndex === undefined) continue
    const title = anchor.text === '' ? `第 ${chapterIndex + 1} 节` : anchor.text
    if (!titled.has(chapterIndex)) titled.set(chapterIndex, title)
    toc.push({ title, chapterIndex })
  }

  let coverPath: string | null = null
  const coverMetaId = listOf(metadata.meta).map(meta => attrOf(meta, 'name') === 'cover' ? attrOf(meta, 'content') : undefined).find(id => id !== undefined)
  const coverItem = coverMetaId === undefined
    ? [...manifestById.values()].find(item => item.properties.split(/\s+/u).includes('cover-image'))
    : manifestById.get(coverMetaId)
  if (coverItem !== undefined && files.has(coverItem.path)) coverPath = coverItem.path

  return {
    title: listOf(metadata.title).map(textOf).find(title => title !== '') ?? 'Untitled',
    author: listOf(metadata.creator).map(textOf).find(creator => creator !== '') ?? '',
    language: listOf(metadata.language).map(textOf).find(language => language !== '') ?? '',
    chapters: chapterPaths.map((path, index) => ({ path, title: titled.get(index) ?? null })),
    toc,
    coverPath,
  }
}
