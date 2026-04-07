export const MODEL_PROVIDERS = [
  'anthropic',
  'openai',
  'bedrock',
  'vertex',
  'foundry',
] as const

export type ModelProvider = (typeof MODEL_PROVIDERS)[number]

export const SELECTED_MODEL_SOURCES = [
  'runtime',
  'startup',
  'settings_v2',
  'default',
] as const

export type SelectedModelSource = (typeof SELECTED_MODEL_SOURCES)[number]

export type SelectedModel = {
  provider: ModelProvider
  modelId: string
  source: SelectedModelSource
  rawInput?: string | null
  alias?: string | null
}

export function isModelProvider(value: unknown): value is ModelProvider {
  return (
    typeof value === 'string' &&
    (MODEL_PROVIDERS as readonly string[]).includes(value)
  )
}

export function isSelectedModelSource(
  value: unknown,
): value is SelectedModelSource {
  return (
    typeof value === 'string' &&
    (SELECTED_MODEL_SOURCES as readonly string[]).includes(value)
  )
}
