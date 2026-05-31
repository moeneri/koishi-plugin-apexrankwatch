import type { ScoreHistoryEntry, StoredGroupRecord, StoredPlayerRecord } from './shared'

type GroupStoreLike = {
  save(): Promise<void>
}

type ScoreHistoryStoreLike = {
  findLatestByPlayer(groupId: string, playerKey: string): ScoreHistoryEntry | null
  append(entry: ScoreHistoryEntry): Promise<void>
}

export type RankChangeCommitStatus =
  | 'committed-fresh'
  | 'committed-recovery'
  | 'pending-state'
  | 'noop'
  | 'failed'

export interface RankChangeCommitResult {
  status: RankChangeCommitStatus
  shouldNotify: boolean
  errorMessage?: string
}

export interface RankChangeCommitRequest {
  group: StoredGroupRecord
  groupId: string
  playerKey: string
  previousItem: StoredPlayerRecord
  nextItem: StoredPlayerRecord
  historyEntry: ScoreHistoryEntry
}

export interface RankChangeCommitterDeps {
  groupStore: GroupStoreLike
  scoreHistoryStore: ScoreHistoryStoreLike
}

function errorMessage(error: unknown) {
  return String((error as Error)?.message || error)
}

function isSameScoreChange(left: ScoreHistoryEntry | null, right: ScoreHistoryEntry) {
  return Boolean(left && left.oldScore === right.oldScore && left.newScore === right.newScore)
}

export class RankChangeCommitter {
  constructor(private readonly deps: RankChangeCommitterDeps) {}

  async commit(request: RankChangeCommitRequest): Promise<RankChangeCommitResult> {
    if (request.previousItem.rankScore === request.nextItem.rankScore) {
      return { status: 'noop', shouldNotify: false }
    }

    const latest = this.deps.scoreHistoryStore.findLatestByPlayer(request.groupId, request.playerKey)
    const isRecovery = isSameScoreChange(latest, request.historyEntry)

    if (!isRecovery) {
      try {
        await this.deps.scoreHistoryStore.append(request.historyEntry)
      } catch (error) {
        return {
          status: 'failed',
          shouldNotify: false,
          errorMessage: errorMessage(error),
        }
      }
    }

    request.group.players[request.playerKey] = { ...request.nextItem }
    try {
      await this.deps.groupStore.save()
    } catch (error) {
      request.group.players[request.playerKey] = { ...request.previousItem }
      return {
        status: 'pending-state',
        shouldNotify: false,
        errorMessage: errorMessage(error),
      }
    }

    return {
      status: isRecovery ? 'committed-recovery' : 'committed-fresh',
      shouldNotify: true,
    }
  }
}
