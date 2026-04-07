import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk'
import { randomUUID } from 'crypto'
import type { GoogleAuth } from 'google-auth-library'
import {
  APIConnectionError,
  APIError,
  AuthenticationError,
  NotFoundError,
} from '@anthropic-ai/sdk'
import {
  computeCch,
  hasCchPlaceholder,
  replaceCchPlaceholder,
} from 'src/utils/cch.js'
import {
  checkAndRefreshOAuthTokenIfNeeded,
  getAnthropicApiKey,
  getAnthropicBaseUrl,
  getAnthropicApiKeySource,
  getApiKeyFromApiKeyHelper,
  getClaudeAIOAuthTokens,
  getProviderAuthStatus,
  isClaudeAISubscriber,
  refreshAndGetAwsCredentials,
  refreshGcpCredentialsIfNeeded,
} from 'src/utils/auth.js'
import { getUserAgent } from 'src/utils/http.js'
import { getDescriptorForSelectedModel } from 'src/utils/model/registry/registry.js'
import { getSmallFastModel } from 'src/utils/model/model.js'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from 'src/utils/model/providers.js'
import type { SelectedModel } from 'src/utils/model/types.js'
import { getProxyFetchOptions } from 'src/utils/proxy.js'
import { sideQuery } from 'src/utils/sideQuery.js'
import {
  getIsNonInteractiveSession,
  getSessionId,
} from '../../../bootstrap/state.js'
import { getOauthConfig } from '../../../constants/oauth.js'
import { isDebugToStdErr, logForDebugging } from '../../../utils/debug.js'
import {
  getAWSRegion,
  getVertexRegionForModel,
  isEnvTruthy,
} from '../../../utils/envUtils.js'
import type {
  AnthropicClientParams,
  AnthropicFamilyProviderClient,
  ProviderConfig,
} from './types.js'

export type GetAnthropicClientArgs = AnthropicClientParams

const ANTHROPIC_API_KEY_ENV = 'ANTHROPIC_API_KEY'
const ANTHROPIC_BASE_URL_ENV = 'ANTHROPIC_BASE_URL'

function createStderrLogger(): ClientOptions['logger'] {
  return {
    error: (msg, ...args) =>
      console.error('[Anthropic SDK ERROR]', msg, ...args),
    warn: (msg, ...args) => console.error('[Anthropic SDK WARN]', msg, ...args),
    info: (msg, ...args) => console.error('[Anthropic SDK INFO]', msg, ...args),
    debug: (msg, ...args) =>
      console.error('[Anthropic SDK DEBUG]', msg, ...args),
  }
}

export const CLIENT_REQUEST_ID_HEADER = 'x-client-request-id'

function getCustomHeaders(): Record<string, string> {
  const customHeaders: Record<string, string> = {}
  const customHeadersEnv = process.env.ANTHROPIC_CUSTOM_HEADERS

  if (!customHeadersEnv) {
    return customHeaders
  }

  const headerStrings = customHeadersEnv.split(/\n|\r\n/)
  for (const headerString of headerStrings) {
    if (!headerString.trim()) {
      continue
    }

    const colonIndex = headerString.indexOf(':')
    if (colonIndex === -1) {
      continue
    }

    const name = headerString.slice(0, colonIndex).trim()
    const value = headerString.slice(colonIndex + 1).trim()
    if (name) {
      customHeaders[name] = value
    }
  }

  return customHeaders
}

function buildFetch(
  fetchOverride: ClientOptions['fetch'],
  source: string | undefined,
): ClientOptions['fetch'] {
  const inner = fetchOverride ?? globalThis.fetch
  const injectClientRequestId =
    getAPIProvider() === 'firstParty' && isFirstPartyAnthropicBaseUrl()

  return async (input, init) => {
    const headers = new Headers(init?.headers)
    if (injectClientRequestId && !headers.has(CLIENT_REQUEST_ID_HEADER)) {
      headers.set(CLIENT_REQUEST_ID_HEADER, randomUUID())
    }

    let body = init?.body
    try {
      const url = input instanceof Request ? input.url : String(input)
      const id = headers.get(CLIENT_REQUEST_ID_HEADER)
      logForDebugging(
        `[API REQUEST] ${new URL(url).pathname}${id ? ` ${CLIENT_REQUEST_ID_HEADER}=${id}` : ''} source=${source ?? 'unknown'}`,
      )

      if (
        url.includes('/v1/messages') &&
        headers.has('anthropic-version') &&
        typeof body === 'string' &&
        hasCchPlaceholder(body)
      ) {
        const cch = await computeCch(body)
        body = replaceCchPlaceholder(body, cch)
        logForDebugging(`[CCH] signed request cch=${cch}`)
      }
    } catch {
      // never let logging crash the fetch
    }

    return inner(input, { ...init, headers, body })
  }
}

async function configureApiKeyHeaders(
  headers: Record<string, string>,
  isNonInteractiveSession: boolean,
): Promise<void> {
  const token =
    process.env.ANTHROPIC_AUTH_TOKEN ||
    (await getApiKeyFromApiKeyHelper(isNonInteractiveSession))
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
}

function getAnthropicProviderConfig(): ProviderConfig {
  void ANTHROPIC_API_KEY_ENV
  void ANTHROPIC_BASE_URL_ENV

  return {
    apiKey: getAnthropicApiKey() ?? undefined,
    baseURL: getAnthropicBaseUrl(),
    apiKeySource: getAnthropicApiKeySource(),
  }
}

export async function getAnthropicClient({
  apiKey,
  maxRetries,
  model,
  fetchOverride,
  source,
}: GetAnthropicClientArgs): Promise<Anthropic> {
  const containerId = process.env.CLAUDE_CODE_CONTAINER_ID
  const remoteSessionId = process.env.CLAUDE_CODE_REMOTE_SESSION_ID
  const clientApp = process.env.CLAUDE_AGENT_SDK_CLIENT_APP
  const customHeaders = getCustomHeaders()
  const defaultHeaders: Record<string, string> = {
    'x-app': 'cli',
    'User-Agent': getUserAgent(),
    'X-Claude-Code-Session-Id': getSessionId(),
    ...customHeaders,
    ...(containerId ? { 'x-claude-remote-container-id': containerId } : {}),
    ...(remoteSessionId
      ? { 'x-claude-remote-session-id': remoteSessionId }
      : {}),
    ...(clientApp ? { 'x-client-app': clientApp } : {}),
  }

  logForDebugging(
    `[API:request] Creating client, ANTHROPIC_CUSTOM_HEADERS present: ${!!process.env.ANTHROPIC_CUSTOM_HEADERS}, has Authorization header: ${!!customHeaders.Authorization}`,
  )

  if (isEnvTruthy(process.env.CLAUDE_CODE_ADDITIONAL_PROTECTION)) {
    defaultHeaders['x-anthropic-additional-protection'] = 'true'
  }

  logForDebugging('[API:auth] OAuth token check starting')
  await checkAndRefreshOAuthTokenIfNeeded()
  logForDebugging('[API:auth] OAuth token check complete')

  if (!isClaudeAISubscriber()) {
    await configureApiKeyHeaders(defaultHeaders, getIsNonInteractiveSession())
  }

  const resolvedFetch = buildFetch(fetchOverride, source)
  const baseArgs = {
    defaultHeaders,
    maxRetries,
    timeout: parseInt(process.env.API_TIMEOUT_MS || String(600 * 1000), 10),
    dangerouslyAllowBrowser: true,
    fetchOptions: getProxyFetchOptions({
      forAnthropicAPI: true,
    }) as ClientOptions['fetchOptions'],
    ...(resolvedFetch ? { fetch: resolvedFetch } : {}),
  }

  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK)) {
    const { AnthropicBedrock } = await import('@anthropic-ai/bedrock-sdk')
    const awsRegion =
      model === getSmallFastModel() &&
      process.env.ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION
        ? process.env.ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION
        : getAWSRegion()

    const bedrockArgs = {
      ...baseArgs,
      awsRegion,
      ...(isEnvTruthy(process.env.CLAUDE_CODE_SKIP_BEDROCK_AUTH)
        ? { skipAuth: true }
        : {}),
      ...(isDebugToStdErr() ? { logger: createStderrLogger() } : {}),
    } as Record<string, unknown>

    if (process.env.AWS_BEARER_TOKEN_BEDROCK) {
      bedrockArgs.skipAuth = true
      const currentDefaultHeaders =
        (bedrockArgs.defaultHeaders as Record<string, string> | undefined) ?? {}
      bedrockArgs.defaultHeaders = {
        ...currentDefaultHeaders,
        Authorization: `Bearer ${process.env.AWS_BEARER_TOKEN_BEDROCK}`,
      }
    } else if (!isEnvTruthy(process.env.CLAUDE_CODE_SKIP_BEDROCK_AUTH)) {
      const cachedCredentials = await refreshAndGetAwsCredentials()
      if (cachedCredentials) {
        bedrockArgs.awsAccessKey = cachedCredentials.accessKeyId
        bedrockArgs.awsSecretKey = cachedCredentials.secretAccessKey
        bedrockArgs.awsSessionToken = cachedCredentials.sessionToken
      }
    }

    return new AnthropicBedrock(bedrockArgs) as unknown as Anthropic
  }

  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY)) {
    const { AnthropicFoundry } = await import('@anthropic-ai/foundry-sdk')
    let azureADTokenProvider: (() => Promise<string>) | undefined
    if (!process.env.ANTHROPIC_FOUNDRY_API_KEY) {
      if (isEnvTruthy(process.env.CLAUDE_CODE_SKIP_FOUNDRY_AUTH)) {
        azureADTokenProvider = () => Promise.resolve('')
      } else {
        const {
          DefaultAzureCredential: AzureCredential,
          getBearerTokenProvider,
        } = await import('@azure/identity')
        azureADTokenProvider = getBearerTokenProvider(
          new AzureCredential(),
          'https://cognitiveservices.azure.com/.default',
        )
      }
    }

    const foundryArgs = {
      ...baseArgs,
      ...(azureADTokenProvider ? { azureADTokenProvider } : {}),
      ...(isDebugToStdErr() ? { logger: createStderrLogger() } : {}),
    } as ConstructorParameters<typeof AnthropicFoundry>[0]
    return new AnthropicFoundry(foundryArgs) as unknown as Anthropic
  }

  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX)) {
    if (!isEnvTruthy(process.env.CLAUDE_CODE_SKIP_VERTEX_AUTH)) {
      await refreshGcpCredentialsIfNeeded()
    }

    const [{ AnthropicVertex }, { GoogleAuth }] = await Promise.all([
      import('@anthropic-ai/vertex-sdk'),
      import('google-auth-library'),
    ])

    const hasProjectEnvVar =
      process.env.GCLOUD_PROJECT ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.gcloud_project ||
      process.env.google_cloud_project
    const hasKeyFile =
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      process.env.google_application_credentials

    const googleAuth = isEnvTruthy(process.env.CLAUDE_CODE_SKIP_VERTEX_AUTH)
      ? ({
          getClient: () => ({
            getRequestHeaders: () => ({}),
          }),
        } as unknown as GoogleAuth)
      : (new GoogleAuth({
          scopes: ['https://www.googleapis.com/auth/cloud-platform'],
          ...(hasProjectEnvVar || hasKeyFile
            ? {}
            : {
                projectId: process.env.ANTHROPIC_VERTEX_PROJECT_ID,
              }),
        }) as unknown as GoogleAuth)

    const vertexArgs = {
      ...baseArgs,
      region: getVertexRegionForModel(model),
      googleAuth,
      ...(isDebugToStdErr() ? { logger: createStderrLogger() } : {}),
    } as unknown as ConstructorParameters<typeof AnthropicVertex>[0]
    return new AnthropicVertex(vertexArgs) as unknown as Anthropic
  }

  const resolvedBaseUrl = getAnthropicBaseUrl()
  const clientConfig: ConstructorParameters<typeof Anthropic>[0] = {
    apiKey: isClaudeAISubscriber() ? null : apiKey || getAnthropicApiKey(),
    authToken: isClaudeAISubscriber()
      ? getClaudeAIOAuthTokens()?.accessToken
      : undefined,
    ...(resolvedBaseUrl ? { baseURL: resolvedBaseUrl } : {}),
    ...baseArgs,
    ...(isDebugToStdErr() ? { logger: createStderrLogger() } : {}),
  }

  return new Anthropic(clientConfig)
}

function handleValidationError(
  error: unknown,
  selectedModel: SelectedModel,
): { valid: boolean; error: string } {
  if (error instanceof NotFoundError) {
    return {
      valid: false,
      error: `Model '${selectedModel.modelId}' not found`,
    }
  }

  if (error instanceof APIError) {
    if (error instanceof AuthenticationError) {
      const authStatus = getProviderAuthStatus(selectedModel)
      return {
        valid: false,
        error: authStatus.ok
          ? 'Authentication failed. Please check your API credentials.'
          : authStatus.message,
      }
    }

    if (error instanceof APIConnectionError) {
      return {
        valid: false,
        error: 'Network error. Please check your internet connection.',
      }
    }

    return { valid: false, error: `API error: ${error.message}` }
  }

  const errorMessage = error instanceof Error ? error.message : String(error)
  return {
    valid: false,
    error: `Unable to validate model: ${errorMessage}`,
  }
}

export const anthropicProviderClient: AnthropicFamilyProviderClient = {
  provider: 'anthropic',
  getAuthStatus(selectedModel) {
    return getProviderAuthStatus(selectedModel)
  },
  getConfig() {
    return getAnthropicProviderConfig()
  },
  async getAnthropicClient(args) {
    return getAnthropicClient(args)
  },
  async validateModel({ selectedModel }) {
    const authStatus = getProviderAuthStatus(selectedModel)
    if (!authStatus.ok) {
      return { valid: false, error: authStatus.message }
    }

    const descriptor = getDescriptorForSelectedModel(selectedModel, {
      includeHidden: true,
    })
    if (descriptor) {
      return { valid: true }
    }

    if (selectedModel.modelId === process.env.ANTHROPIC_CUSTOM_MODEL_OPTION) {
      return { valid: true }
    }

    if (selectedModel.provider !== 'anthropic') {
      return {
        valid: false,
        error: `${selectedModel.provider} provider 当前仅支持注册表内模型：${selectedModel.modelId}`,
      }
    }

    try {
      await sideQuery({
        model: selectedModel.modelId,
        max_tokens: 1,
        maxRetries: 0,
        querySource: 'model_validation',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Hi',
                cache_control: { type: 'ephemeral' },
              },
            ],
          },
        ],
      })

      return { valid: true }
    } catch (error) {
      return handleValidationError(error, selectedModel)
    }
  },
}
