import { join } from 'node:path'
import type { ProviderPluginRegistry, ProviderPreset } from 'openfox/provider'
import { OpenCodeFreeModelManager } from './models-fetcher.js'
import { OpenCodeCredentialStore } from './credentials.js'
import { OpenCodeAuthAdapter } from './auth.js'
import { OpenCodeFreeTransportAdapter } from './transport.js'

export const openCodeFreePreset: ProviderPreset = {
  id: 'opencode-free',
  name: 'OpenCode (Free Models)',
  description: 'Use all free models available on OpenCode with automatic 1-hour updates.',
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
  const credentials = new OpenCodeCredentialStore(
    join(storageDir, 'credentials.json'),
  )
  const auth = new OpenCodeAuthAdapter(credentials)
  const modelManager = new OpenCodeFreeModelManager()
  modelManager.startPeriodicRefresh()

  const transport = new OpenCodeFreeTransportAdapter(modelManager, auth)

  registry.registerAuth(auth)
  registry.registerTransport(transport)
  registry.registerPreset(openCodeFreePreset)
}

export { OpenCodeFreeModelManager } from './models-fetcher.js'
export { OpenCodeCredentialStore } from './credentials.js'
export { OpenCodeAuthAdapter } from './auth.js'
export { OpenCodeFreeTransportAdapter } from './transport.js'
