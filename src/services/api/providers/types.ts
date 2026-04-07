import type Anthropic from '@anthropic-ai/sdk'
import type { ClientOptions } from '@anthropic-ai/sdk'
import type { ModelProvider, SelectedModel } from 'src/utils/model/types.js'

export type ProviderAuthStatus =
  | {
      ok: true
      provider: ModelProvider
      mode: 'oauth' | 'apiKey' | 'cloud' | 'mixed'
      message?: string
    }
  | {
      ok: false
      provider: ModelProvider
      code: 'missing_auth'
      message: string
    }

export type ProviderConfig = {
  apiKey?: string
  baseURL?: string
  apiKeySource?: string
}

export type AnthropicClientParams = {
  apiKey?: string
  maxRetries: number
  model?: string
  fetchOverride?: ClientOptions['fetch']
  source?: string
}

export interface ProviderClient {
  readonly provider: ModelProvider
  getAuthStatus(selectedModel: SelectedModel): ProviderAuthStatus
  getConfig(selectedModel: SelectedModel): ProviderConfig
  validateModel(args: {
    selectedModel: SelectedModel
  }): Promise<{ valid: boolean; error?: string }>
}

export interface AnthropicFamilyProviderClient extends ProviderClient {
  getAnthropicClient(args: AnthropicClientParams): Promise<Anthropic>
}
