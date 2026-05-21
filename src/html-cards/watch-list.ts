import { formatPlatform, formatRank, formatPlayerDisplayName, translate } from '../shared'
import type { StoredPlayerRecord } from '../shared'
import { resolveLegendAsset, resolveLogoAsset, resolveRankAsset } from './asset-resolver'
import type { DenseListRow, WatchListCardDocument } from './panel-types'

const ROW_LIMIT = 8
const BEIJING_TIMEZONE = 'Asia/Shanghai'

function formatCheckedAt(value: number) {
  const raw = Number(value)
  if (!Number.isFinite(raw) || raw <= 0) return '未知时间'
  const seconds = raw > 10_000_000_000 ? raw / 1000 : raw
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: BEIJING_TIMEZONE,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(seconds * 1000))
  const get = (type: string) => parts.find((part) => part.type === type)?.value || ''
  return `${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
}

async function buildRow(index: number, player: StoredPlayerRecord): Promise<DenseListRow> {
  const displayName = player.remark
    ? formatPlayerDisplayName(player.playerName, player.remark)
    : formatPlayerDisplayName(player.playerName)
  const rankImageUrl = await resolveRankAsset(player.rankName || '未知', player.rankDiv || 0)
  const legendImageUrl = await resolveLegendAsset(player.selectedLegend || '未知')

  return {
    index,
    rankImageUrl,
    rankFallbackText: String(index),
    displayName,
    meta: `${formatPlatform(player.platform)} · ${formatCheckedAt(player.lastChecked)} · ${formatRank(player.rankName, player.rankDiv)}`,
    legendImageUrl,
    legendFallbackText: '英',
    legendLabel: translate(player.selectedLegend || '未知'),
    valueLabel: `${player.rankScore}`,
    accent: 'neutral',
  }
}

export async function buildWatchListCardDocument(params: {
  players: StoredPlayerRecord[]
  checkInterval: number
  minValidScore: number
}): Promise<WatchListCardDocument> {
  const { players, checkInterval, minValidScore } = params
  const shownPlayers = players.slice(0, ROW_LIMIT)
  const rows = await Promise.all(shownPlayers.map((player, index) => buildRow(index + 1, player)))
  const remaining = Math.max(0, players.length - shownPlayers.length)
  const footerText = remaining
    ? `已展示前 ${shownPlayers.length} 位，还有 ${remaining} 位玩家未展示`
    : '时间均为北京时间'

  return {
    header: {
      title: 'Apex 群监控列表',
      subtitle: `${players.length} 位玩家 · 每 ${checkInterval} 分钟检测一次`,
      logoDataUri: await resolveLogoAsset(),
    },
    summaryItems: [
      { label: '监控玩家', value: `${players.length} 位` },
      { label: '检测间隔', value: `${checkInterval} 分钟` },
      { label: '最低有效分', value: `${minValidScore} 分` },
    ],
    rows,
    footer: {
      text: footerText,
    },
  }
}
