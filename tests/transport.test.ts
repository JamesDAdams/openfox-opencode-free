import { describe, it, expect, vi } from 'vitest'
import { OpenRouterFreeTransportAdapter } from '../src/transport.js'
import { OpenRouterFreeModelManager } from '../src/models-fetcher.js'

describe('OpenRouterFreeTransportAdapter', () => {
  it('streams response from OpenRouter API correctly', async () => {
    const mockModelManager = {
      getFreeModels: vi.fn().mockResolvedValue([
        { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B' },
      ]),
    } as unknown as OpenRouterFreeModelManager

    const transport = new OpenRouterFreeTransportAdapter(mockModelManager)

    const sseChunks = [
      'data: {"id":"gen-123","choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: [DONE]\n\n',
    ]

    const mockResponseStream = new ReadableStream({
      start(controller) {
        for (const chunk of sseChunks) {
          controller.enqueue(new TextEncoder().encode(chunk))
        }
        controller.close()
      },
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: mockResponseStream,
    }))

    const events: any[] = []
    for await (const event of transport.stream({
      messages: [{ role: 'user', content: 'Hi' }],
    }, {
      providerId: 'openrouter-free',
      model: 'meta-llama/llama-3.3-70b-instruct:free',
    })) {
      events.push(event)
    }

    expect(events).toContainEqual({ type: 'text_delta', content: 'Hello' })
    expect(events).toContainEqual({ type: 'text_delta', content: ' world' })
    const doneEvent = events.find(e => e.type === 'done')
    expect(doneEvent).toBeDefined()
    expect(doneEvent.response.content).toBe('Hello world')
  })
})
