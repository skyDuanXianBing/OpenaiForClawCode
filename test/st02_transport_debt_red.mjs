import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function absolutePath(relativePath) {
  return resolve(rootDir, relativePath)
}

function fileExists(relativePath) {
  return existsSync(absolutePath(relativePath))
}

function readText(relativePath) {
  return readFileSync(absolutePath(relativePath), 'utf8')
}

let passedChecks = 0
let failedChecks = 0

function recordResult(passed, id, category, detail) {
  const status = passed ? 'PASS' : 'FAIL'
  console.log(`${status} ${id} [${category}] ${detail}`)

  if (passed) {
    passedChecks += 1
    return
  }

  failedChecks += 1
}

function expectMissing(relativePath, id, category, detail) {
  recordResult(!fileExists(relativePath), id, category, detail)
}

function expectFileToOmit(relativePath, matcher, id, category, detail) {
  const passed = fileExists(relativePath) && !matcher.test(readText(relativePath))
  recordResult(passed, id, category, detail)
}

function expectFileToContain(relativePath, matcher, id, category, detail) {
  const passed = fileExists(relativePath) && matcher.test(readText(relativePath))
  recordResult(passed, id, category, detail)
}

console.log('ST-02 Red | transport compat debt cleanup')

expectMissing(
  'src/services/api/codex-fetch-adapter.ts',
  'RED-ST02-01',
  'negative',
  'src/services/api/codex-fetch-adapter.ts should be removed or decomposed into provider-local formal helpers',
)

expectFileToOmit(
  'src/services/api/providers/openai.ts',
  /createOpenAIAnthropicStreamResponse|codex-fetch-adapter/,
  'RED-ST02-02',
  'negative',
  'src/services/api/providers/openai.ts should stop exposing the Anthropic-shaped OpenAI bridge and stop importing the compat shim',
)

expectFileToOmit(
  'src/services/api/claude.ts',
  /createOpenAIAnthropicStreamResponse|AnthropicSDKStream\.fromSSEResponse/,
  'RED-ST02-03',
  'negative',
  'src/services/api/claude.ts OpenAI branch should stop consuming Anthropic-shaped stream responses',
)

expectFileToOmit(
  'test/st07_openai_reasoning_effort.ts',
  /codex-fetch-adapter/,
  'RED-ST02-04',
  'happy',
  'test/st07_openai_reasoning_effort.ts should validate reasoning.effort against the formal OpenAI transport contract, not the shim',
)

expectFileToOmit(
  'test/st07_openai_reasoning_streaming.ts',
  /codex-fetch-adapter/,
  'RED-ST02-05',
  'boundary',
  'test/st07_openai_reasoning_streaming.ts should validate reasoning summary/text streaming against formal normalization, not the shim',
)

expectFileToContain(
  'src/services/api/providers/anthropic.ts',
  /./,
  'GUARD-ST02-01',
  'guard',
  'src/services/api/providers/anthropic.ts remains a formal provider surface and is not a deletion target',
)

expectFileToContain(
  'src/services/api/claude.ts',
  /getAnthropicClient|anthropic\.beta\.messages\.create/,
  'GUARD-ST02-02',
  'guard',
  'src/services/api/claude.ts still retains the formal Anthropic request path and should not be treated as compat debt by itself',
)

if (failedChecks > 0) {
  console.log(
    `RED RESULT: ${failedChecks} failing checks captured as expected; ${passedChecks} guard checks passed.`,
  )
  process.exit(1)
}

console.log(`GREEN RESULT: all ${passedChecks} checks passed.`)
