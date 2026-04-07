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
      `[${testCase.category}] ${testCase.name}: 红测意外通过，请确认 ST-04 是否已实现，或继续收紧断言。`,
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

async function loadModule(relativePath: string) {
  const moduleUrl = new URL(relativePath, import.meta.url).href
  return (await import(moduleUrl)) as Record<string, any>
}

const testCases: TestCase[] = [
  {
    category: 'happy',
    name: 'provider router 正式入口已落盘，client facade 不再直接把 OpenAI 绑到 Anthropic adapter',
    async run() {
      const providerRouter = await loadModule('../src/services/api/providerRouter.ts')
      const clientSource = readSourceFile('../src/services/api/client.ts')

      assert.ok(
        typeof providerRouter.getProviderClient === 'function' ||
          typeof providerRouter.createProviderRouter === 'function',
        '期望存在 provider router 正式入口（如 getProviderClient/createProviderRouter）。',
      )

      assert.match(
        clientSource,
        /providerRouter|getProviderClient|createProviderRouter/,
        '期望 src/services/api/client.ts 已升级为 provider router facade。',
      )

      assert.doesNotMatch(
        clientSource,
        /codex-fetch-adapter|createCodexFetch/,
        '期望 OpenAI adapter 仅保留在 OpenAI provider 内部，而不是继续出现在全局 client facade。',
      )
    },
  },
  {
    category: 'happy',
    name: 'Anthropic 与 OpenAI 存在清晰分离的 provider 实现与对称 env helper',
    async run() {
      const anthropicSource = readSourceFile('../src/services/api/providers/anthropic.ts')
      const openaiSource = readSourceFile('../src/services/api/providers/openai.ts')

      assert.match(
        anthropicSource,
        /ANTHROPIC_API_KEY/,
        '期望 Anthropic provider 有独立的 apiKey env 入口。',
      )
      assert.match(
        anthropicSource,
        /ANTHROPIC_BASE_URL/,
        '期望 Anthropic provider 有独立的 baseURL env 入口。',
      )
      assert.doesNotMatch(
        anthropicSource,
        /codex-fetch-adapter|createCodexFetch/,
        '期望 Anthropic provider 不再直接依赖 OpenAI/Codex adapter。',
      )

      assert.match(openaiSource, /OPENAI_API_KEY/, '期望 OpenAI provider 有独立的 apiKey env 入口。')
      assert.match(openaiSource, /OPENAI_BASE_URL/, '期望 OpenAI provider 有独立的 baseURL env 入口。')
      assert.match(
        openaiSource,
        /responses/,
        '期望 OpenAI provider 正式主干已出现 Responses API 语义入口。',
      )
    },
  },
  {
    category: 'boundary',
    name: 'validateModel 或等效校验入口已显式支持 provider-aware 分流',
    async run() {
      const validateModelModule = await loadModule('../src/utils/model/validateModel.ts')
      const validateModelSource = readSourceFile('../src/utils/model/validateModel.ts')

      assert.equal(
        typeof validateModelModule.validateModel,
        'function',
        '期望 validateModel() 仍是正式验证入口。',
      )

      assert.match(
        validateModelSource,
        /SelectedModel|providerHint/,
        '期望 validateModel() 或相关入口可直接接受 provider-aware 输入，而不是只接收裸 model string。',
      )

      assert.match(
        validateModelSource,
        /openai/,
        '期望 validateModel() 已显式区分 OpenAI provider 验证分支。',
      )

      assert.match(
        validateModelSource,
        /anthropic/,
        '期望 validateModel() 已显式保留 Anthropic provider 验证分支。',
      )

      assert.match(
        validateModelSource,
        /bedrock|vertex|foundry/,
        '期望 validateModel() 对 Bedrock / Vertex / Foundry 有显式 provider-aware 兼容分支，而不是回退到 Anthropic-only 假设。',
      )
    },
  },
  {
    category: 'boundary',
    name: '/model 输入解析已支持 provider:model 与裸 alias / 裸 model 的稳定规则',
    async run() {
      const selectionModule = await loadModule('../src/utils/model/selection.ts')

      assert.equal(
        typeof selectionModule.parseModelCommandInput,
        'function',
        '期望存在 parseModelCommandInput()，统一承接 /model provider-aware 输入解析。',
      )

      const explicitAnthropic = selectionModule.parseModelCommandInput({
        input: 'anthropic:sonnet',
        currentSelectedModel: {
          provider: 'openai',
          modelId: 'gpt-5.4',
          source: 'runtime',
        },
      })
      assert.equal(explicitAnthropic.provider, 'anthropic')
      assert.match(String(explicitAnthropic.modelId), /sonnet/i)

      const explicitOpenAI = selectionModule.parseModelCommandInput({
        input: 'openai:gpt-5.4',
        currentSelectedModel: {
          provider: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          source: 'runtime',
        },
      })
      assert.equal(explicitOpenAI.provider, 'openai')
      assert.equal(explicitOpenAI.modelId, 'gpt-5.4')

      const bareOpenAI = selectionModule.parseModelCommandInput({
        input: 'gpt-5.4',
        currentSelectedModel: {
          provider: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          source: 'runtime',
        },
      })
      assert.equal(bareOpenAI.provider, 'openai')
      assert.equal(bareOpenAI.modelId, 'gpt-5.4')

      const bareAlias = selectionModule.parseModelCommandInput({
        input: 'sonnet',
        currentSelectedModel: {
          provider: 'openai',
          modelId: 'gpt-5.4',
          source: 'runtime',
        },
      })
      assert.equal(bareAlias.provider, 'anthropic')
      assert.match(String(bareAlias.modelId), /sonnet/i)
    },
  },
  {
    category: 'boundary',
    name: 'ModelPicker 与 /model 命令已接入 selectedModel 主干并展示 provider 语义',
    async run() {
      const pickerSource = readSourceFile('../src/components/ModelPicker.tsx')
      const modelCommandSource = readSourceFile('../src/commands/model/model.tsx')

      assert.match(
        pickerSource,
        /selectedModel/,
        '期望 ModelPicker 读取 provider-aware selectedModel，而不是仅消费 mainLoopModel:string。',
      )
      assert.match(
        pickerSource,
        /provider|openai|anthropic|bedrock|vertex|foundry/,
        '期望 ModelPicker 列表项或当前项显式展示 provider 语义。',
      )

      assert.match(
        modelCommandSource,
        /selectedModel/,
        '期望 /model 命令层读写 selectedModel 主干。',
      )
      assert.match(
        modelCommandSource,
        /parseModelCommandInput|provider:/,
        '期望 /model 命令层已接入 provider-aware 输入解析。',
      )
    },
  },
  {
    category: 'negative',
    name: '未认证 provider 的判定不再绑定 env provider，也不会静默 fallback',
    async run() {
      const authSource = readSourceFile('../src/utils/auth.ts')

      assert.match(authSource, /openai/i, '期望认证入口显式处理 OpenAI provider。')
      assert.match(authSource, /anthropic/i, '期望认证入口显式处理 Anthropic provider。')
      assert.match(
        authSource,
        /selectedModel|provider/,
        '期望 provider 未认证判断读取 provider-aware 选择主干，而不只依赖 env provider。',
      )
      assert.match(
        authSource,
        /OPENAI_API_KEY|assertProviderAuthenticated|getProviderAuth/i,
        '期望存在面向 OpenAI provider 的显式认证探测入口，而不是只剩 Codex 订阅判断。',
      )
      assert.doesNotMatch(
        authSource,
        /getAPIProvider\(\)/,
        '期望 OpenAI 未认证判断不再绑定 getAPIProvider() 这类 env-only 条件。',
      )
    },
  },
]

for (const testCase of testCases) {
  await execute(testCase)
}

console.error(`\nST-04 red summary: ${failures.length} case(s) failed as expected.`)

if (failures.length === 0) {
  throw new Error('ST-04 红测未能捕获缺口：没有出现任何失败。')
}

process.exitCode = 1
