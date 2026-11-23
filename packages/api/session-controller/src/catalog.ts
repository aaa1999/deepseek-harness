/** Shared projection of the live LLM registry into the browser model catalog. */

import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'
import type { LlmModelInfo } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type {
  ModelCatalog,
  ModelProviderKeySlot,
  ModelProviderKeySlots,
  ModelReasoning,
  ModelSelection,
} from './types.ts'

/** Uppercase route id over non-alphanumerics: the stem of a derived credential reference. */
function deriveKeyRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/**
 * The key-slot series of one route: the base reference its profile resolves
 * keys through, then its numbered sisters `_2` through `_9`. Mirror of
 * `keySlotRefs` in `packages/client/ui-settings-models/src/client/store.ts`:
 * client packages reference only client packages, so the convention is
 * mirrored here rather than imported — keep the two in step, as `apiKeyFailure`
 * keeps in step with `normalizeApiKey`.
 */
function keySlotRefs(baseRef: string): string[] {
  return [baseRef, ...Array.from({ length: 8 }, (_unused, index) => `${baseRef}_${String(index + 2)}`)]
}

/**
 * The key-slot state of every catalog group a stored key belongs to. Routes
 * without a settings address (nothing a switch could write), the account route
 * (its credential is a sign-in, not a key slot), and routes naming a reference
 * outside the credential-seam grammar contribute nothing. A credential read
 * that fails reads as an unconfigured slot: the block is enrichment for the
 * picker, and a broken store must not take the model list down with it.
 * @param ctx - Host registry, settings, and credential services.
 * @param groupIds - provider routes the catalog carries; only these are probed.
 * @returns provider id to its key-slot state, for groups with at least one stored slot.
 */
async function providerKeyBlocks(
  ctx: Context,
  groupIds: ReadonlySet<string>,
): Promise<Map<string, ModelProviderKeySlots>> {
  const blocks = new Map<string, ModelProviderKeySlots>()
  const settings = ctx.get('settings')
  const credentials = ctx.get('credentials')
  if (settings === undefined || credentials === undefined) return blocks
  const namespaces = settings.describe({ redactSecrets: true })
  for (const provider of ctx.llm.listConfigurableProviders()) {
    if (!groupIds.has(provider.provider) || provider.provider === 'deepseek-account') continue
    let profile: unknown = namespaces.find(namespace => namespace.ns === provider.settingsNs)?.value
    for (const key of provider.settingsPath) {
      profile = typeof profile === 'object' && profile !== null ? Reflect.get(profile, key) : undefined
    }
    const named: unknown = typeof profile === 'object' && profile !== null ? Reflect.get(profile, 'apiKeyEnv') : undefined
    const activeRef = typeof named === 'string' && named.length > 0 ? named : deriveKeyRef(provider.provider)
    if (!isCredentialRefName(activeRef)) continue
    const series = keySlotRefs(activeRef)
    const infos = await Promise.all(series.map(
      ref => credentials.describe(credentialRef(ref)).catch(() => undefined),
    ))
    const slots: ModelProviderKeySlot[] = series.flatMap((ref, index) => {
      const info = infos[index]
      if (info?.configured !== true) return []
      return [{ ref, ...info.masked === undefined ? {} : { masked: info.masked } }]
    })
    if (slots.length > 0) {
      blocks.set(provider.provider, {
        settingsNs: provider.settingsNs,
        settingsPath: [...provider.settingsPath],
        activeRef,
        slots,
      })
    }
  }
  return blocks
}

/**
 * Build the browser model catalog without requiring a Session.
 * @param ctx - Host context carrying the live LLM registry.
 * @param defaultSelection - deployment default used before a Session selects a model.
 * @returns successful non-empty provider groups and isolated provider failures.
 */
export async function buildModelCatalog(
  ctx: Context,
  defaultSelection: ModelSelection = ctx.agentDefaultModel.currentSelection(),
): Promise<ModelCatalog> {
  const providers = ctx.llm.listProviders()
  const catalog = await Promise.all(providers.map(async (provider) => {
    try {
      const models = await ctx.llm.listModels(provider.id)
      const entries = await Promise.all(models.map(async (model) => {
        const resolved = await ctx.llm.resolveModelInfo(provider.id, model.id)
        const reasoning: ModelReasoning | undefined = resolved.reasoning === undefined
          ? undefined
          : {
            efforts: resolved.reasoning.efforts.map(effort => ({
              id: effort.id,
              name: effort.name,
              ...(effort.description === undefined ? {} : { description: effort.description }),
            })),
            ...(resolved.reasoning.defaultEffort === undefined
              ? {}
              : { defaultEffort: resolved.reasoning.defaultEffort }),
          }
        return {
          id: model.id,
          name: model.name,
          ...(model.description === undefined ? {} : { description: model.description }),
          ...(reasoning === undefined ? {} : { reasoning }),
          ...(model.badge === undefined ? {} : { badge: model.badge }),
        }
      }))
      return {
        kind: 'group' as const,
        group: { id: provider.id, name: provider.name, models: entries },
      }
    } catch (error) {
      return {
        kind: 'failure' as const,
        failure: {
          id: provider.id,
          name: provider.name,
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }))
  const loaded = catalog.flatMap(item => item.kind === 'group' ? [item.group] : [])
    .filter(group => group.models.length > 0)
  const keyBlocks = await providerKeyBlocks(ctx, new Set(loaded.map(group => group.id)))
  const groups = loaded.map((group) => {
    const keys = keyBlocks.get(group.id)
    return keys === undefined ? group : { ...group, keys }
  })
  return {
    default: { ...defaultSelection },
    routableProviders: groups.map(group => group.id),
    groups,
    failures: catalog.flatMap(item => item.kind === 'failure' ? [item.failure] : []),
  }
}

/**
 * Check a GUI selection against the current available provider catalog.
 * @param ctx - Host LLM registry.
 * @param selection - stored or explicitly requested selection.
 * @returns whether the exact model is currently advertised as available.
 */
export async function modelAvailable(ctx: Context, selection: ModelSelection): Promise<boolean> {
  if (!ctx.llm.listProviders().some(provider => provider.id === selection.provider)) return false
  let models: readonly LlmModelInfo[]
  try { models = await ctx.llm.listModels(selection.provider) }
  catch (error) {
    throw new RemoteError('session/model-unavailable',
      error instanceof Error ? error.message : String(error),
      { provider: selection.provider, model: selection.model })
  }
  return models.some(model => model.id === selection.model)
}

/**
 * Check configured provider API-key references independently of model availability.
 * @param ctx - Host registry, settings, and credential services.
 * @returns whether any API-key provider has a configured credential.
 */
export async function hasProviderApiKey(ctx: Context): Promise<boolean> {
  const settings = ctx.get('settings')
  const credentials = ctx.get('credentials')
  if (settings === undefined || credentials === undefined) {
    throw new RemoteError('session/provider-credentials-unavailable', 'provider credentials are unavailable', {})
  }
  const namespaces = settings.describe({ redactSecrets: true })
  for (const provider of ctx.llm.listConfigurableProviders()) {
    if (provider.provider === 'deepseek-account') continue
    let profile = namespaces.find(namespace => namespace.ns === provider.settingsNs)?.value
    for (const key of provider.settingsPath) {
      profile = typeof profile === 'object' && profile !== null ? Reflect.get(profile, key) : undefined
    }
    if (typeof profile !== 'object' || profile === null) continue
    const ref: unknown = Reflect.get(profile, 'apiKeyEnv')
    if (typeof ref === 'string' && ref.length > 0
      && (await credentials.describe(credentialRef(ref))).configured) return true
  }
  return false
}
