/** EPUB structure parsing over programmatic fixtures. */
import { describe, expect, it } from 'vitest'
import { dirOf, parseEpub, resolveHref } from '../src/epub.ts'
import { epub2Fixture, epub3Fixture } from './fixture.ts'
import { unzipSync } from 'fflate'

/** The file map of one fixture archive. */
function filesOf(bytes: Uint8Array): Map<string, Uint8Array> {
  return new Map(Object.entries(unzipSync(bytes)))
}

describe('resolveHref', () => {
  it('joins relative paths and resolves parent segments', () => {
    expect(resolveHref('OEBPS/text', '../images/cover.jpg')).toBe('OEBPS/images/cover.jpg')
    expect(resolveHref('', 'OEBPS/content.opf')).toBe('OEBPS/content.opf')
    expect(resolveHref('OEBPS', 'text/ch1.xhtml#frag')).toBe('OEBPS/text/ch1.xhtml')
  })

  it('rejects pure fragments and escapes above the root', () => {
    expect(resolveHref('OEBPS', '#start')).toBe('')
    expect(resolveHref('OEBPS', '../../outside.txt')).toBe('outside.txt')
  })

  it('dirOf splits the last segment', () => {
    expect(dirOf('OEBPS/text/ch1.xhtml')).toBe('OEBPS/text')
    expect(dirOf('root.xhtml')).toBe('')
  })
})

describe('parseEpub', () => {
  it('reads an EPUB3 package with nav TOC and cover metadata', () => {
    const parsed = parseEpub(filesOf(epub3Fixture()))
    expect(parsed.title).toBe('Sample Book')
    expect(parsed.author).toBe('A. Author')
    expect(parsed.language).toBe('en')
    expect(parsed.chapters.map(chapter => chapter.path)).toEqual(['OEBPS/text/ch1.xhtml', 'OEBPS/text/ch2.xhtml'])
    expect(parsed.chapters[0]?.title).toBe('First Chapter')
    expect(parsed.toc).toEqual([
      { title: 'First Chapter', chapterIndex: 0 },
      { title: 'Second Chapter', chapterIndex: 1 },
    ])
    expect(parsed.coverPath).toBe('OEBPS/images/cover.jpg')
  })

  it('reads an EPUB2 package with an NCX TOC and no cover', () => {
    const parsed = parseEpub(filesOf(epub2Fixture()))
    expect(parsed.title).toBe('Old Book')
    expect(parsed.author).toBe('Legacy Writer')
    expect(parsed.language).toBe('')
    expect(parsed.chapters.map(chapter => chapter.path)).toEqual(['OEBPS/c1.xhtml', 'OEBPS/c2.xhtml'])
    expect(parsed.toc).toEqual([
      { title: 'Alpha', chapterIndex: 0 },
      { title: 'Beta', chapterIndex: 1 },
    ])
    expect(parsed.coverPath).toBeNull()
  })

  it('rejects archives without EPUB structure', () => {
    expect(() => parseEpub(new Map())).toThrow(/container/i)
    expect(() => parseEpub(new Map([['META-INF/container.xml', new Uint8Array()]]))).toThrow(/root file/i)
  })
})
