import type {
  ProviderAuthAdapter,
  ProviderAuthStatus,
  ProviderAccessContext,
  ProviderLoginChallenge,
} from 'openfox/provider'
import type { OpenRouterCredentialStore } from './credentials.js'
import { createServer, type Server } from 'node:http'

export interface OpenRouterAuthAdapterOptions {
  openRouterAuthUrl?: string
  openRouterExchangeUrl?: string
  fetcher?: typeof fetch
}

export class OpenRouterAuthAdapter implements ProviderAuthAdapter {
  readonly id = 'openrouter-free-auth'
  private activeLogins = new Map<
    string,
    {
      challenge: ProviderLoginChallenge
      completion: Promise<{ credentialRef: string }>
      server?: Server
    }
  >()

  constructor(
    private readonly credentials: OpenRouterCredentialStore,
    private readonly options: OpenRouterAuthAdapterOptions = {},
  ) {}

  async beginLogin(context: { providerId: string }): Promise<{
    challenge: ProviderLoginChallenge
    completion: Promise<{ credentialRef: string }>
  }> {
    const existing = this.activeLogins.get(context.providerId)
    if (existing) {
      return { challenge: existing.challenge, completion: existing.completion }
    }

    const fetcher = this.options.fetcher ?? fetch
    const exchangeEndpoint =
      this.options.openRouterExchangeUrl ??
      'https://openrouter.ai/api/v1/auth/keys'

    let serverInstance: Server | undefined
    let resolveCompletion!: (res: { credentialRef: string }) => void
    let rejectCompletion!: (err: Error) => void

    const completion = new Promise<{ credentialRef: string }>((res, rej) => {
      resolveCompletion = res
      rejectCompletion = rej
    })

    const port = await new Promise<number>((resolvePort, rejectPort) => {
      const server = createServer((req, res) => {
        try {
          const reqUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`)
          if (reqUrl.pathname === '/callback') {
            const code = reqUrl.searchParams.get('code')
            const error = reqUrl.searchParams.get('error')

            if (error) {
              res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
              res.end(`<html><body><h2>OpenRouter Connection Failed</h2><p>${error}</p></body></html>`)
              rejectCompletion(new Error(`OpenRouter login error: ${error}`))
              return
            }

            if (code) {
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
              res.end(`<html><body><h2>OpenFox Connected!</h2><p>OpenRouter authorization successful. You can close this tab and return to OpenFox.</p><script>setTimeout(() => window.close(), 1500)</script></body></html>`)

              fetcher(exchangeEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code }),
              })
                .then(async (exchangeRes) => {
                  if (!exchangeRes.ok) {
                    const errText = await exchangeRes.text()
                    throw new Error(`Failed to exchange OpenRouter code (${exchangeRes.status}): ${errText}`)
                  }
                  const data = (await exchangeRes.json()) as { key?: string }
                  if (!data?.key) {
                    throw new Error('OpenRouter response did not contain an API key')
                  }
                  return this.credentials.create({ apiKey: data.key })
                })
                .then((credentialRef) => {
                  resolveCompletion({ credentialRef })
                })
                .catch((err) => {
                  rejectCompletion(err instanceof Error ? err : new Error(String(err)))
                })
                .finally(() => {
                  if (serverInstance) serverInstance.close()
                  this.activeLogins.delete(context.providerId)
                })
              return
            }
          }
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          res.end('Not found')
        } catch (err: any) {
          rejectCompletion(err)
        }
      })

      serverInstance = server

      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (typeof addr === 'object' && addr) {
          resolvePort(addr.port)
        } else {
          rejectPort(new Error('Failed to resolve server port'))
        }
      })

      server.on('error', (err) => {
        rejectPort(err)
      })
    })

    const callbackUrl = `http://127.0.0.1:${port}/callback`
    const baseUrl =
      this.options.openRouterAuthUrl ?? 'https://openrouter.ai/auth'
    const verificationUrl = `${baseUrl}?callback_url=${encodeURIComponent(callbackUrl)}`

    const challenge: ProviderLoginChallenge = {
      mode: 'browser',
      verificationUrl,
      directUrl: verificationUrl,
      instructions: 'Please click to authorize with your OpenRouter account. Once authorized, your API key will be saved automatically.',
    }

    // Prevent unhandled rejection warnings
    completion.catch(() => {})

    const activeObj = { challenge, completion, server: serverInstance }
    this.activeLogins.set(context.providerId, activeObj)

    return { challenge, completion }
  }

  async getStatus(context: { providerId: string; credentialRef?: string }): Promise<ProviderAuthStatus> {
    if (context.credentialRef) {
      const cred = await this.credentials.get(context.credentialRef)
      if (cred?.apiKey) {
        return { state: 'connected', accountLabel: 'OpenRouter Account' }
      }
    }

    const envKey = process.env.OPENROUTER_API_KEY
    if (envKey) {
      return { state: 'connected', accountLabel: 'Environment Variable (OPENROUTER_API_KEY)' }
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
      apiKey = process.env.OPENROUTER_API_KEY
    }

    if (!apiKey) {
      throw new Error('No OpenRouter API key found. Please connect your OpenRouter account or set OPENROUTER_API_KEY.')
    }

    return {
      accessToken: apiKey,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/co-l/openfox',
        'X-Title': 'OpenFox OpenRouter Free Plugin',
      },
    }
  }

  async logout(credentialRef: string): Promise<void> {
    await this.credentials.delete(credentialRef)
  }
}
