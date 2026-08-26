import type {
  ProviderAuthAdapter,
  ProviderAuthStatus,
  ProviderAccessContext,
  ProviderLoginChallenge,
} from 'openfox/provider'
import type { OpenCodeCredentialStore } from './credentials.js'

export class OpenCodeAuthAdapter implements ProviderAuthAdapter {
  readonly id = 'opencode-free-auth'

  constructor(
    private readonly credentials: OpenCodeCredentialStore,
  ) {}

  async beginLogin(context: { providerId: string; apiKey?: string }): Promise<{
    challenge: ProviderLoginChallenge
    completion: Promise<{ credentialRef: string }>
  }> {
    const apiKey = context.apiKey || process.env.OPENCODE_API_KEY
    const credentialRef = apiKey ? await this.credentials.create({ apiKey }) : ''

    const challenge: ProviderLoginChallenge = {
      mode: 'external',
      verificationUrl: 'https://opencode.ai',
      instructions: 'Please obtain an API key from OpenCode and enter it or set OPENCODE_API_KEY.',
    }

    const completion = Promise.resolve({ credentialRef })

    return { challenge, completion }
  }

  async getStatus(context: { providerId: string; credentialRef?: string }): Promise<ProviderAuthStatus> {
    if (context.credentialRef) {
      const cred = await this.credentials.get(context.credentialRef)
      if (cred?.apiKey) {
        return { state: 'connected', accountLabel: 'OpenCode Account' }
      }
    }

    const envKey = process.env.OPENCODE_API_KEY
    if (envKey) {
      return { state: 'connected', accountLabel: 'Environment Variable (OPENCODE_API_KEY)' }
    }

    return { state: 'disconnected' }
  }

  async getAccessContext(credentialRef?: string): Promise<ProviderAccessContext> {
    let apiKey: string | undefined

    if (credentialRef) {
      const cred = await this.credentials.get(credentialRef)
      apiKey = cred?.apiKey
    }

    if (!apiKey) {
      apiKey = process.env.OPENCODE_API_KEY
    }

    if (!apiKey) {
      throw new Error('No OpenCode API key found. Please connect your OpenCode account or set OPENCODE_API_KEY.')
    }

    return {
      accessToken: apiKey,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-Title': 'OpenFox OpenCode Free Plugin',
      },
    }
  }

  async logout(credentialRef: string): Promise<void> {
    await this.credentials.delete(credentialRef)
  }
}
