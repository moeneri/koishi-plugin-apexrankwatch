import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  DailyMapPoolState,
  NotificationTarget,
  RuntimeSettings,
  StoredGroupRecord,
  StoredPlayerRecord,
  LoggerLike,
  coerceBool,
  normalizePlatform,
  toInt,
} from './shared'

function cloneTarget(target: NotificationTarget | null) {
  return target ? { ...target } : null
}

function defaultTarget(groupId: string): NotificationTarget {
  return {
    botSid: '',
    platform: 'onebot',
    selfId: '',
    channelId: groupId,
    guildId: groupId,
  }
}

function normalizeTarget(groupId: string, value: any): NotificationTarget | null {
  if (!value || typeof value !== 'object') return null
  const channelId = String(value.channelId ?? value.channel_id ?? value.guildId ?? value.guild_id ?? '').trim()
  if (!channelId) return null
  return {
    botSid: String(value.botSid ?? value.bot_sid ?? '').trim(),
    platform: String(value.platform ?? '').trim(),
    selfId: String(value.selfId ?? value.self_id ?? '').trim(),
    channelId,
    guildId: String(value.guildId ?? value.guild_id ?? groupId).trim() || groupId,
  }
}

function normalizePlayerRecord(value: any): StoredPlayerRecord | null {
  if (!value || typeof value !== 'object') return null
  const playerName = String(value.playerName ?? value.player_name ?? '').trim()
  if (!playerName) return null

  let legendKillsPercent = String(value.legendKillsPercent ?? value.legend_kills_percent ?? '').trim()
  if (!legendKillsPercent) {
    legendKillsPercent = String(value.legendStats?.kills?.globalPercent ?? '').trim()
  }

  const platform = normalizePlatform(String(value.platform ?? 'PC'))
  const lookupId = String(value.lookupId ?? value.lookup_id ?? playerName).trim() || playerName

  return {
    playerName,
    platform,
    lookupId,
    useUid: coerceBool(value.useUid ?? value.use_uid, false),
    rankScore: toInt(value.rankScore ?? value.rank_score) ?? 0,
    rankName: String(value.rankName ?? value.rank_name ?? '').trim() || '菜鸟',
    rankDiv: toInt(value.rankDiv ?? value.rank_div) ?? 0,
    lastChecked: toInt(value.lastChecked ?? value.last_checked) ?? 0,
    globalRankPercent: String(value.globalRankPercent ?? value.global_rank_percent ?? '未知').trim() || '未知',
    selectedLegend: String(value.selectedLegend ?? value.selected_legend ?? '').trim(),
    legendKillsPercent,
    remark: value.remark ? String(value.remark).trim() : undefined,
  }
}

function normalizeGroupRecord(groupId: string, value: any): StoredGroupRecord | null {
  if (!value || typeof value !== 'object') return null
  const normalizedGroupId = String(value.groupId ?? value.group_id ?? groupId).trim() || groupId
  const rawPlayers = value.players && typeof value.players === 'object' ? value.players : {}
  const players: Record<string, StoredPlayerRecord> = {}

  for (const [key, player] of Object.entries(rawPlayers)) {
    const normalized = normalizePlayerRecord(player)
    if (!normalized) continue
    players[key] = normalized
  }

  const target =
    normalizeTarget(normalizedGroupId, value.target ?? value.notifyTarget) ||
    (Object.keys(players).length ? defaultTarget(normalizedGroupId) : null)

  return {
    groupId: normalizedGroupId,
    target,
    players,
  }
}

function defaultDailyMapPoolState(): DailyMapPoolState {
  return {
    seasonKey: '',
    seasonEndIso: '',
    status: 'learning',
    cycle: [],
    lastCurrent: '',
    lastNext: '',
    lastCurrentStart: 0,
    updatedAt: 0,
    reason: '',
  }
}

function normalizeMapCycle(cycle: unknown) {
  const result: string[] = []
  if (!Array.isArray(cycle)) return result
  for (const item of cycle) {
    const text = String(item || '').trim()
    if (!text) continue
    const key = text.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '')
    if (result.some((existing) => existing.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '') === key)) continue
    result.push(text)
  }
  return result
}

function normalizeDailyMapPoolState(value: any): DailyMapPoolState {
  if (!value || typeof value !== 'object') return defaultDailyMapPoolState()
  const status = String(value.status || 'learning').toLowerCase() === 'confirmed' ? 'confirmed' : 'learning'
  return {
    seasonKey: String(value.seasonKey ?? value.season_key ?? ''),
    seasonEndIso: String(value.seasonEndIso ?? value.season_end_iso ?? ''),
    status,
    cycle: normalizeMapCycle(value.cycle),
    lastCurrent: String(value.lastCurrent ?? value.last_current ?? ''),
    lastNext: String(value.lastNext ?? value.last_next ?? ''),
    lastCurrentStart: toInt(value.lastCurrentStart ?? value.last_current_start) ?? 0,
    updatedAt: toInt(value.updatedAt ?? value.updated_at) ?? 0,
    reason: String(value.reason ?? ''),
  }
}

async function writeJsonAtomic(filePath: string, payload: unknown) {
  await mkdir(dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.tmp`
  const content = `${JSON.stringify(payload, null, 2)}\n`
  await writeFile(tmpPath, content, 'utf8')
  await rename(tmpPath, filePath)
}

export class GroupStore {
  private groups: Record<string, StoredGroupRecord> = {}

  constructor(private readonly filePath: string, private readonly logger: LoggerLike) {}

  async load() {
    try {
      const raw = JSON.parse(await readFile(this.filePath, 'utf8'))
      if (!raw || typeof raw !== 'object') return
      this.groups = {}
      for (const [groupId, value] of Object.entries(raw)) {
        const normalized = normalizeGroupRecord(groupId, value)
        if (!normalized) continue
        this.groups[groupId] = normalized
      }
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        this.logger.error(`加载 groups.json 失败: ${error?.message || error}`)
      }
    }
  }

  async save() {
    const payload = Object.fromEntries(
      Object.entries(this.groups).map(([groupId, group]) => [
        groupId,
        {
          groupId: group.groupId,
          target: group.target,
          players: group.players,
        },
      ]),
    )
    await writeJsonAtomic(this.filePath, payload)
  }

  getGroup(groupId: string) {
    return this.groups[groupId]
  }

  ensureGroup(groupId: string, target?: NotificationTarget | null) {
    if (!this.groups[groupId]) {
      this.groups[groupId] = {
        groupId,
        target: target ? cloneTarget(target) : defaultTarget(groupId),
        players: {},
      }
    } else if (target) {
      this.groups[groupId].target = cloneTarget(target)
    }
    return this.groups[groupId]
  }

  updateTarget(groupId: string, target: NotificationTarget) {
    this.ensureGroup(groupId, target)
  }

  setPlayer(groupId: string, playerKey: string, record: StoredPlayerRecord, target?: NotificationTarget | null) {
    const group = this.ensureGroup(groupId, target)
    group.players[playerKey] = { ...record }
  }

  removePlayer(groupId: string, playerKey: string) {
    const group = this.groups[groupId]
    if (!group?.players[playerKey]) return false
    delete group.players[playerKey]
    if (!Object.keys(group.players).length) delete this.groups[groupId]
    return true
  }

  entries() {
    return Object.entries(this.groups)
  }
}

export class SettingsStore {
  constructor(private readonly filePath: string, private readonly logger: LoggerLike) {}

  async load(): Promise<RuntimeSettings> {
    try {
      const raw = JSON.parse(await readFile(this.filePath, 'utf8'))
      if (!raw || typeof raw !== 'object') throw new Error('settings.json 不是对象')
      return {
        runtimeBlacklist: Array.isArray(raw.runtime_blacklist)
          ? raw.runtime_blacklist.map((item: unknown) => String(item).trim().toLowerCase()).filter(Boolean)
          : [],
        seasonKeywordDisabledGroups: Array.isArray(raw.season_keyword_disabled_groups)
          ? raw.season_keyword_disabled_groups.map((item: unknown) => String(item).trim()).filter(Boolean)
          : [],
      }
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        this.logger.error(`加载 settings.json 失败: ${error?.message || error}`)
      }
      return {
        runtimeBlacklist: [],
        seasonKeywordDisabledGroups: [],
      }
    }
  }

  async save(settings: RuntimeSettings) {
    await writeJsonAtomic(this.filePath, {
      runtime_blacklist: Array.from(new Set(settings.runtimeBlacklist)).sort(),
      season_keyword_disabled_groups: Array.from(new Set(settings.seasonKeywordDisabledGroups)).sort(),
    })
  }
}

export class DailyMapPoolStore {
  constructor(private readonly filePath: string, private readonly logger: LoggerLike) {}

  async load(): Promise<DailyMapPoolState> {
    try {
      const raw = JSON.parse(await readFile(this.filePath, 'utf8'))
      return normalizeDailyMapPoolState(raw)
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        this.logger.error(`加载 daily_map_pool_state.json 失败: ${error?.message || error}`)
      }
      return defaultDailyMapPoolState()
    }
  }

  async save(state: DailyMapPoolState) {
    const normalized = normalizeDailyMapPoolState(state)
    await writeJsonAtomic(this.filePath, {
      season_key: normalized.seasonKey,
      season_end_iso: normalized.seasonEndIso,
      status: normalized.status,
      cycle: normalized.cycle,
      last_current: normalized.lastCurrent,
      last_next: normalized.lastNext,
      last_current_start: normalized.lastCurrentStart,
      updated_at: normalized.updatedAt,
      reason: normalized.reason,
    })
  }
}
