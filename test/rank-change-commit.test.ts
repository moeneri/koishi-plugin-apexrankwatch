import test from 'node:test'
import assert from 'node:assert/strict'
import { RankChangeCommitter } from '../src/rank-change-commit'
import type { ScoreHistoryEntry, StoredGroupRecord, StoredPlayerRecord } from '../src/shared'

class FakeGroupStore {
  saveCalls = 0
  failSave = false
  savedPlayers: Array<StoredPlayerRecord | undefined> = []

  constructor(
    private readonly operations: string[],
    private readonly readPlayerAtSave: () => StoredPlayerRecord | undefined,
  ) {}

  async save() {
    this.operations.push('save')
    this.saveCalls += 1
    const currentPlayer = this.readPlayerAtSave()
    this.savedPlayers.push(currentPlayer ? { ...currentPlayer } : undefined)
    if (this.failSave) throw new Error('group save failed')
  }
}

class FakeScoreHistoryStore {
  entries: ScoreHistoryEntry[] = []
  appendCalls = 0
  failAppend = false

  constructor(private readonly operations: string[]) {}

  findLatestByPlayer(groupId: string, playerKey: string): ScoreHistoryEntry | null {
    let latest: ScoreHistoryEntry | null = null
    for (const entry of this.entries) {
      if (entry.groupId !== groupId || entry.playerKey !== playerKey) continue
      if (!latest || entry.recordedAt >= latest.recordedAt) latest = entry
    }
    return latest ? { ...latest } : null
  }

  async append(entry: ScoreHistoryEntry) {
    this.operations.push('append')
    this.appendCalls += 1
    if (this.failAppend) throw new Error('history append failed')
    this.entries.push({ ...entry })
  }
}

const playerKey = 'name:player@PC'

function player(overrides: Partial<StoredPlayerRecord> = {}): StoredPlayerRecord {
  return {
    playerName: 'player',
    platform: 'PC',
    lookupId: 'player',
    useUid: false,
    rankScore: 1000,
    rankName: 'Silver',
    rankDiv: 2,
    lastChecked: 1,
    globalRankPercent: '未知',
    selectedLegend: '',
    legendKillsPercent: '',
    ...overrides,
  }
}

function group(previous = player()): StoredGroupRecord {
  return {
    groupId: 'group-a',
    target: null,
    players: {
      [playerKey]: previous,
    },
  }
}

function history(overrides: Partial<ScoreHistoryEntry> = {}): ScoreHistoryEntry {
  return {
    groupId: 'group-a',
    playerKey,
    playerName: 'player',
    displayNameSnapshot: 'player',
    platform: 'PC',
    oldScore: 1000,
    newScore: 1200,
    delta: 200,
    recordedAt: 1000,
    ...overrides,
  }
}

function createCommitter(
  storedGroup: StoredGroupRecord,
  options: { failAppend?: boolean; failSave?: boolean; existingHistory?: ScoreHistoryEntry[] } = {},
) {
  const operations: string[] = []
  const groupStore = new FakeGroupStore(operations, () => storedGroup.players[playerKey])
  groupStore.failSave = Boolean(options.failSave)
  const scoreHistoryStore = new FakeScoreHistoryStore(operations)
  scoreHistoryStore.failAppend = Boolean(options.failAppend)
  scoreHistoryStore.entries = options.existingHistory ? options.existingHistory.map((entry) => ({ ...entry })) : []
  return {
    operations,
    groupStore,
    scoreHistoryStore,
    committer: new RankChangeCommitter({ groupStore, scoreHistoryStore }),
  }
}

test('commit records a new leaderboard event before saving advanced group state', async () => {
  const previousItem = player({ rankScore: 1000 })
  const nextItem = player({ rankScore: 1200, rankName: 'Gold', lastChecked: 2 })
  const storedGroup = group(previousItem)
  const { committer, operations, groupStore, scoreHistoryStore } = createCommitter(storedGroup)

  const result = await committer.commit({
    group: storedGroup,
    groupId: 'group-a',
    playerKey,
    previousItem,
    nextItem,
    historyEntry: history(),
  })

  assert.equal(result.status, 'committed-fresh')
  assert.equal(result.shouldNotify, true)
  assert.deepEqual(operations, ['append', 'save'])
  assert.equal(scoreHistoryStore.appendCalls, 1)
  assert.equal(scoreHistoryStore.entries.length, 1)
  assert.equal(groupStore.saveCalls, 1)
  assert.deepEqual(groupStore.savedPlayers[0], nextItem)
  assert.deepEqual(storedGroup.players[playerKey], nextItem)
})

test('commit recovers by comparing only oldScore and newScore for latest matching history', async () => {
  const previousItem = player({ rankScore: 1000 })
  const nextItem = player({ rankScore: 1200, lastChecked: 2 })
  const storedGroup = group(previousItem)
  const existing = history({
    oldScore: 1000,
    newScore: 1200,
    recordedAt: 5000,
    playerName: 'old-player-name',
    displayNameSnapshot: 'old display',
    remarkSnapshot: 'old remark',
    ownerUserIdSnapshot: 'old-owner',
  })
  const { committer, operations, groupStore, scoreHistoryStore } = createCommitter(storedGroup, { existingHistory: [existing] })

  const result = await committer.commit({
    group: storedGroup,
    groupId: 'group-a',
    playerKey,
    previousItem,
    nextItem,
    historyEntry: history({
      oldScore: 1000,
      newScore: 1200,
      recordedAt: 6000,
      playerName: 'new-player-name',
      displayNameSnapshot: 'new display',
      remarkSnapshot: 'new remark',
      ownerUserIdSnapshot: 'new-owner',
    }),
  })

  assert.equal(result.status, 'committed-recovery')
  assert.equal(result.shouldNotify, true)
  assert.deepEqual(operations, ['save'])
  assert.equal(scoreHistoryStore.appendCalls, 0)
  assert.equal(scoreHistoryStore.entries.length, 1)
  assert.deepEqual(scoreHistoryStore.entries[0], existing)
  assert.equal(groupStore.saveCalls, 1)
  assert.deepEqual(groupStore.savedPlayers[0], nextItem)
  assert.deepEqual(storedGroup.players[playerKey], nextItem)
})

test('commit returns failed and leaves group state unchanged when history append fails', async () => {
  const previousItem = player({ rankScore: 1000 })
  const nextItem = player({ rankScore: 1200, lastChecked: 2 })
  const storedGroup = group(previousItem)
  const { committer, operations, groupStore, scoreHistoryStore } = createCommitter(storedGroup, { failAppend: true })

  const result = await committer.commit({
    group: storedGroup,
    groupId: 'group-a',
    playerKey,
    previousItem,
    nextItem,
    historyEntry: history(),
  })

  assert.equal(result.status, 'failed')
  assert.equal(result.shouldNotify, false)
  assert.match(result.errorMessage || '', /history append failed/)
  assert.deepEqual(operations, ['append'])
  assert.equal(scoreHistoryStore.appendCalls, 1)
  assert.equal(groupStore.saveCalls, 0)
  assert.deepEqual(storedGroup.players[playerKey], previousItem)
})

test('commit keeps fresh history and rolls back group memory when group save fails', async () => {
  const previousItem = player({ rankScore: 1000 })
  const nextItem = player({ rankScore: 1200, lastChecked: 2 })
  const storedGroup = group(previousItem)
  const { committer, operations, groupStore, scoreHistoryStore } = createCommitter(storedGroup, { failSave: true })

  const result = await committer.commit({
    group: storedGroup,
    groupId: 'group-a',
    playerKey,
    previousItem,
    nextItem,
    historyEntry: history(),
  })

  assert.equal(result.status, 'pending-state')
  assert.equal(result.shouldNotify, false)
  assert.match(result.errorMessage || '', /group save failed/)
  assert.deepEqual(operations, ['append', 'save'])
  assert.equal(scoreHistoryStore.appendCalls, 1)
  assert.equal(scoreHistoryStore.entries.length, 1)
  assert.equal(groupStore.saveCalls, 1)
  assert.deepEqual(groupStore.savedPlayers[0], nextItem)
  assert.deepEqual(storedGroup.players[playerKey], previousItem)
})

test('commit does not duplicate recovery history and rolls back group memory when group save fails', async () => {
  const previousItem = player({ rankScore: 1000 })
  const nextItem = player({ rankScore: 1200, lastChecked: 2 })
  const storedGroup = group(previousItem)
  const existing = history({ oldScore: 1000, newScore: 1200, recordedAt: 5000 })
  const { committer, operations, groupStore, scoreHistoryStore } = createCommitter(storedGroup, { failSave: true, existingHistory: [existing] })

  const result = await committer.commit({
    group: storedGroup,
    groupId: 'group-a',
    playerKey,
    previousItem,
    nextItem,
    historyEntry: history({ oldScore: 1000, newScore: 1200, recordedAt: 6000 }),
  })

  assert.equal(result.status, 'pending-state')
  assert.equal(result.shouldNotify, false)
  assert.match(result.errorMessage || '', /group save failed/)
  assert.deepEqual(operations, ['save'])
  assert.equal(scoreHistoryStore.appendCalls, 0)
  assert.equal(scoreHistoryStore.entries.length, 1)
  assert.equal(groupStore.saveCalls, 1)
  assert.deepEqual(groupStore.savedPlayers[0], nextItem)
  assert.deepEqual(storedGroup.players[playerKey], previousItem)
})

test('commit returns noop when the previous and next rank scores are equal', async () => {
  const previousItem = player({ rankScore: 1000 })
  const nextItem = player({ rankScore: 1000, lastChecked: 2 })
  const storedGroup = group(previousItem)
  const { committer, operations, groupStore, scoreHistoryStore } = createCommitter(storedGroup)

  const result = await committer.commit({
    group: storedGroup,
    groupId: 'group-a',
    playerKey,
    previousItem,
    nextItem,
    historyEntry: history({ oldScore: 1000, newScore: 1000, delta: 0 }),
  })

  assert.equal(result.status, 'noop')
  assert.equal(result.shouldNotify, false)
  assert.deepEqual(operations, [])
  assert.equal(scoreHistoryStore.appendCalls, 0)
  assert.equal(groupStore.saveCalls, 0)
  assert.deepEqual(storedGroup.players[playerKey], previousItem)
})
