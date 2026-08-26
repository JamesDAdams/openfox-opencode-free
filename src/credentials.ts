import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface OpenCodeCredential {
  apiKey: string
}

export class OpenCodeCredentialStore {
  constructor(private readonly filePath: string) {}

  private async ensureDir(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
  }

  async get(credentialRef: string): Promise<OpenCodeCredential | undefined> {
    try {
      const data = await readFile(this.filePath, 'utf8')
      const store = JSON.parse(data) as Record<string, OpenCodeCredential>
      return store[credentialRef]
    } catch {
      return undefined
    }
  }

  async create(credential: OpenCodeCredential): Promise<string> {
    await this.ensureDir()
    let store: Record<string, OpenCodeCredential> = {}
    try {
      const data = await readFile(this.filePath, 'utf8')
      store = JSON.parse(data)
    } catch {
      store = {}
    }
    const id = 'opencode-cred-' + Date.now()
    store[id] = credential
    await writeFile(this.filePath, JSON.stringify(store, null, 2), 'utf8')
    return id
  }

  async delete(credentialRef: string): Promise<void> {
    try {
      const data = await readFile(this.filePath, 'utf8')
      const store = JSON.parse(data) as Record<string, OpenCodeCredential>
      delete store[credentialRef]
      await writeFile(this.filePath, JSON.stringify(store, null, 2), 'utf8')
    } catch {}
  }
}
