import capitalize from 'lodash-es/capitalize.js'
import React, { useMemo, useState } from 'react'
import { useExitOnCtrlCDWithKeybindings } from 'src/hooks/useExitOnCtrlCDWithKeybindings.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  FAST_MODE_MODEL_DISPLAY,
  isFastModeAvailable,
  isFastModeCooldown,
  isFastModeEnabled,
} from 'src/utils/fastMode.js'
import { Box, Text } from '../ink.js'
import { useKeybindings } from '../keybindings/useKeybinding.js'
import { useAppState, useSetAppState } from '../state/AppState.js'
import {
  convertEffortValueToLevel,
  type EffortLevel,
  getDefaultEffortForModel,
  modelSupportsEffort,
  modelSupportsMaxEffort,
  resolvePickerEffortPersistence,
  toPersistableEffort,
} from '../utils/effort.js'
import {
  getDefaultMainLoopModel,
  type ModelSetting,
  modelDisplayString,
  parseUserSpecifiedModel,
} from '../utils/model/model.js'
import {
  getActiveSelectedModel,
  getRuntimeModelSettingFromSelectedModel,
} from '../utils/model/runtimeSelectedModel.js'
import { getModelRegistry } from '../utils/model/registry/registry.js'
import {
  formatSelectedModelCommandValue,
  formatSelectedModelDisplay,
  getSelectedModelProviderLabel,
  isSelectedModelAllowed,
} from '../utils/model/selection.js'
import type { SelectedModel } from '../utils/model/types.js'
import { getSettingsForSource, updateSettingsForSource } from '../utils/settings/settings.js'
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js'
import { Select } from './CustomSelect/index.js'
import { Byline } from './design-system/Byline.js'
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js'
import { Pane } from './design-system/Pane.js'
import { effortLevelToSymbol } from './EffortIndicator.js'

export type Props = {
  initial: string | null
  sessionModel?: ModelSetting
  onSelect: (
    model: string | null,
    effort: EffortLevel | undefined,
    selectedModel?: SelectedModel | null,
  ) => void
  onCancel?: () => void
  isStandaloneCommand?: boolean
  showFastModeNotice?: boolean
  headerText?: string
  skipSettingsWrite?: boolean
}

type ProviderAwareModelOption = {
  value: string
  label: string
  description: string
  selectedModel: SelectedModel | null
  modelId: string | null
}

const NO_PREFERENCE = '__NO_PREFERENCE__'

function resolveInitialSelectedModel(
  initial: string | null,
  runtimeSelectedModel: SelectedModel | null,
): SelectedModel | null {
  if (runtimeSelectedModel) {
    return runtimeSelectedModel
  }

  if (!initial) {
    return null
  }

  const normalizedInitial = initial.trim().toLowerCase()
  if (!normalizedInitial) {
    return null
  }

  const registry = getModelRegistry()
  const matches = (['anthropic', 'openai'] as const)
    .map((provider) =>
      registry.listDescriptors({ provider, visibility: 'public' }).find((descriptor) => {
        return descriptor.modelId.toLowerCase() === normalizedInitial
      }),
    )
    .filter((descriptor) => Boolean(descriptor))

  if (matches.length !== 1) {
    return null
  }

  return {
    provider: matches[0]!.provider,
    modelId: matches[0]!.modelId,
    source: 'runtime',
    rawInput: initial.trim(),
  }
}

function buildProviderAwareOptions(
  runtimeSelectedModel: SelectedModel | null,
): ProviderAwareModelOption[] {
  const options: ProviderAwareModelOption[] = [
    {
      value: NO_PREFERENCE,
      label: 'Default (recommended)',
      description: 'Use the default provider and model for this environment',
      selectedModel: null,
      modelId: null,
    },
  ]
  const registry = getModelRegistry()
  const providers = new Set<'anthropic' | 'openai' | 'bedrock' | 'vertex' | 'foundry'>([
    'anthropic',
    'openai',
  ])

  if (runtimeSelectedModel) {
    providers.add(runtimeSelectedModel.provider)
  }

  for (const provider of providers) {
    const descriptors = registry.listDescriptors({
      provider,
      visibility: 'public',
    })

    for (const descriptor of descriptors) {
      const selectedModel: SelectedModel = {
        provider,
        modelId: descriptor.modelId,
        source: 'runtime',
        rawInput: descriptor.aliases?.[0] ?? descriptor.modelId,
        alias: descriptor.aliases?.[0] ?? null,
      }

      if (!isSelectedModelAllowed(selectedModel)) {
        continue
      }

      options.push({
        value: formatSelectedModelCommandValue(selectedModel),
        label: `${descriptor.label} (${getSelectedModelProviderLabel(provider)})`,
        description: `${getSelectedModelProviderLabel(provider)} · ${descriptor.publicName}`,
        selectedModel,
        modelId: descriptor.modelId,
      })
    }
  }

  if (runtimeSelectedModel) {
    const currentValue = formatSelectedModelCommandValue(runtimeSelectedModel)
    if (!options.some((option) => option.value === currentValue)) {
      options.push({
        value: currentValue,
        label: formatSelectedModelDisplay(runtimeSelectedModel),
        description: 'Current model',
        selectedModel: runtimeSelectedModel,
        modelId: runtimeSelectedModel.modelId,
      })
    }
  }

  return options
}

function resolveOptionModelId(option?: ProviderAwareModelOption): string | undefined {
  if (!option || !option.modelId) {
    return undefined
  }

  return option.modelId === NO_PREFERENCE
    ? getDefaultMainLoopModel()
    : parseUserSpecifiedModel(option.modelId)
}

function EffortLevelIndicator({ effort }: { effort: EffortLevel | undefined }) {
  return <Text color={effort ? 'claude' : 'subtle'}>{effortLevelToSymbol(effort ?? 'low')}</Text>
}

function cycleEffortLevel(
  current: EffortLevel,
  direction: 'left' | 'right',
  includeMax: boolean,
): EffortLevel {
  const levels: EffortLevel[] = includeMax
    ? ['low', 'medium', 'high', 'max']
    : ['low', 'medium', 'high']
  const currentIndex = levels.includes(current)
    ? levels.indexOf(current)
    : levels.indexOf('high')

  if (direction === 'right') {
    return levels[(currentIndex + 1) % levels.length]!
  }

  return levels[(currentIndex - 1 + levels.length) % levels.length]!
}

export function ModelPicker({
  initial,
  sessionModel,
  onSelect,
  onCancel,
  isStandaloneCommand,
  showFastModeNotice,
  headerText,
  skipSettingsWrite,
}: Props) {
  const setAppState = useSetAppState()
  const exitState = useExitOnCtrlCDWithKeybindings()
  const effortValue = useAppState((state) => state.effortValue)
  const selectedModel = useAppState((state) => state.selectedModel)
  const selectedModelForSession = useAppState(
    (state) => state.selectedModelForSession,
  )
  const runtimeSelectedModel = getActiveSelectedModel(
    selectedModel,
    selectedModelForSession,
  )
  const initialSelectedModel = resolveInitialSelectedModel(initial, runtimeSelectedModel)
  const runtimeModelSetting = getRuntimeModelSettingFromSelectedModel(
    selectedModel,
    selectedModelForSession,
  )

  const modelOptions = useMemo(
    () => buildProviderAwareOptions(initialSelectedModel),
    [initialSelectedModel],
  )

  const initialValue =
    initialSelectedModel !== null
      ? formatSelectedModelCommandValue(initialSelectedModel)
      : NO_PREFERENCE

  const [focusedValue, setFocusedValue] = useState(initialValue)
  const [hasToggledEffort, setHasToggledEffort] = useState(false)
  const [effort, setEffort] = useState(
    effortValue !== undefined ? convertEffortValueToLevel(effortValue) : undefined,
  )

  const selectOptions = modelOptions.map((option) => ({
    value: option.value,
    label: option.label,
    description: option.description,
  }))
  const initialFocusValue = selectOptions.some((option) => option.value === initialValue)
    ? initialValue
    : selectOptions[0]?.value

  const focusedOption = modelOptions.find((option) => option.value === focusedValue)
  const focusedModelId = resolveOptionModelId(focusedOption)
  const focusedSupportsEffort = focusedModelId
    ? modelSupportsEffort(focusedModelId)
    : false
  const focusedSupportsMax = focusedModelId
    ? modelSupportsMaxEffort(focusedModelId)
    : false
  const focusedDefaultEffort: EffortLevel = focusedModelId
    ? convertEffortValueToLevel(getDefaultEffortForModel(focusedModelId) ?? 'high')
    : 'high'
  const displayEffort = effort === 'max' && !focusedSupportsMax ? 'high' : effort
  const visibleCount = Math.min(10, selectOptions.length)
  const hiddenCount = Math.max(0, selectOptions.length - visibleCount)

  useKeybindings(
    {
      'modelPicker:decreaseEffort': () => {
        if (!focusedSupportsEffort) {
          return
        }

        setEffort((previous) =>
          cycleEffortLevel(
            previous ?? focusedDefaultEffort,
            'left',
            focusedSupportsMax,
          ),
        )
        setHasToggledEffort(true)
      },
      'modelPicker:increaseEffort': () => {
        if (!focusedSupportsEffort) {
          return
        }

        setEffort((previous) =>
          cycleEffortLevel(
            previous ?? focusedDefaultEffort,
            'right',
            focusedSupportsMax,
          ),
        )
        setHasToggledEffort(true)
      },
    },
    { context: 'ModelPicker' },
  )

  function handleFocus(value: string) {
    setFocusedValue(value)
    if (!hasToggledEffort && effortValue === undefined) {
      const option = modelOptions.find((candidate) => candidate.value === value)
      const optionModelId = resolveOptionModelId(option)
      const nextDefaultEffort = optionModelId
        ? convertEffortValueToLevel(getDefaultEffortForModel(optionModelId) ?? 'high')
        : 'high'
      setEffort(nextDefaultEffort)
    }
  }

  function handleSelect(value: string) {
    logEvent('tengu_model_command_menu_effort', {
      effort: effort as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })

    const option = modelOptions.find((candidate) => candidate.value === value)
    const optionModelId = resolveOptionModelId(option)
    const optionDefaultEffort = optionModelId
      ? convertEffortValueToLevel(getDefaultEffortForModel(optionModelId) ?? 'high')
      : 'high'

    if (!skipSettingsWrite) {
      const effortLevel = resolvePickerEffortPersistence(
        effort,
        optionDefaultEffort,
        getSettingsForSource('userSettings')?.effortLevel,
        hasToggledEffort,
      )
      const persistable = toPersistableEffort(effortLevel)
      if (persistable !== undefined) {
        updateSettingsForSource('userSettings', {
          effortLevel: persistable,
        })
      }
      setAppState((previous) => ({
        ...previous,
        effortValue: effortLevel,
      }))
    }

    const selectedEffort =
      hasToggledEffort && optionModelId && modelSupportsEffort(optionModelId)
        ? effort
        : undefined

    if (!option || option.selectedModel === null) {
      onSelect(null, selectedEffort, null)
      return
    }

    onSelect(option.selectedModel.modelId, selectedEffort, option.selectedModel)
  }

  const content = (
    <Box flexDirection="column">
      <Box marginBottom={1} flexDirection="column">
        <Text color="remember" bold>
          Select model
        </Text>
          <Text dimColor>
            {headerText ??
            '切换 provider 与模型。请使用 provider:model_id，或在列表中直接选择。'}
          </Text>
        {selectedModelForSession ? (
          <Text dimColor>
            Currently using {formatSelectedModelDisplay(selectedModelForSession)} for this
            session (set by plan mode). Selecting a model will undo this.
          </Text>
        ) : sessionModel ? (
          <Text dimColor>
            Currently using {modelDisplayString(sessionModel ?? runtimeModelSetting)} for this session (set by
             plan mode). Selecting a model will undo this.
          </Text>
        ) : null}
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Box flexDirection="column">
          <Select
            defaultValue={initialValue}
            defaultFocusValue={initialFocusValue}
            options={selectOptions}
            onChange={handleSelect}
            onFocus={handleFocus}
            onCancel={onCancel}
            visibleOptionCount={visibleCount}
          />
        </Box>
        {hiddenCount > 0 ? (
          <Box paddingLeft={3}>
            <Text dimColor>and {hiddenCount} more…</Text>
          </Box>
        ) : null}
      </Box>

      <Box marginBottom={1} flexDirection="column">
        {focusedSupportsEffort ? (
          <Text dimColor>
            <EffortLevelIndicator effort={displayEffort} />{' '}
            {capitalize(displayEffort)} effort
            {displayEffort === focusedDefaultEffort ? ' (default)' : ''}{' '}
            <Text color="subtle">← → to adjust</Text>
          </Text>
        ) : (
          <Text color="subtle">
            <EffortLevelIndicator effort={undefined} /> Effort not supported
            {focusedOption ? ` for ${focusedOption.label}` : ''}
          </Text>
        )}
      </Box>

      {isFastModeEnabled() ? (
        showFastModeNotice ? (
          <Box marginBottom={1}>
            <Text dimColor>
              Fast mode is <Text bold>ON</Text> and available with {FAST_MODE_MODEL_DISPLAY}{' '}
              only (/fast). Switching to other models turn off fast mode.
            </Text>
          </Box>
        ) : isFastModeAvailable() && !isFastModeCooldown() ? (
          <Box marginBottom={1}>
            <Text dimColor>
              Use <Text bold>/fast</Text> to turn on Fast mode ({FAST_MODE_MODEL_DISPLAY}{' '}
              only).
            </Text>
          </Box>
        ) : null
      ) : null}

      {isStandaloneCommand ? (
        <Text dimColor italic>
          {exitState.pending ? (
            <>Press {exitState.keyName} again to exit</>
          ) : (
            <Byline>
              <KeyboardShortcutHint shortcut="Enter" action="confirm" />
              <ConfigurableShortcutHint
                action="select:cancel"
                context="Select"
                fallback="Esc"
                description="exit"
              />
            </Byline>
          )}
        </Text>
      ) : null}
    </Box>
  )

  if (!isStandaloneCommand) {
    return content
  }

  return <Pane color="permission">{content}</Pane>
}
