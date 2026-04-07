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
      `[${testCase.category}] ${testCase.name}: 红测意外通过，请收紧断言或确认 ST-02 是否已实现。`,
    )
  } catch (error) {
    const detail = error instanceof Error ? error.stack ?? error.message : String(error)
    console.error(`EXPECTED RED [${testCase.category}] ${testCase.name}`)
    console.error(detail)
    failures.push(`[${testCase.category}] ${testCase.name}\n${detail}`)
  }
}

async function loadSelectionModule() {
  const modulePath = '../src/utils/model/selection.ts'
  return (await import(modulePath)) as Record<string, any>
}

function readSourceFile(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

const testCases: TestCase[] = [
  {
    category: 'happy',
    name: 'AppState 主干显式承载 provider-aware selectedModel',
    async run() {
      const appStateStoreSource = readSourceFile('../src/state/AppStateStore.ts')

      assert.match(
        appStateStoreSource,
        /selectedModel/,
        '期望 AppState 正式包含 selectedModel，而不是继续只有 mainLoopModel:string。',
      )

      assert.match(
        appStateStoreSource,
        /provider/,
        '期望 AppState 的模型选择主干显式携带 provider 信息。',
      )
    },
  },
  {
    category: 'happy',
    name: 'Settings schema 显式支持 selectedModel，并保留旧 model 兼容桥接',
    async run() {
      const settingsTypesSource = readSourceFile('../src/utils/settings/types.ts')

      assert.match(
        settingsTypesSource,
        /selectedModel/,
        '期望 settings schema 定义新的 selectedModel 结构。',
      )

      assert.match(
        settingsTypesSource,
        /\bmodel\b/,
        '期望 settings schema 兼容保留旧 model 字段读取。',
      )
    },
  },
  {
    category: 'happy',
    name: '旧 settings.model 的 gpt-5.4 可桥接为 OpenAI provider-aware 选择',
    async run() {
      const selection = await loadSelectionModule()
      assert.equal(
        typeof selection.readLegacyModelSetting,
        'function',
        '期望存在 readLegacyModelSetting() 兼容桥接入口。',
      )

      const actual = selection.readLegacyModelSetting({ model: 'gpt-5.4' })
      assert.deepStrictEqual(actual, {
        provider: 'openai',
        modelId: 'gpt-5.4',
        source: 'settings_legacy',
        rawInput: 'gpt-5.4',
      })
    },
  },
  {
    category: 'boundary',
    name: '已有运行时 provider-aware 选择时，env 默认值不能反向覆盖',
    async run() {
      const selection = await loadSelectionModule()
      assert.equal(
        typeof selection.resolveInitialSelectedModel,
        'function',
        '期望存在 resolveInitialSelectedModel() 解析入口。',
      )

      const actual = selection.resolveInitialSelectedModel({
        runtimeSelectedModel: {
          provider: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          source: 'runtime',
        },
        settings: {
          selectedModel: {
            provider: 'anthropic',
            modelId: 'claude-sonnet-4-5',
            source: 'settings_v2',
          },
        },
        env: {
          CLAUDE_CODE_USE_OPENAI: '1',
          ANTHROPIC_MODEL: 'sonnet',
        },
      })

      assert.deepStrictEqual(actual, {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        source: 'runtime',
      })
    },
  },
  {
    category: 'happy',
    name: '持久化序列化会主写新的 selectedModel 结构，而不只写旧 model 字符串',
    async run() {
      const onChangeAppStateSource = readSourceFile('../src/state/onChangeAppState.ts')
      assert.match(
        onChangeAppStateSource,
        /selectedModel/,
        '期望 onChangeAppState 持久化路径写入 selectedModel。',
      )

      const selection = await loadSelectionModule()
      assert.equal(
        typeof selection.serializeSelectedModelForSettings,
        'function',
        '期望存在 serializeSelectedModelForSettings() 持久化桥接入口。',
      )

      const actual = selection.serializeSelectedModelForSettings({
        provider: 'openai',
        modelId: 'gpt-5.4',
        source: 'runtime',
      })

      assert.deepStrictEqual(actual, {
        selectedModel: {
          provider: 'openai',
          modelId: 'gpt-5.4',
          source: 'settings_v2',
        },
        model: 'gpt-5.4',
      })
    },
  },
  {
    category: 'negative',
    name: '缺少 provider 的新结构不能被静默持久化',
    async run() {
      const selection = await loadSelectionModule()
      assert.equal(
        typeof selection.serializeSelectedModelForSettings,
        'function',
        '期望存在 serializeSelectedModelForSettings() 持久化桥接入口。',
      )

      assert.throws(
        () =>
          selection.serializeSelectedModelForSettings({
            modelId: 'gpt-5.4',
            source: 'runtime',
          }),
        /provider/i,
      )
    },
  },
]

for (const testCase of testCases) {
  await execute(testCase)
}

console.error(`\nST-02 red summary: ${failures.length} case(s) failed as expected.`)

if (failures.length === 0) {
  throw new Error('ST-02 红测未能捕获缺口：没有出现任何失败。')
}

process.exitCode = 1
