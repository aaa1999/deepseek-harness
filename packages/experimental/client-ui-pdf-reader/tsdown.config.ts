/** Bundle the PDF reader client with an inlined same-version PDF.js runtime. */
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { UserConfig } from 'tsdown'
import { clientBundle } from '../../client/tsdown.client.ts'

const bundle = clientBundle(import.meta.dirname, ['lib/types/index.js'], {
  clientBanner: fileName => fileName.endsWith('client.js') ? pdfLicenseBanner() : undefined,
})
const require = createRequire(import.meta.url)
const workerSpecifier = 'pdfjs-dist/build/pdf.worker.min.mjs?raw'
const workerModule = '\0dsh-pdf-reader-worker.mjs'

/** License files for PDF.js and the data embedded beside its runtime. */
function pdfLicenseFiles(root: string): string[] {
  return ['LICENSE', ...['cmaps', 'standard_fonts', 'wasm'].flatMap(directory =>
    readdirSync(join(root, directory)).filter(name => name.startsWith('LICENSE')).sort()
      .map(name => `${directory}/${name}`),
  )]
}

/** Keep every bundled PDF.js license visible in the published client artifact. */
function pdfLicenseBanner(): string {
  const root = join(require.resolve('pdfjs-dist/package.json'), '..')
  const notice = pdfLicenseFiles(root).map(name =>
    `${name}\n\n${readFileSync(join(root, name), 'utf8').trimEnd()}`,
  ).join('\n\n')
  return ['//! Bundled PDF.js license notices', ...notice.split('\n').map(line => `// ${line}`)].join('\n')
}

/** Keep font mappings and image decoders in the same artifact as its PDF.js runtime. */
function pdfAssets(): string {
  const root = join(require.resolve('pdfjs-dist/package.json'), '..')
  return JSON.stringify(Object.fromEntries([
    ['cMapUrl', 'cmaps'], ['standardFontDataUrl', 'standard_fonts'], ['wasmUrl', 'wasm'],
  ].map(([kind, directory]) => [kind, Object.fromEntries(
    readdirSync(join(root, directory!)).filter(name => !name.startsWith('LICENSE')).sort()
      .map(name => [name, readFileSync(join(root, directory!, name)).toString('base64')]),
  )])))
}

/** The dynamic client factory has no module URL from which to resolve a Worker file. */
const pdfWorker: NonNullable<UserConfig['plugins']> = [{
  name: 'dsh-pdf-reader-worker-source',
  resolveId(source) {
    return source === workerSpecifier ? workerModule : null
  },
  load(id) {
    if (id !== workerModule) return null
    const path = require.resolve('pdfjs-dist/build/pdf.worker.min.mjs')
    this.addWatchFile(path)
    return `export default ${JSON.stringify(readFileSync(path, 'utf8'))};`
  },
}]

export default (options: Parameters<typeof bundle>[0]): UserConfig[] => bundle(options).map(config =>
  config.name?.endsWith('/client') === true ? {
    ...config,
    inputOptions: {
      ...config.inputOptions,
      resolve: { ...config.inputOptions?.resolve, mainFields: ['browser', 'module', 'main'], aliasFields: [['browser']] },
    },
    plugins: [config.plugins, pdfWorker],
    define: { ...config.define, __DSH_PDF_READER_ASSETS__: pdfAssets() },
  } : config,
)
