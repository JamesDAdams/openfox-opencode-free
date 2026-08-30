import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PluginSettingsStore, DEFAULT_SETTINGS } from '../src/settings.js'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('PluginSettingsStore', () => {
  let tempDir: string
  let settingsFile: string
  let store: PluginSettingsStore

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openfox-opencode-test-'))
    settingsFile = join(tempDir, 'settings.json')
    store = new PluginSettingsStore(settingsFile)
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('loads default settings if settings file does not exist', async () => {
    const loaded = await store.load()
    expect(loaded).toEqual(DEFAULT_SETTINGS)
    expect(loaded.notifyOnNewModelsOnly).toBe(true)
    expect(loaded.notifyOnEveryCheck).toBe(false)
    expect(loaded.checkOnStartup).toBe(true)
    expect(loaded.refreshIntervalMinutes).toBe(60)
  })

  it('saves and loads settings correctly', async () => {
    const updated = await store.save({
      notifyOnNewModelsOnly: false,
      notifyOnEveryCheck: true,
      checkOnStartup: false,
      refreshIntervalMinutes: 30,
    })

    expect(updated.notifyOnNewModelsOnly).toBe(false)
    expect(updated.notifyOnEveryCheck).toBe(true)
    expect(updated.checkOnStartup).toBe(false)
    expect(updated.refreshIntervalMinutes).toBe(30)

    const reloaded = await store.load()
    expect(reloaded).toEqual(updated)

    const fileContent = JSON.parse(await readFile(settingsFile, 'utf8'))
    expect(fileContent).toEqual(updated)
  })

  it('preserves existing settings when partial values are saved', async () => {
    await store.save({
      notifyOnEveryCheck: true,
      refreshIntervalMinutes: 15,
    })

    const loaded = await store.load()
    expect(loaded.notifyOnNewModelsOnly).toBe(true)
    expect(loaded.notifyOnEveryCheck).toBe(true)
    expect(loaded.checkOnStartup).toBe(true)
    expect(loaded.refreshIntervalMinutes).toBe(15)
  })
})
