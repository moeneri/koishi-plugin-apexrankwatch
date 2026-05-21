import { formatPlatform, formatRank, translateState } from '../shared'
import type { ApexPlayerStats } from '../shared'
import { resolveLegendAsset, resolveLogoAsset, resolveRankAsset, resolveStatusAsset } from './asset-resolver'
import type { RankChangeCardDocument } from './panel-types'

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

export async function buildRankChangeCardDocument(params: {
  player: ApexPlayerStats & { displayName?: string }
  oldScore: number
  newScore: number
  platform: string
  isSeasonReset: boolean
}): Promise<RankChangeCardDocument> {
  const { player, oldScore, newScore, platform, isSeasonReset } = params
  const displayName = String(player.displayName || player.name || '未知玩家').trim() || '未知玩家'
  const rankLabel = formatRank(player.rankName, player.rankDiv) || '未知'
  const diff = newScore - oldScore
  const deltaLabel = diff > 0 ? `+${diff}` : `${diff}`
  const directionLabel = isSeasonReset ? '赛季重置' : diff > 0 ? '上升' : '下降'
  const stateLabel = translateState(player.currentState || (player.isOnline ? '在线' : '离线'))
  const globalRank = rankPercent(player.globalRankPercent)
  const heroLabel = player.selectedLegend || '未知'

  return {
    header: {
      title: 'Apex 排位分数变化',
      subtitle: '原分数、当前分数与变动结果',
      timestamp: `时间：${nowText()}`,
      logoDataUri: await resolveLogoAsset(),
    },
    topCards: [
      {
        label: '玩家',
        value: displayName,
        secondary: player.uid ? `UID ${player.uid}` : 'UID 未知',
        badgeText: '人',
      },
      {
        label: '平台',
        value: formatPlatform(platform || player.platform),
        badgeText: '台',
      },
      {
        label: '段位',
        value: rankLabel,
        rankImageUrl: await resolveRankAsset(player.rankName || '未知', player.rankDiv || 0),
        rankFallbackText: rankLabel.slice(0, 1) || '段',
      },
    ],
    deltaPanel: {
      oldScoreLabel: `${oldScore}`,
      newScoreLabel: `${newScore}`,
      deltaLabel,
      directionLabel,
      detailLabel: isSeasonReset ? `下降 ${Math.abs(diff)} 分` : `${diff > 0 ? '上升' : '下降'} ${Math.abs(diff)} 分`,
      variant: isSeasonReset ? 'warn' : diff > 0 ? 'gain' : 'loss',
      notice: isSeasonReset ? '检测到大幅度分数下降，可能是赛季重置导致。' : undefined,
    },
    bottomCards: [
      {
        label: '全球排名',
        value: globalRank !== '未知' ? globalRank : '未知',
        badgeText: '全',
      },
      {
        label: '当前英雄',
        value: heroLabel,
        iconUrl: await resolveLegendAsset(heroLabel),
        iconAlt: 'legend',
        badgeText: '英',
      },
      {
        label: '当前状态',
        value: stateLabel,
        statusImageDataUri: await resolveStatusAsset(stateLabel),
        variant: isSeasonReset ? 'warn' : diff > 0 ? 'gain' : 'loss',
      },
    ],
  }
}
