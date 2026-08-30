import { join } from 'node:path'
import type { ProviderPluginRegistry, ProviderPreset } from 'openfox/provider'
import { OpenCodeFreeModelManager } from './models-fetcher.js'
import { OpenCodeCredentialStore } from './credentials.js'
import { OpenCodeAuthAdapter } from './auth.js'
import { OpenCodeFreeTransportAdapter } from './transport.js'
import { PluginSettingsStore } from './settings.js'
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
  const modelManager = new OpenCodeFreeModelManager({
    settings: initialSettings,
    notify: (notification) => {
      if (typeof registry.notify === 'function') {
        registry.notify(notification)
      }
    },
  })
  modelManager.startPeriodicRefresh(initialSettings.checkOnStartup)

  const transport = new OpenCodeFreeTransportAdapter(modelManager, auth)

  registry.registerAuth(auth)
  registry.registerTransport(transport)
  registry.registerPreset(openCodeFreePreset)

  if (typeof registry.registerSettings === 'function') {
    registry.registerSettings({
      title: 'OpenCode Free Models Configuration',
      description: 'Configure notification preferences and periodic synchronization for free OpenCode models.',
      fields: [
        {
          key: 'checkOnStartup',
          label: 'Check models on OpenFox startup',
          type: 'boolean',
          description: 'Automatically check OpenCode for new free models when OpenFox starts.',
          defaultValue: true,
        },
        {
          key: 'refreshIntervalMinutes',
          label: 'Check interval (minutes)',
          type: 'number',
          description: 'How often to automatically check OpenCode for new free models (in minutes).',
          defaultValue: 60,
          required: true,
        },
        {
          key: 'notifyOnNewModelsOnly',
          label: 'Notify only when new models are available or a models was removed',
          type: 'boolean',
          description: 'Receive an in-app notification only when free models are added or removed on OpenCode.',
          defaultValue: true,
        },
        {
          key: 'notifyOnEveryCheck',
          label: 'Notify on every check',
          type: 'boolean',
          description: 'Receive an in-app notification every time the background batch checks OpenCode for models.',
          defaultValue: false,
        },
        {
          key: 'manualSync',
          label: '',
          type: 'button',
          buttonLabel: 'Sync Now',
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
          const models = await modelManager.getFreeModels(true, true)
          const newModels = modelManager.getLastDiscoveredModels()
          const removedModels = modelManager.getLastRemovedModels()
          const changes: string[] = []
          if (newModels.length > 0) changes.push(`${newModels.length} new: ${newModels.join(', ')}`)
          if (removedModels.length > 0) changes.push(`${removedModels.length} removed: ${removedModels.join(', ')}`)

          if (changes.length > 0) {
            return {
              message: `Sync complete: ${models.length} free models available (${changes.join(' | ')}).`,
            }
          }
          return { message: `Sync complete: ${models.length} free models are available.` }
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
