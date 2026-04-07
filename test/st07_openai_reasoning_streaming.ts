/// <reference types="node" />
import assert from 'node:assert/strict'

import {
  createOpenAIResponsesEventStream,
} from '../src/services/api/providers/openaiResponses.ts'
import {
  handleMessageFromStream,
  type StreamingThinking,
} from '../src/utils/messages.ts'

function createSSEPayload(events: Array<Record<string, unknown>>): string {
  return events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
}

function createStreamingResponse(events: Array<Record<string, unknown>>): Response {
  const payload = createSSEPayload(events)

  return new Response(payload, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
    },
  })
}

const openAIResponse = createStreamingResponse([
  {
    type: 'response.output_item.added',
    item: { type: 'reasoning' },
  },
  {
    type: 'response.reasoning_summary.delta',
    delta: 'Plan ',
  },
  {
    type: 'response.reasoning_summary.done',
    text: 'Plan carefully.',
  },
  {
    type: 'response.output_item.done',
    item: { type: 'reasoning' },
  },
  {
    type: 'response.completed',
    response: {
      usage: {
        input_tokens: 3,
        output_tokens: 5,
      },
    },
  },
])

const stream = createOpenAIResponsesEventStream({
  response: openAIResponse,
  model: 'gpt-5.4',
})

let streamingThinking: StreamingThinking | null = null
let streamMode = 'responding'

for await (const event of stream) {
  handleMessageFromStream(
    { type: 'stream_event', event } as never,
    () => {},
    () => {},
    mode => {
      streamMode = mode
    },
    () => {},
    undefined,
    updater => {
      streamingThinking = updater(streamingThinking)
    },
  )
}

assert.ok(streamingThinking)

const finalThinking = streamingThinking as StreamingThinking

assert.equal(finalThinking.thinking, 'Plan carefully.')
assert.equal(finalThinking.isStreaming, false)
assert.equal(streamMode, 'tool-use')

console.log('ST-07 openai reasoning streaming passed')
console.log(
  JSON.stringify({
    thinking: finalThinking.thinking,
    isStreaming: finalThinking.isStreaming,
  }),
)
