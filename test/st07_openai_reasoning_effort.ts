/// <reference types="node" />
import assert from 'node:assert/strict'

import { buildOpenAIResponsesRequestBody } from '../src/services/api/providers/openaiResponses.ts'

const requestBody = buildOpenAIResponsesRequestBody({
  selectedModel: {
    modelId: 'gpt-5.4',
  },
  anthropicRequest: {
    messages: [{ role: 'user', content: 'hello' }],
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
  },
})

assert.deepEqual(requestBody.reasoning, {
  effort: 'high',
  summary: 'auto',
})

console.log('ST-07 openai reasoning effort mapping passed')
console.log(JSON.stringify(requestBody.reasoning))
