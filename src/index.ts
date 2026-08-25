import { join } from 'node:path'
import type { ProviderPluginRegistry, ProviderPreset } from 'openfox/provider'
import { OpenRouterFreeModelManager } from './models-fetcher.js'
import { OpenRouterCredentialStore } from './credentials.js'
import { OpenRouterAuthAdapter } from './auth.js'
import { OpenRouterFreeTransportAdapter } from './transport.js'

export const openRouterFreePreset: ProviderPreset = {
  id: 'openrouter-free',
  name: 'OpenRouter (Free Models)',
  description: 'Use all free models available on OpenRouter with automatic 1-hour updates.',
  documentationUrl: 'https://openrouter.ai/models?variant=free',
  requiresAuth: true,
  authAdapter: 'openrouter-free-auth',
  transportAdapter: 'openrouter-free-transport',
  defaults: {
    name: 'OpenRouter Free',
    url: 'https://openrouter.ai/api/v1',
    backend: 'openai',
  },
  connectLabel: 'Connect OpenRouter',
  disconnectLabel: 'Disconnect OpenRouter',
  missingPluginMessage: 'Install openfox-openrouter-free to use free OpenRouter models.',
}

export async function register(registry: ProviderPluginRegistry): Promise<void> {
  const storageDir = join(
    registry.runtime.configDirectory,
    'plugins',
    'openfox-openrouter-free',
  )
  const credentials = new OpenRouterCredentialStore(
    join(storageDir, 'credentials.json'),
  )
  const auth = new OpenRouterAuthAdapter(credentials)
  const modelManager = new OpenRouterFreeModelManager()
  modelManager.startPeriodicRefresh()

  const transport = new OpenRouterFreeTransportAdapter(modelManager, auth)

  registry.registerAuth(auth)
  registry.registerTransport(transport)
  registry.registerPreset(openRouterFreePreset)
}

export { OpenRouterFreeModelManager } from './models-fetcher.js'
export { OpenRouterCredentialStore } from './credentials.js'
export { OpenRouterAuthAdapter } from './auth.js'
export { OpenRouterFreeTransportAdapter } from './transport.js'
