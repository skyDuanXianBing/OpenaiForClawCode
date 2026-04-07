import chalk from 'chalk'
import React from 'react'
import type { CommandResultDisplay } from '../../commands.js'
import { ModelPicker } from '../../components/ModelPicker.js'
import { COMMON_HELP_ARGS, COMMON_INFO_ARGS } from '../../constants/xml.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { useAppState, useSetAppState } from '../../state/AppState.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import type { EffortLevel } from '../../utils/effort.js'
import { isBilledAsExtraUsage } from '../../utils/extraUsage.js'
import {
  clearFastModeCooldown,
  isFastModeAvailable,
  isFastModeEnabled,
  isFastModeSupportedByModel,
} from '../../utils/fastMode.js'
import { checkOpus1mAccess, checkSonnet1mAccess } from '../../utils/model/check1mAccess.js'
import {
  getDefaultMainLoopModelSetting,
  isOpus1mMergeEnabled,
  renderDefaultModelSetting,
} from '../../utils/model/model.js'
import {
  getActiveSelectedModel,
  getRuntimeModelSettingFromSelectedModel,
} from '../../utils/model/runtimeSelectedModel.js'
import {
  formatSelectedModelDisplay,
  isSelectedModelAllowed,
  parseModelCommandInput,
} from '../../utils/model/selection.js'
import type { SelectedModel } from '../../utils/model/types.js'
import { validateModel } from '../../utils/model/validateModel.js'

function renderModelLabel(
  selectedModel: SelectedModel | null,
  fallbackModel: string | null,
): string {
  if (selectedModel) {
    return formatSelectedModelDisplay(selectedModel)
  }

  const rendered = renderDefaultModelSetting(
    fallbackModel ?? getDefaultMainLoopModelSetting(),
  )
  return fallbackModel === null ? `${rendered} (default)` : rendered
}

function persistModelSelection(
  setAppState: ReturnType<typeof useSetAppState>,
  nextSelectedModel: SelectedModel | null,
) {
  setAppState((previous) => ({
    ...previous,
    selectedModel: nextSelectedModel,
    selectedModelForSession: null,
  }))
}

function applyFastModeResult(params: {
  isFastMode: boolean
  setAppState: ReturnType<typeof useSetAppState>
  modelValue: string | null
}): { messageSuffix: string; wasFastModeToggledOn?: boolean } {
  if (!isFastModeEnabled()) {
    return { messageSuffix: '' }
  }

  clearFastModeCooldown()
  if (!isFastModeSupportedByModel(params.modelValue) && params.isFastMode) {
    params.setAppState((previous) => ({
      ...previous,
      fastMode: false,
    }))
    return {
      messageSuffix: ' · Fast mode OFF',
      wasFastModeToggledOn: false,
    }
  }

  if (
    isFastModeSupportedByModel(params.modelValue) &&
    isFastModeAvailable() &&
    params.isFastMode
  ) {
    return {
      messageSuffix: ' · Fast mode ON',
      wasFastModeToggledOn: true,
    }
  }

  return { messageSuffix: '' }
}

function ModelPickerWrapper({
  onDone,
}: {
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void
}) {
  const selectedModel = useAppState((state) => state.selectedModel)
  const selectedModelForSession = useAppState(
    (state) => state.selectedModelForSession,
  )
  const isFastMode = useAppState((state) => state.fastMode)
  const setAppState = useSetAppState()
  const runtimeSelectedModel = getActiveSelectedModel(
    selectedModel,
    selectedModelForSession,
  )
  const mainLoopModel = getRuntimeModelSettingFromSelectedModel(
    selectedModel,
    null,
  )
  const mainLoopModelForSession = getRuntimeModelSettingFromSelectedModel(
    null,
    selectedModelForSession,
  )

  function handleCancel() {
    logEvent('tengu_model_command_menu', {
      action: 'cancel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    onDone(`Kept model as ${chalk.bold(renderModelLabel(runtimeSelectedModel, mainLoopModel))}`, {
      display: 'system',
    })
  }

  function handleSelect(
    model: string | null,
    effort: EffortLevel | undefined,
    nextSelectedModel?: SelectedModel | null,
  ) {
    logEvent('tengu_model_command_menu', {
      action: model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      from_model:
        mainLoopModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      to_model: model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })

    persistModelSelection(setAppState, nextSelectedModel ?? null)

    let message = `Set model to ${chalk.bold(renderModelLabel(nextSelectedModel ?? null, model))}`
    if (effort !== undefined) {
      message += ` with ${chalk.bold(effort)} effort`
    }

    const fastModeResult = applyFastModeResult({
      isFastMode,
      setAppState,
      modelValue: model,
    })

    if (
      isBilledAsExtraUsage(
        model,
        fastModeResult.wasFastModeToggledOn === true,
        isOpus1mMergeEnabled(),
      )
    ) {
      message += ' · Billed as extra usage'
    }

    message += fastModeResult.messageSuffix
    onDone(message)
  }

  const showFastModeNotice =
    isFastModeEnabled() &&
    isFastMode &&
    isFastModeSupportedByModel(mainLoopModel) &&
    isFastModeAvailable()

  return (
    <ModelPicker
      initial={mainLoopModel}
      sessionModel={mainLoopModelForSession}
      onSelect={handleSelect}
      onCancel={handleCancel}
      isStandaloneCommand
      showFastModeNotice={showFastModeNotice}
    />
  )
}

function SetModelAndClose({
  args,
  onDone,
}: {
  args: string
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void
}): React.ReactNode {
  const isFastMode = useAppState((state) => state.fastMode)
  const selectedModel = useAppState((state) => state.selectedModel)
  const selectedModelForSession = useAppState(
    (state) => state.selectedModelForSession,
  )
  const setAppState = useSetAppState()
  const runtimeSelectedModel = getActiveSelectedModel(
    selectedModel,
    selectedModelForSession,
  )

  React.useEffect(() => {
    async function handleModelChange(): Promise<void> {
      if (args === 'default') {
        persistModelSelection(setAppState, null)
        onDone(`Set model to ${chalk.bold(renderModelLabel(null, null))}`)
        return
      }

      let nextSelectedModel: SelectedModel
      try {
        nextSelectedModel = parseModelCommandInput({
          input: args,
          currentSelectedModel: runtimeSelectedModel,
        })
      } catch (error) {
        onDone(error instanceof Error ? error.message : String(error), {
          display: 'system',
        })
        return
      }

      if (!isSelectedModelAllowed(nextSelectedModel)) {
        onDone(
          `Model '${nextSelectedModel.modelId}' is not available. Your organization restricts model selection.`,
          { display: 'system' },
        )
        return
      }

      if (isOpus1mUnavailable(nextSelectedModel.modelId)) {
        onDone(
          'Opus 4.6 with 1M context is not available for your account. Learn more: https://code.claude.com/docs/en/model-config#extended-context-with-1m',
          { display: 'system' },
        )
        return
      }

      if (isSonnet1mUnavailable(nextSelectedModel.modelId)) {
        onDone(
          'Sonnet 4.6 with 1M context is not available for your account. Learn more: https://code.claude.com/docs/en/model-config#extended-context-with-1m',
          { display: 'system' },
        )
        return
      }

      const validationResult = await validateModel(nextSelectedModel, {
        currentSelectedModel: runtimeSelectedModel,
      })
      if (!validationResult.valid) {
        onDone(validationResult.error ?? `Model '${args}' not found`, {
          display: 'system',
        })
        return
      }

        persistModelSelection(
          setAppState,
          { ...nextSelectedModel, source: 'runtime' },
        )

      let message = `Set model to ${chalk.bold(renderModelLabel(nextSelectedModel, nextSelectedModel.modelId))}`
      const fastModeResult = applyFastModeResult({
        isFastMode,
        setAppState,
        modelValue: nextSelectedModel.modelId,
      })

      if (
        isBilledAsExtraUsage(
          nextSelectedModel.modelId,
          fastModeResult.wasFastModeToggledOn === true,
          isOpus1mMergeEnabled(),
        )
      ) {
        message += ' · Billed as extra usage'
      }

      message += fastModeResult.messageSuffix
      onDone(message)
    }

    void handleModelChange()
  }, [args, isFastMode, onDone, runtimeSelectedModel, setAppState])

  return null
}

function isOpus1mUnavailable(model: string): boolean {
  const normalizedModel = model.toLowerCase()
  return (
    !checkOpus1mAccess() &&
    !isOpus1mMergeEnabled() &&
    normalizedModel.includes('opus') &&
    normalizedModel.includes('[1m]')
  )
}

function isSonnet1mUnavailable(model: string): boolean {
  const normalizedModel = model.toLowerCase()
  return (
    !checkSonnet1mAccess() &&
    (normalizedModel.includes('sonnet[1m]') ||
      normalizedModel.includes('sonnet-4-6[1m]'))
  )
}

function ShowModelAndClose({
  onDone,
}: {
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void
}) {
  const selectedModel = useAppState((state) => state.selectedModel)
  const selectedModelForSession = useAppState(
    (state) => state.selectedModelForSession,
  )
  const effortValue = useAppState((state) => state.effortValue)
  const mainLoopModel = getRuntimeModelSettingFromSelectedModel(
    selectedModel,
    null,
  )
  const mainLoopModelForSession = getRuntimeModelSettingFromSelectedModel(
    null,
    selectedModelForSession,
  )
  const baseLabel = renderModelLabel(selectedModel, mainLoopModel)
  const effortInfo = effortValue !== undefined ? ` (effort: ${effortValue})` : ''

  if (selectedModelForSession) {
    onDone(
      `Current model: ${chalk.bold(renderModelLabel(selectedModelForSession, mainLoopModelForSession))} (session override from plan mode)\nBase model: ${baseLabel}${effortInfo}`,
    )
    return null
  }

  onDone(`Current model: ${baseLabel}${effortInfo}`)
  return null
}

export const call: LocalJSXCommandCall = async (onDone, _context, rawArgs) => {
  const args = rawArgs?.trim() || ''

  if (COMMON_INFO_ARGS.includes(args)) {
    logEvent('tengu_model_command_inline_help', {
      args: args as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return <ShowModelAndClose onDone={onDone} />
  }

  if (COMMON_HELP_ARGS.includes(args)) {
    onDone(
      'Run /model to open the model selection menu, or /model [provider:model_id] to set the model. Examples: /model anthropic:claude-sonnet-4-6, /model openai:gpt-5.4.',
      {
        display: 'system',
      },
    )
    return
  }

  if (args) {
    logEvent('tengu_model_command_inline', {
      args: args as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return <SetModelAndClose args={args} onDone={onDone} />
  }

  return <ModelPickerWrapper onDone={onDone} />
}
