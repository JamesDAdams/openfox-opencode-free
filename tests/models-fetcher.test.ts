import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OpenCodeFreeModelManager, OpenCodeModelApiItem } from '../src/models-fetcher.js'

describe('OpenCodeFreeModelManager', () => {
  let modelManager: OpenCodeFreeModelManager
  let mockFetcher: any

  beforeEach(() => {
    mockFetcher = vi.fn()
    modelManager = new OpenCodeFreeModelManager({
      fetcher: mockFetcher,
      refreshIntervalMs: 3600 * 1000,
    })
  })

  afterEach(() => {
    modelManager.stopPeriodicRefresh()
  })

  it('has selected: true on all DEFAULT_FREE_MODELS', () => {
    const cached = modelManager.getCachedModels()
    expect(cached.length).toBeGreaterThan(0)
    for (const model of cached) {
      expect(model.selected).toBe(true)
    }
  })

  it('filters strictly for free models ending with "-free"', () => {
    const freeItem: OpenCodeModelApiItem = {
      id: 'deepseek-v4-flash-free',
      name: 'DeepSeek V4 Flash Free',
    }
    const paidItem: OpenCodeModelApiItem = {
      id: 'claude-sonnet-5',
      name: 'Claude Sonnet 5',
    }

    expect(modelManager.isFreeModel(freeItem)).toBe(true)
    expect(modelManager.isFreeModel(paidItem)).toBe(false)
  })

  it('refreshes free models list and enriches with models.dev contextWindow, supportsVision and reasoningEfforts', async () => {
    const mockOpenCodeApiResponse = {
      data: [
        {
          id: 'x-preview-f-free',
          name: 'X Preview F (free)',
        },
        {
          id: 'paid-model-paid',
          name: 'Paid Model',
        },
      ],
    }

    const mockModelsDevApiResponse = {
      provider1: {
        models: {
          'x-preview-f-free': {
            id: 'x-preview-f-free',
            limit: { context: 1000000 },
            modalities: { input: ['text', 'image', 'video'] },
            reasoning: true,
            reasoning_options: [
              {
                type: 'effort',
                values: ['low', 'high', 'max'],
              },
            ],
          },
        },
      },
    }

    mockFetcher.mockImplementation(async (url: string) => {
      if (url.includes('opencode.ai')) {
        return { ok: true, json: async () => mockOpenCodeApiResponse }
      }
      if (url.includes('models.dev')) {
        return { ok: true, json: async () => mockModelsDevApiResponse }
      }
      return { ok: false }
    })

    const models = await modelManager.getFreeModels(true)
    expect(models.length).toBe(1)
    expect(models[0].id).toBe('x-preview-f-free')
    expect(models[0].selected).toBe(true)
    expect(models[0].contextWindow).toBe(1000000)
    expect(models[0].supportsVision).toBe(true)
    expect(models[0].reasoningEfforts).toEqual(['low', 'high', 'max'])
  })

  it('updates cache dynamically by adding new free models and removing retired ones', async () => {
    mockFetcher.mockImplementation(async (url: string) => {
      if (url.includes('opencode.ai')) {
        return {
          ok: true,
          json: async () => ({
            data: [{ id: 'model1-free' }, { id: 'model2-free' }],
          }),
        }
      }
      return { ok: false }
    })

    await modelManager.getFreeModels(true)
    expect(modelManager.getCachedModels().map((m) => m.id)).toEqual(['model1-free', 'model2-free'])
    expect(modelManager.getCachedModels().every((m) => m.selected === true)).toBe(true)

    // Second fetch 1 hour later: model2-free retired, model3-free added
    mockFetcher.mockImplementation(async (url: string) => {
      if (url.includes('opencode.ai')) {
        return {
          ok: true,
          json: async () => ({
            data: [{ id: 'model1-free' }, { id: 'model3-free' }],
          }),
        }
      }
      return { ok: false }
    })

    await modelManager.getFreeModels(true)
    expect(modelManager.getCachedModels().map((m) => m.id)).toEqual(['model1-free', 'model3-free'])
    expect(modelManager.getCachedModels().every((m) => m.selected === true)).toBe(true)
  })

  it('periodic timer triggers periodic refresh', async () => {
    vi.useFakeTimers()
    const timerManager = new OpenCodeFreeModelManager({
      fetcher: mockFetcher,
      refreshIntervalMs: 1000,
    })

    mockFetcher.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    })

    timerManager.startPeriodicRefresh()
    expect(mockFetcher).toHaveBeenCalled()

    vi.advanceTimersByTime(1005)
    expect(mockFetcher).toHaveBeenCalled()

    timerManager.stopPeriodicRefresh()
    vi.useRealTimers()
  })
})
