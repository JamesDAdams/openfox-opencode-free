import type {
  ProviderTransportAdapter,
  ProviderRequestContext,
  ModelConfig,
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMStreamEvent,
  ToolCall,
  LLMMessage,
  LLMToolDefinition,
} from 'openfox/provider'
import type { OpenCodeFreeModelManager } from './models-fetcher.js'
import type { OpenCodeAuthAdapter } from './auth.js'

export class OpenCodeFreeTransportAdapter implements ProviderTransportAdapter {
  readonly id = 'opencode-free-transport'

  constructor(
    private readonly modelManager: OpenCodeFreeModelManager,
    private readonly auth?: OpenCodeAuthAdapter,
  ) {}

  async listModels(_context: ProviderRequestContext): Promise<ModelConfig[]> {
    return await this.modelManager.getFreeModels()
  }

  async complete(
    request: LLMCompletionRequest,
    context: ProviderRequestContext,
  ): Promise<LLMCompletionResponse> {
    let result: LLMCompletionResponse | undefined
    for await (const event of this.stream(request, context)) {
      if (event.type === 'done') result = event.response
      if (event.type === 'error') throw new Error(event.error)
    }
    if (!result) {
      throw new Error('OpenCode response completed without a final result')
    }
    return result
  }

  async *stream(
    request: LLMCompletionRequest,
    context: ProviderRequestContext,
  ): AsyncIterable<LLMStreamEvent> {
    const model = context.model ?? 'deepseek-v4-flash-free'

    let apiKey: string | undefined

    let accessHeaders: Record<string, string> = {
      'X-Title': 'OpenFox OpenCode Free Plugin',
    }

    if (context.auth?.headers) {
      accessHeaders = { ...accessHeaders, ...context.auth.headers }
    }

    if (context.auth?.accessToken) {
      apiKey = context.auth.accessToken
    }
    if (!apiKey && (context as any).apiKey) {
      apiKey = (context as any).apiKey
    }
    if (!apiKey && this.auth && context.credentialRef) {
      try {
        const access = await this.auth.getAccessContext(context.credentialRef)
        apiKey = access.accessToken
        if (access.headers) {
          accessHeaders = { ...accessHeaders, ...access.headers }
        }
      } catch {}
    }
    if (!apiKey) {
      apiKey = process.env.OPENCODE_API_KEY
    }

    if (apiKey && !accessHeaders['Authorization']) {
      accessHeaders['Authorization'] = `Bearer ${apiKey}`
    }

    const messages = request.messages.map((m: LLMMessage) => {
      const base: Record<string, unknown> = {
        role: m.role,
        content: m.content === '' ? null : m.content,
      }
      if (m.role === 'assistant' && m.toolCalls?.length) {
        base.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        }))
      }
      if (m.role === 'tool' && m.toolCallId) {
        base.tool_call_id = m.toolCallId
      }
      if (m.name) base.name = m.name
      return base
    })

    const body: Record<string, unknown> = {
      model,
      messages,
      stream: true,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
    }

    if (request.tools?.length) {
      body.tools = request.tools.map((t: LLMToolDefinition) => ({
        type: 'function',
        function: {
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        },
      }))
    }
    if (request.toolChoice) body.tool_choice = request.toolChoice
    if (request.reasoningEffort) body.reasoning_effort = request.reasoningEffort

    let res: Response
    try {
      res = await fetch('https://opencode.ai/zen/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...accessHeaders,
        },
        body: JSON.stringify(body),
        signal: request.signal,
      })
    } catch (err: any) {
      if (request.signal?.aborted) {
        yield { type: 'error', error: 'Request aborted' }
        return
      }
      yield { type: 'error', error: err.message || String(err) }
      return
    }

    if (!res.ok) {
      const errorText = await res.text()
      yield {
        type: 'error',
        error: `OpenCode API error (${res.status}): ${errorText}`,
      }
      return
    }

    if (!res.body) {
      yield { type: 'error', error: 'Response body is empty' }
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let fullContent = ''
    let fullThinking = ''
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>()
    let finishReason: LLMCompletionResponse['finishReason'] = 'stop'
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    let responseId = 'opencode-response-' + crypto.randomUUID()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          if (buffer.trim()) {
            const cleaned = buffer.trim()
            if (cleaned.startsWith('data: ') && cleaned.slice(6) !== '[DONE]') {
              this.parseAndYieldChunk(
                cleaned.slice(6),
                (id) => { responseId = id },
                (u) => { usage = u },
                (fr) => { finishReason = fr },
                (thinking) => { fullThinking += thinking },
                (content) => { fullContent += content },
                toolCalls,
              )
            }
          }
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const cleaned = line.trim()
          if (!cleaned || cleaned === 'data: [DONE]') continue

          if (cleaned.startsWith('data: ')) {
            const dataStr = cleaned.slice(6)
            for (const event of this.parseAndYieldChunk(
              dataStr,
              (id) => { responseId = id },
              (u) => { usage = u },
              (fr) => { finishReason = fr },
              (thinking) => { fullThinking += thinking },
              (content) => { fullContent += content },
              toolCalls,
            )) {
              yield event
            }
          }
        }
      }
    } catch (err: any) {
      if (request.signal?.aborted) {
        yield { type: 'error', error: 'Request aborted' }
        return
      }
      yield { type: 'error', error: err.message || String(err) }
      return
    } finally {
      reader.releaseLock()
    }

    const parsedToolCalls: ToolCall[] = []
    for (const [, tc] of toolCalls) {
      try {
        parsedToolCalls.push({
          id: tc.id,
          name: tc.name,
          arguments: JSON.parse(tc.arguments) as Record<string, unknown>,
        })
      } catch (error) {
        parsedToolCalls.push({
          id: tc.id,
          name: tc.name,
          arguments: {},
          parseError: error instanceof Error ? error.message : 'Unknown JSON parse error',
          rawArguments: tc.arguments,
        })
      }
    }

    yield {
      type: 'done',
      response: {
        id: responseId,
        content: fullContent,
        ...(fullThinking && { thinkingContent: fullThinking }),
        ...(parsedToolCalls.length > 0 && { toolCalls: parsedToolCalls }),
        finishReason,
        usage,
      },
    }
  }

  private *parseAndYieldChunk(
    dataStr: string,
    setId: (id: string) => void,
    setUsage: (u: { promptTokens: number; completionTokens: number; totalTokens: number }) => void,
    setFinishReason: (fr: LLMCompletionResponse['finishReason']) => void,
    addThinking: (thinking: string) => void,
    addContent: (content: string) => void,
    toolCalls: Map<number, { id: string; name: string; arguments: string }>,
  ): Generator<LLMStreamEvent> {
    try {
      const parsed = JSON.parse(dataStr) as {
        id?: string
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
        choices?: Array<{
          finish_reason?: string | null
          delta?: {
            content?: string | null
            reasoning_content?: string | null
            reasoning?: string | null
            thinking?: string | null
            tool_calls?: Array<{
              index: number
              id?: string
              function?: { name?: string; arguments?: string }
            }>
          }
        }>
      }

      if (parsed.id) setId(parsed.id)
      if (parsed.usage) {
        setUsage({
          promptTokens: parsed.usage.prompt_tokens ?? 0,
          completionTokens: parsed.usage.completion_tokens ?? 0,
          totalTokens: parsed.usage.total_tokens ?? 0,
        })
      }

      const choice = parsed.choices?.[0]
      if (!choice) return

      if (choice.finish_reason) {
        switch (choice.finish_reason) {
          case 'stop':
            setFinishReason('stop')
            break
          case 'tool_calls':
            setFinishReason('tool_calls')
            break
          case 'length':
            setFinishReason('length')
            break
          case 'content_filter':
            setFinishReason('content_filter')
            break
        }
      }

      const delta = choice.delta
      if (!delta) return

      const thinking = delta.reasoning_content || delta.reasoning || delta.thinking
      if (thinking) {
        addThinking(thinking)
        yield { type: 'thinking_delta', content: thinking }
      }

      if (delta.content) {
        addContent(delta.content)
        yield { type: 'text_delta', content: delta.content }
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = toolCalls.get(tc.index)
          if (!existing) {
            toolCalls.set(tc.index, {
              id: tc.id ?? '',
              name: tc.function?.name ?? '',
              arguments: tc.function?.arguments ?? '',
            })
          } else {
            if (tc.id) existing.id = tc.id
            if (tc.function?.name) existing.name += tc.function.name
            if (tc.function?.arguments) existing.arguments += tc.function.arguments
          }

          yield {
            type: 'tool_call_delta',
            index: tc.index,
            ...(tc.id ? { id: tc.id } : {}),
            ...(tc.function?.name ? { name: tc.function.name } : {}),
            ...(tc.function?.arguments ? { arguments: tc.function.arguments } : {}),
          }
        }
      }
    } catch {}
  }
}
