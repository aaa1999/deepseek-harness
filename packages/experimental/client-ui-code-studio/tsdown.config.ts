import { clientBundle } from '../../client/tsdown.client.ts'

// The panel wraps the shared client preset to keep Monaco shippable as one
// self-contained lazy chunk: the module loader resolves a dynamic chunk's
// synchronous requires only against chunks it already carries, so the shared
// language chunks the default split produces never materialize. Grouping every
// monaco-editor module into one named chunk removes those cross-chunk
// requires; the grouping's interop form (require(spec).then((n) => n.t))
// additionally needs rewriting ahead of the preset's async-chunk plugin, whose
// pattern only accepts the bare require call.
const faces = clientBundle(import.meta.dirname, ['lib/types/index.js'], { hostPhase: true })

/** The preset's async-chunk plugin name. */
const ASYNC_CHUNK_PLUGIN = 'dsh-client-async-chunk-require'

/** Dynamic import the grouping emits with a namespace-interop tail. */
const INTEROP_IMPORT = /Promise\.resolve\(\)\.then\(\(\)\s*=>\s*require\((['"])(\.\/client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js)\1\)\)\.then\(\(n\)\s*=>\s*n\.t\)/g

export default (inline: Parameters<ReturnType<typeof clientBundle>>[0]) => {
  return faces(inline).map(config => {
    const name = (config as { name?: string }).name ?? ''
    if (!name.endsWith('/client')) return config
    for (const plugin of (config.plugins as { name?: string }[])) {
      if (plugin.name !== ASYNC_CHUNK_PLUGIN) continue
      const original = (plugin as { renderChunk: (this: unknown, code: string, chunk: unknown, options: unknown) => unknown }).renderChunk
      ;(plugin as unknown as { renderChunk: (this: unknown, code: string, chunk: { dynamicImports?: readonly string[] }, options: unknown) => unknown }).renderChunk = function (
        this: unknown, code: string, chunk: { dynamicImports?: readonly string[] }, options: unknown,
      ) {
        const rewritten = code.replace(INTEROP_IMPORT, 'require.async($1$2$1).then((n) => n.t)')
        try {
          return original.call(this, rewritten, chunk, options)
        } catch (error) {
          // The interop rewrite already produced the plugin's target form for
          // every chunk import — the grouping lists the group's own chunk
          // among its dynamic imports, which never carries a call — so only a
          // genuinely missing import on another chunk rethrows.
          const file = (chunk as { fileName?: string }).fileName
          const covered = (chunk.dynamicImports ?? []).filter(spec => spec !== file).every(spec =>
            rewritten.includes(`require.async("./${spec}")`) || rewritten.includes(`require.async('${spec}')`))
          if (!covered) throw error
          return rewritten === code ? null : rewritten
        }
      }
    }
    config.outputOptions = {
      ...config.outputOptions,
      advancedChunks: { groups: [{ name: 'monaco', test: /monaco-editor[\\/]/ }] },
    }
    return config
  })
}
