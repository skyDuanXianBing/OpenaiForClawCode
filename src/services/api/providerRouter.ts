import {
  assertProviderAuthenticated,
  getProviderAuthStatus,
} from 'src/utils/auth.js'
import type { ModelProvider, SelectedModel } from 'src/utils/model/types.js'
import { parseModelCommandInput } from 'src/utils/model/selection.js'
import {
  anthropicProviderClient,
  type GetAnthropicClientArgs,
} from './providers/anthropic.js'
import { openAIProviderClient } from './providers/openai.js'
import type {
  AnthropicFamilyProviderClient,
  ProviderClient,
  ProviderAuthStatus,
} from './providers/types.js'

function toSelectedModel(
  input: Pick<SelectedModel, 'provider' | 'modelId'>,
): SelectedModel {
  return {
    provider: input.provider,
    modelId: input.modelId,
    source: 'runtime',
  }
}

export function resolveProviderClientSelection(
  model: string,
): SelectedModel {
  return parseModelCommandInput({ input: model })
}

export function getProviderClient(
  selectedModel: Pick<SelectedModel, 'provider' | 'modelId'>,
): ProviderClient {
  if (selectedModel.provider === 'openai') {
    return openAIProviderClient
  }

  return anthropicProviderClient
}

export function getProviderClientForModel(
  model: string,
): ProviderClient {
  return getProviderClient(resolveProviderClientSelection(model))
}

export function getProviderAuthProbe(
  selectedModel: Pick<SelectedModel, 'provider' | 'modelId'>,
): ProviderAuthStatus {
  return getProviderAuthStatus(toSelectedModel(selectedModel))
}

export function assertProviderReady(
  selectedModel: Pick<SelectedModel, 'provider' | 'modelId'>,
): ProviderAuthStatus {
  return assertProviderAuthenticated(toSelectedModel(selectedModel))
}

export async function getAnthropicClientForSelection(
  selectedModel: Pick<SelectedModel, 'provider' | 'modelId'>,
  args: GetAnthropicClientArgs,
) {
  // Compatibility facade for Anthropic-family transports. OpenAI keeps its own
  // provider client and should not flow through the Anthropic SDK constructor.
  if (selectedModel.provider === 'openai') {
    throw new Error(
      'OpenAI provider does not expose an Anthropic SDK client. Route requests through the provider-aware transport instead.',
    )
  }

  const providerClient = getProviderClient(
    selectedModel,
  ) as AnthropicFamilyProviderClient
  return providerClient.getAnthropicClient(args)
}

export function createProviderRouter() {
  return {
    getProviderClient,
    getProviderClientForModel,
    getProviderAuthProbe,
    assertProviderReady,
    getAnthropicClientForSelection,
  }
}
