import type { ClientOptions } from '@anthropic-ai/sdk'
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { Stream } from '@anthropic-ai/sdk/streaming.mjs'
import {
  getCodexOAuthTokens,
  getOpenAIApiKey,
  getOpenAIAuthMode,
  getProviderAuthStatus,
  resolveOpenAIBaseUrl,
} from 'src/utils/auth.js'
import { getUserAgent } from 'src/utils/http.js'
import { getDescriptorForSelectedModel } from 'src/utils/model/registry/registry.js'
import type { SelectedModel } from 'src/utils/model/types.js'
import { getProxyFetchOptions } from 'src/utils/proxy.js'
import { getSessionId } from '../../../bootstrap/state.js'
import {
  buildOpenAIResponsesRequestBody,
  createOpenAIResponsesEventStream,
} from './openaiResponses.js'
import type { ProviderClient, ProviderConfig } from './types.js'

type OpenAITransportMode = 'responses_http' | 'oauth_bridge' | 'none'

const OPENAI_OAUTH_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'
const JWT_CLAIM_PATH = 'https://api.openai.com/auth'

function getOpenAIAuthErrorMessage(): string {
  return 'OpenAI provider 未认证。请设置 OPENAI_API_KEY，或先完成 Codex 登录。'
}

function extractCodexAccountId(accessToken: string): string {
  try {
    const parts = accessToken.split('.')
    if (parts.length !== 3) {
      throw new Error('Invalid token')
    }

    const payload = JSON.parse(atob(parts[1]))
    const accountId = payload?.[JWT_CLAIM_PATH]?.chatgpt_account_id
    if (!accountId) {
      throw new Error('Missing account id')
    }

    return accountId
  } catch {
    throw new Error('Failed to extract account ID from Codex token')
  }
}

function resolveOpenAIResponsesTransport(params: {
  fetchOverride?: ClientOptions['fetch']
} = {}): {
  fetch: NonNullable<ClientOptions['fetch']>
  fetchOptions: ClientOptions['fetchOptions']
  headers: Record<string, string>
  url: string
} {
  const transportMode = getOpenAITransportMode()
  if (transportMode === 'none') {
    throw new Error(getOpenAIAuthErrorMessage())
  }

  const transport = getOpenAITransportConfig({
    fetchOverride: params.fetchOverride,
  })

  if (transportMode === 'responses_http') {
    if (!transport.apiKey) {
      throw new Error(getOpenAIAuthErrorMessage())
    }

    return {
      fetch: transport.fetch,
      fetchOptions: transport.fetchOptions,
      url: `${transport.baseURL}/responses`,
      headers: {
        ...transport.headers,
        Authorization: `Bearer ${transport.apiKey}`,
      },
    }
  }

  const tokens = getCodexOAuthTokens()
  if (!tokens?.accessToken) {
    throw new Error(getOpenAIAuthErrorMessage())
  }

  return {
    fetch: transport.fetch,
    fetchOptions: transport.fetchOptions,
    url: OPENAI_OAUTH_RESPONSES_URL,
    headers: {
      ...transport.headers,
      Authorization: `Bearer ${tokens.accessToken}`,
      'chatgpt-account-id': extractCodexAccountId(tokens.accessToken),
      originator: 'pi',
      'OpenAI-Beta': 'responses=experimental',
    },
  }
}

async function sendOpenAIResponsesRequest(args: {
  body: Record<string, unknown>
  fetchOverride?: ClientOptions['fetch']
  signal?: AbortSignal
  stream: boolean
}): Promise<Response> {
  const transport = resolveOpenAIResponsesTransport({
    fetchOverride: args.fetchOverride,
  })

  return transport.fetch(transport.url, {
    ...(transport.fetchOptions ?? {}),
    method: 'POST',
    headers: {
      ...transport.headers,
      ...(args.stream ? { Accept: 'text/event-stream' } : {}),
    },
    signal: args.signal,
    body: JSON.stringify({
      ...args.body,
      stream: args.stream,
    }),
  })
}

export function getOpenAITransportMode(): OpenAITransportMode {
  if (getOpenAIApiKey()) {
    return 'responses_http'
  }

  if (getCodexOAuthTokens()?.accessToken) {
    return 'oauth_bridge'
  }

  return 'none'
}

export function getOpenAITransportConfig(params: {
  apiKey?: string
  baseURL?: string
  fetchOverride?: ClientOptions['fetch']
} = {}): {
  apiKey?: string
  baseURL: string
  fetch: NonNullable<ClientOptions['fetch']>
  headers: Record<string, string>
  fetchOptions: ClientOptions['fetchOptions']
} {
  return {
    apiKey: params.apiKey ?? getOpenAIApiKey() ?? undefined,
    baseURL: params.baseURL ?? resolveOpenAIBaseUrl(),
    fetch: params.fetchOverride ?? globalThis.fetch,
    headers: {
      'User-Agent': getUserAgent(),
      'X-Claude-Code-Session-Id': getSessionId(),
      'Content-Type': 'application/json',
    },
    fetchOptions: getProxyFetchOptions({
      forAnthropicAPI: false,
    }) as ClientOptions['fetchOptions'],
  }
}

export async function createOpenAIResponse(args: {
  selectedModel: SelectedModel
  instructions?: string
  input: Array<Record<string, unknown>>
  stream?: boolean
  maxOutputTokens?: number
  effort?: 'low' | 'medium' | 'high'
  fetchOverride?: ClientOptions['fetch']
  signal?: AbortSignal
}): Promise<Response> {
  return sendOpenAIResponsesRequest({
    fetchOverride: args.fetchOverride,
    signal: args.signal,
    stream: args.stream ?? false,
    body: {
      model: args.selectedModel.modelId,
      store: false,
      instructions: args.instructions,
      input: args.input,
      ...(args.maxOutputTokens !== undefined
        ? { max_output_tokens: args.maxOutputTokens }
        : {}),
      ...(args.effort ? { reasoning: { effort: args.effort } } : {}),
    },
  })
}

export async function createOpenAIStream(args: {
  selectedModel: SelectedModel
  anthropicRequest: Record<string, unknown>
  fetchOverride?: ClientOptions['fetch']
  signal: AbortSignal
}): Promise<{
  requestId?: string
  response: Response
  stream: Stream<BetaRawMessageStreamEvent>
}> {
  const response = await sendOpenAIResponsesRequest({
    fetchOverride: args.fetchOverride,
    signal: args.signal,
    stream: true,
    body: buildOpenAIResponsesRequestBody({
      selectedModel: args.selectedModel,
      anthropicRequest: args.anthropicRequest,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(
      `OpenAI Responses API error (${response.status}): ${errorText}`,
    )
  }

  return {
    requestId: response.headers.get('x-request-id') ?? undefined,
    response,
    stream: createOpenAIResponsesEventStream({
      response,
      model: args.selectedModel.modelId,
    }),
  }
}

function getOpenAIApiKeySource(): ProviderConfig['apiKeySource'] {
  const authMode = getOpenAIAuthMode()

  if (authMode === 'apiKey') {
    return 'env'
  }

  if (authMode === 'oauth') {
    return 'oauth'
  }

  return 'none'
}

function getOpenAIProviderConfig(): ProviderConfig {
  return {
    apiKey: getOpenAIApiKey() ?? undefined,
    baseURL: resolveOpenAIBaseUrl(),
    apiKeySource: getOpenAIApiKeySource(),
  }
}

export const openAIProviderClient: ProviderClient = {
  provider: 'openai',
  getAuthStatus(selectedModel) {
    return getProviderAuthStatus(selectedModel)
  },
  getConfig() {
    return getOpenAIProviderConfig()
  },
  async validateModel({ selectedModel }) {
    const authStatus = getProviderAuthStatus(selectedModel)
    if (!authStatus.ok) {
      return { valid: false, error: authStatus.message }
    }

    const descriptor = getDescriptorForSelectedModel(selectedModel, {
      includeHidden: true,
    })
    if (!descriptor) {
      return {
        valid: false,
        error: `OpenAI provider 当前仅支持已注册模型：${selectedModel.modelId}`,
      }
    }

    return { valid: true }
  },
}
