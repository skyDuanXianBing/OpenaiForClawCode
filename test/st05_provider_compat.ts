import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.NODE_ENV = 'test'
process.env.ANTHROPIC_API_KEY = 'st05-anthropic-key'
process.env.OPENAI_API_KEY = 'st05-openai-key'
process.env.CLAUDE_CODE_USE_BEDROCK = '1'
process.env.CLAUDE_CODE_USE_VERTEX = '1'
process.env.CLAUDE_CODE_USE_FOUNDRY = '1'

const tempConfigDir = mkdtempSync(join(tmpdir(), 'st05-provider-compat-'))
process.env.CLAUDE_CONFIG_DIR = tempConfigDir

async function loadModule<T = Record<string, unknown>>(relativePath: string): Promise<T> {
  const moduleUrl = new URL(relativePath, import.meta.url).href
  return (await import(moduleUrl)) as T
}

async function main() {
  const bootstrapState = await loadModule<typeof import('../src/bootstrap/state.ts')>(
    '../src/bootstrap/state.ts',
  )
  const settingsCache = await loadModule<
    typeof import('../src/utils/settings/settingsCache.ts')
  >('../src/utils/settings/settingsCache.ts')
  const registryModule = await loadModule<
    typeof import('../src/utils/model/registry/registry.ts')
  >('../src/utils/model/registry/registry.ts')
  const selectionModule = await loadModule<
    typeof import('../src/utils/model/selection.ts')
  >('../src/utils/model/selection.ts')
  const validateModelModule = await loadModule<
    typeof import('../src/utils/model/validateModel.ts')
  >('../src/utils/model/validateModel.ts')
  const providerRouterModule = await loadModule<
    typeof import('../src/services/api/providerRouter.ts')
  >('../src/services/api/providerRouter.ts')

  bootstrapState.resetStateForTests()
  bootstrapState.setFlagSettingsInline({
    availableModels: [
      'openai:gpt-5.4',
      'anthropic:sonnet',
      'bedrock:sonnet',
      'vertex:sonnet',
      'foundry:sonnet',
    ],
  })
  settingsCache.resetSettingsCache()

  const registry = registryModule.getModelRegistry()
  const anthropicSonnet = registry.getDescriptor({
    provider: 'anthropic',
    modelId: 'sonnet',
  })
  assert.ok(anthropicSonnet)

  const cloudProviders = ['bedrock', 'vertex', 'foundry'] as const
  const cloudResults: Array<Record<string, unknown>> = []

  for (const provider of cloudProviders) {
    const descriptor = registry.listDescriptors({
      provider,
      visibility: 'public',
    })[0]
    assert.ok(descriptor, `缺少 ${provider} 公开 descriptor`)

    const authProbe = providerRouterModule.getProviderAuthProbe({
      provider,
      modelId: descriptor.modelId,
    })
    assert.equal(authProbe.ok, true)

    const parsedAlias = selectionModule.parseModelCommandInput({
      input: 'sonnet',
      currentSelectedModel: {
        provider,
        modelId: descriptor.modelId,
        source: 'runtime',
      },
    })
    assert.equal(parsedAlias.provider, provider)
    assert.equal(parsedAlias.alias, 'sonnet')

    const validation = await validateModelModule.validateModel('sonnet', {
      currentSelectedModel: {
        provider,
        modelId: descriptor.modelId,
        source: 'runtime',
      },
    })
    assert.deepEqual(validation, { valid: true })

    cloudResults.push({
      provider,
      modelId: descriptor.modelId,
      parsedAlias,
      authProbe,
      validation,
    })
  }

  const anthropicProbe = providerRouterModule.getProviderAuthProbe({
    provider: 'anthropic',
    modelId: anthropicSonnet!.modelId,
  })
  assert.equal(anthropicProbe.ok, true)

  const anthropicValidation = await validateModelModule.validateModel(
    'anthropic:sonnet',
  )
  assert.deepEqual(anthropicValidation, { valid: true })

  const openAIProbe = providerRouterModule.getProviderAuthProbe({
    provider: 'openai',
    modelId: 'gpt-5.4',
  })
  assert.equal(openAIProbe.ok, true)

  const openAIValidation = await validateModelModule.validateModel('openai:gpt-5.4')
  assert.deepEqual(openAIValidation, { valid: true })

  const blockedOpenAI = await validateModelModule.validateModel('openai:gpt-5.3-codex')
  assert.equal(blockedOpenAI.valid, false)
  assert.match(blockedOpenAI.error ?? '', /not in the list of available models/i)

  delete process.env.OPENAI_API_KEY
  const missingOpenAIAuth = providerRouterModule.getProviderAuthProbe({
    provider: 'openai',
    modelId: 'gpt-5.4',
  })
  assert.equal(missingOpenAIAuth.ok, false)
  assert.match(missingOpenAIAuth.message, /OpenAI provider 未认证/)

  console.log('ST-05 provider compat passed')
  console.log(
    JSON.stringify(
      {
        anthropicProbe,
        anthropicValidation,
        openAIProbe,
        openAIValidation,
        blockedOpenAI,
        missingOpenAIAuth,
        cloudResults,
      },
      null,
      2,
    ),
  )
}

try {
  await main()
} finally {
  rmSync(tempConfigDir, { recursive: true, force: true })
}
