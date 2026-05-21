import { formatPlatform, formatRank, translateState } from '../shared'
import type { ApexPlayerStats } from '../shared'
import { resolveDefaultAvatarAsset, resolveLegendAsset, resolveLogoAsset, resolveRankAsset, resolveStatusAsset } from './asset-resolver'
import type { PlayerRankCardDocument } from './panel-types'

const BEIJING_TIMEZONE = 'Asia/Shanghai'

function nowText() {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: BEIJING_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date()).replace(/\//g, '-')
}

function rankPercent(value: string) {
  const text = String(value || '').trim()
  if (!text || text === '未知') return '未知'
  return text.endsWith('%') ? text : `${text}%`
}

export async function buildPlayerRankCardDocument(player: ApexPlayerStats & { displayName?: string }): Promise<PlayerRankCardDocument> {
  const displayName = String(player.displayName || player.name || '未知玩家').trim() || '未知玩家'
  const rankLabel = formatRank(player.rankName, player.rankDiv) || '未知'
  const globalRank = rankPercent(player.globalRankPercent)
  const heroLabel = player.selectedLegend || '未知'
  const stateLabel = translateState(player.currentState || (player.isOnline ? '在线' : '离线'))

  return {
    header: {
      title: 'Apex 玩家档案',
      subtitle: '玩家段位、分数、英雄与状态信息',
      timestamp: `时间：${nowText()}`,
      logoDataUri: await resolveLogoAsset(),
    },
    heroCards: [
      {
        label: '玩家信息',
        displayName,
        secondary: player.uid ? `UID ${player.uid}` : 'UID 未知',
        avatarDataUri: await resolveDefaultAvatarAsset(),
      },
      {
        label: '当前段位',
        value: rankLabel,
        rankImageUrl: await resolveRankAsset(player.rankName || '未知', player.rankDiv || 0),
        rankFallbackText: rankLabel.slice(0, 1) || '段',
      },
    ],
    scorePanel: {
      scoreLabel: `${player.rankScore}`,
      rankLabel,
      globalRankLabel: globalRank !== '未知' ? `全球前 ${globalRank}` : '全球排名未知',
    },
    summaryCards: [
      {
        label: '当前英雄',
        value: heroLabel,
        iconUrl: await resolveLegendAsset(heroLabel),
        iconAlt: 'legend',
        badgeText: '英',
      },
      {
        label: '等级 / 平台',
        value: `${player.level ?? '未知'}`,
        secondary: `平台 ${formatPlatform(player.platform)}`,
        badgeText: '等',
      },
      {
        label: '当前状态',
        value: stateLabel,
        iconUrl: await resolveStatusAsset(stateLabel),
        iconAlt: 'status',
        badgeText: '态',
      },
    ],
  }
}
