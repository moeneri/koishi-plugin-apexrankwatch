import type { LeaderboardTemplateTheme } from '../leaderboard/resource-types'
import type {
  DenseListRow,
  PanelAvatarCard,
  PanelFooter,
  PanelHeader,
  PanelIconValueCard,
  PanelRankBadgeCard,
  PanelStatusCard,
  PanelSummaryItem,
  PlayerRankCardDocument,
  RankChangeCardDocument,
  WatchListCardDocument,
} from './panel-types'

function escapeHtml(value: string) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderLogo(dataUri?: string) {
  if (!dataUri) return '<div class="apex-panel-logo-text">A</div>'
  return `<img class="apex-panel-logo-image" src="${escapeHtml(dataUri)}" alt="logo" />`
}

function renderHeader(header: PanelHeader) {
  return `<header class="apex-panel-header">
    <div class="apex-panel-logo">${renderLogo(header.logoDataUri)}</div>
    <div class="apex-panel-header-main">
      <h1 class="apex-panel-title">${escapeHtml(header.title)}</h1>
      ${header.subtitle ? `<div class="apex-panel-subtitle">${escapeHtml(header.subtitle)}</div>` : ''}
      ${header.timestamp ? `<div class="apex-panel-timestamp">${escapeHtml(header.timestamp)}</div>` : ''}
    </div>
  </header>`
}

function renderSummaryItems(items: PanelSummaryItem[]) {
  if (!items.length) return ''
  return `<section class="apex-panel-summary">${items.map((item) => `<div class="apex-panel-summary-item"><div class="apex-panel-summary-label">${escapeHtml(item.label)}</div><div class="apex-panel-summary-value">${escapeHtml(item.value)}</div></div>`).join('')}</section>`
}

function renderMedia(url?: string, alt = 'media', fallbackText = '?', className = 'apex-panel-media-image') {
  if (url) return `<img class="${className}" src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" />`
  return `<div class="apex-panel-media-fallback">${escapeHtml(fallbackText || '?')}</div>`
}

function renderAvatarCard(card: PanelAvatarCard) {
  return `<section class="apex-panel-card apex-panel-card-avatar">
    <div class="apex-panel-card-label">${escapeHtml(card.label)}</div>
    <div class="apex-panel-avatar-wrap">${renderMedia(card.avatarDataUri, 'avatar', card.displayName.slice(0, 1) || '?', 'apex-panel-avatar-image')}</div>
    <div class="apex-panel-card-value" title="${escapeHtml(card.displayName)}">${escapeHtml(card.displayName)}</div>
    ${card.secondary ? `<div class="apex-panel-card-secondary">${escapeHtml(card.secondary)}</div>` : ''}
  </section>`
}

function renderRankBadgeCard(card: PanelRankBadgeCard) {
  return `<section class="apex-panel-card apex-panel-card-rank">
    <div class="apex-panel-card-label">${escapeHtml(card.label)}</div>
    <div class="apex-panel-rank-wrap">${renderMedia(card.rankImageUrl, 'rank', card.rankFallbackText || card.value.slice(0, 1) || '?', 'apex-panel-rank-image')}</div>
    <div class="apex-panel-card-value">${escapeHtml(card.value)}</div>
    ${card.secondary ? `<div class="apex-panel-card-secondary">${escapeHtml(card.secondary)}</div>` : ''}
  </section>`
}

function renderIconValueCard(card: PanelIconValueCard) {
  return `<section class="apex-panel-card apex-panel-card-generic">
    <div class="apex-panel-card-label">${escapeHtml(card.label)}</div>
    <div class="apex-panel-icon-wrap">${renderMedia(card.iconUrl, card.iconAlt || card.label, card.badgeText || card.value.slice(0, 1) || '?')}</div>
    <div class="apex-panel-card-value">${escapeHtml(card.value)}</div>
    ${card.secondary ? `<div class="apex-panel-card-secondary">${escapeHtml(card.secondary)}</div>` : ''}
  </section>`
}

function renderStatusCard(card: PanelStatusCard) {
  return `<section class="apex-panel-card apex-panel-card-status apex-panel-card-status-${escapeHtml(card.variant || 'neutral')}">
    <div class="apex-panel-card-label">${escapeHtml(card.label)}</div>
    <div class="apex-panel-status-wrap">${renderMedia(card.statusImageDataUri, 'status', card.value.slice(0, 1) || '?')}</div>
    <div class="apex-panel-card-value">${escapeHtml(card.value)}</div>
  </section>`
}

function renderDenseRow(row: DenseListRow) {
  return `<div class="apex-panel-dense-row apex-panel-dense-row-${escapeHtml(row.accent || 'neutral')}">
    <div class="apex-panel-dense-rank">${renderMedia(row.rankImageUrl, 'rank', row.rankFallbackText || String(row.index), 'apex-panel-dense-rank-image')}</div>
    <div class="apex-panel-dense-main">
      <div class="apex-panel-dense-name" title="${escapeHtml(row.displayName)}">${escapeHtml(`${row.index}. ${row.displayName}`)}</div>
      <div class="apex-panel-dense-meta">${escapeHtml(row.meta)}</div>
    </div>
    <div class="apex-panel-dense-legend">
      ${renderMedia(row.legendImageUrl, 'legend', row.legendFallbackText || (row.legendLabel || '?').slice(0, 1), 'apex-panel-dense-legend-image')}
      ${row.legendLabel ? `<div class="apex-panel-dense-legend-label">${escapeHtml(row.legendLabel)}</div>` : ''}
    </div>
    <div class="apex-panel-dense-value">${escapeHtml(row.valueLabel)}</div>
  </div>`
}

function renderFooter(footer?: PanelFooter) {
  if (!footer?.text) return ''
  return `<footer class="apex-panel-footer">${escapeHtml(footer.text)}</footer>`
}

function renderWatchListBody(document: WatchListCardDocument) {
  return `${renderSummaryItems(document.summaryItems)}<section class="apex-panel-list">${document.rows.map(renderDenseRow).join('')}</section>${renderFooter(document.footer)}`
}

function renderPlayerRankBody(document: PlayerRankCardDocument) {
  const [playerCard, rankCard] = document.heroCards
  const [heroCard, levelPlatformCard, statusCard] = document.summaryCards
  const scorePanel = document.scorePanel
  return `<section class="apex-panel-grid apex-panel-grid-top">${renderAvatarCard(playerCard)}${renderRankBadgeCard(rankCard)}</section>
<section class="apex-panel-score-panel">
  <div class="apex-panel-score-label">段位分数</div>
  <div class="apex-panel-score-value">${escapeHtml(scorePanel.scoreLabel)}</div>
  <div class="apex-panel-score-meta">
    <div class="apex-panel-score-rank">当前段位：${escapeHtml(scorePanel.rankLabel)}</div>
    <div class="apex-panel-score-global">${escapeHtml(scorePanel.globalRankLabel)}</div>
  </div>
</section>
<section class="apex-panel-grid apex-panel-grid-bottom">${renderIconValueCard(heroCard)}${renderIconValueCard(levelPlatformCard)}${renderIconValueCard(statusCard)}</section>${renderFooter(document.footer)}`
}

function renderDeltaPanel(document: RankChangeCardDocument) {
  const panel = document.deltaPanel
  return `<section class="apex-panel-delta apex-panel-delta-${escapeHtml(panel.variant)}">
    <div class="apex-panel-delta-col"><div class="apex-panel-delta-label">原分数</div><div class="apex-panel-delta-value">${escapeHtml(panel.oldScoreLabel)}</div></div>
    <div class="apex-panel-delta-main"><div class="apex-panel-delta-direction">${escapeHtml(panel.directionLabel)}</div><div class="apex-panel-delta-change">${escapeHtml(panel.deltaLabel)}</div>${panel.detailLabel ? `<div class="apex-panel-delta-detail">${escapeHtml(panel.detailLabel)}</div>` : ''}${panel.notice ? `<div class="apex-panel-delta-notice">${escapeHtml(panel.notice)}</div>` : ''}</div>
    <div class="apex-panel-delta-col"><div class="apex-panel-delta-label">当前分数</div><div class="apex-panel-delta-value">${escapeHtml(panel.newScoreLabel)}</div></div>
  </section>`
}

function renderRankChangeBody(document: RankChangeCardDocument) {
  const [playerCard, platformCard, rankCard] = document.topCards
  const [globalCard, heroCard, statusCard] = document.bottomCards
  return `<section class="apex-panel-grid apex-panel-grid-three">${renderIconValueCard(playerCard)}${renderIconValueCard(platformCard)}${renderRankBadgeCard(rankCard)}</section>
${renderDeltaPanel(document)}
<section class="apex-panel-grid apex-panel-grid-three">${renderIconValueCard(globalCard)}${renderIconValueCard(heroCard)}${renderStatusCard(statusCard)}</section>${renderFooter(document.footer)}`
}

function renderBody(document: WatchListCardDocument | PlayerRankCardDocument | RankChangeCardDocument, mode: 'watch-list' | 'player-rank' | 'rank-change') {
  if (mode === 'watch-list') return renderWatchListBody(document as WatchListCardDocument)
  if (mode === 'player-rank') return renderPlayerRankBody(document as PlayerRankCardDocument)
  return renderRankChangeBody(document as RankChangeCardDocument)
}

export function buildPanelCardHtml(params: {
  mode: 'watch-list' | 'player-rank' | 'rank-change'
  document: WatchListCardDocument | PlayerRankCardDocument | RankChangeCardDocument
  theme: LeaderboardTemplateTheme
  fontFacesCss: string
  backgroundCss: string
  resourceBaseHref: string
  titleFont: string
  bodyFont: string
  numberFont: string
  customCss?: string
}) {
  const { mode, document, theme, fontFacesCss, backgroundCss, resourceBaseHref, titleFont, bodyFont, numberFont, customCss } = params
  const header = renderHeader(document.header)
  const body = renderBody(document, mode)

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<base href="${escapeHtml(resourceBaseHref)}" />
<style>
${fontFacesCss}
${backgroundCss}
:root {
  --accent: ${theme.accentColor};
  --surface: ${theme.surfaceColor};
  --text-primary: ${theme.textPrimaryColor};
  --text-secondary: ${theme.textSecondaryColor};
  --gain: ${theme.gainColor};
  --loss: ${theme.lossColor};
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 28px;
  font-family: '${bodyFont}', 'Noto Sans CJK SC', 'Microsoft YaHei', sans-serif;
  color: var(--text-primary);
}
.apex-panel-shell {
  width: 100%;
  background: rgba(10, 12, 16, 0.84);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 18px;
  overflow: hidden;
  box-shadow: 0 12px 40px rgba(0,0,0,0.28);
}
.apex-panel-header {
  display: flex;
  gap: 18px;
  align-items: center;
  padding: 24px 28px 18px 28px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
.apex-panel-logo {
  width: 84px;
  height: 84px;
  border-radius: 50%;
  overflow: hidden;
  background: rgba(255,255,255,0.06);
  display: flex;
  align-items: center;
  justify-content: center;
}
.apex-panel-logo-image,
.apex-panel-avatar-image,
.apex-panel-status-wrap img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.apex-panel-logo-text,
.apex-panel-media-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-weight: 700;
  font-size: 24px;
  background: rgba(255,255,255,0.06);
}
.apex-panel-title {
  margin: 0;
  font-size: 34px;
  line-height: 1.2;
  font-family: '${titleFont}', 'Noto Sans CJK SC', 'Microsoft YaHei', sans-serif;
}
.apex-panel-subtitle,
.apex-panel-timestamp,
.apex-panel-card-secondary,
.apex-panel-dense-meta,
.apex-panel-footer,
.apex-panel-summary-label,
.apex-panel-card-label,
.apex-panel-delta-label,
.apex-panel-delta-direction,
.apex-panel-delta-notice {
  color: var(--text-secondary);
}
.apex-panel-subtitle { margin-top: 8px; font-size: 15px; line-height: 1.6; }
.apex-panel-timestamp { margin-top: 6px; font-size: 13px; }
.apex-panel-summary {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  padding: 18px 22px 4px 22px;
}
.apex-panel-summary-item {
  min-width: 120px;
  background: rgba(255,255,255,0.06);
  padding: 10px 14px;
  border-radius: 10px;
}
.apex-panel-summary-value,
.apex-panel-card-value,
.apex-panel-delta-value,
.apex-panel-delta-change,
.apex-panel-dense-value {
  font-family: '${numberFont}', '${bodyFont}', 'Noto Sans CJK SC', sans-serif;
}
.apex-panel-summary-value { margin-top: 4px; font-size: 18px; }
.apex-panel-list,
.apex-panel-grid,
.apex-panel-delta,
.apex-panel-footer,
.apex-panel-score-panel { padding: 18px 22px 22px 22px; }
.apex-panel-grid { display: grid; gap: 14px; }
.apex-panel-grid-top { grid-template-columns: 1fr 1fr; }
.apex-panel-grid-bottom,
.apex-panel-grid-three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.apex-panel-score-panel {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 14px;
  margin: 0 22px;
  text-align: center;
}
.apex-panel-score-label {
  color: var(--text-secondary);
  font-size: 18px;
  font-weight: 600;
}
.apex-panel-score-value {
  margin-top: 12px;
  font-size: 72px;
  font-weight: 800;
  line-height: 1;
  font-family: '${numberFont}', '${bodyFont}', 'Noto Sans CJK SC', sans-serif;
}
.apex-panel-score-meta {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid rgba(255,255,255,0.08);
}
.apex-panel-score-rank,
.apex-panel-score-global {
  flex: 1;
  font-size: 15px;
  line-height: 1.6;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}
.apex-panel-card {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 14px;
  padding: 16px;
  min-width: 0;
}
.apex-panel-avatar-wrap,
.apex-panel-rank-wrap,
.apex-panel-icon-wrap,
.apex-panel-status-wrap {
  width: 96px;
  height: 96px;
  margin: 14px auto 12px auto;
  border-radius: 16px;
  overflow: hidden;
}
.apex-panel-avatar-wrap { width: 112px; height: 112px; border-radius: 50%; }
.apex-panel-rank-image,
.apex-panel-icon-wrap img,
.apex-panel-dense-rank-image,
.apex-panel-dense-legend-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.apex-panel-card-value,
.apex-panel-card-secondary,
.apex-panel-dense-name,
.apex-panel-dense-legend-label,
.apex-panel-dense-value,
.apex-panel-footer,
.apex-panel-summary-value,
.apex-panel-subtitle,
.apex-panel-timestamp,
.apex-panel-delta-notice {
  white-space: pre-wrap;
  word-break: break-word;
}
.apex-panel-card-value { font-size: 22px; font-weight: 700; line-height: 1.4; text-align: center; }
.apex-panel-card-secondary { margin-top: 6px; font-size: 14px; line-height: 1.5; text-align: center; }
.apex-panel-dense-row {
  display: grid;
  grid-template-columns: 68px minmax(240px, 1fr) 120px 140px;
  gap: 12px;
  align-items: center;
  padding: 14px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.apex-panel-dense-row:last-child { border-bottom: none; }
.apex-panel-dense-rank { width: 56px; height: 56px; }
.apex-panel-dense-name { font-size: 20px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.apex-panel-dense-meta { margin-top: 6px; font-size: 13px; line-height: 1.5; }
.apex-panel-dense-legend { text-align: center; }
.apex-panel-dense-legend-image { width: 48px; height: 48px; margin: 0 auto; display: block; }
.apex-panel-dense-legend-label { margin-top: 6px; font-size: 13px; }
.apex-panel-dense-value { justify-self: end; font-size: 24px; font-weight: 700; }
.apex-panel-delta {
  display: grid;
  grid-template-columns: 1fr 1.2fr 1fr;
  gap: 16px;
  align-items: center;
}
.apex-panel-delta-col,
.apex-panel-delta-main {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 14px;
  padding: 18px 16px;
  text-align: center;
}
.apex-panel-delta-value { margin-top: 10px; font-size: 42px; font-weight: 700; }
.apex-panel-delta-change { margin-top: 10px; font-size: 46px; font-weight: 700; }
.apex-panel-delta-detail {
  margin-top: 10px;
  font-size: 16px;
  line-height: 1.5;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}
.apex-panel-delta-gain .apex-panel-delta-change,
.apex-panel-card-status-gain .apex-panel-card-value,
.apex-panel-dense-row-gain .apex-panel-dense-value { color: var(--gain); }
.apex-panel-delta-loss .apex-panel-delta-change,
.apex-panel-card-status-loss .apex-panel-card-value,
.apex-panel-dense-row-loss .apex-panel-dense-value { color: var(--loss); }
.apex-panel-delta-warn .apex-panel-delta-change,
.apex-panel-card-status-warn .apex-panel-card-value,
.apex-panel-dense-row-warn .apex-panel-dense-value { color: #ffb247; }
.apex-panel-delta-notice { margin-top: 10px; font-size: 14px; line-height: 1.6; }
.apex-panel-footer { font-size: 13px; line-height: 1.6; }
${theme.customCss || ''}
${customCss || ''}
</style>
</head>
<body>
  <div class="apex-panel-shell">
    ${header}
    ${body}
  </div>
</body>
</html>`
}
