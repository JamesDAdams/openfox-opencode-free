import type { ModelConfig } from 'openfox/provider'

export interface OpenCodeModelApiItem {
  id: string
  name?: string
  object?: string
  owned_by?: string
  context_length?: number
  architecture?: {
    input_modalities?: string[]
  }
  modalities?: {
    input?: string[]
    output?: string[]
  }
  supported_parameters?: string[]
  reasoning?: boolean
  reasoning_options?: Array<{
    type?: string
    values?: string[]
  }>
}

export interface OpenCodeModelsApiResponse {
  data?: OpenCodeModelApiItem[]
}

export interface ModelsDevModelInfo {
  id?: string
  limit?: {
    context?: number
    output?: number
  }
  modalities?: {
    input?: string[]
    output?: string[]
  }
  reasoning?: boolean
  reasoning_options?: Array<{
    type?: string
    values?: string[]
  }>
}

export interface ModelsDevApiResponse {
  [providerId: string]: {
    models?: {
      [modelId: string]: ModelsDevModelInfo
    }
  }
}

export const DEFAULT_FREE_MODELS: ModelConfig[] = [
  {
    id: 'deepseek-v4-flash-free',
    name: 'DeepSeek V4 Flash (free)',
    contextWindow: 1048576,
    source: 'backend',
    supportsVision: false,
    selected: true,
    reasoningEfforts: ['low', 'high', 'max'],
  },
  {
    id: 'x-preview-f-free',
    name: 'X Preview F (free)',
    contextWindow: 1000000,
    source: 'backend',
    supportsVision: true,
    selected: true,
    reasoningEfforts: ['low', 'high', 'max'],
  },
  {
    id: 'muse-spark-1.2-contributor-free',
    name: 'Muse Spark 1.2 Contributor (free)',
    contextWindow: 1048576,
    source: 'backend',
    supportsVision: true,
    selected: true,
    reasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh'],
  },
  {
    id: 'mimo-v2.5-free',
    name: 'Mimo V2.5 (free)',
    contextWindow: 1048576,
    source: 'backend',
    supportsVision: true,
    selected: true,
    reasoningEfforts: ['low', 'medium', 'high'],
  },
  {
    id: 'hy3-free',
    name: 'HY3 (free)',
    contextWindow: 256000,
    source: 'backend',
    supportsVision: false,
    selected: true,
    reasoningEfforts: ['low', 'medium', 'high'],
  },
  {
    id: 'nemotron-3-ultra-free',
    name: 'Nemotron 3 Ultra (free)',
    contextWindow: 1000000,
    source: 'backend',
    supportsVision: false,
    selected: true,
    reasoningEfforts: ['low', 'medium', 'high'],
  },
  {
    id: 'nemotron-3.5-lightning-free',
    name: 'Nemotron 3.5 Lightning (free)',
    contextWindow: 262144,
    source: 'backend',
    supportsVision: false,
    selected: true,
    reasoningEfforts: ['low', 'medium', 'high'],
  },
  {
    id: 'laguna-s-2.1-free',
    name: 'Laguna S 2.1 (free)',
    contextWindow: 256000,
    source: 'backend',
    supportsVision: false,
    selected: true,
    reasoningEfforts: ['low', 'medium', 'high'],
  },
]

export class OpenCodeFreeModelManager {
  private cachedModels: ModelConfig[] = [...DEFAULT_FREE_MODELS]
  private lastFetchTimestamp = 0
  private timer: NodeJS.Timeout | null = null
  private readonly refreshIntervalMs: number
  private readonly apiEndpoint: string
  private readonly modelsDevEndpoint: string
  private readonly fetcher: typeof fetch

  constructor(options?: {
    refreshIntervalMs?: number
    apiEndpoint?: string
    modelsDevEndpoint?: string
    fetcher?: typeof fetch
  }) {
    this.refreshIntervalMs = options?.refreshIntervalMs ?? 3600 * 1000 // 1 hour
    this.apiEndpoint = options?.apiEndpoint ?? 'https://opencode.ai/zen/v1/models'
    this.modelsDevEndpoint = options?.modelsDevEndpoint ?? 'https://models.dev/api.json'
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
      if (forceRefresh) {
        await this.refreshFreeModels()
      } else {
        this.refreshFreeModels().catch(() => {})
      }
    }
    return this.cachedModels
  }

  /**
   * Fetches models.dev API to map context limits, vision capabilities, and reasoning options.
   */
  private async fetchModelsDevMap(): Promise<Map<string, ModelsDevModelInfo>> {
    const devMap = new Map<string, ModelsDevModelInfo>()
    try {
      const res = await this.fetcher(this.modelsDevEndpoint, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'OpenFox-OpenCode-Free-Plugin',
        },
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) return devMap

      const data = (await res.json()) as ModelsDevApiResponse
      if (!data || typeof data !== 'object') return devMap

      for (const provider of Object.values(data)) {
        if (!provider) continue
        if ((provider as any).modalities && (provider as any).id) {
          const info = provider as unknown as ModelsDevModelInfo
          devMap.set(info.id!, info)
          const simpleId = info.id!.split('/').pop()
          if (simpleId && !devMap.has(simpleId)) devMap.set(simpleId, info)
        }
        if (provider.models) {
          for (const [modelId, info] of Object.entries(provider.models)) {
            if (!info) continue
            devMap.set(modelId, info)

            const simpleId = modelId.split('/').pop()
            if (simpleId && !devMap.has(simpleId)) {
              devMap.set(simpleId, info)
            }
          }
        }
      }
    } catch {}
    return devMap
  }

  /**
   * Fetches latest models from OpenCode API, filters for free models only (ending in -free),
   * enriches with models.dev info (context window, vision, reasoning efforts), adds new free models, and removes retired ones.
   */
  async refreshFreeModels(): Promise<ModelConfig[]> {
    try {
      const [openCodeRes, devMap] = await Promise.all([
        this.fetcher(this.apiEndpoint, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'OpenFox-OpenCode-Free-Plugin',
          },
          signal: AbortSignal.timeout(5000),
        }).catch(() => null),
        this.fetchModelsDevMap(),
      ])

      if (!openCodeRes || !openCodeRes.ok) {
        return this.cachedModels
      }

      const body = (await openCodeRes.json()) as OpenCodeModelsApiResponse
      if (!body?.data || !Array.isArray(body.data)) {
        return this.cachedModels
      }

      const freeModels: ModelConfig[] = []
      for (const item of body.data) {
        if (!item.id) continue
        if (!this.isFreeModel(item)) continue

        const baseId = item.id.replace(/-free$/, '').replace(/:free$/, '')
        let devInfo = devMap.get(item.id) || devMap.get(baseId)

        if (!devInfo) {
          for (const [k, v] of devMap.entries()) {
            if (k === baseId || k.endsWith('/' + baseId)) {
              devInfo = v
              break
            }
          }
        }

        const supportsVision =
          devInfo?.modalities?.input?.includes('image') ??
          item.modalities?.input?.includes('image') ??
          item.architecture?.input_modalities?.includes('image') ??
          false

        const contextWindow =
          devInfo?.limit?.context ??
          item.context_length ??
          128000

        let reasoningEfforts: string[] | undefined
        const devReasoningOpts = devInfo?.reasoning_options || item.reasoning_options
        if (Array.isArray(devReasoningOpts)) {
          const effortOpt = devReasoningOpts.find((opt) => opt.type === 'effort' && Array.isArray(opt.values) && opt.values.length > 0)
          if (effortOpt?.values) {
            reasoningEfforts = effortOpt.values
          }
        }

        if (!reasoningEfforts) {
          const isReasoning =
            devInfo?.reasoning ??
            item.reasoning ??
            item.supported_parameters?.includes('reasoning') ??
            item.supported_parameters?.includes('reasoning_effort') ??
            item.supported_parameters?.includes('include_reasoning') ??
            false

          if (isReasoning) {
            reasoningEfforts = ['low', 'medium', 'high']
          }
        }

        const modelConfig: ModelConfig = {
          id: item.id,
          name: item.name || item.id,
          contextWindow,
          source: 'backend',
          supportsVision,
          selected: true,
          ...(reasoningEfforts ? { reasoningEfforts } : {}),
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
   * Helper to determine if an OpenCode model item is free.
   * Free models end with "-free".
   */
  isFreeModel(item: OpenCodeModelApiItem): boolean {
    if (!item.id) return false
    return item.id.endsWith('-free')
  }

  getCachedModels(): ModelConfig[] {
    return this.cachedModels
  }

  getLastFetchTimestamp(): number {
    return this.lastFetchTimestamp
  }
}
