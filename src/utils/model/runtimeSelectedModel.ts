import {
  getDefaultMainLoopModelSetting,
  parseUserSpecifiedModel,
  type ModelName,
  type ModelSetting,
} from './model.js'
import { parseModelCommandInput } from './selection.js'
import type { SelectedModel } from './types.js'

export function getActiveSelectedModel(
  selectedModel: SelectedModel | null,
  selectedModelForSession: SelectedModel | null,
): SelectedModel | null {
  return selectedModelForSession ?? selectedModel
}

export function getRuntimeModelSettingFromSelectedModel(
  selectedModel: SelectedModel | null,
  selectedModelForSession: SelectedModel | null,
): ModelSetting {
  const activeSelectedModel = getActiveSelectedModel(
    selectedModel,
    selectedModelForSession,
  )

  if (!activeSelectedModel) {
    return null
  }

  return activeSelectedModel.modelId
}

export function getRuntimeModelNameFromSelectedModel(
  selectedModel: SelectedModel | null,
  selectedModelForSession: SelectedModel | null,
): ModelName {
  return parseUserSpecifiedModel(
    getRuntimeModelSettingFromSelectedModel(
      selectedModel,
      selectedModelForSession,
    ) ?? getDefaultMainLoopModelSetting(),
  )
}

export function createRuntimeSelectedModelFromValue(
  modelValue: string | null,
  currentSelectedModel?: SelectedModel | null,
): SelectedModel | null {
  if (modelValue === null) {
    return null
  }

  try {
    return parseModelCommandInput({
      input: modelValue,
      currentSelectedModel,
    })
  } catch {
    return {
      provider: currentSelectedModel?.provider ?? 'anthropic',
      modelId: modelValue,
      source: 'runtime',
      rawInput: modelValue,
    }
  }
}
