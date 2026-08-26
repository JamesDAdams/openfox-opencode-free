import { describe, it, expect, vi } from 'vitest'
import { OpenCodeFreeTransportAdapter } from '../src/transport.js'
import { OpenCodeFreeModelManager } from '../src/models-fetcher.js'

describe('OpenCodeFreeTransportAdapter', () => {
  it('streams response from OpenCode API correctly', async () => {
    const mockModelManager = {
      getFreeModels: vi.fn().mockResolvedValue([
        { id: 'deepseek-v4-flash-free', name: 'DeepSeek V4 Flash Free' },
      ]),
    } as unknown as OpenCodeFreeModelManager

    const transport = new OpenCodeFreeTransportAdapter(mockModelManager)

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
      providerId: 'opencode-free',
      model: 'deepseek-v4-flash-free',
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
