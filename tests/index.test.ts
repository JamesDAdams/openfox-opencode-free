import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { register, openCodeFreePreset } from '../src/index.js'
import type { ProviderPluginRegistry } from 'openfox/provider'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('index.ts plugin register', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openfox-opencode-reg-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('registers auth, transport, preset, settings with button action, and notify callback properly', async () => {
    const registeredAuth: any[] = []
    const registeredTransports: any[] = []
    const registeredPresets: any[] = []
    let registeredSettings: any = null
    const notifyMock = vi.fn()

    const registry = {
      runtime: {
        mode: 'development' as const,
        configDirectory: tempDir,
      },
      registerAuth: (auth: any) => registeredAuth.push(auth),
      registerTransport: (t: any) => registeredTransports.push(t),
      registerPreset: (p: any) => registeredPresets.push(p),
      registerSettings: (s: any) => {
        registeredSettings = s
      },
      notify: notifyMock,
    } as unknown as ProviderPluginRegistry

    await register(registry)

    expect(registeredAuth.length).toBe(1)
    expect(registeredAuth[0].id).toBe('opencode-free-auth')

    expect(registeredTransports.length).toBe(1)
    expect(registeredTransports[0].id).toBe('opencode-free-transport')

    expect(registeredPresets.length).toBe(1)
    expect(registeredPresets[0]).toEqual(openCodeFreePreset)

    expect(registeredSettings).toBeDefined()
    expect(registeredSettings.title).toBe('OpenCode Free Models Configuration')
    expect(registeredSettings.fields).toHaveLength(5)
    expect(registeredSettings.fields.map((f: any) => f.key)).toEqual([
      'checkOnStartup',
      'refreshIntervalMinutes',
      'notifyOnNewModelsOnly',
      'notifyOnEveryCheck',
      'manualSync',
    ])
    expect(registeredSettings.fields[0].type).toBe('boolean')
    expect(registeredSettings.fields[1].type).toBe('number')
    expect(registeredSettings.fields[2].label).toBe(
      'Notify only when new models are available or a models was removed',
    )
    expect(registeredSettings.fields[4].type).toBe('button')
    expect(registeredSettings.fields[4].buttonLabel).toBe('Sync Now')

    const initialVals = await registeredSettings.getSettings()
    expect(initialVals.checkOnStartup).toBe(true)
    expect(initialVals.refreshIntervalMinutes).toBe(60)
    expect(initialVals.notifyOnNewModelsOnly).toBe(true)
    expect(initialVals.notifyOnEveryCheck).toBe(false)

    await registeredSettings.saveSettings({
      checkOnStartup: false,
      refreshIntervalMinutes: 30,
      notifyOnNewModelsOnly: false,
      notifyOnEveryCheck: true,
    })

    const savedVals = await registeredSettings.getSettings()
    expect(savedVals.checkOnStartup).toBe(false)
    expect(savedVals.refreshIntervalMinutes).toBe(30)
    expect(savedVals.notifyOnNewModelsOnly).toBe(false)
    expect(savedVals.notifyOnEveryCheck).toBe(true)

    const actionResult = await registeredSettings.executeAction('manualSync')
    expect(actionResult?.message).toMatch(/free models.*available/)
  })
})
