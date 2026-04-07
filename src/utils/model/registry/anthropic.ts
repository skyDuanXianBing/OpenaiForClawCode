import type { ModelDescriptor, ModelCapability, ModelPricingTier } from './types.js'

const DEFAULT_CONTEXT_WINDOW = 200_000

const NO_THINKING: ModelCapability['thinking'] = {
  supported: false,
  mode: 'none',
}

const BUDGETED_THINKING: ModelCapability['thinking'] = {
  supported: true,
  mode: 'budgeted',
  defaultEnabled: true,
}

const ADAPTIVE_THINKING: ModelCapability['thinking'] = {
  supported: true,
  mode: 'adaptive',
  adaptive: true,
  defaultEnabled: true,
}

const NO_EFFORT: ModelCapability['effort'] = {
  supported: false,
  levels: [],
}

const STANDARD_EFFORT: ModelCapability['effort'] = {
  supported: true,
  levels: ['low', 'medium', 'high'],
}

const MAX_EFFORT: ModelCapability['effort'] = {
  supported: true,
  levels: ['low', 'medium', 'high', 'max'],
}

const COST_TIER_3_15: ModelPricingTier = {
  inputTokens: 3,
  outputTokens: 15,
  promptCacheWriteTokens: 3.75,
  promptCacheReadTokens: 0.3,
  webSearchRequests: 0.01,
}

const COST_TIER_15_75: ModelPricingTier = {
  inputTokens: 15,
  outputTokens: 75,
  promptCacheWriteTokens: 18.75,
  promptCacheReadTokens: 1.5,
  webSearchRequests: 0.01,
}

const COST_TIER_5_25: ModelPricingTier = {
  inputTokens: 5,
  outputTokens: 25,
  promptCacheWriteTokens: 6.25,
  promptCacheReadTokens: 0.5,
  webSearchRequests: 0.01,
}

const COST_TIER_30_150: ModelPricingTier = {
  inputTokens: 30,
  outputTokens: 150,
  promptCacheWriteTokens: 37.5,
  promptCacheReadTokens: 3,
  webSearchRequests: 0.01,
}

const COST_HAIKU_35: ModelPricingTier = {
  inputTokens: 0.8,
  outputTokens: 4,
  promptCacheWriteTokens: 1,
  promptCacheReadTokens: 0.08,
  webSearchRequests: 0.01,
}

const COST_HAIKU_45: ModelPricingTier = {
  inputTokens: 1,
  outputTokens: 5,
  promptCacheWriteTokens: 1.25,
  promptCacheReadTokens: 0.1,
  webSearchRequests: 0.01,
}

function createCapability(input: {
  maxOutputTokens: ModelCapability['maxOutputTokens']
  supports1M?: boolean
  thinking: ModelCapability['thinking']
  effort: ModelCapability['effort']
  pricing?: ModelCapability['pricing']
}): ModelCapability {
  return {
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxOutputTokens: input.maxOutputTokens,
    supports1M: input.supports1M,
    thinking: input.thinking,
    effort: input.effort,
    pricing: input.pricing ?? {},
  }
}

function createAnthropicDescriptor(input: {
  canonicalId: string
  modelId?: string
  family: ModelDescriptor['family']
  variant: string
  label: string
  publicName: string
  visibility: ModelDescriptor['visibility']
  selectable?: boolean
  aliases?: string[]
  legacyInputs?: string[]
  capability: ModelCapability
  lifecycle?: ModelDescriptor['lifecycle']
}): ModelDescriptor {
  return {
    provider: 'anthropic',
    canonicalId: input.canonicalId,
    modelId: input.modelId ?? input.canonicalId,
    family: input.family,
    variant: input.variant,
    label: input.label,
    publicName: input.publicName,
    visibility: input.visibility,
    selectable: input.selectable ?? true,
    aliases: input.aliases,
    legacyInputs: input.legacyInputs,
    capability: input.capability,
    lifecycle: input.lifecycle,
    providerPolicy: {
      authMode: 'mixed',
      envApiKey: 'ANTHROPIC_API_KEY',
      envBaseURL: 'ANTHROPIC_BASE_URL',
    },
    metadata: {
      source: 'registry',
    },
  }
}

export const ANTHROPIC_MODEL_DESCRIPTORS: ModelDescriptor[] = [
  createAnthropicDescriptor({
    canonicalId: 'claude-sonnet-4-6',
    family: 'sonnet',
    variant: '4.6',
    label: 'Sonnet',
    publicName: 'Sonnet 4.6',
    visibility: 'public',
    aliases: ['sonnet'],
    capability: createCapability({
      maxOutputTokens: { default: 32_000, upperLimit: 128_000 },
      supports1M: true,
      thinking: ADAPTIVE_THINKING,
      effort: STANDARD_EFFORT,
      pricing: { standard: COST_TIER_3_15 },
    }),
  }),
  createAnthropicDescriptor({
    canonicalId: 'claude-opus-4-6',
    family: 'opus',
    variant: '4.6',
    label: 'Opus',
    publicName: 'Opus 4.6',
    visibility: 'public',
    aliases: ['opus', 'best'],
    capability: createCapability({
      maxOutputTokens: { default: 64_000, upperLimit: 128_000 },
      supports1M: true,
      thinking: ADAPTIVE_THINKING,
      effort: MAX_EFFORT,
      pricing: { standard: COST_TIER_5_25, fast: COST_TIER_30_150 },
    }),
  }),
  createAnthropicDescriptor({
    canonicalId: 'claude-haiku-4-5',
    family: 'haiku',
    variant: '4.5',
    label: 'Haiku',
    publicName: 'Haiku 4.5',
    visibility: 'public',
    aliases: ['haiku'],
    legacyInputs: ['claude-haiku-4-5-20251001'],
    capability: createCapability({
      maxOutputTokens: { default: 32_000, upperLimit: 64_000 },
      thinking: BUDGETED_THINKING,
      effort: NO_EFFORT,
      pricing: { standard: COST_HAIKU_45 },
    }),
  }),
  createAnthropicDescriptor({
    canonicalId: 'claude-sonnet-4-5',
    family: 'sonnet',
    variant: '4.5',
    label: 'Sonnet 4.5',
    publicName: 'Sonnet 4.5',
    visibility: 'legacy',
    legacyInputs: ['claude-sonnet-4-5-20250929'],
    capability: createCapability({
      maxOutputTokens: { default: 32_000, upperLimit: 64_000 },
      supports1M: true,
      thinking: BUDGETED_THINKING,
      effort: NO_EFFORT,
      pricing: { standard: COST_TIER_3_15 },
    }),
    lifecycle: { status: 'legacy', replacedBy: 'claude-sonnet-4-6' },
  }),
  createAnthropicDescriptor({
    canonicalId: 'claude-sonnet-4',
    family: 'sonnet',
    variant: '4.0',
    label: 'Sonnet 4',
    publicName: 'Sonnet 4',
    visibility: 'legacy',
    legacyInputs: ['claude-sonnet-4-20250514'],
    capability: createCapability({
      maxOutputTokens: { default: 32_000, upperLimit: 64_000 },
      supports1M: true,
      thinking: BUDGETED_THINKING,
      effort: NO_EFFORT,
      pricing: { standard: COST_TIER_3_15 },
    }),
    lifecycle: { status: 'legacy', replacedBy: 'claude-sonnet-4-6' },
  }),
  createAnthropicDescriptor({
    canonicalId: 'claude-opus-4-5',
    family: 'opus',
    variant: '4.5',
    label: 'Opus 4.5',
    publicName: 'Opus 4.5',
    visibility: 'legacy',
    legacyInputs: ['claude-opus-4-5-20251101'],
    capability: createCapability({
      maxOutputTokens: { default: 32_000, upperLimit: 64_000 },
      thinking: BUDGETED_THINKING,
      effort: NO_EFFORT,
      pricing: { standard: COST_TIER_5_25 },
    }),
    lifecycle: { status: 'legacy', replacedBy: 'claude-opus-4-6' },
  }),
  createAnthropicDescriptor({
    canonicalId: 'claude-opus-4-1',
    family: 'opus',
    variant: '4.1',
    label: 'Opus 4.1',
    publicName: 'Opus 4.1',
    visibility: 'legacy',
    legacyInputs: ['claude-opus-4-1-20250805'],
    capability: createCapability({
      maxOutputTokens: { default: 32_000, upperLimit: 32_000 },
      thinking: BUDGETED_THINKING,
      effort: NO_EFFORT,
      pricing: { standard: COST_TIER_15_75 },
    }),
    lifecycle: { status: 'legacy', replacedBy: 'claude-opus-4-6' },
  }),
  createAnthropicDescriptor({
    canonicalId: 'claude-opus-4',
    family: 'opus',
    variant: '4.0',
    label: 'Opus 4',
    publicName: 'Opus 4',
    visibility: 'legacy',
    legacyInputs: ['claude-opus-4-20250514'],
    capability: createCapability({
      maxOutputTokens: { default: 32_000, upperLimit: 32_000 },
      thinking: BUDGETED_THINKING,
      effort: NO_EFFORT,
      pricing: { standard: COST_TIER_15_75 },
    }),
    lifecycle: { status: 'legacy', replacedBy: 'claude-opus-4-6' },
  }),
  createAnthropicDescriptor({
    canonicalId: 'claude-3-7-sonnet',
    family: 'sonnet',
    variant: '3.7',
    label: 'Claude 3.7 Sonnet',
    publicName: 'Claude 3.7 Sonnet',
    visibility: 'legacy',
    legacyInputs: ['claude-3-7-sonnet-20250219'],
    capability: createCapability({
      maxOutputTokens: { default: 32_000, upperLimit: 64_000 },
      thinking: NO_THINKING,
      effort: NO_EFFORT,
      pricing: { standard: COST_TIER_3_15 },
    }),
    lifecycle: { status: 'legacy', replacedBy: 'claude-sonnet-4-6' },
  }),
  createAnthropicDescriptor({
    canonicalId: 'claude-3-5-sonnet',
    family: 'sonnet',
    variant: '3.5',
    label: 'Claude 3.5 Sonnet',
    publicName: 'Claude 3.5 Sonnet',
    visibility: 'legacy',
    legacyInputs: ['claude-3-5-sonnet-20241022'],
    capability: createCapability({
      maxOutputTokens: { default: 8_192, upperLimit: 8_192 },
      thinking: NO_THINKING,
      effort: NO_EFFORT,
      pricing: { standard: COST_TIER_3_15 },
    }),
    lifecycle: { status: 'legacy', replacedBy: 'claude-sonnet-4-6' },
  }),
  createAnthropicDescriptor({
    canonicalId: 'claude-3-5-haiku',
    family: 'haiku',
    variant: '3.5',
    label: 'Claude 3.5 Haiku',
    publicName: 'Claude 3.5 Haiku',
    visibility: 'legacy',
    legacyInputs: ['claude-3-5-haiku-20241022'],
    capability: createCapability({
      maxOutputTokens: { default: 8_192, upperLimit: 8_192 },
      thinking: NO_THINKING,
      effort: NO_EFFORT,
      pricing: { standard: COST_HAIKU_35 },
    }),
    lifecycle: { status: 'legacy', replacedBy: 'claude-haiku-4-5' },
  }),
  createAnthropicDescriptor({
    canonicalId: 'claude-3-opus',
    family: 'opus',
    variant: '3.0',
    label: 'Claude 3 Opus',
    publicName: 'Claude 3 Opus',
    visibility: 'legacy',
    capability: createCapability({
      maxOutputTokens: { default: 4_096, upperLimit: 4_096 },
      thinking: NO_THINKING,
      effort: NO_EFFORT,
    }),
    lifecycle: { status: 'legacy', replacedBy: 'claude-opus-4-6' },
  }),
  createAnthropicDescriptor({
    canonicalId: 'claude-3-sonnet',
    family: 'sonnet',
    variant: '3.0',
    label: 'Claude 3 Sonnet',
    publicName: 'Claude 3 Sonnet',
    visibility: 'legacy',
    capability: createCapability({
      maxOutputTokens: { default: 8_192, upperLimit: 8_192 },
      thinking: NO_THINKING,
      effort: NO_EFFORT,
    }),
    lifecycle: { status: 'legacy', replacedBy: 'claude-sonnet-4-6' },
  }),
  createAnthropicDescriptor({
    canonicalId: 'claude-3-haiku',
    family: 'haiku',
    variant: '3.0',
    label: 'Claude 3 Haiku',
    publicName: 'Claude 3 Haiku',
    visibility: 'legacy',
    capability: createCapability({
      maxOutputTokens: { default: 4_096, upperLimit: 4_096 },
      thinking: NO_THINKING,
      effort: NO_EFFORT,
    }),
    lifecycle: { status: 'legacy', replacedBy: 'claude-haiku-4-5' },
  }),
]
