import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

type TestCase = {
  category: 'happy' | 'boundary' | 'negative'
  name: string
  run: () => Promise<void>
}

const failures: string[] = []

async function execute(testCase: TestCase) {
  try {
    await testCase.run()
    console.log(`UNEXPECTED PASS [${testCase.category}] ${testCase.name}`)
    failures.push(
      `[${testCase.category}] ${testCase.name}: 红测意外通过，请确认 ST-03 是否已实现，或继续收紧断言。`,
    )
  } catch (error) {
    const detail = error instanceof Error ? error.stack ?? error.message : String(error)
    console.error(`EXPECTED RED [${testCase.category}] ${testCase.name}`)
    console.error(detail)
    failures.push(`[${testCase.category}] ${testCase.name}\n${detail}`)
  }
}

function readSourceFile(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

async function loadRegistryModule() {
  const moduleUrl = new URL('../src/utils/model/registry/registry.ts', import.meta.url).href
  return (await import(moduleUrl)) as Record<string, any>
}

function getRegistryTypesSource() {
  return readSourceFile('../src/utils/model/registry/types.ts')
}

function getDescriptorId(descriptor: Record<string, any>) {
  return descriptor.modelId ?? descriptor.canonicalId ?? descriptor.id ?? descriptor.publicName
}

function getPublicDescriptorsForProvider(registry: Record<string, any>, provider: string) {
  if (typeof registry.listDescriptors === 'function') {
    return registry.listDescriptors({ provider, visibility: 'public' })
  }

  if (typeof registry.getDescriptors === 'function') {
    return registry.getDescriptors({ provider, visibility: 'public' })
  }

  if (Array.isArray(registry.descriptors)) {
    return registry.descriptors.filter((descriptor: Record<string, any>) => {
      const visibility = descriptor.visibility ?? 'public'
      return descriptor.provider === provider && visibility !== 'hidden' && descriptor.selectable !== false
    })
  }

  throw new assert.AssertionError({
    message:
      '期望 getModelRegistry() 返回可枚举 descriptor 的正式入口（如 listDescriptors/getDescriptors/descriptors）。',
  })
}

const legacyOpenAIModels = [
  'gpt-5.4-mini',
  'gpt-5.2',
  'gpt-5.2-codex',
  'gpt-5.1',
  'gpt-5.1-codex',
  'gpt-5.1-codex-mini',
  'gpt-5.1-codex-max',
  'codex-mini',
  'codex-max',
]

const registryDelegationPattern = /getModelRegistry|getDescriptorForSelectedModel|resolveCapability/

const testCases: TestCase[] = [
  {
    category: 'happy',
    name: '正式 registry 入口与 ModelDescriptor/ModelCapability 类型已落盘',
    async run() {
      const registry = await loadRegistryModule()
      const typesSource = getRegistryTypesSource()

      assert.equal(
        typeof registry.getModelRegistry,
        'function',
        '期望存在 getModelRegistry()，作为统一模型注册表正式入口。',
      )

      assert.equal(
        typeof registry.getDescriptorForSelectedModel,
        'function',
        '期望存在 getDescriptorForSelectedModel()，统一按 SelectedModel 解析 descriptor。',
      )

      assert.equal(
        typeof registry.resolveCapability,
        'function',
        '期望存在 resolveCapability()，统一查询 context/maxOutput/thinking/effort/pricing。',
      )

      assert.match(
        typesSource,
        /export\s+(type|interface)\s+ModelDescriptor\b/,
        '期望存在正式的 ModelDescriptor 结构定义。',
      )

      assert.match(
        typesSource,
        /export\s+(type|interface)\s+ModelCapability\b/,
        '期望存在正式的 ModelCapability 结构定义。',
      )
    },
  },
  {
    category: 'happy',
    name: 'Anthropic 与 OpenAI descriptor 已进入统一 registry 主干',
    async run() {
      const registry = await loadRegistryModule()

      const anthropic = registry.getDescriptorForSelectedModel({
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        source: 'runtime',
      })
      const openai = registry.getDescriptorForSelectedModel({
        provider: 'openai',
        modelId: 'gpt-5.4',
        source: 'runtime',
      })

      assert.equal(anthropic?.provider, 'anthropic', '期望 Anthropic descriptor 通过统一 registry 解析。')
      assert.equal(openai?.provider, 'openai', '期望 OpenAI descriptor 通过统一 registry 解析。')
      assert.ok(anthropic?.capability, '期望 Anthropic descriptor 自带统一 capability 元数据。')
      assert.ok(openai?.capability, '期望 OpenAI descriptor 自带统一 capability 元数据。')
    },
  },
  {
    category: 'boundary',
    name: 'OpenAI 公开模型范围仅包含 gpt-5.4 与 gpt-5.3-codex',
    async run() {
      const registryModule = await loadRegistryModule()
      const registry = registryModule.getModelRegistry()
      const publicOpenAIIds = getPublicDescriptorsForProvider(registry, 'openai')
        .map((descriptor: Record<string, any>) => getDescriptorId(descriptor))
        .filter(Boolean)
        .sort()

      assert.deepStrictEqual(publicOpenAIIds, ['gpt-5.3-codex', 'gpt-5.4'])

      for (const legacyModel of legacyOpenAIModels) {
        assert.ok(
          !publicOpenAIIds.includes(legacyModel),
          `期望旧 OpenAI 模型 ${legacyModel} 已退出公开列表，只能存在于隐藏兼容层。`,
        )
      }
    },
  },
  {
    category: 'boundary',
    name: '统一 capability 查询入口可返回 context/maxOutput/thinking/effort/pricing',
    async run() {
      const registry = await loadRegistryModule()

      const anthropicCapability = registry.resolveCapability({
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        source: 'runtime',
      })
      const openaiCapability = registry.resolveCapability({
        provider: 'openai',
        modelId: 'gpt-5.4',
        source: 'runtime',
      })

      for (const capability of [anthropicCapability, openaiCapability]) {
        assert.ok(capability && typeof capability === 'object', '期望 resolveCapability() 返回结构化 capability。')
        assert.ok('contextWindow' in capability, '期望 capability 统一暴露 contextWindow。')
        assert.ok('maxOutputTokens' in capability, '期望 capability 统一暴露 maxOutputTokens。')
        assert.ok('thinking' in capability, '期望 capability 统一暴露 thinking。')
        assert.ok('effort' in capability, '期望 capability 统一暴露 effort。')
        assert.ok('pricing' in capability, '期望 capability 统一暴露 pricing。')
      }
    },
  },
  {
    category: 'negative',
    name: '旧 helper 已开始委托 registry，而不是继续散落硬编码 capability',
    async run() {
      const helperFiles = [
        '../src/utils/context.ts',
        '../src/utils/thinking.ts',
        '../src/utils/effort.ts',
        '../src/utils/modelCost.ts',
        '../src/utils/model/modelOptions.ts',
        '../src/utils/model/validateModel.ts',
      ]

      const missingDelegation = helperFiles.filter((filePath) => {
        const source = readSourceFile(filePath)
        return !registryDelegationPattern.test(source)
      })

      assert.deepStrictEqual(
        missingDelegation,
        [],
        `期望旧 helper 至少开始调用 registry/capability 统一入口，当前仍未委托：${missingDelegation.join(', ')}`,
      )
    },
  },
  {
    category: 'negative',
    name: 'codex adapter 不再继续维护旧 OpenAI 公开模型真相源',
    async run() {
      const adapterSource = readSourceFile('../src/services/api/codex-fetch-adapter.ts')

      assert.match(
        adapterSource,
        registryDelegationPattern,
        '期望 codex adapter 改为从 registry 读取模型元数据，而不是自维护公开模型列表。',
      )

      const stillExposed = legacyOpenAIModels.filter((modelId) => adapterSource.includes(modelId))
      assert.deepStrictEqual(
        stillExposed,
        [],
        `期望 codex adapter 不再内嵌旧 OpenAI 公开模型字面量，当前仍命中：${stillExposed.join(', ')}`,
      )
    },
  },
]

for (const testCase of testCases) {
  await execute(testCase)
}

console.error(`\nST-03 red summary: ${failures.length} case(s) failed as expected.`)

if (failures.length === 0) {
  throw new Error('ST-03 红测未能捕获缺口：没有出现任何失败。')
}

process.exitCode = 1
