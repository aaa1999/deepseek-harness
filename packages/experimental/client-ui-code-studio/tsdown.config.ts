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

/** Package-local dynamic import the grouping lowers to a require call. */
const DYNAMIC_REQUIRE = /Promise\.resolve\(\)\.then\(\(\)\s*=>\s*require\((['"])(\.\/client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js)\1\)\)/g

/**
 * The async-chunk plugin face this panel rewrites: the preset types the
 * renderChunk call shapes this override must match.
 */
interface AsyncChunkPlugin {
  readonly name?: string
  renderChunk?: (this: unknown, code: string, chunk: unknown, options: unknown) => unknown
}

export default (inline: Parameters<ReturnType<typeof clientBundle>>[0]) => {
  return faces(inline).map(config => {
    const name = (config as { name?: string }).name ?? ''
    if (!name.endsWith('/client')) return config
    for (const plugin of (config.plugins as { name?: string }[])) {
      if (plugin.name !== ASYNC_CHUNK_PLUGIN) continue
      // The grouping changes the call shapes the preset's plugin accepts, so
      // this panel owns the rewrite: every package-local dynamic import keeps
      // its expression tail but reaches the chunk through require.async.
      ;(plugin as AsyncChunkPlugin).renderChunk = function (
        this: unknown, code: string, chunk: unknown, options: unknown,
      ) {
        const rewritten = code.replace(DYNAMIC_REQUIRE, 'Promise.resolve().then(() => require.async($1$2$1))')
        return rewritten === code ? null : rewritten
      }
    }
    // The grouping makes both the entry and the monaco chunk require the
    // 737-byte rolldown runtime chunk synchronously, which the module loader
    // cannot resolve; inline that module into every consumer and drop the
    // chunk instead.
    ;(config.plugins as unknown[]).push({
      name: 'dsh-inline-rolldown-runtime',
      generateBundle(_options: unknown, bundle: Record<string, { type?: string; code?: string }>) {
        const runtimeKey = 'client.rolldown-runtime.js'
        const runtime = bundle[runtimeKey]
        if (runtime === undefined || runtime.type !== 'chunk' || runtime.code === undefined) return
        const head = 'var module={exports:{}};var exports=module.exports;'
        const tail = 'return module.exports'
        const start = runtime.code.indexOf(head)
        const end = runtime.code.lastIndexOf(tail)
        if (start < 0 || end < start + head.length) {
          throw new Error('tsdown: the rolldown runtime chunk lost its expected wrapper shape')
        }
        const body = runtime.code.slice(start + head.length, end)
        const inlined = `(()=>{var module={exports:{}};var exports=module.exports;${body}return module.exports})()`
        for (const [key, output] of Object.entries(bundle)) {
          if (output.type !== 'chunk' || output.code === undefined) continue
          if (output.code.includes('./client.rolldown-runtime.js')) {
            output.code = output.code.replaceAll('require("./client.rolldown-runtime.js")', inlined)
          }
        }
        delete bundle[runtimeKey]
      },
    })
    config.outputOptions = {
      ...config.outputOptions,
      advancedChunks: { groups: [{ name: 'monaco', test: /monaco-editor[\\/]/ }] },
    }
    return config
  })
}
