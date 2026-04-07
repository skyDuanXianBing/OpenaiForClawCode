/// <reference types="node" />
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

type TestCategory = 'happy' | 'boundary' | 'negative'

type TestCase = {
  category: TestCategory
  name: string
  run: () => void | Promise<void>
}

const failures: string[] = []

function readSourceFile(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

async function execute(testCase: TestCase) {
  try {
    await testCase.run()
    console.log(`UNEXPECTED PASS [${testCase.category}] ${testCase.name}`)
    failures.push(
      `[${testCase.category}] ${testCase.name}: 红测意外通过，请确认 ST-06 是否已实现，或继续收紧断言。`,
    )
  } catch (error) {
    const detail = error instanceof Error ? error.stack ?? error.message : String(error)
    console.error(`EXPECTED RED [${testCase.category}] ${testCase.name}`)
    console.error(detail)
    failures.push(`[${testCase.category}] ${testCase.name}\n${detail}`)
  }
}

const modelCommandSource = readSourceFile('../src/commands/model/model.tsx')
const statePersistenceSource = readSourceFile('../src/state/onChangeAppState.ts')
const querySource = readSourceFile('../src/query.ts')
const claudeSource = readSourceFile('../src/services/api/claude.ts')
const providerRouterSource = readSourceFile('../src/services/api/providerRouter.ts')
const openAIProviderSource = readSourceFile('../src/services/api/providers/openai.ts')

const testCases: TestCase[] = [
  {
    category: 'happy',
    name: '显示层已切到 OpenAI 后，query 主干也必须读取 selectedModel',
    run() {
      assert.match(
        modelCommandSource,
        /selectedModel/,
        '前提失败：`/model` 命令层应已写入 selectedModel，本回归才成立。',
      )
      assert.match(
        statePersistenceSource,
        /selectedModel/,
        '前提失败：状态持久化层应已包含 selectedModel，本回归才成立。',
      )
      assert.match(
        querySource,
        /selectedModel/,
        '期望 `src/query.ts` 主请求链路显式读取 selectedModel；否则就是“显示层已切 OpenAI，但 query 仍没带 provider”。',
      )
    },
  },
  {
    category: 'boundary',
    name: 'query 不应继续只透传旧 mainLoopModel:string',
    run() {
      const queryUsesMainLoopModel = /mainLoopModel/.test(querySource)
      const queryUsesSelectedModel = /selectedModel/.test(querySource)
      const queryUsesProviderAwareRoute = /getProviderClient|providerRouter|providerClient/.test(
        querySource,
      )

      assert.ok(
        !queryUsesMainLoopModel || (queryUsesSelectedModel && queryUsesProviderAwareRoute),
        '期望 `src/query.ts` 在保留 `mainLoopModel` 兼容桥接时，至少同时透传 `selectedModel` 并接入 provider-aware route；当前仍是 `mainLoopModel:string` 单线主干。',
      )
    },
  },
  {
    category: 'negative',
    name: 'OpenAI provider 已存在时，主请求链路必须接到 provider-aware router',
    run() {
      assert.match(
        providerRouterSource,
        /getProviderClient|providerRouter|providerClient/,
        '前提失败：provider-aware router 入口应已存在，否则无法锁定“已存在但未接线”的回归。',
      )
      assert.match(
        openAIProviderSource,
        /createOpenAIResponse|openAIProviderClient|responses/,
        '前提失败：OpenAI provider client 应已存在，否则本回归不是“接线缺失”而是“实现缺失”。',
      )
      assert.match(
        querySource,
        /getProviderClient|providerRouter|providerClient/,
        '期望 `src/query.ts` 真实请求主链路接到 provider-aware router；否则 OpenAI provider 只是“存在但未被主链路使用”。',
      )
    },
  },
  {
    category: 'negative',
    name: '当 claude.ts 仍固定走 Anthropic transport 时，OpenAI 场景必须在 query 侧绕开它',
    run() {
      const fixedAnthropicTransport =
        /getAnthropicClient\(/.test(claudeSource) &&
        /anthropic\.beta\.messages\.create\(/.test(claudeSource)
      const queryUsesProviderAwareRoute = /selectedModel|getProviderClient|providerRouter|providerClient/.test(
        querySource,
      )

      assert.ok(
        !fixedAnthropicTransport || queryUsesProviderAwareRoute,
        '检测到 `src/services/api/claude.ts` 仍固定组合 `getAnthropicClient()` + `anthropic.beta.messages.create(...)`；若 `src/query.ts` 又未接 provider-aware route，就能直接证明“OpenAI 选择后真实发送仍落到 Anthropic 链路”。',
      )
    },
  },
]

for (const testCase of testCases) {
  await execute(testCase)
}

console.error(`\nST-06 red summary: ${failures.length} case(s) failed as expected.`)

if (failures.length === 0) {
  throw new Error('ST-06 红测未能捕获缺口：没有出现任何失败。')
}

process.exitCode = 1
