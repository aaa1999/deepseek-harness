/** The chapter allowlist: what survives, what is rewritten, what is dropped. */
import { describe, expect, it } from 'vitest'
import { sanitizeChapter } from '../src/sanitize.ts'

/** The route rewriter a test uses: interior paths become `route:<path>`. */
const route = (path: string): string => `route:${path}`

const BODY = (inner: string): string =>
  `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>${inner}</body></html>`

describe('sanitizeChapter', () => {
  it('keeps prose tags and drops attributes outside the allowlist', () => {
    const html = sanitizeChapter(BODY('<p class="calibre" id="p1" style="margin:0">Plain <em>emphasis</em>.</p>'), 'ch.xhtml', route)
    expect(html).toBe('<p>Plain <em>emphasis</em>.</p>')
  })

  it('drops scripts, styles, handlers, and iframes entirely', () => {
    const html = sanitizeChapter(BODY(
      '<p>before</p><script>alert(1)</script><style>.x{}</style>'
      + '<p onclick="steal()">kept</p><iframe src="https://evil.example"></iframe><p>after</p>',
    ), 'ch.xhtml', route)
    expect(html).toBe('<p>before</p><p>kept</p><p>after</p>')
  })

  it('rewrites interior image references and blocks external or non-image ones', () => {
    const html = sanitizeChapter(BODY(
      '<p><img src="../images/pic.webp" alt="pic"/></p>'
      + '<p><img src="https://evil.example/x.png"/></p>'
      + '<p><img src="text/hidden.txt"/></p>',
    ), 'OEBPS/text/ch.xhtml', route)
    expect(html).toBe('<p><img src="route:OEBPS/images/pic.webp" alt="pic"></p><p><img></p><p><img></p>')
  })

  it('keeps svg image wrappers with their href rewritten', () => {
    const html = sanitizeChapter(BODY('<svg viewBox="0 0 10 10" onload="x()"><image xlink:href="cover.jpg" width="10" height="10"/></svg>'), 'OEBPS/ch.xhtml', route)
    expect(html).toBe('<svg viewBox="0 0 10 10"><image href="route:OEBPS/cover.jpg" width="10" height="10"></image></svg>')
  })

  it('unwraps unknown tags while keeping their text, and escapes text content', () => {
    const html = sanitizeChapter(BODY('<custom><p>a &amp; b</p>tail</custom>'), 'ch.xhtml', route)
    expect(html).toBe('<p>a &amp; b</p>tail')
  })

  it('keeps table and list structure attributes', () => {
    const html = sanitizeChapter(BODY('<table><tr><td colspan="2">x</td></tr></table><ol start="3"><li>y</li></ol>'), 'ch.xhtml', route)
    expect(html).toBe('<table><tr><td colspan="2">x</td></tr></table><ol start="3"><li>y</li></ol>')
  })

  it('returns body-inner content only, tolerating documents without a body', () => {
    const fragment = sanitizeChapter('<?xml version="1.0"?><p>frag</p>', 'ch.xhtml', route)
    expect(fragment).toBe('<p>frag</p>')
  })
})
