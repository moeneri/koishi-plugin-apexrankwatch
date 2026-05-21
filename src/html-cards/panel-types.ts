export interface PanelHeader {
  title: string
  subtitle?: string
  timestamp?: string
  logoDataUri?: string
}

export interface PanelSummaryItem {
  label: string
  value: string
}

export interface PanelIconValueCard {
  label: string
  value: string
  secondary?: string
  iconUrl?: string
  iconAlt?: string
  badgeText?: string
}

export interface PanelAvatarCard {
  label: string
  displayName: string
  secondary?: string
  avatarDataUri?: string
}

export interface PanelRankBadgeCard {
  label: string
  value: string
  secondary?: string
  rankImageUrl?: string
  rankFallbackText?: string
}

export interface PanelStatusCard {
  label: string
  value: string
  statusImageDataUri?: string
  variant?: 'neutral' | 'gain' | 'loss' | 'warn'
}

export interface DenseListRow {
  index: number
  rankImageUrl?: string
  rankFallbackText?: string
  displayName: string
  meta: string
  legendImageUrl?: string
  legendFallbackText?: string
  legendLabel?: string
  valueLabel: string
  accent?: 'neutral' | 'gain' | 'loss' | 'warn'
}

export interface DeltaPanel {
  oldScoreLabel: string
  newScoreLabel: string
  deltaLabel: string
  directionLabel: string
  detailLabel?: string
  variant: 'gain' | 'loss' | 'warn'
  notice?: string
}

export interface PanelFooter {
  text: string
}

export interface WatchListCardDocument {
  header: PanelHeader
  summaryItems: PanelSummaryItem[]
  rows: DenseListRow[]
  footer?: PanelFooter
}

export interface PlayerRankScorePanel {
  scoreLabel: string
  rankLabel: string
  globalRankLabel: string
}

export interface PlayerRankCardDocument {
  header: PanelHeader
  heroCards: [PanelAvatarCard, PanelRankBadgeCard]
  scorePanel: PlayerRankScorePanel
  summaryCards: [PanelIconValueCard, PanelIconValueCard, PanelIconValueCard]
  footer?: PanelFooter
}

export interface RankChangeCardDocument {
  header: PanelHeader
  topCards: [PanelIconValueCard, PanelIconValueCard, PanelRankBadgeCard]
  deltaPanel: DeltaPanel
  bottomCards: [PanelIconValueCard, PanelIconValueCard, PanelStatusCard]
  footer?: PanelFooter
}
