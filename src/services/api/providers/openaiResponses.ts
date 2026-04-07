import type { Stream } from '@anthropic-ai/sdk/streaming.mjs'
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { SelectedModel } from 'src/utils/model/types.js'

interface AnthropicContentBlock {
  type: string
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string | AnthropicContentBlock[]
  source?: {
    type?: string
    media_type?: string
    data?: string
  }
  [key: string]: unknown
}

interface AnthropicMessage {
  role: string
  content: string | AnthropicContentBlock[]
}

interface AnthropicTool {
  name: string
  description?: string
  input_schema?: Record<string, unknown>
}

function translateTools(
  anthropicTools: AnthropicTool[],
): Array<Record<string, unknown>> {
  return anthropicTools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description || '',
    parameters: tool.input_schema || { type: 'object', properties: {} },
    strict: null,
  }))
}

function translateMessages(
  anthropicMessages: AnthropicMessage[],
): Array<Record<string, unknown>> {
  const responseInput: Array<Record<string, unknown>> = []
  let toolCallCounter = 0

  for (const message of anthropicMessages) {
    if (typeof message.content === 'string') {
      responseInput.push({ role: message.role, content: message.content })
      continue
    }

    if (!Array.isArray(message.content)) {
      continue
    }

    if (message.role === 'user') {
      const contentParts: Array<Record<string, unknown>> = []

      for (const block of message.content) {
        if (block.type === 'tool_result') {
          const callId = block.tool_use_id || `call_${toolCallCounter++}`
          let outputText = ''

          if (typeof block.content === 'string') {
            outputText = block.content
          } else if (Array.isArray(block.content)) {
            outputText = block.content
              .map((nestedBlock) => {
                if (nestedBlock.type === 'text') {
                  return nestedBlock.text || ''
                }

                if (nestedBlock.type === 'image') {
                  return '[Image data attached]'
                }

                return ''
              })
              .join('\n')
          }

          responseInput.push({
            type: 'function_call_output',
            call_id: callId,
            output: outputText || '',
          })
          continue
        }

        if (block.type === 'text' && typeof block.text === 'string') {
          contentParts.push({ type: 'input_text', text: block.text })
          continue
        }

        if (
          block.type === 'image' &&
          block.source &&
          typeof block.source === 'object' &&
          block.source.type === 'base64'
        ) {
          contentParts.push({
            type: 'input_image',
            image_url: `data:${block.source.media_type};base64,${block.source.data}`,
          })
        }
      }

      if (contentParts.length === 1 && contentParts[0]?.type === 'input_text') {
        responseInput.push({ role: 'user', content: contentParts[0].text })
        continue
      }

      if (contentParts.length > 0) {
        responseInput.push({ role: 'user', content: contentParts })
      }

      continue
    }

    for (const block of message.content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        responseInput.push({
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: block.text,
              annotations: [],
            },
          ],
          status: 'completed',
        })
        continue
      }

      if (block.type === 'tool_use') {
        responseInput.push({
          type: 'function_call',
          call_id: block.id || `call_${toolCallCounter++}`,
          name: block.name || '',
          arguments: JSON.stringify(block.input || {}),
        })
      }
    }
  }

  return responseInput
}

function getAnthropicEffort(
  anthropicRequest: Record<string, unknown>,
): string | undefined {
  const outputConfig = anthropicRequest.output_config
  if (!outputConfig || typeof outputConfig !== 'object') {
    return undefined
  }

  const effort = (outputConfig as Record<string, unknown>).effort
  return typeof effort === 'string' ? effort : undefined
}

function getOpenAIReasoningConfig(
  anthropicRequest: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const reasoning: Record<string, unknown> = {}
  const effort = getAnthropicEffort(anthropicRequest)

  if (effort) {
    reasoning.effort = effort
  }

  if (anthropicRequest.thinking !== undefined) {
    reasoning.summary = 'auto'
  }

  return Object.keys(reasoning).length > 0 ? reasoning : undefined
}

function getInstructions(
  systemPrompt:
    | string
    | Array<{ type: string; text?: string; cache_control?: unknown }>
    | undefined,
): string {
  if (!systemPrompt) {
    return ''
  }

  if (typeof systemPrompt === 'string') {
    return systemPrompt
  }

  if (!Array.isArray(systemPrompt)) {
    return ''
  }

  return systemPrompt
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text || '')
    .join('\n')
}

export function buildOpenAIResponsesRequestBody(args: {
  selectedModel: Pick<SelectedModel, 'modelId'>
  anthropicRequest: Record<string, unknown>
}): Record<string, unknown> {
  const anthropicMessages =
    (args.anthropicRequest.messages as AnthropicMessage[]) || []
  const anthropicTools = (args.anthropicRequest.tools as AnthropicTool[]) || []

  const requestBody: Record<string, unknown> = {
    model: args.selectedModel.modelId,
    store: false,
    instructions: getInstructions(args.anthropicRequest.system as never),
    input: translateMessages(anthropicMessages),
    tool_choice: 'auto',
    parallel_tool_calls: true,
  }

  if (typeof args.anthropicRequest.max_tokens === 'number') {
    requestBody.max_output_tokens = args.anthropicRequest.max_tokens
  }

  if (anthropicTools.length > 0) {
    requestBody.tools = translateTools(anthropicTools)
  }

  const reasoning = getOpenAIReasoningConfig(args.anthropicRequest)
  if (reasoning) {
    requestBody.reasoning = reasoning
  }

  return requestBody
}

function extractOpenAIReasoningText(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(extractOpenAIReasoningText).filter(Boolean).join('')
  }

  if (!value || typeof value !== 'object') {
    return ''
  }

  const record = value as Record<string, unknown>

  if (typeof record.text === 'string') {
    return record.text
  }

  if (typeof record.delta === 'string') {
    return record.delta
  }

  if (Array.isArray(record.summary)) {
    return extractOpenAIReasoningText(record.summary)
  }

  if (Array.isArray(record.content)) {
    return extractOpenAIReasoningText(record.content)
  }

  if (Array.isArray(record.parts)) {
    return extractOpenAIReasoningText(record.parts)
  }

  return ''
}

function getOpenAIReasoningEventText(
  event: Record<string, unknown>,
  candidateKeys: string[],
): string {
  for (const candidateKey of candidateKeys) {
    const text = extractOpenAIReasoningText(event[candidateKey])
    if (text.length > 0) {
      return text
    }
  }

  return ''
}

function createMessageStartEvent(messageId: string, model: string) {
  return {
    type: 'message_start',
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      content: [],
      model,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  } as BetaRawMessageStreamEvent
}

function createContentBlockStartEvent(index: number, contentBlock: unknown) {
  return {
    type: 'content_block_start',
    index,
    content_block: contentBlock,
  } as BetaRawMessageStreamEvent
}

function createContentBlockDeltaEvent(index: number, delta: unknown) {
  return {
    type: 'content_block_delta',
    index,
    delta,
  } as BetaRawMessageStreamEvent
}

function createContentBlockStopEvent(index: number) {
  return {
    type: 'content_block_stop',
    index,
  } as BetaRawMessageStreamEvent
}

function createMessageDeltaEvent(args: {
  hadToolCalls: boolean
  inputTokens: number
  outputTokens: number
}) {
  return {
    type: 'message_delta',
    delta: {
      stop_reason: args.hadToolCalls ? 'tool_use' : 'end_turn',
      stop_sequence: null,
    },
    usage: {
      input_tokens: args.inputTokens,
      output_tokens: args.outputTokens,
    },
  } as BetaRawMessageStreamEvent
}

function createMessageStopEvent(args: {
  inputTokens: number
  outputTokens: number
}) {
  return {
    type: 'message_stop',
    usage: {
      input_tokens: args.inputTokens,
      output_tokens: args.outputTokens,
    },
  } as BetaRawMessageStreamEvent
}

export function createOpenAIResponsesEventStream(args: {
  response: Response
  model: string
}): Stream<BetaRawMessageStreamEvent> {
  const controller = new AbortController()

  const iterator = async function* (): AsyncGenerator<BetaRawMessageStreamEvent> {
    const queue: BetaRawMessageStreamEvent[] = []
    const messageId = `msg_openai_${Date.now()}`
    let contentBlockIndex = 0
    let outputTokens = 0
    let inputTokens = 0
    let currentTextBlockStarted = false
    let currentToolCallId = ''
    let currentToolCallName = ''
    let inToolCall = false
    let hadToolCalls = false
    let inReasoningBlock = false
    let reasoningSummaryText = ''
    let reasoningText = ''

    const flushQueue = async function* (): AsyncGenerator<BetaRawMessageStreamEvent> {
      while (queue.length > 0) {
        yield queue.shift() as BetaRawMessageStreamEvent
      }
    }

    const ensureReasoningBlockStarted = () => {
      if (inReasoningBlock) {
        return
      }

      inReasoningBlock = true
      queue.push(
        createContentBlockStartEvent(contentBlockIndex, {
          type: 'thinking',
          thinking: '',
        }),
      )
    }

    const appendReasoningChunk = (text: string, kind: 'summary' | 'text') => {
      if (text.length === 0) {
        return
      }

      ensureReasoningBlockStarted()

      let displayText = text
      if (
        kind === 'text' &&
        reasoningText.length === 0 &&
        reasoningSummaryText.length > 0
      ) {
        displayText = `\n\n${text}`
      }

      queue.push(
        createContentBlockDeltaEvent(contentBlockIndex, {
          type: 'thinking_delta',
          thinking: displayText,
        }),
      )

      if (kind === 'summary') {
        reasoningSummaryText += text
      } else {
        reasoningText += text
      }

      outputTokens += 1
    }

    const appendReasoningDoneText = (
      text: string,
      kind: 'summary' | 'text',
    ) => {
      if (text.length === 0) {
        return
      }

      const currentText = kind === 'summary' ? reasoningSummaryText : reasoningText
      if (currentText.length === 0) {
        appendReasoningChunk(text, kind)
        return
      }

      if (!text.startsWith(currentText)) {
        return
      }

      appendReasoningChunk(text.slice(currentText.length), kind)
    }

    const closeToolCallBlock = () => {
      queue.push(createContentBlockStopEvent(contentBlockIndex))
    }

    const closeTextBlock = () => {
      queue.push(createContentBlockStopEvent(contentBlockIndex))
      contentBlockIndex += 1
      currentTextBlockStarted = false
    }

    const closeReasoningBlock = () => {
      queue.push(createContentBlockStopEvent(contentBlockIndex))
      contentBlockIndex += 1
      inReasoningBlock = false
      reasoningSummaryText = ''
      reasoningText = ''
    }

    const processDataLine = (dataLine: string) => {
      if (dataLine === '[DONE]') {
        return
      }

      let event: Record<string, unknown>
      try {
        event = JSON.parse(dataLine)
      } catch {
        return
      }

      const eventType = event.type as string

      if (eventType === 'response.output_item.added') {
        const item = event.item as Record<string, unknown>

        if (item?.type === 'reasoning') {
          ensureReasoningBlockStarted()
          return
        }

        if (item?.type === 'message') {
          if (inToolCall) {
            closeToolCallBlock()
            contentBlockIndex += 1
            inToolCall = false
          }
          return
        }

        if (item?.type === 'function_call') {
          if (currentTextBlockStarted) {
            closeTextBlock()
          }

          currentToolCallId = (item.call_id as string) || `toolu_${Date.now()}`
          currentToolCallName = (item.name as string) || ''
          inToolCall = true
          hadToolCalls = true

          queue.push(
            createContentBlockStartEvent(contentBlockIndex, {
              type: 'tool_use',
              id: currentToolCallId,
              name: currentToolCallName,
              input: {},
            }),
          )
        }

        return
      }

      if (eventType === 'response.output_text.delta') {
        const text = event.delta
        if (typeof text !== 'string' || text.length === 0) {
          return
        }

        if (!currentTextBlockStarted) {
          queue.push(
            createContentBlockStartEvent(contentBlockIndex, {
              type: 'text',
              text: '',
            }),
          )
          currentTextBlockStarted = true
        }

        queue.push(
          createContentBlockDeltaEvent(contentBlockIndex, {
            type: 'text_delta',
            text,
          }),
        )
        outputTokens += 1
        return
      }

      if (eventType === 'response.reasoning.delta') {
        appendReasoningChunk(event.delta as string, 'text')
        return
      }

      if (
        eventType === 'response.reasoning_summary.delta' ||
        eventType === 'response.reasoning.summary.delta'
      ) {
        appendReasoningChunk(
          getOpenAIReasoningEventText(event, ['delta', 'summary', 'part']),
          'summary',
        )
        return
      }

      if (
        eventType === 'response.reasoning_summary.done' ||
        eventType === 'response.reasoning.summary.done'
      ) {
        appendReasoningDoneText(
          getOpenAIReasoningEventText(event, ['text', 'summary', 'part']),
          'summary',
        )
        return
      }

      if (
        eventType === 'response.reasoning_text.delta' ||
        eventType === 'response.reasoning.text.delta'
      ) {
        appendReasoningChunk(
          getOpenAIReasoningEventText(event, ['delta', 'text', 'content', 'part']),
          'text',
        )
        return
      }

      if (
        eventType === 'response.reasoning_text.done' ||
        eventType === 'response.reasoning.text.done'
      ) {
        appendReasoningDoneText(
          getOpenAIReasoningEventText(event, ['text', 'content', 'part']),
          'text',
        )
        return
      }

      if (eventType === 'response.function_call_arguments.delta') {
        const argumentDelta = event.delta as string
        if (typeof argumentDelta !== 'string' || !inToolCall) {
          return
        }

        queue.push(
          createContentBlockDeltaEvent(contentBlockIndex, {
            type: 'input_json_delta',
            partial_json: argumentDelta,
          }),
        )
        return
      }

      if (eventType === 'response.output_item.done') {
        const item = event.item as Record<string, unknown>

        if (item?.type === 'function_call') {
          closeToolCallBlock()
          contentBlockIndex += 1
          inToolCall = false
          return
        }

        if (item?.type === 'message' && currentTextBlockStarted) {
          closeTextBlock()
          return
        }

        if (item?.type === 'reasoning' && inReasoningBlock) {
          closeReasoningBlock()
        }

        return
      }

      if (eventType === 'response.completed') {
        const response = event.response as Record<string, unknown>
        const usage = response?.usage as Record<string, number> | undefined
        if (usage) {
          outputTokens = usage.output_tokens || outputTokens
          inputTokens = usage.input_tokens || inputTokens
        }
      }
    }

    queue.push(createMessageStartEvent(messageId, args.model))
    yield* flushQueue()

    const reader = args.response.body?.getReader()
    if (!reader) {
      throw new Error('OpenAI Responses stream body is missing.')
    }

    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        if (controller.signal.aborted) {
          return
        }

        const { done, value } = await reader.read()
        if (done) {
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith('event: ')) {
            continue
          }

          if (!trimmed.startsWith('data: ')) {
            continue
          }

          processDataLine(trimmed.slice(6))
          yield* flushQueue()
        }
      }

      const remainingLine = buffer.trim()
      if (remainingLine.startsWith('data: ')) {
        processDataLine(remainingLine.slice(6))
        yield* flushQueue()
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return
      }

      throw error
    } finally {
      reader.releaseLock()
    }

    if (currentTextBlockStarted) {
      closeTextBlock()
    }

    if (inReasoningBlock) {
      closeReasoningBlock()
    }

    if (inToolCall) {
      closeToolCallBlock()
    }

    queue.push(
      createMessageDeltaEvent({
        hadToolCalls,
        inputTokens,
        outputTokens,
      }),
    )
    queue.push(
      createMessageStopEvent({
        inputTokens,
        outputTokens,
      }),
    )
    yield* flushQueue()
  }

  return {
    controller,
    [Symbol.asyncIterator]: iterator,
  } as unknown as Stream<BetaRawMessageStreamEvent>
}
