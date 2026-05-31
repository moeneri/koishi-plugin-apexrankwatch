import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'
import { ScoreHistoryStore } from '../src/storage'
import type { LoggerLike, ScoreHistoryEntry } from '../src/shared'

const logger: LoggerLike = {
  info() {},
  warn() {},
  error() {},
}

async function withTempStore(run: (store: ScoreHistoryStore) => Promise<void>) {
  const dir = join(tmpdir(), `apexrankwatch-score-history-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  await mkdir(dir, { recursive: true })
  try {
    const store = new ScoreHistoryStore(join(dir, 'score-history.json'), logger)
    await run(store)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function entry(overrides: Partial<ScoreHistoryEntry>): ScoreHistoryEntry {
  return {
    groupId: 'group-a',
    playerKey: 'name:player@PC',
    playerName: 'player',
    displayNameSnapshot: 'player',
    platform: 'PC',
    oldScore: 1000,
    newScore: 1100,
    delta: 100,
    recordedAt: 1000,
    ...overrides,
  }
}

const now = Date.now()

test('findLatestByPlayer returns the matching event with greatest recordedAt', async () => {
  await withTempStore(async (store) => {
    await store.append(entry({ oldScore: 1000, newScore: 1100, recordedAt: now }))
    await store.append(entry({ oldScore: 1200, newScore: 1300, recordedAt: now + 2000 }))
    await store.append(entry({ oldScore: 1100, newScore: 1200, recordedAt: now + 1000 }))
    await store.append(entry({ groupId: 'group-b', oldScore: 9000, newScore: 9100, recordedAt: now + 4000 }))
    await store.append(entry({ playerKey: 'name:other@PC', oldScore: 8000, newScore: 8100, recordedAt: now + 5000 }))

    const latest = store.findLatestByPlayer('group-a', 'name:player@PC')

    assert.equal(latest?.oldScore, 1200)
    assert.equal(latest?.newScore, 1300)
    assert.equal(latest?.recordedAt, now + 2000)
  })
})

test('findLatestByPlayer breaks equal recordedAt ties by later array position', async () => {
  await withTempStore(async (store) => {
    const recordedAt = Date.now()
    await store.append(entry({ oldScore: 1000, newScore: 1100, recordedAt }))
    await store.append(entry({ oldScore: 1100, newScore: 1200, recordedAt }))

    const latest = store.findLatestByPlayer('group-a', 'name:player@PC')

    assert.equal(latest?.oldScore, 1100)
    assert.equal(latest?.newScore, 1200)
  })
})

test('findLatestByPlayer returns null when no matching player history exists', async () => {
  await withTempStore(async (store) => {
    await store.append(entry({ groupId: 'group-b', recordedAt: Date.now() }))

    const latest = store.findLatestByPlayer('group-a', 'name:player@PC')

    assert.equal(latest, null)
  })
})
