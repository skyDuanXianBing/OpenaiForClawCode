import type { ModelProvider, SelectedModel } from '../types.js'

export type ModelPricingTier = {
  inputTokens: number
  outputTokens: number
  promptCacheWriteTokens?: number
  promptCacheReadTokens?: number
  webSearchRequests?: number
}

export type ModelPricing = {
  standard?: ModelPricingTier
  fast?: ModelPricingTier
}

export type ModelThinkingMode = 'none' | 'budgeted' | 'adaptive' | 'always_on'

export type RegistryEffortLevel = 'low' | 'medium' | 'high' | 'max'

export type ModelCapability = {
  contextWindow: number
  maxOutputTokens: {
    default: number
    upperLimit: number
  }
  supports1M?: boolean
  thinking: {
    supported: boolean
    mode: ModelThinkingMode
    adaptive?: boolean
    interleaved?: boolean
    defaultEnabled?: boolean
  }
  effort: {
    supported: boolean
    levels: RegistryEffortLevel[]
    defaultLevel?: RegistryEffortLevel
  }
  pricing: ModelPricing
}

export type ModelVisibility = 'public' | 'legacy' | 'hidden'

export type ModelFamily =
  | 'opus'
  | 'sonnet'
  | 'haiku'
  | 'gpt'
  | 'codex'
  | 'custom'

export type ModelDescriptor = {
  provider: ModelProvider
  canonicalId: string
  modelId: string
  family: ModelFamily
  variant: string
  label: string
  publicName: string
  visibility: ModelVisibility
  selectable: boolean
  aliases?: string[]
  legacyInputs?: string[]
  capability: ModelCapability
  lifecycle?: {
    status: 'active' | 'legacy' | 'internal_only'
    replacedBy?: string
  }
  providerPolicy?: {
    authMode: 'apiKey' | 'oauth' | 'cloud' | 'mixed'
    envApiKey?: string
    envBaseURL?: string
  }
  metadata?: {
    source:
      | 'registry'
      | 'registry+overlay'
      | 'registry+remote-capability-cache'
    notes?: string[]
  }
}

export type ModelCapabilityOverride = Partial<{
  contextWindow: number
  maxOutputTokens: Partial<ModelCapability['maxOutputTokens']>
  supports1M: boolean
  thinking: Partial<ModelCapability['thinking']>
  effort: Partial<ModelCapability['effort']>
  pricing: Partial<ModelCapability['pricing']>
}>

export type ProviderDescriptorOverlay = {
  provider: 'bedrock' | 'vertex' | 'foundry'
  canonicalId: string
  modelId: string
  visibility?: ModelVisibility
  selectable?: boolean
  aliases?: string[]
  legacyInputs?: string[]
  capabilityOverride?: ModelCapabilityOverride
  providerPolicy?: ModelDescriptor['providerPolicy']
}

export type ListDescriptorsOptions = {
  provider?: ModelProvider
  visibility?: ModelVisibility
  includeHidden?: boolean
}

export interface ModelRegistry {
  descriptors: readonly ModelDescriptor[]
  list(provider?: ModelProvider, options?: { includeHidden?: boolean }): ModelDescriptor[]
  listDescriptors(options?: ListDescriptorsOptions): ModelDescriptor[]
  getDescriptors(options?: ListDescriptorsOptions): ModelDescriptor[]
  getDescriptor(input: {
    provider: ModelProvider
    modelId: string
    includeHidden?: boolean
  }): ModelDescriptor | undefined
  getDescriptorForSelectedModel(
    selectedModel: Pick<SelectedModel, 'provider' | 'modelId'>,
    options?: { includeHidden?: boolean },
  ): ModelDescriptor | undefined
  resolveCapability(
    selectedModel: Pick<SelectedModel, 'provider' | 'modelId'>,
    options?: { includeHidden?: boolean },
  ): ModelCapability | undefined
  getDefaultDescriptor(provider: ModelProvider): ModelDescriptor | undefined
  listPublicOpenAIModels(): ModelDescriptor[]
}
