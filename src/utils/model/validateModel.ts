import { MODEL_ALIASES } from './aliases.js'
import { isSelectedModelAllowed } from './selection.js'
import type { SelectedModel } from './types.js'
import { getProviderClient } from '../../services/api/providerRouter.js'

const validModelCache = new Map<string, boolean>()

type ValidateModelOptions = {
  currentSelectedModel?: SelectedModel | null
}

function parseExplicitSelectedModel(input: string): SelectedModel {
  const trimmedInput = input.trim()
  if (!trimmedInput) {
    throw new Error('Model name cannot be empty')
  }

  const explicitMatch = trimmedInput.match(/^([a-z]+):(.*)$/i)
  if (!explicitMatch) {
    throw new Error('Model validation now requires provider:model input')
  }

  const provider = explicitMatch[1]?.trim().toLowerCase()
  const modelId = explicitMatch[2]?.trim()

  if (
    provider !== 'anthropic' &&
    provider !== 'openai' &&
    provider !== 'bedrock' &&
    provider !== 'vertex' &&
    provider !== 'foundry'
  ) {
    throw new Error(`Unsupported provider: ${provider}`)
  }

  if (!modelId) {
    throw new Error('provider:model is missing the model segment')
  }

  return {
    provider,
    modelId,
    source: 'runtime',
    rawInput: trimmedInput,
  }
}

function resolveSelectedModelInput(
  input: string | SelectedModel,
): SelectedModel {
  if (typeof input !== 'string') {
    return input
  }

  const trimmedInput = input.trim()
  if (!trimmedInput) {
    throw new Error('Model name cannot be empty')
  }

  return parseExplicitSelectedModel(trimmedInput)
}

function getCacheKey(selectedModel: Pick<SelectedModel, 'provider' | 'modelId'>): string {
  return `${selectedModel.provider}:${selectedModel.modelId}`
}

/**
 * Provider-aware model validation.
 * Anthropic / OpenAI / bedrock / vertex / foundry are routed explicitly.
 */
export async function validateModel(
  input: string | SelectedModel,
  _options: ValidateModelOptions = {},
): Promise<{ valid: boolean; error?: string }> {
  let selectedModel: SelectedModel
  try {
    selectedModel = resolveSelectedModelInput(input)
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }

  const normalizedModel = selectedModel.modelId.trim()
  if (!normalizedModel) {
    return { valid: false, error: 'Model name cannot be empty' }
  }

  if (!isSelectedModelAllowed(selectedModel)) {
    return {
      valid: false,
      error: `Model '${normalizedModel}' is not in the list of available models`,
    }
  }

  const lowerModel = normalizedModel.toLowerCase()
  if ((MODEL_ALIASES as readonly string[]).includes(lowerModel)) {
    return { valid: true }
  }

  const cacheKey = getCacheKey(selectedModel)
  if (validModelCache.has(cacheKey)) {
    return { valid: true }
  }

  const providerClient = getProviderClient(selectedModel)
  const result = await providerClient.validateModel({ selectedModel })
  if (result.valid) {
    validModelCache.set(cacheKey, true)
  }

  return result
}
