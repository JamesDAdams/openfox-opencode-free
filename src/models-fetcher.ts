import type { ModelConfig } from 'openfox/provider'
import { DEFAULT_SETTINGS, type OpenCodePluginSettings } from './settings.js'
import type { PluginNotificationRequest } from './types.js'

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

export interface OpenCodeFreeModelManagerOptions {
  refreshIntervalMs?: number
  apiEndpoint?: string
  modelsDevEndpoint?: string
  fetcher?: typeof fetch
  notify?: (notification: PluginNotificationRequest) => void
  settings?: OpenCodePluginSettings
  getDynamicSettings?: () => OpenCodePluginSettings | undefined
}

export class OpenCodeFreeModelManager {
  private cachedModels: ModelConfig[] = []
  private knownModelIds: Set<string> = new Set()
  private lastDiscoveredModels: string[] = []
  private lastRemovedModels: string[] = []
  private isInitialLoad = true
  private lastFetchTimestamp = 0
  private heartbeatTimer: NodeJS.Timeout | null = null
  private isDestroyed = false
  private readonly customRefreshIntervalMs?: number
  private readonly apiEndpoint: string
  private readonly modelsDevEndpoint: string
  private readonly fetcher: typeof fetch
  private notifier?: (notification: PluginNotificationRequest) => void
  private settings: OpenCodePluginSettings
  private readonly dynamicSettingsGetter?: () => OpenCodePluginSettings | undefined

  constructor(options?: OpenCodeFreeModelManagerOptions) {
    this.customRefreshIntervalMs = options?.refreshIntervalMs
    this.apiEndpoint = options?.apiEndpoint ?? 'https://opencode.ai/zen/v1/models'
    this.modelsDevEndpoint = options?.modelsDevEndpoint ?? 'https://models.dev/api.json'
    this.fetcher = options?.fetcher ?? fetch
    this.notifier = options?.notify
    this.settings = options?.settings ?? { ...DEFAULT_SETTINGS }
    this.dynamicSettingsGetter = options?.getDynamicSettings
  }

  getRefreshIntervalMs(): number {
    if (this.customRefreshIntervalMs !== undefined) {
      return this.customRefreshIntervalMs
    }
    const current = this.getSettings()
    const minutes = current.refreshIntervalMinutes || DEFAULT_SETTINGS.refreshIntervalMinutes
    return Math.max(1, minutes) * 60 * 1000
  }

  setNotifier(notify: (notification: PluginNotificationRequest) => void): void {
    this.notifier = notify
  }

  updateSettings(settings: OpenCodePluginSettings): void {
    this.settings = { ...settings }
  }

  getSettings(): OpenCodePluginSettings {
    if (this.dynamicSettingsGetter) {
      const dynamic = this.dynamicSettingsGetter()
      if (dynamic) {
        return dynamic
      }
    }
    return { ...this.settings }
  }

  getLastDiscoveredModels(): string[] {
    return [...this.lastDiscoveredModels]
  }

  getLastRemovedModels(): string[] {
    return [...this.lastRemovedModels]
  }

  /**
   * Start periodic background refresh using a resilient heartbeat ticker.
   */
  startPeriodicRefresh(checkOnStart?: boolean): void {
    if (this.isDestroyed) return
    this.stopPeriodicRefresh()

    const settings = this.getSettings()
    if (checkOnStart ?? settings.checkOnStartup) {
      this.refreshFreeModels(false, false).catch(() => {})
    }

    // Heartbeat ticker checks every 5 seconds if the refresh interval has elapsed
    this.heartbeatTimer = setInterval(async () => {
      if (this.isDestroyed) return
      const intervalMs = this.getRefreshIntervalMs()
      const now = Date.now()
      if (now - this.lastFetchTimestamp >= intervalMs) {
        this.lastFetchTimestamp = now
        try {
          await this.refreshFreeModels(false, false)
        } catch {}
      }
    }, 5000)

    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref()
    }
  }

  /**
   * Stop periodic background refresh.
   */
  stopPeriodicRefresh(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  destroy(): void {
    this.isDestroyed = true
    this.stopPeriodicRefresh()
  }

  /**
   * Returns the list of free models, refreshing if cache is expired or empty.
   */
  async getFreeModels(forceRefresh = false, isManual = false): Promise<ModelConfig[]> {
    const now = Date.now()
    if (
      forceRefresh ||
      this.cachedModels.length === 0 ||
      now - this.lastFetchTimestamp >= this.getRefreshIntervalMs()
    ) {
      if (forceRefresh || this.cachedModels.length === 0) {
        await this.refreshFreeModels(forceRefresh, isManual)
      } else {
        this.refreshFreeModels(false, isManual).catch(() => {})
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
          'User-Agent': 'opencode/1.0.0',
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
  async refreshFreeModels(_forceRefresh = false, isManual = false): Promise<ModelConfig[]> {
    const settings = this.getSettings()
    try {
      const [openCodeRes, devMap] = await Promise.all([
        this.fetcher(this.apiEndpoint, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'opencode/1.0.0',
            'x-opencode-client': 'cli',
            Authorization: 'Bearer public',
          },
          signal: AbortSignal.timeout(5000),
        }).catch(() => null),
        this.fetchModelsDevMap(),
      ])

      if (!openCodeRes || !openCodeRes.ok) {
        if (isManual && this.notifier) {
          this.notifier({
            title: {
              en: 'OpenCode Sync Failed',
              fr: 'Échec de synchronisation OpenCode',
            },
            body: {
              en: `Failed to fetch models from OpenCode (HTTP ${openCodeRes?.status ?? 'error'}).`,
              fr: `Impossible de récupérer les modèles depuis OpenCode (HTTP ${openCodeRes?.status ?? 'error'}).`,
            },
            level: 'error',
          })
        }
        return this.cachedModels
      }

      const body = (await openCodeRes.json()) as OpenCodeModelsApiResponse
      if (!body?.data || !Array.isArray(body.data)) {
        return this.cachedModels
      }

      const freeModels: ModelConfig[] = []
      const newlyDiscoveredModels: string[] = []

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

        if (!this.knownModelIds.has(item.id)) {
          newlyDiscoveredModels.push(modelConfig.name || modelConfig.id)
        }
      }

      const freeModelIds = new Set(freeModels.map((m) => m.id))
      const removedModels: string[] = []
      if (!this.isInitialLoad) {
        for (const id of this.knownModelIds) {
          if (!freeModelIds.has(id)) {
            const oldModel = this.cachedModels.find((m) => m.id === id)
            removedModels.push(oldModel?.name || id)
          }
        }
      }

      const wasInitial = this.isInitialLoad
      this.lastDiscoveredModels = newlyDiscoveredModels
      this.lastRemovedModels = removedModels
      if (freeModels.length > 0 || this.isInitialLoad) {
        this.cachedModels = freeModels
        this.knownModelIds = freeModelIds
      }
      this.lastFetchTimestamp = Date.now()
      this.isInitialLoad = false

      // Notifications logic
      if (this.notifier) {
        const changesEn: string[] = []
        const changesFr: string[] = []

        if (newlyDiscoveredModels.length > 0) {
          changesEn.push(`Added (${newlyDiscoveredModels.length}): ${newlyDiscoveredModels.join(', ')}`)
          changesFr.push(`Ajouté (${newlyDiscoveredModels.length}) : ${newlyDiscoveredModels.join(', ')}`)
        }
        if (removedModels.length > 0) {
          changesEn.push(`Removed (${removedModels.length}): ${removedModels.join(', ')}`)
          changesFr.push(`Supprimé (${removedModels.length}) : ${removedModels.join(', ')}`)
        }

        if (isManual) {
          this.notifier({
            title: {
              en: 'OpenCode Free Models Synchronized',
              fr: 'Modèles gratuits OpenCode synchronisés',
            },
            body: {
              en:
                changesEn.length > 0
                  ? `Sync complete: ${freeModels.length} free models available (${changesEn.join(' | ')}).`
                  : `Sync complete: ${freeModels.length} free models are available (no changes).`,
              fr:
                changesFr.length > 0
                  ? `Synchronisation terminée : ${freeModels.length} modèles gratuits disponibles (${changesFr.join(' | ')}).`
                  : `Synchronisation terminée : ${freeModels.length} modèles gratuits disponibles (aucun changement).`,
            },
            level: 'success',
          })
        } else if (
          !wasInitial &&
          changesEn.length > 0 &&
          (settings.notifyOnNewModelsOnly || settings.notifyOnEveryCheck)
        ) {
          this.notifier({
            title: {
              en: 'OpenCode Free Models Updated',
              fr: 'Modèles gratuits OpenCode mis à jour',
            },
            body: {
              en: changesEn.join('\n'),
              fr: changesFr.join('\n'),
            },
            level: 'info',
          })
        } else if (settings.notifyOnEveryCheck && (!wasInitial || changesEn.length === 0)) {
          this.notifier({
            title: {
              en: 'OpenCode Free Models Checked',
              fr: 'Vérification des modèles gratuits OpenCode terminée',
            },
            body: {
              en: `Check complete: ${freeModels.length} free models available (no changes).`,
              fr: `Vérification terminée : ${freeModels.length} modèles gratuits disponibles (aucun changement).`,
            },
            level: 'info',
          })
        }
      }

      return this.cachedModels
    } catch (err) {
      if (isManual && this.notifier) {
        this.notifier({
          title: {
            en: 'OpenCode Sync Error',
            fr: 'Erreur de synchronisation OpenCode',
          },
          body: {
            en: err instanceof Error ? err.message : 'Error syncing models from OpenCode',
            fr: err instanceof Error ? err.message : 'Erreur lors de la synchronisation des modèles OpenCode',
          },
          level: 'error',
        })
      }
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
