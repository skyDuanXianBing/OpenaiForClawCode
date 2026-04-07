import { getAPIProvider, type APIProvider } from '../providers.js'
import type { ModelProvider, SelectedModel } from '../types.js'
import {
  getDescriptorForSelectedModel,
  getModelRegistry,
  resolveCapability,
} from './registry.js'
import type { ModelCapability, ModelDescriptor } from './types.js'

function inferNativeRegistryProvider(model: string): 'anthropic' | 'openai' {
  const normalizedModel = model.toLowerCase()
  return normalizedModel.includes('gpt-') || normalizedModel.includes('codex')
    ? 'openai'
    : 'anthropic'
}

export function toModelProvider(
  provider: APIProvider | ModelProvider | undefined,
): ModelProvider {
  if (!provider || provider === 'firstParty') {
    return 'anthropic'
  }
  return provider
}

export function resolveSelectedModelForLookup(
  model: string,
  providerHint?: APIProvider | ModelProvider,
): SelectedModel | undefined {
  const trimmedModel = model.trim()
  if (!trimmedModel) {
    return undefined
  }

  const explicitProvider = providerHint
    ? toModelProvider(providerHint)
    : undefined

  if (explicitProvider) {
    return {
      provider: explicitProvider,
      modelId: trimmedModel,
      source: 'runtime',
      rawInput: trimmedModel,
    }
  }

  const registry = getModelRegistry()
  const matches = (['anthropic', 'openai'] as const)
    .map((provider) =>
      registry.listDescriptors({ provider, visibility: 'public' }).find((descriptor) => {
        return descriptor.modelId.toLowerCase() === trimmedModel.toLowerCase()
      }),
    )
    .filter((descriptor): descriptor is ModelDescriptor => Boolean(descriptor))

  if (matches.length !== 1) {
    return {
      provider: toModelProvider(getAPIProvider()),
      modelId: trimmedModel,
      source: 'runtime',
      rawInput: trimmedModel,
    }
  }

  return {
    provider: matches[0].provider,
    modelId: matches[0].modelId,
    source: 'runtime',
    rawInput: trimmedModel,
  }
}

export function getDescriptorForModelInput(
  model: string,
  options: {
    provider?: APIProvider | ModelProvider
    includeHidden?: boolean
  } = {},
): ModelDescriptor | undefined {
  const selectedModel = resolveSelectedModelForLookup(model, options.provider)
  if (!selectedModel) {
    return undefined
  }
  return getDescriptorForSelectedModel(selectedModel, {
    includeHidden: options.includeHidden,
  })
}

export function getCapabilityForModelInput(
  model: string,
  options: {
    provider?: APIProvider | ModelProvider
    includeHidden?: boolean
  } = {},
): ModelCapability | undefined {
  const selectedModel = resolveSelectedModelForLookup(model, options.provider)
  if (!selectedModel) {
    return undefined
  }
  return resolveCapability(selectedModel, { includeHidden: options.includeHidden })
}

/**
 * Native-registry probe used by legacy fallback helpers that historically only
 * distinguished Anthropic vs OpenAI families from the raw model string.
 * Intentionally does not route Claude aliases through cloud overlays.
 */
export function getCapabilityForNativeModelInput(
  model: string,
  options: {
    includeHidden?: boolean
  } = {},
): ModelCapability | undefined {
  return resolveCapability(
    {
      provider: inferNativeRegistryProvider(model),
      modelId: model,
    },
    { includeHidden: options.includeHidden },
  )
}

export function listPublicDescriptorsForProvider(
  provider: ModelProvider,
): ModelDescriptor[] {
  return getModelRegistry().listDescriptors({ provider, visibility: 'public' })
}
