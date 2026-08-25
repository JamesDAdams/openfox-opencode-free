import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OpenRouterAuthAdapter } from '../src/auth.js'
import { OpenRouterCredentialStore } from '../src/credentials.js'
import http from 'node:http'

describe('OpenRouterAuthAdapter', () => {
  let credentialsStore: OpenRouterCredentialStore
  let authAdapter: OpenRouterAuthAdapter

  beforeEach(() => {
    credentialsStore = {
      get: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    } as any
    authAdapter = new OpenRouterAuthAdapter(credentialsStore)
  })

  it('getStatus returns disconnected when no credential or env key exists', async () => {
    delete process.env.OPENROUTER_API_KEY
    const status = await authAdapter.getStatus({ providerId: 'openrouter-free' })
    expect(status.state).toBe('disconnected')
  })

  it('getStatus returns connected when credentialRef has an API key stored', async () => {
    vi.mocked(credentialsStore.get).mockResolvedValueOnce({ apiKey: 'sk-or-v1-mock' })
    const status = await authAdapter.getStatus({ providerId: 'openrouter-free', credentialRef: 'cred-1' })
    expect(status.state).toBe('connected')
    expect(status.accountLabel).toBe('OpenRouter Account')
  })

  it('getStatus returns connected when OPENROUTER_API_KEY environment variable is set', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-env'
    const status = await authAdapter.getStatus({ providerId: 'openrouter-free' })
    expect(status.state).toBe('connected')
    expect(status.accountLabel).toBe('Environment Variable (OPENROUTER_API_KEY)')
    delete process.env.OPENROUTER_API_KEY
  })

  it('getAccessContext includes Authorization header with Bearer token', async () => {
    vi.mocked(credentialsStore.get).mockResolvedValueOnce({ apiKey: 'sk-or-v1-testkey' })
    const ctx = await authAdapter.getAccessContext('cred-1')
    expect(ctx.accessToken).toBe('sk-or-v1-testkey')
    expect(ctx.headers?.['Authorization']).toBe('Bearer sk-or-v1-testkey')
  })

  it('beginLogin creates a browser login challenge and OAuth exchange listener', async () => {
    const mockFetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ key: 'sk-or-v1-exchanged-key' }),
    })
    vi.mocked(credentialsStore.create).mockResolvedValueOnce('cred-new')

    const customAuthAdapter = new OpenRouterAuthAdapter(credentialsStore, {
      fetcher: mockFetcher,
    })

    const { challenge, completion } = await customAuthAdapter.beginLogin({ providerId: 'openrouter-free' })
    expect(challenge.mode).toBe('browser')
    expect(challenge.verificationUrl).toContain('https://openrouter.ai/auth?callback_url=')

    // Extract port from challenge URL
    const callbackUrl = new URL(new URL(challenge.verificationUrl!).searchParams.get('callback_url')!)
    const port = callbackUrl.port

    // Make HTTP request to local server
    await new Promise<void>((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/callback?code=test_code_123`, (res) => {
        res.resume()
        resolve()
      }).on('error', reject)
    })

    const result = await completion
    expect(result.credentialRef).toBe('cred-new')
    expect(credentialsStore.create).toHaveBeenCalledWith({ apiKey: 'sk-or-v1-exchanged-key' })
  })
})
