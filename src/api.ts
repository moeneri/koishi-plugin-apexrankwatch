import {
  ApexPlayerStats,
  DailyMapPoolState,
  DailyMapScheduleInfo,
  LegendKillsRank,
  LoggerLike,
  MapRotationEntry,
  MapRotationInfo,
  MapScheduleEntry,
  PLATFORM_SEARCH_ORDER,
  PredatorInfo,
  PredatorPlatformInfo,
  SeasonInfo,
  maskSecret,
  normalizeKeyName,
  normalizePlatform,
  toFloat,
  toInt,
  translate,
  translateState,
} from './shared'

export class PlayerNotFoundError extends Error {}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>
type DailyMapMode = 'ranked' | 'battle_royale'

const SEASON_MAP_POOL_LOCK_BEFORE_END_SECS = 2 * 60 * 60
const SEASON_MAP_POOL_LOCK_AFTER_END_SECS = 12 * 60 * 60
const USER_AGENT = 'Koishi-ApexRankWatch/2.1.0'

function withTimeout(timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timer)
    },
  }
}

export class ApexApiClient {
  static serializeDebugPayload(payload: unknown) {
    return serializePayload(sanitizeDebugPayload(payload))
  }

  constructor(
    private readonly options: {
      apiKey: string
      timeoutMs: number
      maxRetries: number
      debugLogging: boolean
      logger: LoggerLike
      fetcher?: Fetcher
    },
  ) {}

  private get fetcher() {
    return this.options.fetcher ?? fetch
  }

  async fetchPlayerStatsByName(playerName: string, platform: string) {
    const url = new URL('https://api.mozambiquehe.re/bridge')
    url.searchParams.set('auth', this.options.apiKey)
    url.searchParams.set('player', playerName)
    url.searchParams.set('platform', platform)
    const data = await this.requestPlayerData(url.toString(), playerName)
    return parsePlayerStats(data, platform, playerName)
  }

  async fetchPlayerStatsByUid(uid: string, platform: string) {
    const url = new URL('https://api.mozambiquehe.re/bridge')
    url.searchParams.set('auth', this.options.apiKey)
    url.searchParams.set('uid', uid)
    url.searchParams.set('platform', platform)
    const data = await this.requestPlayerData(url.toString(), uid)
    return parsePlayerStats(data, platform, uid)
  }

  async fetchPlayerStatsAuto(identifier: string, platform = '', useUid = false): Promise<{ player: ApexPlayerStats; platform: string }> {
    if (platform) {
      const normalized = normalizePlatform(platform)
      const player = useUid
        ? await this.fetchPlayerStatsByUid(identifier, normalized)
        : await this.fetchPlayerStatsByName(identifier, normalized)
      return { player, platform: normalized }
    }

    for (const candidate of PLATFORM_SEARCH_ORDER) {
      try {
        const player = useUid
          ? await this.fetchPlayerStatsByUid(identifier, candidate)
          : await this.fetchPlayerStatsByName(identifier, candidate)
        return { player, platform: candidate }
      } catch (error) {
        if (!(error instanceof PlayerNotFoundError)) throw error
      }
    }

    throw new PlayerNotFoundError(`Player not found: ${identifier}`)
  }

  async fetchPredatorInfo(): Promise<PredatorInfo> {
    const cacheBust = String(Date.now())
    const url = new URL('https://api.mozambiquehe.re/predator')
    url.searchParams.set('auth', this.options.apiKey)
    url.searchParams.set('_', cacheBust)
    url.searchParams.set('cb', cacheBust)
    url.searchParams.set('ts', cacheBust)

    const headers = {
      'Cache-Control': 'no-cache, no-store, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    }

    const { data: firstData, status: firstStatus } = await this.requestJson(url.toString(), headers)
    if (firstStatus === 401 || firstStatus === 403 || isInvalidApiKey(firstData)) {
      throw new Error('Invalid API key')
    }
    let [mode, payload] = selectPredatorPayload(firstData)
    let platforms = parsePredatorPlatforms(payload)

    if (platforms.length && platforms.every((entry) => entry.mastersCount === null)) {
      this.options.logger.warn('猎杀接口首次请求未解析到大师及以上人数，正在进行无缓存重试。')
      const { data: secondData, status: secondStatus } = await this.requestJson(url.toString(), headers)
      if (secondStatus === 401 || secondStatus === 403 || isInvalidApiKey(secondData)) {
        throw new Error('Invalid API key')
      }
      ;[mode, payload] = selectPredatorPayload(secondData)
      platforms = parsePredatorPlatforms(payload)
    }

    const summary = platforms
      .map((entry) => `${entry.platform}(rp=${entry.requiredRp ?? 'null'}, masters=${entry.mastersCount ?? 'null'})`)
      .join('; ')
    if (summary) this.options.logger.info(`猎杀接口解析结果: ${summary}`)

    return { mode, platforms }
  }

  async fetchMapRotationInfo(): Promise<MapRotationInfo> {
    const url = new URL('https://api.mozambiquehe.re/maprotation')
    url.searchParams.set('auth', this.options.apiKey)
    url.searchParams.set('version', '2')
    const { data, status } = await this.requestJson(url.toString())
    if (status === 401 || status === 403 || isInvalidApiKey(data)) {
      throw new Error('Invalid API key')
    }
    return parseMapRotationInfo(data)
  }

  async fetchDailyMapSchedule(mode: DailyMapMode = 'ranked', poolState?: DailyMapPoolState | null, seasonInfo?: SeasonInfo | null): Promise<DailyMapScheduleInfo> {
    const normalizedMode = normalizeDailyMapMode(mode)
    const now = new Date()
    const rotationInfo = await this.fetchMapRotationInfo()
    const rotationMode = normalizedMode === 'battle_royale' ? rotationInfo.battleRoyale : rotationInfo.ranked
    const updatedPoolState = normalizedMode === 'ranked' && poolState
      ? updateDailyMapPoolState(poolState, rotationMode.current, rotationMode.next, seasonInfo || null, now)
      : null
    const [entries, sourceNote] = updatedPoolState
      ? buildDailyMapEntriesFromPoolState(updatedPoolState, rotationMode.current, rotationMode.next)
      : buildDailyMapEntriesFromPoolState(defaultDailyMapPoolState(), rotationMode.current, rotationMode.next)

    return {
      mode: normalizedMode,
      title: normalizedMode === 'battle_royale' ? 'Apex 三人赛全天地图' : 'Apex 排位全天地图',
      dateLabel: formatBeijingDay(now),
      generatedAt: formatBeijingDateTime(now),
      sourceUrl: normalizedMode === 'battle_royale'
        ? 'https://apexlegendsstatus.com/current-map/battle_royale/pubs'
        : 'https://apexlegendsstatus.com/current-map/battle_royale/ranked',
      sourceNote,
      entries,
      poolState: updatedPoolState,
    }
  }

  async fetchSeasonInfo(seasonNumber?: number | null): Promise<SeasonInfo> {
    if (seasonNumber === undefined || seasonNumber === null) {
      const html = await this.requestText('https://apexlegendsstatus.com/new-season-countdown')
      return parseApexStatusCurrentSeasonInfo(html)
    }

    const homeUrl = 'https://apexseasons.online/'
    const homeHtml = await this.requestText(homeUrl)
    const references = extractSeasonReferences(homeHtml)
    const target = references.find((entry) => entry.seasonNumber === seasonNumber)
    if (!target) throw new Error(`未找到 S${seasonNumber} 的赛季数据`)
    const detailHtml = target.seasonUrl ? await this.requestText(target.seasonUrl) : ''
    const seasonInfo: SeasonInfo = {
      seasonNumber: target.seasonNumber,
      seasonName: target.seasonName,
      startDate: '未知',
      endDate: '未知',
      timezone: '未知',
      updateTimeHint: '未知',
      source: 'apexseasons.online',
      seasonUrl: target.seasonUrl,
      startIso: '',
      endIso: '',
    }
    applySeasonPageOverrides(seasonInfo, detailHtml)
    seasonInfo.statusText = seasonStatusText(seasonInfo.startIso, seasonInfo.endIso)
    if (!seasonInfo.startIso && !seasonInfo.endIso) {
      const fallback = parseCurrentSeason(homeHtml)
      if (fallback.seasonNumber === seasonNumber) return fallback
    }
    return seasonInfo
  }

  async fetchCurrentSeasonInfo(): Promise<SeasonInfo> {
    const homeUrl = 'https://apexseasons.online/'
    const homeHtml = await this.requestText(homeUrl)
    const seasonInfo = parseCurrentSeason(homeHtml)

    if (seasonInfo.seasonUrl) {
      try {
        const detailHtml = await this.requestText(seasonInfo.seasonUrl)
        applySeasonPageOverrides(seasonInfo, detailHtml)
        seasonInfo.statusText = seasonStatusText(seasonInfo.startIso, seasonInfo.endIso)
      } catch (error: any) {
        this.options.logger.warn(`获取赛季详情页失败: ${error?.message || error}`)
      }
    }

    return seasonInfo
  }

  private async requestPlayerData(url: string, identifier: string) {
    const { data, status } = await this.requestJson(url)
    if (status === 401 || isInvalidApiKey(data)) {
      throw new Error('Invalid API key')
    }
    if (status === 400 || status === 404 || isPlayerNotFound(data)) {
      throw new PlayerNotFoundError(`Player not found: ${identifier}`)
    }
    return data
  }

  private async requestJson(url: string, extraHeaders?: HeadersInit) {
    let lastError: unknown

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = retryDelay(attempt)
        this.options.logger.info(`API 请求失败，正在重试 ${attempt}/${this.options.maxRetries}，延迟 ${delay}s...`)
        await new Promise((resolve) => setTimeout(resolve, delay * 1000))
      }

      const timeout = withTimeout(this.options.timeoutMs)
      try {
        const headers: HeadersInit = {
          'User-Agent': USER_AGENT,
          ...(extraHeaders || {}),
        }
        this.debugLogRequest('JSON', url, headers)
        const response = await this.fetcher(url, { method: 'GET', headers, signal: timeout.signal })
        const text = await response.text()
        const data = parseJsonLike(text)
        this.debugLogResponse('JSON', url, data, response.status)

        if (response.status === 429 || response.status >= 500) {
          throw new Error(`retryable:${response.status}`)
        }

        return { data, status: response.status }
      } catch (error: any) {
        lastError = error
        this.debugLogError('JSON', url, error)
        if (String(error?.message || '').startsWith('retryable:') && attempt < this.options.maxRetries) continue
        if (error?.name === 'AbortError' && attempt < this.options.maxRetries) continue
        if (error?.message?.includes('fetch failed') && attempt < this.options.maxRetries) continue
        if (error?.message?.includes('retryable:')) throw new Error(`Apex API 请求失败 (${error.message.replace('retryable:', 'HTTP ')})`)
        throw error
      } finally {
        timeout.clear()
      }
    }

    throw lastError
  }

  private async requestText(url: string) {
    let lastError: unknown

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = retryDelay(attempt)
        this.options.logger.info(`页面请求失败，正在重试 ${attempt}/${this.options.maxRetries}，延迟 ${delay}s...`)
        await new Promise((resolve) => setTimeout(resolve, delay * 1000))
      }

      const timeout = withTimeout(this.options.timeoutMs)
      try {
        const headers: HeadersInit = {
          'User-Agent': USER_AGENT,
        }
        this.debugLogRequest('TEXT', url, headers)
        const response = await this.fetcher(url, { method: 'GET', headers, signal: timeout.signal })
        const text = await response.text()
        this.debugLogResponse('TEXT', url, text, response.status)
        if (response.status === 429 || response.status >= 500) throw new Error(`retryable:${response.status}`)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return text
      } catch (error: any) {
        lastError = error
        this.debugLogError('TEXT', url, error)
        if ((String(error?.message || '').startsWith('retryable:') || error?.name === 'AbortError') && attempt < this.options.maxRetries) continue
        throw error
      } finally {
        timeout.clear()
      }
    }

    throw lastError
  }

  private debugLogRequest(kind: string, url: string, headers?: HeadersInit) {
    if (!this.options.debugLogging) return
    this.options.logger.info(`[DEBUG] ${kind} 请求 => url=${url}, headers=${serializeHeaders(headers)}`)
  }

  private debugLogResponse(kind: string, url: string, payload: unknown, status: number) {
    if (!this.options.debugLogging) return
    const preview = ApexApiClient.serializeDebugPayload(payload)
    this.options.logger.info(`[DEBUG] ${kind} 响应 <= url=${url}, status=${status}, payload=${preview}`)
  }

  private debugLogError(kind: string, url: string, error: unknown) {
    if (!this.options.debugLogging) return
    this.options.logger.error(`[DEBUG] ${kind} 异常 !! url=${url}, error=${String((error as any)?.message || error)}`)
  }
}

function serializeHeaders(headers?: HeadersInit) {
  if (!headers) return '{}'
  const entries = Array.isArray(headers)
    ? headers
    : headers instanceof Headers
      ? Array.from(headers.entries())
      : Object.entries(headers)
  const sanitized = Object.fromEntries(entries.map(([key, value]) => [key, /auth|token|api[-_]?key|authorization/i.test(key) ? maskSecret(value) : value]))
  return JSON.stringify(sanitized)
}

function serializePayload(payload: unknown) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return text.length > 4000 ? `${text.slice(0, 4000)}...(truncated)` : text
}

function sanitizeDebugPayload(payload: unknown, key = ''): unknown {
  if (payload === null || payload === undefined) return payload
  const normalizedKey = normalizeKeyName(key)
  if (['auth', 'authorization', 'apikey', 'api_key', 'token', 'secret', 'password', 'cookie'].some((candidate) => normalizedKey.includes(normalizeKeyName(candidate)))) {
    return maskSecret(payload)
  }
  if (['uid', 'uuid', 'userid', 'groupid', 'player', 'playername', 'name', 'displayname'].includes(normalizedKey)) {
    return '***'
  }
  if (Array.isArray(payload)) return payload.map((item) => sanitizeDebugPayload(item, key))
  if (typeof payload === 'object') {
    return Object.fromEntries(Object.entries(payload).map(([nestedKey, value]) => [nestedKey, sanitizeDebugPayload(value, nestedKey)]))
  }
  if (typeof payload === 'string') {
    return payload
      .replace(/(auth|api[_-]?key|token)=([^&\s]+)/gi, '$1=***')
      .replace(/(player|uid|uuid|name)=([^&\s]+)/gi, '$1=***')
  }
  return payload
}

function retryDelay(attempt: number) {
  return Math.min(5, Math.max(1, 2 ** (attempt - 1)))
}

function isPlayerNotFound(data: any) {
  if (!data || typeof data !== 'object') return true
  for (const key of ['Error', 'error', 'message']) {
    const value = data[key]
    if (typeof value === 'string' && value.toLowerCase().includes('not found')) return true
  }
  const globalData = data.global
  if (!globalData || typeof globalData !== 'object') return true
  return !globalData.name && !globalData.uid
}

function isInvalidApiKey(data: any) {
  if (!data) return false
  if (typeof data === 'string') {
    const text = data.toLowerCase()
    return text.includes('invalid api key') || text.includes(`api key doesn't exist`)
  }
  if (typeof data === 'object') {
    for (const key of ['Error', 'error', 'message']) {
      const value = data[key]
      if (typeof value === 'string' && (value.toLowerCase().includes('invalid api key') || value.toLowerCase().includes(`api key doesn't exist`))) {
        return true
      }
    }
  }
  return false
}

function parseJsonLike(text: string) {
  if (!text) return null
  const trimmed = text.trim()
  if (!trimmed) return null
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    return JSON.parse(trimmed)
  }
  return trimmed
}

function parsePlayerStats(data: any, platform: string, fallbackName: string): ApexPlayerStats {
  const globalData = data?.global ?? {}
  const realtimeData = data?.realtime ?? {}
  const rankData = globalData?.rank ?? {}
  const legendsData = data?.legends ?? {}

  const selectedLegendRaw = String(realtimeData.selectedLegend ?? '')
  const selectedLegend = translate(selectedLegendRaw)

  let legendKillsRank: LegendKillsRank | null = null
  const legendStatsData = Array.isArray(legendsData?.selected?.data) ? legendsData.selected.data : []
  for (const stat of legendStatsData) {
    if (!stat || typeof stat !== 'object') continue
    if (stat.name !== 'BR Kills' && stat.key !== 'specialEvent_kills') continue
    const topPercent = toFloat(stat.rank?.topPercent)
    if (topPercent === null) continue
    legendKillsRank = {
      value: toInt(stat.value) ?? 0,
      globalPercent: topPercent.toFixed(2),
    }
    break
  }

  const currentStateRaw = realtimeData.currentStateAsText ?? realtimeData.currentState ?? 'offline'
  const currentState = translateState(currentStateRaw)
  const isOnline = (toInt(realtimeData.isOnline) ?? 0) === 1 || realtimeData.isOnline === true

  return {
    name: String(globalData.name || fallbackName),
    uid: String(globalData.uid || ''),
    level: toInt(globalData.level) ?? 0,
    rankScore: toInt(rankData.rankScore) ?? 0,
    rankName: translate(String(rankData.rankName ?? 'Unranked')),
    rankDiv: toInt(rankData.rankDiv) ?? 0,
    globalRankPercent: rankData.ALStopPercentGlobal === undefined || rankData.ALStopPercentGlobal === null || rankData.ALStopPercentGlobal === ''
      ? '未知'
      : String(rankData.ALStopPercentGlobal),
    isOnline,
    selectedLegend,
    legendKillsRank,
    currentState,
    isInLobbyOrMatch: currentState.includes('大厅') || currentState.includes('比赛'),
    platform,
  }
}

function selectPredatorPayload(data: any): [string, Record<string, any>] {
  if (data && typeof data === 'object') {
    for (const key of ['RP', 'AP']) {
      if (data[key] && typeof data[key] === 'object') return [key, data[key]]
    }
    return ['RP', data]
  }
  return ['RP', {}]
}

function parsePredatorPlatforms(payload: Record<string, any>): PredatorPlatformInfo[] {
  if (!payload || typeof payload !== 'object') return []
  const keys = Array.from(new Set([...PLATFORM_SEARCH_ORDER, ...Object.keys(payload)]))
  const result: PredatorPlatformInfo[] = []
  for (const key of keys) {
    const entry = payload[key]
    if (!entry || typeof entry !== 'object') continue
    result.push({
      platform: key,
      requiredRp: getFirstInt(entry, 'val', 'value', 'rp', 'RP', 'requiredRP', 'required_rp', 'score'),
      mastersCount: getFirstInt(entry, 'count', 'totalMastersAndPreds', 'totalMasters', 'masters', 'mastersCount', 'masterCount', 'totalMasterCount'),
      updateTimestamp: getFirstInt(entry, 'updateTimestamp', 'lastUpdated', 'updateTime', 'updatedAt', 'timestamp'),
    })
  }
  return result
}

function parseMapRotationInfo(data: any): MapRotationInfo {
  return {
    ranked: parseMapRotationMode(data?.ranked),
    battleRoyale: parseMapRotationMode(data?.battle_royale ?? data?.battleRoyale ?? data?.battle_royale_pub),
  }
}

function parseMapRotationMode(data: any) {
  return {
    current: parseMapRotationEntry(data?.current),
    next: parseMapRotationEntry(data?.next),
  }
}

function parseMapRotationEntry(data: any): MapRotationEntry | null {
  if (!data || typeof data !== 'object') return null
  const mapName = String(data.map ?? data.mapName ?? data.name ?? '').trim()
  if (!mapName) return null
  return {
    start: toInt(data.start ?? data.startTimestamp ?? data.start_time),
    end: toInt(data.end ?? data.endTimestamp ?? data.end_time),
    mapName,
    mapNameZh: translate(mapName),
    remainingTimer: String(data.remainingTimer ?? data.remaining_timer ?? '').trim(),
  }
}

export function defaultDailyMapPoolState(): DailyMapPoolState {
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

export function updateDailyMapPoolState(
  state: DailyMapPoolState | null | undefined,
  current: MapRotationEntry | null,
  nextEntry: MapRotationEntry | null,
  seasonInfo: SeasonInfo | null = null,
  now = new Date(),
): DailyMapPoolState {
  const currentState = normalizeDailyMapPoolState(state)
  const nowTs = Math.floor(now.getTime() / 1000)
  const seasonKey = dailyMapSeasonKey(seasonInfo) || currentState.seasonKey
  const seasonEndIso = seasonInfo?.endIso || currentState.seasonEndIso

  if (!current || !nextEntry) {
    return {
      ...defaultDailyMapPoolState(),
      seasonKey,
      seasonEndIso,
      status: 'learning',
      cycle: [...currentState.cycle],
      updatedAt: nowTs,
      reason: 'API 未返回完整地图轮换，暂时无法确认排位地图池',
    }
  }

  const currentName = String(current.mapName || '').trim()
  const nextName = String(nextEntry.mapName || '').trim()
  if (!currentName || !nextName) {
    return {
      ...defaultDailyMapPoolState(),
      seasonKey,
      seasonEndIso,
      status: 'learning',
      updatedAt: nowTs,
      reason: 'API 地图名称缺失，暂时无法确认排位地图池',
    }
  }

  if (isInSeasonMapPoolLockWindow(seasonInfo, now, seasonEndIso)) {
    return newLearningMapPoolState(seasonKey, seasonEndIso, current, nextEntry, nowTs, '临近赛季更新，排位地图池重新确认中，仅显示 API 当前/下一张')
  }

  if (currentState.seasonKey && seasonKey && currentState.seasonKey !== seasonKey) {
    return newLearningMapPoolState(seasonKey, seasonEndIso, current, nextEntry, nowTs, '赛季已变化，排位地图池重新学习中，仅显示 API 当前/下一张')
  }

  if (currentState.status === 'confirmed' && currentState.cycle.length >= 3) {
    if (dailyMapPairMatchesCycle(currentState.cycle, currentName, nextName)) {
      return {
        seasonKey,
        seasonEndIso,
        status: 'confirmed',
        cycle: [...currentState.cycle],
        lastCurrent: currentName,
        lastNext: nextName,
        lastCurrentStart: current.start || 0,
        updatedAt: nowTs,
        reason: 'API 已确认排位地图池闭环',
      }
    }
    return newLearningMapPoolState(seasonKey, seasonEndIso, current, nextEntry, nowTs, 'API 轮换显示地图池变化，重新学习中，仅显示 API 当前/下一张')
  }

  if (isSameApiPair(currentState, current, nextEntry)) {
    return {
      ...currentState,
      seasonKey,
      seasonEndIso,
      updatedAt: nowTs,
      reason: currentState.reason || '新赛季地图池学习中，仅显示 API 当前/下一张',
    }
  }

  const cycle = advanceLearningMapCycle(currentState.cycle, currentName, nextName)
  const status: DailyMapPoolState['status'] = learningCycleIsClosed(cycle, currentName, nextName) ? 'confirmed' : 'learning'
  return {
    seasonKey,
    seasonEndIso,
    status,
    cycle,
    lastCurrent: currentName,
    lastNext: nextName,
    lastCurrentStart: current.start || 0,
    updatedAt: nowTs,
    reason: status === 'confirmed' ? 'API 已确认排位地图池闭环' : '新赛季地图池学习中，仅显示 API 当前/下一张',
  }
}

export function buildDailyMapEntriesFromPoolState(
  state: DailyMapPoolState | null | undefined,
  current: MapRotationEntry | null,
  nextEntry: MapRotationEntry | null,
  hours = 24,
): [MapScheduleEntry[], string] {
  const poolState = normalizeDailyMapPoolState(state)
  const anchors = dedupeScheduleEntries([scheduleEntryFromRotationEntry(current), scheduleEntryFromRotationEntry(nextEntry)].filter(Boolean) as MapScheduleEntry[])

  if (poolState.status === 'confirmed' && poolState.cycle.length >= 3 && current && nextEntry) {
    const entries = buildRollingMapEntriesFromCycle(poolState.cycle, current, nextEntry, hours)
    if (entries.length) {
      return [entries, 'API 已确认排位地图池闭环，当前/下一张为 API，后续按已确认地图池推断']
    }
    return [anchors, 'API 轮换与已确认地图池不一致，仅显示 API 当前/下一张']
  }

  if (
    poolState.status === 'learning'
    && poolState.cycle.length >= 2
    && current
    && nextEntry
    && learningMapPoolAllowsTentativeForecast(poolState)
  ) {
    const entries = buildTentativeMapEntriesFromCycle(poolState.cycle, current, nextEntry, hours)
    if (entries.length > anchors.length) {
      return [entries, '地图池仍在学习中，当前/下一张为 API，后续按已观测顺序临时推测，可能随 API 下一次校正']
    }
  }

  let note = poolState.reason || '新赛季地图池学习中，仅显示 API 当前/下一张'
  if (!note.includes('仅显示 API 当前/下一张')) note = `${note}，仅显示 API 当前/下一张`
  return [anchors, note]
}

export function normalizeDailyMapPoolState(value: DailyMapPoolState | any): DailyMapPoolState {
  if (!value || typeof value !== 'object') return defaultDailyMapPoolState()
  const rawCycle = Array.isArray(value.cycle) ? value.cycle : []
  const status = String(value.status || 'learning').toLowerCase() === 'confirmed' ? 'confirmed' : 'learning'
  return {
    seasonKey: String(value.seasonKey ?? value.season_key ?? ''),
    seasonEndIso: String(value.seasonEndIso ?? value.season_end_iso ?? ''),
    status,
    cycle: dedupeMapCycle(rawCycle.map((item: unknown) => String(item || '').trim()).filter(Boolean)),
    lastCurrent: String(value.lastCurrent ?? value.last_current ?? ''),
    lastNext: String(value.lastNext ?? value.last_next ?? ''),
    lastCurrentStart: toInt(value.lastCurrentStart ?? value.last_current_start) ?? 0,
    updatedAt: toInt(value.updatedAt ?? value.updated_at) ?? 0,
    reason: String(value.reason ?? ''),
  }
}

function normalizeDailyMapMode(mode: string): DailyMapMode {
  return mode === 'battle_royale' ? 'battle_royale' : 'ranked'
}

function newLearningMapPoolState(
  seasonKey: string,
  seasonEndIso: string,
  current: MapRotationEntry,
  nextEntry: MapRotationEntry,
  updatedAt: number,
  reason: string,
): DailyMapPoolState {
  return {
    seasonKey,
    seasonEndIso,
    status: 'learning',
    cycle: dedupeMapCycle([current.mapName, nextEntry.mapName]),
    lastCurrent: String(current.mapName || ''),
    lastNext: String(nextEntry.mapName || ''),
    lastCurrentStart: current.start || 0,
    updatedAt,
    reason,
  }
}

function buildRollingMapEntriesFromCycle(cycle: string[], current: MapRotationEntry, nextEntry: MapRotationEntry, hours: number) {
  const normalizedCycle = dedupeMapCycle(cycle)
  if (normalizedCycle.length < 3) return []
  if (!dailyMapPairMatchesCycle(normalizedCycle, current.mapName, nextEntry.mapName)) return []
  return buildCycleEntries(normalizedCycle, current, nextEntry, hours)
}

function buildTentativeMapEntriesFromCycle(cycle: string[], current: MapRotationEntry, nextEntry: MapRotationEntry, hours: number) {
  const normalizedCycle = dedupeMapCycle(cycle)
  if (normalizedCycle.length < 2) return []
  if (!dailyMapPairMatchesCycle(normalizedCycle, current.mapName, nextEntry.mapName)) return []
  return buildCycleEntries(normalizedCycle, current, nextEntry, hours)
}

function buildCycleEntries(cycle: string[], current: MapRotationEntry, nextEntry: MapRotationEntry, hours: number) {
  const duration = rotationDurationSeconds(current) || rotationDurationSeconds(nextEntry)
  if (duration <= 0 || !current.start) return []
  const currentIndex = mapIndexInCycle(cycle, current.mapName)
  if (currentIndex < 0) return []
  const entries: MapScheduleEntry[] = []
  const windowEnd = current.start + Math.max(1, Math.trunc(hours)) * 60 * 60
  let start = current.start
  let index = currentIndex
  while (start < windowEnd) {
    const mapName = cycle[index % cycle.length]
    let end = start + duration
    let source: MapScheduleEntry['source'] = 'inferred'
    if (sameMapName(mapName, current.mapName) && Math.abs(start - (current.start || 0)) <= 60) {
      end = current.end || end
      source = 'api'
    } else if (sameMapName(mapName, nextEntry.mapName) && Math.abs(start - (nextEntry.start || 0)) <= 60) {
      end = nextEntry.end || end
      source = 'api'
    }
    entries.push(makeMapScheduleEntry(mapName, start, end, source))
    start = end
    index += 1
  }
  return dedupeScheduleEntries(entries)
}

function scheduleEntryFromRotationEntry(entry: MapRotationEntry | null): MapScheduleEntry | null {
  if (!entry?.mapName || !entry.start || !entry.end) return null
  return makeMapScheduleEntry(entry.mapName, entry.start, entry.end, 'api', entry.mapNameZh)
}

function makeMapScheduleEntry(mapName: string, start: number, end: number, source: MapScheduleEntry['source'], mapNameZh = translate(mapName)): MapScheduleEntry {
  return {
    mapName,
    mapNameZh,
    start,
    end,
    readableStart: formatBeijingTime(start),
    readableEnd: formatBeijingTime(end),
    durationSecs: Math.max(0, end - start),
    source,
  }
}

function dedupeScheduleEntries(entries: MapScheduleEntry[]) {
  const seen = new Set<string>()
  const result: MapScheduleEntry[] = []
  for (const entry of entries) {
    const key = `${normalizeMapNameForCompare(entry.mapName)}:${entry.start}:${entry.end}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(entry)
  }
  return result.sort((a, b) => a.start - b.start)
}

function dedupeMapCycle(cycle: string[]) {
  const result: string[] = []
  for (const item of cycle) {
    const name = String(item || '').trim()
    if (!name || result.some((existing) => sameMapName(existing, name))) continue
    result.push(name)
  }
  return result
}

function sameMapName(left: string, right: string) {
  return normalizeMapNameForCompare(left) === normalizeMapNameForCompare(right)
}

function normalizeMapNameForCompare(value: string) {
  return String(value || '').trim().toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '')
}

function mapIndexInCycle(cycle: string[], mapName: string) {
  return cycle.findIndex((item) => sameMapName(item, mapName))
}

function dailyMapPairMatchesCycle(cycle: string[], currentName: string, nextName: string) {
  const index = mapIndexInCycle(cycle, currentName)
  if (index < 0 || !cycle.length) return false
  return sameMapName(cycle[(index + 1) % cycle.length], nextName)
}

function advanceLearningMapCycle(cycle: string[], currentName: string, nextName: string) {
  const currentCycle = dedupeMapCycle(cycle)
  if (currentCycle.length < 2) return dedupeMapCycle([currentName, nextName])
  if (sameMapName(currentCycle[currentCycle.length - 1], currentName)) {
    if (sameMapName(currentCycle[0], nextName) && currentCycle.length >= 3) return currentCycle
    if (!currentCycle.some((item) => sameMapName(item, nextName))) return [...currentCycle, nextName]
    return dedupeMapCycle([currentName, nextName])
  }
  if (dailyMapPairMatchesCycle(currentCycle, currentName, nextName)) return currentCycle
  if (currentCycle.length >= 2 && sameMapName(currentCycle[0], nextName) && !currentCycle.some((item) => sameMapName(item, currentName))) {
    return [...currentCycle, currentName]
  }
  return dedupeMapCycle([currentName, nextName])
}

function learningCycleIsClosed(cycle: string[], currentName: string, nextName: string) {
  return cycle.length >= 3 && sameMapName(cycle[cycle.length - 1], currentName) && sameMapName(cycle[0], nextName)
}

function isSameApiPair(state: DailyMapPoolState, current: MapRotationEntry, nextEntry: MapRotationEntry) {
  return !!state.lastCurrentStart
    && state.lastCurrentStart === (current.start || 0)
    && sameMapName(state.lastCurrent, current.mapName)
    && sameMapName(state.lastNext, nextEntry.mapName)
}

function learningMapPoolAllowsTentativeForecast(poolState: DailyMapPoolState) {
  return !['临近赛季更新', '赛季已变化', '地图池变化', '未返回完整', '名称缺失'].some((token) => poolState.reason.includes(token))
}

function rotationDurationSeconds(entry: MapRotationEntry | null) {
  if (!entry?.start || !entry.end) return 0
  return Math.max(0, entry.end - entry.start)
}

function dailyMapSeasonKey(seasonInfo: SeasonInfo | null) {
  if (!seasonInfo) return ''
  if (seasonInfo.seasonNumber !== null && seasonInfo.seasonNumber !== undefined) return `S${seasonInfo.seasonNumber}:${seasonInfo.seasonName || ''}`
  if (seasonInfo.startIso || seasonInfo.endIso) return `${seasonInfo.startIso}:${seasonInfo.endIso}`
  return ''
}

function isInSeasonMapPoolLockWindow(seasonInfo: SeasonInfo | null, now: Date, fallbackEndIso: string) {
  const endIso = seasonInfo?.endIso || fallbackEndIso
  if (!endIso) return false
  const end = Date.parse(endIso)
  if (!Number.isFinite(end)) return false
  const current = now.getTime()
  return current >= end - SEASON_MAP_POOL_LOCK_BEFORE_END_SECS * 1000 && current <= end + SEASON_MAP_POOL_LOCK_AFTER_END_SECS * 1000
}

function formatBeijingTime(seconds: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(seconds * 1000))
}

function formatBeijingDay(date: Date) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function formatBeijingDateTime(date: Date) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`
}

function getFirstInt(data: any, ...candidates: string[]) {
  if (!data || typeof data !== 'object') return null
  for (const candidate of candidates) {
    const value = toInt(data[candidate])
    if (value !== null) return value
  }
  const normalized = new Set(candidates.map((candidate) => normalizeKeyName(candidate)))
  return findFirstIntByCandidates(data, normalized)
}

function findFirstIntByCandidates(value: any, normalizedCandidates: Set<string>): number | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const numeric = findFirstIntByCandidates(item, normalizedCandidates)
      if (numeric !== null) return numeric
    }
    return null
  }

  if (!value || typeof value !== 'object') return null
  for (const [key, nested] of Object.entries(value)) {
    if (normalizedCandidates.has(normalizeKeyName(key))) {
      const numeric = toInt(nested)
      if (numeric !== null) return numeric
    }
  }
  for (const nested of Object.values(value)) {
    const numeric = findFirstIntByCandidates(nested, normalizedCandidates)
    if (numeric !== null) return numeric
  }
  return null
}

type SeasonReference = {
  seasonNumber: number
  seasonName: string
  seasonUrl: string
}

function extractSeasonReferences(html: string): SeasonReference[] {
  const blocks = Array.from(html.matchAll(/<script\s+type="application\/ld\+json">(.*?)<\/script>/gis)).map((match) => match[1])
  const references: SeasonReference[] = []
  for (const block of blocks) {
    const trimmed = block.trim()
    if (!trimmed) continue
    let parsed: any
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    const candidates = Array.isArray(parsed) ? parsed : [parsed]
    for (const item of candidates) {
      const elements = Array.isArray(item?.itemListElement) ? item.itemListElement : []
      for (const element of elements) {
        const [seasonNumber, seasonName] = parseSeasonName(String(element?.name ?? ''))
        if (seasonNumber === null) continue
        references.push({
          seasonNumber,
          seasonName,
          seasonUrl: String(element?.url ?? ''),
        })
      }
    }
  }
  return references
}

function parseApexStatusCurrentSeasonInfo(html: string, now = new Date()): SeasonInfo {
  const [seasonNumber, seasonName] = extractApexStatusSeasonTitle(html)
  const startTimestamp = extractApexStatusStartTimestamp(html)
  const start = startTimestamp ? new Date(startTimestamp * 1000) : null
  const end = start ? new Date(start.getTime() + 91 * 24 * 60 * 60 * 1000) : null

  const startIso = start ? toIso(start) : ''
  const endIso = end ? toIso(end) : ''

  return {
    seasonNumber,
    seasonName,
    startDate: start ? formatBeijingDate(start) : '未知',
    endDate: end ? formatBeijingDate(end) : '未知',
    timezone: 'Asia/Shanghai',
    updateTimeHint: '',
    source: 'apexlegendsstatus.com',
    seasonUrl: 'https://apexlegendsstatus.com/new-season-countdown',
    startIso,
    endIso,
    statusText: seasonStatusText(startIso, endIso, now),
  }
}

function extractApexStatusSeasonTitle(html: string): [number | null, string] {
  const titleMatch =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<title[^>]*>(.*?)<\/title>/is)
    || html.match(/Countdown to Season\s+\d+[^<\n]*/i)
  const title = String(titleMatch?.[1] ?? titleMatch?.[0] ?? '')
  const match = title.match(/Season\s+(\d+)(?::|\s+[·•-])?\s*([^<"]*)/i)
  if (!match) return [null, '']
  return [toInt(match[1]), match[2].replace(/^[-:·•\s]+/, '').trim()]
}

function extractApexStatusStartTimestamp(html: string) {
  const match =
    html.match(/\bstartTime\s*=\s*(\d{10})\b/i)
    || html.match(/"startTime"\s*:\s*(\d{10})/i)
  return toInt(match?.[1])
}

function toIso(date: Date) {
  return date.toISOString().replace('.000Z', 'Z')
}

function formatBeijingDate(date: Date) {
  const beijing = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${beijing.getUTCFullYear()}-${pad(beijing.getUTCMonth() + 1)}-${pad(beijing.getUTCDate())} ${pad(beijing.getUTCHours())}:${pad(beijing.getUTCMinutes())} 北京时间`
}

function seasonStatusText(startIso: string, endIso: string, now = new Date()) {
  const start = new Date(startIso).getTime()
  const end = new Date(endIso).getTime()
  const current = now.getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '未知'
  if (current < start) return '未开始'
  if (current > end) return '已结束'
  return '进行中'
}

function parseCurrentSeason(html: string): SeasonInfo {
  let seasonNumber: number | null = null
  let seasonName = ''
  let startDate = '未知'
  let endDate = '未知'
  let timezone = '未知'
  let updateTimeHint = '未知'
  let seasonUrl = ''
  let startIso = ''
  let endIso = ''

  if (html) {
    const jsonldBlocks = Array.from(html.matchAll(/<script\s+type="application\/ld\+json">(.*?)<\/script>/gis)).map((match) => match[1])
    ;[seasonNumber, seasonName, seasonUrl] = extractSeasonFromJsonLd(jsonldBlocks)

    if (seasonNumber === null || !seasonName) {
      const match = html.match(/Season\s+(\d+)\s+[·•路-]\s+([^\n]+?)\s+(?:is live now|Started)/i)
      if (match) {
        seasonNumber = toInt(match[1])
        seasonName = match[2].trim()
      }
    }

    endIso = extractCountdownTarget(html) || ''
    if (endIso) endDate = formatIsoDate(endIso)

    const dateMatch = html.match(/Started\s+([A-Za-z]{3}\s+\d{1,2})\s+(\d{4})\s+Ends\s+([A-Za-z]{3}\s+\d{1,2})\s+(\d{4})/is)
    if (dateMatch) {
      startDate = `${dateMatch[1]} ${dateMatch[2]}`
      endDate = `${dateMatch[3]} ${dateMatch[4]}`
    }

    const timezoneMatch = html.match(/Timezone\s+[·•路-]\s+([^\n]+)/i)
    if (timezoneMatch) timezone = cleanTimezone(timezoneMatch[1])

    const updateMatch = html.match(/Respawn\s+deploys\s+all\s+major\s+updates\s+at\s+([^\n.]+)/i)
    if (updateMatch) updateTimeHint = updateMatch[1].trim()
  }

  return {
    seasonNumber,
    seasonName,
    startDate,
    endDate,
    timezone,
    updateTimeHint,
    source: 'apexseasons.online',
    seasonUrl,
    startIso,
    endIso,
    statusText: seasonStatusText(startIso, endIso),
  }
}

function extractSeasonFromJsonLd(blocks: string[]): [number | null, string, string] {
  let bestNumber: number | null = null
  let bestName = ''
  let bestUrl = ''
  let bestPosition: number | null = null

  for (const block of blocks) {
    const trimmed = block.trim()
    if (!trimmed) continue
    let parsed: any
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    const candidates = Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object') : [parsed]
    for (const item of candidates) {
      if (item?.['@type'] !== 'ItemList') continue
      const elements = Array.isArray(item.itemListElement) ? item.itemListElement : []
      for (const element of elements) {
        if (!element || typeof element !== 'object') continue
        const [number, title] = parseSeasonName(String(element.name ?? ''))
        if (number === null) continue
        const position = toInt(element.position)
        if (bestPosition === null || (position !== null && position < bestPosition)) {
          bestPosition = position
          bestNumber = number
          bestName = title
          bestUrl = String(element.url ?? '')
        }
      }
    }
  }

  return [bestNumber, bestName, bestUrl]
}

function parseSeasonName(text: string): [number | null, string] {
  const match = text.match(/Season\s+(\d+)\s+[·•路-]\s+(.+)/i)
  if (!match) return [null, '']
  return [toInt(match[1]), match[2].trim()]
}

function applySeasonPageOverrides(seasonInfo: SeasonInfo, html: string) {
  if (!html) return
  const [startIso, endIso] = extractEventDatesFromJsonLd(html)
  if (startIso) {
    seasonInfo.startIso = startIso
    seasonInfo.startDate = formatIsoDate(startIso)
  }
  if (endIso) {
    seasonInfo.endIso = endIso
    seasonInfo.endDate = formatIsoDate(endIso)
  }

  const start = extractDate(html, 'Start Date')
  const end = extractDate(html, 'End Date')
  if (start) seasonInfo.startDate = start
  if (end) seasonInfo.endDate = end

  if (seasonInfo.startDate === '未知' || seasonInfo.endDate === '未知') {
    const match = html.match(/Started\s+([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}).*?Ends\s+([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/is)
    if (match) {
      seasonInfo.startDate = match[1].trim()
      seasonInfo.endDate = match[2].trim()
    }
  }

  const timezoneMatch = html.match(/Timezone\s*:?\s*([^\n<]+)/i)
  if (timezoneMatch) {
    seasonInfo.timezone = cleanTimezone(timezoneMatch[1])
  } else if (startIso?.endsWith('Z')) {
    seasonInfo.timezone = 'UTC'
  }
}

function extractEventDatesFromJsonLd(html: string): [string | null, string | null] {
  const blocks = Array.from(html.matchAll(/<script\s+type="application\/ld\+json">(.*?)<\/script>/gis)).map((match) => match[1])
  for (const block of blocks) {
    const trimmed = block.trim()
    if (!trimmed) continue
    let parsed: any
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    const items = Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object') : [parsed]
    for (const item of items) {
      if (item?.['@type'] === 'Event') {
        return [String(item.startDate ?? '') || null, String(item.endDate ?? '') || null]
      }
    }
  }
  return [null, null]
}

function formatIsoDate(value: string) {
  try {
    const iso = value.endsWith('Z') ? value.replace('Z', '+00:00') : value
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return value
    return date.toISOString().replace('T', ' ').slice(0, 16)
  } catch {
    return value
  }
}

function cleanTimezone(value: string) {
  return value.replace(/<!-- -->/g, ' ').replace(/^[·•路-]/, '').replace(/\s+/g, ' ').trim() || '未知'
}

function extractCountdownTarget(html: string) {
  const arrayMatch = html.match(/targetDate"\s*:\s*\[0\s*,\s*"([^"]+)"\]/i)
  if (arrayMatch) return arrayMatch[1].trim()
  const plainMatch = html.match(/targetDate"\s*:\s*"([^"]+)"/i)
  return plainMatch?.[1].trim() || null
}

function extractDate(html: string, label: string) {
  const safeLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = html.match(new RegExp(`${safeLabel}\\s*:?\\s*([A-Za-z]{3,9}\\s+\\d{1,2},?\\s+\\d{4})`, 'i'))
  return match?.[1].trim() || null
}
