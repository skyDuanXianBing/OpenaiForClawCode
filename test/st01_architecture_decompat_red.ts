import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type RedCheck = {
  id: string
  category: 'happy' | 'boundary' | 'negative'
  trace: string
  description: string
  run: () => void
}

const testDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(testDir, '..')

function repoPath(relativePath: string) {
  return path.join(repoRoot, relativePath)
}

function read(relativePath: string) {
  const absolutePath = repoPath(relativePath)
  assert.ok(existsSync(absolutePath), `missing file: ${relativePath}`)
  return readFileSync(absolutePath, 'utf8')
}

function assertAbsent(relativePath: string, pattern: RegExp, reason: string) {
  const content = read(relativePath)
  assert.ok(!pattern.test(content), `${relativePath} still contains ${reason}`)
}

function assertMissing(relativePath: string, reason: string) {
  assert.ok(!existsSync(repoPath(relativePath)), `${relativePath} should be removed: ${reason}`)
}

const checks: RedCheck[] = [
  {
    id: 'RED-ST01-01',
    category: 'happy',
    trace: 'REQ-01, REQ-02 -> TASK-01 -> VER-01, VER-02, VER-03',
    description:
      '正式 provider-aware 主干应只保留 selectedModel，不再保留 model/mainLoopModel 双轨兼容',
    run: () => {
      assertAbsent('src/utils/settings/types.ts', /\bmodel\??\s*:/, 'legacy `model` settings field')
      assertAbsent('src/state/AppStateStore.ts', /mainLoopModel(?:Override|ForSession)?/, 'legacy mainLoopModel state bridge')
      assertAbsent('src/state/onChangeAppState.ts', /mainLoopModel|\bmodel\b/, 'legacy dual-write persistence bridge')
      assertAbsent('src/bootstrap/state.ts', /mainLoopModel(?:Override)?|initialMainLoopModel/, 'legacy bootstrap override bridge')
    },
  },
  {
    id: 'RED-ST01-02',
    category: 'boundary',
    trace: 'REQ-03, REQ-05 -> TASK-02 -> VER-04, VER-05, VER-06',
    description:
      '边界输入应拒绝 legacy alias、裸字符串和 env provider 推断，只接受显式 provider-aware 选择',
    run: () => {
      assertAbsent(
        'src/utils/model/selection.ts',
        /readLegacyModelSetting|inferProviderFromLegacyModel|resolveLegacyAliasModelId|looksLikeOpenAIModel|looksLikeAnthropicModel|looksLikeAnthropicFamilyAlias|ANTHROPIC_MODEL/,
        'legacy alias / bare-string / env inference helpers',
      )
      assertAbsent(
        'src/utils/model/validateModel.ts',
        /readLegacyModelSetting|providerHint|parseModelCommandInput/,
        'legacy validation fallback for ambiguous model input',
      )
    },
  },
  {
    id: 'RED-ST01-03',
    category: 'negative',
    trace: 'REQ-04, REQ-08 -> TASK-03 -> VER-07, VER-08, VER-09, VER-15, VER-16',
    description:
      '不再支持 legacy/hidden 兼容面；公开模型集合只允许正式 provider 能力',
    run: () => {
      assertMissing('src/utils/model/registry/legacy.ts', 'legacy hidden registry should be deleted')
      assertAbsent('src/utils/model/registry/registry.ts', /allowHidden|LEGACY_OPENAI_MODEL_DESCRIPTORS/, 'legacy hidden registry lookups')
      assertAbsent(
        'src/utils/model/model.ts',
        /getSettings_DEPRECATED|getAPIProvider|firstPartyNameToCanonical|getMarketingNameForModel|ANTHROPIC_MODEL/,
        'legacy helper and provider compatibility branches',
      )
    },
  },
  {
    id: 'RED-ST01-04',
    category: 'negative',
    trace: 'REQ-06, REQ-08 -> TASK-04 -> VER-10, VER-11, VER-12, VER-15, VER-16',
    description:
      'provider/router/transport 不应再保留 compat facade、shim 或 fallback 分支',
    run: () => {
      assertAbsent('src/services/api/providerRouter.ts', /readLegacyModelSetting|providerHint/, 'legacy provider router fallback')
      assertAbsent('src/services/api/client.ts', /getAnthropicClient|getProviderAnthropicClientForModel/, 'Anthropic compatibility facade')
      assertAbsent('src/services/api/providers/openai.ts', /codex_compat/, 'OpenAI compatibility transport channel')
      assertMissing('src/services/api/codex-fetch-adapter.ts', 'Anthropic/OpenAI protocol shim should be removed')
      assertAbsent('src/services/api/claude.ts', /createOpenAIAnthropicStreamResponse/, 'Anthropic-shaped OpenAI stream bridge')
    },
  },
  {
    id: 'RED-ST01-05',
    category: 'negative',
    trace: 'REQ-07 -> TASK-05 -> VER-13, VER-14',
    description: '旧兼容测试资产不应继续存在并定义通过条件',
    run: () => {
      assertMissing('test/st05_selection_compat.ts', 'legacy compatibility test asset should be deleted or rewritten')
    },
  },
]

let failures = 0

console.log('ST-01 Red | architecture de-compat cleanup')

for (const check of checks) {
  try {
    check.run()
    console.log(`PASS ${check.id} [${check.category}] ${check.description}`)
  } catch (error) {
    failures += 1
    const message = error instanceof Error ? error.message : String(error)
    console.error(`FAIL ${check.id} [${check.category}] ${check.trace}`)
    console.error(`  ${check.description}`)
    console.error(`  ${message}`)
  }
}

if (failures > 0) {
  console.error(`RED RESULT: ${failures}/${checks.length} checks failed as expected.`)
  process.exit(1)
}

console.log('UNEXPECTED GREEN: compatibility debt no longer detected.')
