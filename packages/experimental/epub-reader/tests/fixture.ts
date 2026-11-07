/** Programmatically built EPUB fixtures; no binary assets in the repository. */
import { strToU8, zipSync } from 'fflate'

/** One archive member: interior path to UTF-8 text. */
export type FixtureFiles = Record<string, string>

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

function chapter(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head>
<body>${body}</body></html>`
}

/** An EPUB3 fixture: nav-document TOC, declared cover, two chapters. */
export function epub3Fixture(): Uint8Array {
  const files: FixtureFiles = {
    'META-INF/container.xml': CONTAINER,
    'OEBPS/content.opf': `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Sample Book</dc:title>
    <dc:creator>A. Author</dc:creator>
    <dc:language>en</dc:language>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover-image" href="images/cover.jpg" media-type="image/jpeg"/>
    <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/><itemref idref="ch2"/></spine>
</package>`,
    'OEBPS/nav.xhtml': `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body><nav epub:type="toc"><ol>
  <li><a href="text/ch1.xhtml">First Chapter</a></li>
  <li><a href="text/ch2.xhtml">Second Chapter</a></li>
</ol></nav></body></html>`,
    'OEBPS/text/ch1.xhtml': chapter('<h1>One</h1><p>It was the <em>best</em> of times.</p><p class="calibre">Second paragraph.</p>'),
    'OEBPS/text/ch2.xhtml': chapter('<p>Chapter two body.</p>'),
    'OEBPS/images/cover.jpg': 'not-really-jpeg',
  }
  return zipSync({ mimetype: [strToU8('application/epub+zip'), { level: 0 }], ...textFiles(files) })
}

/** An EPUB2 fixture: NCX TOC, no cover declaration. */
export function epub2Fixture(): Uint8Array {
  const files: FixtureFiles = {
    'META-INF/container.xml': CONTAINER,
    'OEBPS/content.opf': `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Old Book</dc:title>
    <dc:creator>Legacy Writer</dc:creator>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`,
    'OEBPS/toc.ncx': `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="n1" playOrder="1"><navLabel><text>Alpha</text></navLabel><content src="c1.xhtml"/></navPoint>
    <navPoint id="n2" playOrder="2"><navLabel><text>Beta</text></navLabel><content src="c2.xhtml"/></navPoint>
  </navMap>
</ncx>`,
    'OEBPS/c1.xhtml': chapter('<p>Alpha body.</p>'),
    'OEBPS/c2.xhtml': chapter('<p>Beta body.</p>'),
  }
  return zipSync({ mimetype: [strToU8('application/epub+zip'), { level: 0 }], ...textFiles(files) })
}

/** Encode every fixture member as archive bytes. */
function textFiles(files: FixtureFiles): Record<string, Uint8Array> {
  const encoded: Record<string, Uint8Array> = {}
  for (const [path, text] of Object.entries(files)) encoded[path] = strToU8(text)
  return encoded
}
