import { join } from 'node:path'
import type { ProviderPluginRegistry, ProviderPreset } from 'openfox/provider'
import { OpenCodeFreeModelManager } from './models-fetcher.js'
import { OpenCodeCredentialStore } from './credentials.js'
import { OpenCodeAuthAdapter } from './auth.js'
import { OpenCodeFreeTransportAdapter } from './transport.js'
import { PluginSettingsStore, type OpenCodePluginSettings } from './settings.js'
import type { PluginNotificationRequest } from './types.js'
import './types.js'

export const openCodeFreePreset: ProviderPreset = {
  id: 'opencode-free',
  name: 'OpenCode (Free Models)',
  description: 'Use all free models available on OpenCode with automatic updates.',
  documentationUrl: 'https://opencode.ai/zen/v1',
  requiresAuth: false,
  transportAdapter: 'opencode-free-transport',
  defaults: {
    name: 'OpenCode Free',
    url: 'https://opencode.ai/zen/v1',
    backend: 'openai',
  },
  missingPluginMessage: 'Install openfox-opencode-free to use free OpenCode models.',
}

export async function register(registry: ProviderPluginRegistry): Promise<void> {
  const pluginCtx = (registry as any).context
  const storageDir = join(
    registry.runtime.configDirectory,
    'plugins',
    'openfox-opencode-free',
  )
  const settingsStore = new PluginSettingsStore(
    join(storageDir, 'settings.json'),
  )
  const initialSettings = await settingsStore.load()

  const credentials = new OpenCodeCredentialStore(
    join(storageDir, 'credentials.json'),
  )
  const auth = new OpenCodeAuthAdapter(credentials)

  const notify = (notification: PluginNotificationRequest) => {
    try {
      if (pluginCtx && typeof pluginCtx.notify === 'function') {
        pluginCtx.notify(notification)
      } else if (typeof (registry as any).notify === 'function') {
        const titleStr = typeof notification.title === 'string' ? notification.title : notification.title.en
        const bodyStr = typeof notification.body === 'string' ? notification.body : notification.body?.en ?? ''
        ;(registry as any).notify({ title: titleStr, body: bodyStr })
      }
    } catch (err) {
      console.error('Failed to notify from openfox-opencode-free:', err)
    }
  }

  const getDynamicSettings = (): OpenCodePluginSettings | undefined => {
    try {
      if (pluginCtx && typeof pluginCtx.settings === 'function') {
        const s = pluginCtx.settings()
        if (s && typeof s === 'object') {
          return {
            notifyOnNewModelsOnly:
              typeof s['notifyOnNewModelsOnly'] === 'boolean'
                ? s['notifyOnNewModelsOnly']
                : s['notifyOnNewModelsOnly'] === 'true'
                  ? true
                  : s['notifyOnNewModelsOnly'] === 'false'
                    ? false
                    : initialSettings.notifyOnNewModelsOnly,
            notifyOnEveryCheck:
              typeof s['notifyOnEveryCheck'] === 'boolean'
                ? s['notifyOnEveryCheck']
                : s['notifyOnEveryCheck'] === 'true'
                  ? true
                  : s['notifyOnEveryCheck'] === 'false'
                    ? false
                    : initialSettings.notifyOnEveryCheck,
            checkOnStartup:
              typeof s['checkOnStartup'] === 'boolean'
                ? s['checkOnStartup']
                : s['checkOnStartup'] === 'true'
                  ? true
                  : s['checkOnStartup'] === 'false'
                    ? false
                    : initialSettings.checkOnStartup,
            refreshIntervalMinutes:
              typeof s['refreshIntervalMinutes'] === 'number' && s['refreshIntervalMinutes'] > 0
                ? s['refreshIntervalMinutes']
                : !isNaN(Number(s['refreshIntervalMinutes'])) && Number(s['refreshIntervalMinutes']) > 0
                  ? Number(s['refreshIntervalMinutes'])
                  : initialSettings.refreshIntervalMinutes,
          }
        }
      }
    } catch {}
    return undefined
  }

  const modelManager = new OpenCodeFreeModelManager({
    settings: initialSettings,
    getDynamicSettings,
    notify,
  })
  modelManager.startPeriodicRefresh(initialSettings.checkOnStartup)

  const transport = new OpenCodeFreeTransportAdapter(modelManager, auth)

  registry.registerAuth(auth)
  registry.registerTransport(transport)
  registry.registerPreset(openCodeFreePreset)

  const triggerManualSync = async () => {
    const models = await modelManager.getFreeModels(true, true)
    const newModels = modelManager.getLastDiscoveredModels()
    const removedModels = modelManager.getLastRemovedModels()
    const changes: string[] = []
    if (newModels.length > 0) changes.push(`${newModels.length} new: ${newModels.join(', ')}`)
    if (removedModels.length > 0) changes.push(`${removedModels.length} removed: ${removedModels.join(', ')}`)
    const message = changes.length > 0
      ? `Sync complete: ${models.length} free models available (${changes.join(' | ')}).`
      : `Sync complete: ${models.length} free models are available.`
    return {
      success: true,
      modelsCount: models.length,
      newModels,
      removedModels,
      message,
    }
  }

  if (typeof (registry as any).registerRpc === 'function') {
    ;(registry as any).registerRpc('opencode.manualSync', async () => {
      return await triggerManualSync()
    })
  }

  if (typeof (registry as any).registerTool === 'function') {
    ;(registry as any).registerTool({
      name: 'sync_opencode_free_models',
      description: 'Force a sync and fetch the latest list of free models available on OpenCode.',
      parameters: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        const result = await triggerManualSync()
        return {
          success: true,
          output: JSON.stringify(result, null, 2),
        }
      },
    })
  }

  if (typeof registry.registerSettings === 'function') {
    registry.registerSettings({
      title: {
        en: 'OpenCode Free Models Configuration',
        fr: 'Configuration des modèles gratuits OpenCode',
      },
      description: {
        en: 'Configure notification preferences and periodic synchronization for free OpenCode models.',
        fr: 'Configurer les préférences de notification et la synchronisation périodique des modèles gratuits OpenCode.',
      },
      fields: [
        {
          key: 'checkOnStartup',
          label: {
            en: 'Check models on OpenFox startup',
            fr: 'Vérifier les modèles au démarrage d’OpenFox',
          },
          type: 'boolean',
          description: {
            en: 'Automatically check OpenCode for new free models when OpenFox starts.',
            fr: 'Vérifier automatiquement les nouveaux modèles gratuits au démarrage.',
          },
          default: true,
        },
        {
          key: 'refreshIntervalMinutes',
          label: {
            en: 'Check interval (minutes)',
            fr: 'Intervalle de vérification (minutes)',
          },
          type: 'number',
          description: {
            en: 'How often to automatically check OpenCode for new free models (in minutes).',
            fr: 'Fréquence de vérification automatique des modèles gratuits (en minutes).',
          },
          default: 60,
          required: true,
        },
        {
          key: 'notifyOnNewModelsOnly',
          label: {
            en: 'Notify only when new models are available or a model was removed',
            fr: 'Notifier uniquement lors de l’ajout ou du retrait de modèles',
          },
          type: 'boolean',
          description: {
            en: 'Receive an in-app notification only when free models are added or removed on OpenCode.',
            fr: 'Recevoir une notification uniquement lorsque des modèles gratuits sont ajoutés ou retirés.',
          },
          default: true,
        },
        {
          key: 'notifyOnEveryCheck',
          label: {
            en: 'Notify on every check',
            fr: 'Notifier à chaque vérification',
          },
          type: 'boolean',
          description: {
            en: 'Receive an in-app notification every time the background batch checks OpenCode for models.',
            fr: 'Recevoir une notification à chaque vérification en arrière-plan.',
          },
          default: false,
        },
        {
          key: 'manualSync',
          label: { en: 'Sync Now', fr: 'Synchroniser' },
          type: 'button',
          buttonLabel: { en: 'Sync Now', fr: 'Synchroniser' },
          action: 'manualSync',
          rpcMethod: 'opencode.manualSync',
        },
      ],
      async getSettings() {
        return (await settingsStore.load()) as unknown as Record<string, unknown>
      },
      async saveSettings(values: Record<string, unknown>) {
        const updated = await settingsStore.save(values)
        modelManager.updateSettings(updated)
      },
      async executeAction(action: string) {
        if (action === 'manualSync') {
          return await triggerManualSync()
        }
      },
    })
  }
}

export { OpenCodeFreeModelManager } from './models-fetcher.js'
export { OpenCodeCredentialStore } from './credentials.js'
export { OpenCodeAuthAdapter } from './auth.js'
export { OpenCodeFreeTransportAdapter } from './transport.js'
export { PluginSettingsStore, DEFAULT_SETTINGS, type OpenCodePluginSettings } from './settings.js'
