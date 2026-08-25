import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OpenRouterFreeModelManager, OpenRouterModelApiItem } from '../src/models-fetcher.js'

describe('OpenRouterFreeModelManager', () => {
  let modelManager: OpenRouterFreeModelManager
  let mockFetcher: any

  beforeEach(() => {
    mockFetcher = vi.fn()
    modelManager = new OpenRouterFreeModelManager({
      fetcher: mockFetcher,
      refreshIntervalMs: 3600 * 1000,
    })
  })

  afterEach(() => {
    modelManager.stopPeriodicRefresh()
  })

  it('filters strictly for free models (pricing.prompt === "0" & completion === "0")', () => {
    const freeItem: OpenRouterModelApiItem = {
      id: 'meta-llama/llama-3.3-70b-instruct:free',
      name: 'Llama 3.3 70B (free)',
      pricing: { prompt: '0', completion: '0' },
    }
    const paidItem: OpenRouterModelApiItem = {
      id: 'openai/gpt-4o',
      name: 'GPT-4o',
      pricing: { prompt: '0.000005', completion: '0.000015' },
    }

    expect(modelManager.isFreeModel(freeItem)).toBe(true)
    expect(modelManager.isFreeModel(paidItem)).toBe(false)
  })

  it('refreshes free models list and filters out paid models', async () => {
    const mockApiResponse = {
      data: [
        {
          id: 'model/free-1',
          name: 'Free Model 1',
          context_length: 128000,
          pricing: { prompt: '0', completion: '0' },
          architecture: { input_modalities: ['text', 'image'] },
        },
        {
          id: 'model/paid-1',
          name: 'Paid Model 1',
          pricing: { prompt: '0.001', completion: '0.002' },
        },
      ],
    }

    mockFetcher.mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    })

    const models = await modelManager.getFreeModels(true)
    expect(models.length).toBe(1)
    expect(models[0].id).toBe('model/free-1')
    expect(models[0].supportsVision).toBe(true)
  })

  it('updates cache dynamically by adding new free models and removing retired ones', async () => {
    // Initial fetch
    mockFetcher.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { id: 'model/free-1', pricing: { prompt: '0', completion: '0' } },
          { id: 'model/free-2', pricing: { prompt: '0', completion: '0' } },
        ],
      }),
    })

    await modelManager.getFreeModels(true)
    expect(modelManager.getCachedModels().map(m => m.id)).toEqual(['model/free-1', 'model/free-2'])

    // Second fetch 1 hour later: model/free-2 retired, model/free-3 added
    mockFetcher.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { id: 'model/free-1', pricing: { prompt: '0', completion: '0' } },
          { id: 'model/free-3', pricing: { prompt: '0', completion: '0' } },
        ],
      }),
    })

    await modelManager.getFreeModels(true)
    expect(modelManager.getCachedModels().map(m => m.id)).toEqual(['model/free-1', 'model/free-3'])
  })

  it('periodic timer triggers periodic refresh', async () => {
    vi.useFakeTimers()
    const timerManager = new OpenRouterFreeModelManager({
      fetcher: mockFetcher,
      refreshIntervalMs: 1000,
    })

    mockFetcher.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    })

    timerManager.startPeriodicRefresh()
    // Background fetch started immediately in startPeriodicRefresh
    expect(mockFetcher).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1005)
    expect(mockFetcher).toHaveBeenCalledTimes(2)

    timerManager.stopPeriodicRefresh()
    vi.useRealTimers()
  })
})
