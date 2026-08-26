import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OpenCodeAuthAdapter } from '../src/auth.js'
import { OpenCodeCredentialStore } from '../src/credentials.js'

describe('OpenCodeAuthAdapter', () => {
  let credentialsStore: OpenCodeCredentialStore
  let authAdapter: OpenCodeAuthAdapter

  beforeEach(() => {
    credentialsStore = {
      get: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    } as any
    authAdapter = new OpenCodeAuthAdapter(credentialsStore)
  })

  it('getStatus returns disconnected when no credential or env key exists', async () => {
    delete process.env.OPENCODE_API_KEY
    const status = await authAdapter.getStatus({ providerId: 'opencode-free' })
    expect(status.state).toBe('disconnected')
  })

  it('getStatus returns connected when credentialRef has an API key stored', async () => {
    vi.mocked(credentialsStore.get).mockResolvedValueOnce({ apiKey: 'opencode-mock-key' })
    const status = await authAdapter.getStatus({ providerId: 'opencode-free', credentialRef: 'cred-1' })
    expect(status.state).toBe('connected')
    expect(status.accountLabel).toBe('OpenCode Account')
  })

  it('getStatus returns connected when OPENCODE_API_KEY environment variable is set', async () => {
    process.env.OPENCODE_API_KEY = 'opencode-env-key'
    const status = await authAdapter.getStatus({ providerId: 'opencode-free' })
    expect(status.state).toBe('connected')
    expect(status.accountLabel).toBe('Environment Variable (OPENCODE_API_KEY)')
    delete process.env.OPENCODE_API_KEY
  })

  it('getAccessContext includes Authorization header with Bearer token', async () => {
    vi.mocked(credentialsStore.get).mockResolvedValueOnce({ apiKey: 'opencode-testkey' })
    const ctx = await authAdapter.getAccessContext('cred-1')
    expect(ctx.accessToken).toBe('opencode-testkey')
    expect(ctx.headers?.['Authorization']).toBe('Bearer opencode-testkey')
  })

  it('beginLogin creates a login challenge when API key is provided', async () => {
    vi.mocked(credentialsStore.create).mockResolvedValueOnce('cred-1')
    const { challenge, completion } = await authAdapter.beginLogin({ providerId: 'opencode-free', apiKey: 'test-key' })
    expect(challenge.mode).toBe('external')
    expect(challenge.verificationUrl).toBe('https://opencode.ai')
    const res = await completion
    expect(res.credentialRef).toBe('cred-1')
  })
})
