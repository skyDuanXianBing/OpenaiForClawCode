import type { ModelCapability, ModelDescriptor } from './types.js'

const OPENAI_THINKING: ModelCapability['thinking'] = {
  supported: true,
  mode: 'adaptive',
  adaptive: true,
  defaultEnabled: true,
}

const OPENAI_EFFORT: ModelCapability['effort'] = {
  supported: true,
  levels: ['low', 'medium', 'high'],
}

function createOpenAICapability(input: {
  contextWindow: number
  maxOutputTokens: ModelCapability['maxOutputTokens']
  pricing?: ModelCapability['pricing']
}): ModelCapability {
  return {
    contextWindow: input.contextWindow,
    maxOutputTokens: input.maxOutputTokens,
    thinking: OPENAI_THINKING,
    effort: OPENAI_EFFORT,
    pricing: input.pricing ?? {},
  }
}

function createOpenAIDescriptor(input: {
  canonicalId: string
  modelId?: string
  family: ModelDescriptor['family']
  variant: string
  label: string
  publicName: string
  visibility: ModelDescriptor['visibility']
  selectable?: boolean
  legacyInputs?: string[]
  capability: ModelCapability
  lifecycle?: ModelDescriptor['lifecycle']
  metadataNotes?: string[]
}): ModelDescriptor {
  return {
    provider: 'openai',
    canonicalId: input.canonicalId,
    modelId: input.modelId ?? input.canonicalId,
    family: input.family,
    variant: input.variant,
    label: input.label,
    publicName: input.publicName,
    visibility: input.visibility,
    selectable: input.selectable ?? true,
    legacyInputs: input.legacyInputs,
    capability: input.capability,
    lifecycle: input.lifecycle,
    providerPolicy: {
      authMode: 'mixed',
      envApiKey: 'OPENAI_API_KEY',
      envBaseURL: 'OPENAI_BASE_URL',
    },
    metadata: {
      source: 'registry',
      notes: input.metadataNotes,
    },
  }
}

export const OPENAI_MODEL_DESCRIPTORS: ModelDescriptor[] = [
  createOpenAIDescriptor({
    canonicalId: 'gpt-5.4',
    family: 'gpt',
    variant: '5.4',
    label: 'GPT-5.4',
    publicName: 'GPT-5.4',
    visibility: 'public',
    capability: createOpenAICapability({
      contextWindow: 400_000,
      maxOutputTokens: { default: 32_000, upperLimit: 128_000 },
    }),
  }),
  createOpenAIDescriptor({
    canonicalId: 'gpt-5.3-codex',
    family: 'codex',
    variant: '5.3',
    label: 'GPT-5.3 Codex',
    publicName: 'GPT-5.3 Codex',
    visibility: 'public',
    capability: createOpenAICapability({
      contextWindow: 400_000,
      maxOutputTokens: { default: 32_000, upperLimit: 128_000 },
    }),
  }),
]

export const OPENAI_LEGACY_DEFAULT_CAPABILITY = createOpenAICapability({
  contextWindow: 400_000,
  maxOutputTokens: { default: 32_000, upperLimit: 128_000 },
})

export { createOpenAIDescriptor }
