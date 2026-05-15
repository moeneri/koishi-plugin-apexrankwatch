import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DailyMapPoolStore } from '../src/storage'

const logger = {
  info() {},
  warn() {},
  error(message: string) {
    throw new Error(message)
  },
}

test('DailyMapPoolStore persists and normalizes AstrBot style pool state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'apexrankwatch-daily-map-state-'))
  const file = join(dir, 'daily_map_pool_state.json')
  const store = new DailyMapPoolStore(file, logger)

  await store.save({
    seasonKey: 'S29:Overclocked',
    seasonEndIso: '2026-08-04T17:00:00Z',
    status: 'confirmed',
    cycle: ['Broken Moon', 'Kings Canyon', 'Broken Moon', 'Storm Point'],
    lastCurrent: 'Storm Point',
    lastNext: 'Broken Moon',
    lastCurrentStart: 1778049000,
    updatedAt: 1778050000,
    reason: 'API 已确认排位地图池闭环',
  })

  const raw = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(raw.season_key, 'S29:Overclocked')
  assert.deepEqual(raw.cycle, ['Broken Moon', 'Kings Canyon', 'Storm Point'])

  await writeFile(file, JSON.stringify({
    season_key: 'S30:Test',
    season_end_iso: '2026-11-04T17:00:00Z',
    status: 'unknown',
    cycle: ['Olympus', '', 'E-District'],
    last_current: 'Olympus',
    last_next: 'E-District',
    last_current_start: '1000',
    updated_at: '2000',
    reason: 'testing',
  }), 'utf8')

  const loaded = await store.load()
  assert.equal(loaded.status, 'learning')
  assert.deepEqual(loaded.cycle, ['Olympus', 'E-District'])
  assert.equal(loaded.lastCurrentStart, 1000)
})

test('DailyMapPoolStore returns a safe default for missing or invalid files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'apexrankwatch-daily-map-state-bad-'))
  const file = join(dir, 'daily_map_pool_state.json')
  const quietLogger = { info() {}, warn() {}, error() {} }
  const store = new DailyMapPoolStore(file, quietLogger)

  assert.equal((await store.load()).status, 'learning')

  await writeFile(file, '{bad json', 'utf8')
  const loaded = await store.load()
  assert.equal(loaded.status, 'learning')
  assert.deepEqual(loaded.cycle, [])
})
