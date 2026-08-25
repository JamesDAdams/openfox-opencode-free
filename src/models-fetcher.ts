import type { ModelConfig } from 'openfox/provider'

export interface OpenRouterModelApiItem {
  id: string
  name?: string
  context_length?: number
  pricing?: {
    prompt?: string | number
    completion?: string | number
  }
  architecture?: {
    input_modalities?: string[]
  }
  supported_parameters?: string[]
}

export interface OpenRouterModelsApiResponse {
  data?: OpenRouterModelApiItem[]
}

export const DEFAULT_FREE_MODELS: ModelConfig[] = [
  {
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    name: 'Meta: Llama 3.3 70B Instruct (free)',
    contextWindow: 128000,
    source: 'backend',
    supportsVision: false,
  },
  {
    id: 'google/gemini-2.0-flash-lite-preview-02-05:free',
    name: 'Google: Gemini Flash Lite 2.0 Experimental (free)',
    contextWindow: 1048576,
    source: 'backend',
    supportsVision: true,
  },
  {
    id: 'deepseek/deepseek-r1:free',
    name: 'DeepSeek: R1 (free)',
    contextWindow: 16384,
    source: 'backend',
    supportsVision: false,
    reasoningEfforts: ['low', 'medium', 'high'],
  },
  {
    id: 'qwen/qwen-2.5-coder-32b-instruct:free',
    name: 'Qwen: Qwen 2.5 Coder 32B Instruct (free)',
    contextWindow: 32768,
    source: 'backend',
    supportsVision: false,
  },
  {
    id: 'mistralai/mistral-7b-instruct:free',
    name: 'Mistral: Mistral 7B Instruct (free)',
    contextWindow: 32768,
    source: 'backend',
    supportsVision: false,
  },
]

export class OpenRouterFreeModelManager {
  private cachedModels: ModelConfig[] = [...DEFAULT_FREE_MODELS]
  private lastFetchTimestamp = 0
  private timer: NodeJS.Timeout | null = null
  private readonly refreshIntervalMs: number
  private readonly apiEndpoint: string
  private readonly fetcher: typeof fetch

  constructor(options?: {
    refreshIntervalMs?: number
    apiEndpoint?: string
    fetcher?: typeof fetch
  }) {
    this.refreshIntervalMs = options?.refreshIntervalMs ?? 3600 * 1000 // 1 hour
    this.apiEndpoint = options?.apiEndpoint ?? 'https://openrouter.ai/api/v1/models'
    this.fetcher = options?.fetcher ?? fetch
  }

  /**
   * Start periodic 1-hour background refresh.
   */
  startPeriodicRefresh(): void {
    if (this.timer) return
    // Fetch immediately in background without blocking
    this.refreshFreeModels().catch(() => {})

    this.timer = setInterval(() => {
      this.refreshFreeModels().catch(() => {
        // Ignore background refresh errors; stale cache will remain
      })
    }, this.refreshIntervalMs)
    if (this.timer.unref) {
      this.timer.unref()
    }
  }

  /**
   * Stop periodic background refresh.
   */
  stopPeriodicRefresh(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /**
   * Returns the list of free models, refreshing if cache is expired (1x per hour) or empty.
   */
  async getFreeModels(forceRefresh = false): Promise<ModelConfig[]> {
    const now = Date.now()
    if (
      forceRefresh ||
      now - this.lastFetchTimestamp >= this.refreshIntervalMs
    ) {
      // Trigger refresh asynchronously or await if forceRefresh
      if (forceRefresh) {
        await this.refreshFreeModels()
      } else {
        this.refreshFreeModels().catch(() => {})
      }
    }
    return this.cachedModels
  }

  /**
   * Fetches latest models from OpenRouter API, filters for free models only,
   * adds new free models, and removes retired ones.
   */
  async refreshFreeModels(): Promise<ModelConfig[]> {
    try {
      const res = await this.fetcher(this.apiEndpoint, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'OpenFox-OpenRouter-Free-Plugin',
        },
        signal: AbortSignal.timeout(5000),
      })

      if (!res.ok) {
        return this.cachedModels
      }

      const body = (await res.json()) as OpenRouterModelsApiResponse
      if (!body?.data || !Array.isArray(body.data)) {
        return this.cachedModels
      }

      const freeModels: ModelConfig[] = []
      for (const item of body.data) {
        if (!item.id) continue
        if (!this.isFreeModel(item)) continue

        const supportsVision =
          item.architecture?.input_modalities?.includes('image') ?? false
        const supportsReasoning =
          item.supported_parameters?.includes('reasoning') ||
          item.supported_parameters?.includes('reasoning_effort') ||
          item.supported_parameters?.includes('include_reasoning')

        const modelConfig: ModelConfig = {
          id: item.id,
          name: item.name || item.id,
          contextWindow: item.context_length ?? 128000,
          source: 'backend',
          supportsVision,
          ...(supportsReasoning ? { reasoningEfforts: ['low', 'medium', 'high'] } : {}),
        }
        freeModels.push(modelConfig)
      }

      if (freeModels.length > 0) {
        this.cachedModels = freeModels
      }
      this.lastFetchTimestamp = Date.now()
      return this.cachedModels
    } catch {
      return this.cachedModels
    }
  }

  /**
   * Helper to determine if an OpenRouter model item is free.
   * Free models have prompt = "0" and completion = "0".
   */
  isFreeModel(item: OpenRouterModelApiItem): boolean {
    if (!item.pricing) return false
    const promptPrice = parseFloat(String(item.pricing.prompt ?? '-1'))
    const completionPrice = parseFloat(String(item.pricing.completion ?? '-1'))

    return promptPrice === 0 && completionPrice === 0
  }

  getCachedModels(): ModelConfig[] {
    return this.cachedModels
  }

  getLastFetchTimestamp(): number {
    return this.lastFetchTimestamp
  }
}
