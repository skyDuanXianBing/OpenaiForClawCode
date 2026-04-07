import { get3PModelCapabilityOverride } from '../modelSupportOverrides.js'
import type { ModelProvider, SelectedModel } from '../types.js'
import { ANTHROPIC_MODEL_DESCRIPTORS } from './anthropic.js'
import { OPENAI_MODEL_DESCRIPTORS } from './openai.js'
import { PROVIDER_DESCRIPTOR_OVERLAYS } from './overlays.js'
import type {
  ListDescriptorsOptions,
  ModelCapability,
  ModelDescriptor,
  ModelRegistry,
  ProviderDescriptorOverlay,
} from './types.js'

const BASE_DESCRIPTORS: readonly ModelDescriptor[] = [
  ...ANTHROPIC_MODEL_DESCRIPTORS,
  ...OPENAI_MODEL_DESCRIPTORS,
]

function normalizeModelId(modelId: string): string {
  return modelId.replace(/\[(1|2)m\]/gi, '').trim().toLowerCase()
}

function cloneCapability(capability: ModelCapability): ModelCapability {
  return {
    ...capability,
    maxOutputTokens: { ...capability.maxOutputTokens },
    thinking: { ...capability.thinking },
    effort: {
      ...capability.effort,
      levels: [...capability.effort.levels],
    },
    pricing: {
      ...capability.pricing,
      standard: capability.pricing.standard
        ? { ...capability.pricing.standard }
        : undefined,
      fast: capability.pricing.fast ? { ...capability.pricing.fast } : undefined,
    },
  }
}

function applyCapabilityOverride(
  capability: ModelCapability,
  capabilityOverride: ProviderDescriptorOverlay['capabilityOverride'],
): ModelCapability {
  if (!capabilityOverride) {
    return cloneCapability(capability)
  }

  return {
    ...capability,
    contextWindow: capabilityOverride.contextWindow ?? capability.contextWindow,
    maxOutputTokens: {
      ...capability.maxOutputTokens,
      ...capabilityOverride.maxOutputTokens,
    },
    supports1M: capabilityOverride.supports1M ?? capability.supports1M,
    thinking: {
      ...capability.thinking,
      ...capabilityOverride.thinking,
    },
    effort: {
      ...capability.effort,
      ...capabilityOverride.effort,
      levels:
        capabilityOverride.effort?.levels ?? [...capability.effort.levels],
    },
    pricing: {
      ...capability.pricing,
      ...capabilityOverride.pricing,
      standard:
        capabilityOverride.pricing?.standard ?? capability.pricing.standard,
      fast: capabilityOverride.pricing?.fast ?? capability.pricing.fast,
    },
  }
}

function createOverlayDescriptor(
  baseDescriptor: ModelDescriptor,
  overlay: ProviderDescriptorOverlay,
): ModelDescriptor {
  return {
    ...baseDescriptor,
    provider: overlay.provider,
    modelId: overlay.modelId,
    visibility: overlay.visibility ?? baseDescriptor.visibility,
    selectable: overlay.selectable ?? baseDescriptor.selectable,
    aliases: overlay.aliases ?? baseDescriptor.aliases,
    legacyInputs: overlay.legacyInputs ?? baseDescriptor.legacyInputs,
    providerPolicy: overlay.providerPolicy ?? baseDescriptor.providerPolicy,
    capability: applyCapabilityOverride(
      baseDescriptor.capability,
      overlay.capabilityOverride,
    ),
    metadata: {
      source: 'registry+overlay',
      notes: [
        ...(baseDescriptor.metadata?.notes ?? []),
        `${overlay.provider}-overlay`,
      ],
    },
  }
}

function buildRegistryDescriptors(): ModelDescriptor[] {
  const byCanonicalId = new Map<string, ModelDescriptor>()

  for (const descriptor of BASE_DESCRIPTORS) {
    if (descriptor.provider === 'anthropic') {
      byCanonicalId.set(descriptor.canonicalId, descriptor)
    }
  }

  const overlayDescriptors: ModelDescriptor[] = []

  for (const overlay of PROVIDER_DESCRIPTOR_OVERLAYS) {
    const baseDescriptor = byCanonicalId.get(overlay.canonicalId)
    if (!baseDescriptor) {
      continue
    }
    overlayDescriptors.push(createOverlayDescriptor(baseDescriptor, overlay))
  }

  return [...BASE_DESCRIPTORS, ...overlayDescriptors]
}

function shouldIncludeDescriptor(
  descriptor: ModelDescriptor,
  options: ListDescriptorsOptions,
): boolean {
  if (options.provider && descriptor.provider !== options.provider) {
    return false
  }

  if (options.visibility && descriptor.visibility !== options.visibility) {
    return false
  }

  if (!options.includeHidden) {
    if (descriptor.visibility === 'hidden') {
      return false
    }
    if (descriptor.selectable === false && !options.visibility) {
      return false
    }
  }

  if (options.visibility === 'public' && descriptor.selectable === false) {
    return false
  }

  return true
}

function getLookupKeys(descriptor: ModelDescriptor): string[] {
  const keys = [descriptor.modelId, descriptor.canonicalId]

  if (descriptor.aliases) {
    keys.push(...descriptor.aliases)
  }

  if (descriptor.legacyInputs) {
    keys.push(...descriptor.legacyInputs)
  }

  return keys.map(normalizeModelId)
}

function findDescriptor(
  descriptors: readonly ModelDescriptor[],
  input: {
    provider: ModelProvider
    modelId: string
    includeHidden?: boolean
  },
): ModelDescriptor | undefined {
  const normalizedModelId = normalizeModelId(input.modelId)

  const hiddenExactMatch = descriptors.find((descriptor) => {
    if (descriptor.provider !== input.provider) {
      return false
    }

    if (descriptor.visibility !== 'hidden') {
      return false
    }

    return getLookupKeys(descriptor).includes(normalizedModelId)
  })

  if (hiddenExactMatch && !input.includeHidden) {
    return undefined
  }

  for (const descriptor of descriptors) {
    if (descriptor.provider !== input.provider) {
      continue
    }

    if (!input.includeHidden && descriptor.visibility === 'hidden') {
      continue
    }

    const lookupKeys = getLookupKeys(descriptor)
    if (lookupKeys.includes(normalizedModelId)) {
      return descriptor
    }
  }

  return undefined
}

function applyDynamicAnthropicCapability(
  capability: ModelCapability,
  selectedModel: Pick<SelectedModel, 'provider' | 'modelId'>,
): ModelCapability {
  return selectedModel.provider === 'anthropic'
    ? cloneCapability(capability)
    : capability
}

function applyThirdPartyOverrideCapability(
  capability: ModelCapability,
  selectedModel: Pick<SelectedModel, 'provider' | 'modelId'>,
): ModelCapability {
  if (
    selectedModel.provider !== 'bedrock' &&
    selectedModel.provider !== 'vertex' &&
    selectedModel.provider !== 'foundry'
  ) {
    return capability
  }

  const nextCapability = cloneCapability(capability)
  const thinkingOverride = get3PModelCapabilityOverride(selectedModel.modelId, 'thinking')
  const adaptiveThinkingOverride = get3PModelCapabilityOverride(
    selectedModel.modelId,
    'adaptive_thinking',
  )
  const effortOverride = get3PModelCapabilityOverride(selectedModel.modelId, 'effort')
  const maxEffortOverride = get3PModelCapabilityOverride(
    selectedModel.modelId,
    'max_effort',
  )

  if (thinkingOverride !== undefined) {
    nextCapability.thinking.supported = thinkingOverride
    nextCapability.thinking.mode = thinkingOverride ? 'budgeted' : 'none'
    nextCapability.thinking.defaultEnabled = thinkingOverride
  }

  if (adaptiveThinkingOverride !== undefined) {
    nextCapability.thinking.adaptive = adaptiveThinkingOverride
    if (adaptiveThinkingOverride) {
      nextCapability.thinking.supported = true
      nextCapability.thinking.mode = 'adaptive'
      nextCapability.thinking.defaultEnabled = true
    }
  }

  if (effortOverride !== undefined) {
    nextCapability.effort.supported = effortOverride
    nextCapability.effort.levels = effortOverride
      ? ['low', 'medium', 'high']
      : []
  }

  if (maxEffortOverride === true) {
    nextCapability.effort.supported = true
    if (!nextCapability.effort.levels.includes('max')) {
      nextCapability.effort.levels = [
        ...nextCapability.effort.levels,
        'max',
      ]
    }
  }

  return nextCapability
}

function applyContextVariantCapability(
  capability: ModelCapability,
  modelId: string,
): ModelCapability {
  const nextCapability = cloneCapability(capability)
  if (/\[1m\]/i.test(modelId) && nextCapability.supports1M) {
    nextCapability.contextWindow = 1_000_000
  }
  return nextCapability
}

class ModelRegistryImpl implements ModelRegistry {
  readonly descriptors: readonly ModelDescriptor[]

  constructor(descriptors: readonly ModelDescriptor[]) {
    this.descriptors = descriptors
  }

  list(
    provider?: ModelProvider,
    options: { includeHidden?: boolean } = {},
  ): ModelDescriptor[] {
    return this.listDescriptors({
      provider,
      includeHidden: options.includeHidden,
    })
  }

  listDescriptors(options: ListDescriptorsOptions = {}): ModelDescriptor[] {
    return this.descriptors.filter((descriptor) =>
      shouldIncludeDescriptor(descriptor, options),
    )
  }

  getDescriptors(options: ListDescriptorsOptions = {}): ModelDescriptor[] {
    return this.listDescriptors(options)
  }

  getDescriptor(input: {
    provider: ModelProvider
    modelId: string
    includeHidden?: boolean
  }): ModelDescriptor | undefined {
    return findDescriptor(this.descriptors, input)
  }

  getDescriptorForSelectedModel(
    selectedModel: Pick<SelectedModel, 'provider' | 'modelId'>,
    options: { includeHidden?: boolean } = {},
  ): ModelDescriptor | undefined {
    return this.getDescriptor({
      provider: selectedModel.provider,
      modelId: selectedModel.modelId,
      includeHidden: options.includeHidden,
    })
  }

  resolveCapability(
    selectedModel: Pick<SelectedModel, 'provider' | 'modelId'>,
    options: { includeHidden?: boolean } = {},
  ): ModelCapability | undefined {
    const descriptor = this.getDescriptorForSelectedModel(selectedModel, options)
    if (!descriptor) {
      return undefined
    }

    let capability = cloneCapability(descriptor.capability)
    capability = applyDynamicAnthropicCapability(capability, selectedModel)
    capability = applyThirdPartyOverrideCapability(capability, selectedModel)
    capability = applyContextVariantCapability(capability, selectedModel.modelId)
    return capability
  }

  getDefaultDescriptor(provider: ModelProvider): ModelDescriptor | undefined {
    return this.listDescriptors({ provider, visibility: 'public' })[0]
  }

  listPublicOpenAIModels(): ModelDescriptor[] {
    return this.listDescriptors({ provider: 'openai', visibility: 'public' })
  }
}

const modelRegistry = new ModelRegistryImpl(buildRegistryDescriptors())

export function getModelRegistry(): ModelRegistry {
  return modelRegistry
}

export function getDescriptorForSelectedModel(
  selectedModel: Pick<SelectedModel, 'provider' | 'modelId'>,
  options: { includeHidden?: boolean } = {},
): ModelDescriptor | undefined {
  return modelRegistry.getDescriptorForSelectedModel(selectedModel, options)
}

export function resolveCapability(
  selectedModel: Pick<SelectedModel, 'provider' | 'modelId'>,
  options: { includeHidden?: boolean } = {},
): ModelCapability | undefined {
  return modelRegistry.resolveCapability(selectedModel, options)
}
