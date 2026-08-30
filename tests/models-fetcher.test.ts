import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OpenCodeFreeModelManager, OpenCodeModelApiItem } from '../src/models-fetcher.js'

describe('OpenCodeFreeModelManager', () => {
  let modelManager: OpenCodeFreeModelManager
  let mockFetcher: any
  let mockNotify: any

  beforeEach(() => {
    mockFetcher = vi.fn()
    mockNotify = vi.fn()
    modelManager = new OpenCodeFreeModelManager({
      fetcher: mockFetcher,
      refreshIntervalMs: 3600 * 1000,
      notify: mockNotify,
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

  it('notifies when new models are discovered', async () => {
    mockFetcher.mockImplementation(async (url: string) => {
      if (url.includes('opencode.ai')) {
        return {
          ok: true,
          json: async () => ({
            data: [{ id: 'model1-free', name: 'Model 1' }],
          }),
        }
      }
      return { ok: false }
    })

    // Initial fetch (startup)
    await modelManager.getFreeModels(true)
    mockNotify.mockClear()

    // Second fetch: new model added
    mockFetcher.mockImplementation(async (url: string) => {
      if (url.includes('opencode.ai')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { id: 'model1-free', name: 'Model 1' },
              { id: 'model2-free', name: 'Model 2' },
            ],
          }),
        }
      }
      return { ok: false }
    })

    await modelManager.getFreeModels(true)
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'OpenCode Free Models Updated',
        body: expect.stringContaining('Model 2'),
      }),
    )
  })

  it('notifies when a model is removed', async () => {
    mockFetcher.mockImplementation(async (url: string) => {
      if (url.includes('opencode.ai')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { id: 'model1-free', name: 'Model 1' },
              { id: 'model2-free', name: 'Model 2' },
            ],
          }),
        }
      }
      return { ok: false }
    })
    await modelManager.getFreeModels(true)
    mockNotify.mockClear()

    // Second fetch: model2-free removed
    mockFetcher.mockImplementation(async (url: string) => {
      if (url.includes('opencode.ai')) {
        return {
          ok: true,
          json: async () => ({
            data: [{ id: 'model1-free', name: 'Model 1' }],
          }),
        }
      }
      return { ok: false }
    })

    await modelManager.getFreeModels(true)
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'OpenCode Free Models Updated',
        body: expect.stringContaining('Removed (1): Model 2'),
      }),
    )
  })

  it('notifies on manual sync and includes list of new models if any', async () => {
    mockFetcher.mockImplementation(async (url: string) => {
      if (url.includes('opencode.ai')) {
        return {
          ok: true,
          json: async () => ({
            data: [{ id: 'model1-free', name: 'Model 1' }],
          }),
        }
      }
      return { ok: false }
    })

    await modelManager.getFreeModels(true, true)

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'OpenCode Free Models Synchronized',
        body: expect.stringContaining('Sync complete: 1 free models available'),
      }),
    )
  })

  it('periodic timer triggers periodic refresh and updates interval on setting change', async () => {
    vi.useFakeTimers()
    const timerManager = new OpenCodeFreeModelManager({
      fetcher: mockFetcher,
      settings: {
        notifyOnNewModelsOnly: true,
        notifyOnEveryCheck: false,
        checkOnStartup: true,
        refreshIntervalMinutes: 10,
      },
    })

    mockFetcher.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    })

    timerManager.startPeriodicRefresh(true)
    expect(mockFetcher).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(10 * 60 * 1000 + 5)
    expect(mockFetcher).toHaveBeenCalledTimes(4)

    timerManager.updateSettings({
      notifyOnNewModelsOnly: true,
      notifyOnEveryCheck: false,
      checkOnStartup: true,
      refreshIntervalMinutes: 5,
    })

    vi.advanceTimersByTime(5 * 60 * 1000 + 5)
    expect(mockFetcher).toHaveBeenCalledTimes(6)

    timerManager.stopPeriodicRefresh()
    vi.useRealTimers()
  })
})
