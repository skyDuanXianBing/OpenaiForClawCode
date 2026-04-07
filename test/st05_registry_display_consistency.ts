import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.NODE_ENV = 'test'
process.env.ANTHROPIC_API_KEY = 'st05-anthropic-key'

const tempConfigDir = mkdtempSync(join(tmpdir(), 'st05-registry-display-'))
process.env.CLAUDE_CONFIG_DIR = tempConfigDir

async function loadModule<T = Record<string, unknown>>(relativePath: string): Promise<T> {
  const moduleUrl = new URL(relativePath, import.meta.url).href
  return (await import(moduleUrl)) as T
}

async function main() {
  const bootstrapState = await loadModule<typeof import('../src/bootstrap/state.ts')>(
    '../src/bootstrap/state.ts',
  )
  const registryModule = await loadModule<
    typeof import('../src/utils/model/registry/registry.ts')
  >('../src/utils/model/registry/registry.ts')
  const modelModule = await loadModule<typeof import('../src/utils/model/model.ts')>(
    '../src/utils/model/model.ts',
  )
  const modelOptionsModule = await loadModule<
    typeof import('../src/utils/model/modelOptions.ts')
  >('../src/utils/model/modelOptions.ts')
  const auth = await loadModule<typeof import('../src/utils/auth.ts')>(
    '../src/utils/auth.ts',
  )

  bootstrapState.resetStateForTests()

  const registry = registryModule.getModelRegistry()
  const openAIPublic = registry.listPublicOpenAIModels()
  const openAIIds = openAIPublic.map((descriptor) => descriptor.modelId).sort()
  assert.deepEqual(openAIIds, ['gpt-5.3-codex', 'gpt-5.4'])

  const anthropicPublicLabels = registry
    .listDescriptors({ provider: 'anthropic', visibility: 'public' })
    .map((descriptor) => descriptor.label)
    .sort()
  assert.deepEqual(anthropicPublicLabels, ['Haiku', 'Opus', 'Sonnet'])

  for (const descriptor of openAIPublic) {
    assert.equal(
      modelModule.getPublicModelDisplayName(descriptor.modelId),
      descriptor.publicName,
    )
  }

  assert.equal(
    modelModule.getPublicModelDisplayName('gpt-5.4-mini'),
    'gpt-5.4-mini',
  )

  auth.saveCodexOAuthTokens({
    accessToken: 'header.payload.signature',
    refreshToken: 'refresh-token',
    expiresAt: Date.now() + 60_000,
    accountId: 'acct-st05-display',
  })
  const codexPickerValues = modelOptionsModule
    .getModelOptions()
    .map((option) => option.value)
    .filter((value): value is string => value !== null)
    .sort()
  assert.deepEqual(codexPickerValues, openAIIds)
  auth.clearCodexOAuthTokens()

  const modelPickerSource = readFileSync(
    new URL('../src/components/ModelPicker.tsx', import.meta.url),
    'utf8',
  )
  assert.match(modelPickerSource, /visibility:\s*'public'/)
  assert.match(modelPickerSource, /getSelectedModelProviderLabel/)

  console.log('ST-05 registry/display consistency passed')
  console.log(
    JSON.stringify(
        {
          openAIIds,
          anthropicPublicLabels,
          codexPickerValues,
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
