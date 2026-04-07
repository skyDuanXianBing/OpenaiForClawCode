import type { SettingsJson } from '../settings/types.js'
import {
  getDescriptorForSelectedModel,
  getModelRegistry,
} from './registry/registry.js'
import { isModelAllowed } from './modelAllowlist.js'
import {
  MODEL_PROVIDERS,
  isModelProvider,
  isSelectedModelSource,
  type ModelProvider,
  type SelectedModel,
  type SelectedModelSource,
} from './types.js'

type ResolveInitialSelectedModelInput = {
  runtimeSelectedModel?: SelectedModel | null
  settings?: Pick<SettingsJson, 'selectedModel'> | null
}

type ParseModelCommandInputArgs = {
  input: string
  currentSelectedModel?: SelectedModel | null
}

const DEFAULT_SELECTED_MODEL: SelectedModel = {
  provider: 'anthropic',
  modelId: 'claude-sonnet-4-6',
  source: 'default',
}

function getProviderCommandToken(
  selectedModel: Pick<SelectedModel, 'provider' | 'modelId'>,
): string {
  return `${selectedModel.provider}:${selectedModel.modelId}`
}

function getProviderLabel(provider: ModelProvider): string {
  switch (provider) {
    case 'anthropic':
      return 'Anthropic'
    case 'openai':
      return 'OpenAI'
    case 'bedrock':
      return 'Bedrock'
    case 'vertex':
      return 'Vertex'
    case 'foundry':
      return 'Foundry'
    default:
      return provider
  }
}

function resolveDescriptorSelection(
  provider: ModelProvider,
  rawInput: string,
  source: SelectedModelSource,
): SelectedModel | undefined {
  const normalizedInput = rawInput.trim().toLowerCase()
  const descriptor = getModelRegistry()
    .listDescriptors({ provider, visibility: 'public' })
    .find((candidate) => candidate.modelId.toLowerCase() === normalizedInput)

  if (!descriptor) {
    return undefined
  }

  return {
    provider,
    modelId: descriptor.modelId,
    source,
    rawInput: rawInput.trim(),
  }
}

function resolveExplicitProviderSelection(
  provider: ModelProvider,
  rawModelInput: string,
): SelectedModel {
  const trimmedModelInput = rawModelInput.trim()
  const descriptorSelection = resolveDescriptorSelection(
    provider,
    trimmedModelInput,
    'runtime',
  )
  if (descriptorSelection) {
    return descriptorSelection
  }

  return {
    provider,
    modelId: trimmedModelInput,
    source: 'runtime',
    rawInput: trimmedModelInput,
  }
}

export function parseModelCommandInput({
  input,
  currentSelectedModel,
}: ParseModelCommandInputArgs): SelectedModel {
  const trimmedInput = input.trim()
  if (!trimmedInput) {
    throw new Error('模型名称不能为空')
  }

  const explicitMatch = trimmedInput.match(/^([a-z]+):(.*)$/i)
  if (explicitMatch) {
    const providerToken = explicitMatch[1]?.trim().toLowerCase()
    const modelToken = explicitMatch[2]?.trim()
    if (!isModelProvider(providerToken)) {
      throw new Error(`不支持的 provider: ${providerToken}`)
    }
    if (!modelToken) {
      throw new Error('provider:model 中缺少 model 部分')
    }

    return resolveExplicitProviderSelection(providerToken, modelToken)
  }

  if (currentSelectedModel) {
    const currentProviderSelection = resolveDescriptorSelection(
      currentSelectedModel.provider,
      trimmedInput,
      'runtime',
    )
    if (currentProviderSelection) {
      return currentProviderSelection
    }
  }

  const crossProviderMatches = MODEL_PROVIDERS.map((provider) =>
    resolveDescriptorSelection(provider, trimmedInput, 'runtime'),
  ).filter((selection): selection is SelectedModel => Boolean(selection))

  if (crossProviderMatches.length === 1) {
    return crossProviderMatches[0]
  }

  if (crossProviderMatches.length > 1) {
    const suggestions = crossProviderMatches
      .map((selection) => getProviderCommandToken(selection))
      .join('、')
    throw new Error(
      `模型输入存在歧义，请使用 provider:model。可选：${suggestions}`,
    )
  }

  throw new Error(
    `无法解析模型输入 '${trimmedInput}'。请使用 provider:model 形式。`,
  )
}

export function formatSelectedModelCommandValue(
  selectedModel: Pick<SelectedModel, 'provider' | 'modelId'>,
): string {
  return getProviderCommandToken(selectedModel)
}

export function formatSelectedModelDisplay(
  selectedModel: Pick<SelectedModel, 'provider' | 'modelId'>,
): string {
  const descriptor = getDescriptorForSelectedModel(selectedModel)
  const label = descriptor?.label ?? selectedModel.modelId
  return `${getProviderLabel(selectedModel.provider)} · ${label}`
}

export function getSelectedModelProviderLabel(provider: ModelProvider): string {
  return getProviderLabel(provider)
}

function addAllowlistCandidate(
  candidates: Set<string>,
  provider: ModelProvider,
  value: string | null | undefined,
): void {
  if (!value) {
    return
  }

  const trimmedValue = value.trim()
  if (!trimmedValue) {
    return
  }

  candidates.add(trimmedValue)
  if (!trimmedValue.includes(':')) {
    candidates.add(`${provider}:${trimmedValue}`)
  }
}

export function getSelectedModelAllowlistCandidates(
  selectedModel: Pick<SelectedModel, 'provider' | 'modelId' | 'rawInput' | 'alias'>,
): string[] {
  const candidates = new Set<string>()
  const descriptor = getDescriptorForSelectedModel(selectedModel)

  addAllowlistCandidate(candidates, selectedModel.provider, selectedModel.modelId)
  addAllowlistCandidate(
    candidates,
    selectedModel.provider,
    selectedModel.rawInput ?? undefined,
  )
  addAllowlistCandidate(
    candidates,
    selectedModel.provider,
    selectedModel.alias ?? undefined,
  )

  if (descriptor) {
    addAllowlistCandidate(candidates, selectedModel.provider, descriptor.canonicalId)
    addAllowlistCandidate(candidates, selectedModel.provider, descriptor.modelId)

    for (const alias of descriptor.aliases ?? []) {
      addAllowlistCandidate(candidates, selectedModel.provider, alias)
    }
  }

  return [...candidates]
}

export function isSelectedModelAllowed(
  selectedModel: Pick<SelectedModel, 'provider' | 'modelId' | 'rawInput' | 'alias'>,
): boolean {
  return getSelectedModelAllowlistCandidates(selectedModel).some((candidate) =>
    isModelAllowed(candidate),
  )
}

function normalizeSelectedModel(
  input: unknown,
  fallbackSource: SelectedModelSource,
): SelectedModel | undefined {
  if (!input || typeof input !== 'object') {
    return undefined
  }

  const inputRecord = input as Record<string, unknown>
  if (
    !isModelProvider(inputRecord.provider) ||
    typeof inputRecord.modelId !== 'string' ||
    inputRecord.modelId.trim().length === 0
  ) {
    return undefined
  }

  const selectedModel: SelectedModel = {
    provider: inputRecord.provider,
    modelId: inputRecord.modelId.trim(),
    source: isSelectedModelSource(inputRecord.source)
      ? inputRecord.source
      : fallbackSource,
  }

  if (typeof inputRecord.rawInput === 'string') {
    selectedModel.rawInput = inputRecord.rawInput
  }

  if (typeof inputRecord.alias === 'string') {
    selectedModel.alias = inputRecord.alias
  }

  return selectedModel
}

export function resolveInitialSelectedModel(
  input: ResolveInitialSelectedModelInput,
): SelectedModel {
  const runtimeSelectedModel = normalizeSelectedModel(
    input.runtimeSelectedModel,
    'runtime',
  )
  if (runtimeSelectedModel) {
    return runtimeSelectedModel
  }

  const settingsSelectedModel = normalizeSelectedModel(
    input.settings?.selectedModel,
    'settings_v2',
  )
  if (settingsSelectedModel) {
    return settingsSelectedModel
  }

  return DEFAULT_SELECTED_MODEL
}

export function serializeSelectedModelForSettings(
  input: Partial<SelectedModel> | null | undefined,
): Pick<SettingsJson, 'selectedModel'> {
  if (!input || !isModelProvider(input.provider)) {
    throw new Error('selectedModel.provider is required for persistence')
  }

  if (typeof input.modelId !== 'string' || input.modelId.trim().length === 0) {
    throw new Error('selectedModel.modelId is required for persistence')
  }

  const persistedSelectedModel: NonNullable<SettingsJson['selectedModel']> = {
    provider: input.provider,
    modelId: input.modelId.trim(),
    source: 'settings_v2',
  }

  if (typeof input.rawInput === 'string' && input.rawInput.length > 0) {
    persistedSelectedModel.rawInput = input.rawInput
  }

  if (typeof input.alias === 'string' && input.alias.length > 0) {
    persistedSelectedModel.alias = input.alias
  }

  return {
    selectedModel: persistedSelectedModel,
  }
}
