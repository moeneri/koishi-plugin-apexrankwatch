import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildLeaderboardFontFacesCss, loadLeaderboardFonts } from '../leaderboard/font-manager'
import { renderLeaderboardHtmlToBuffer } from '../leaderboard/puppeteer-renderer'
import { ensureLeaderboardResourceLayout, getLeaderboardResourceLayout, reloadLeaderboardResources } from '../leaderboard/resource-reloader'
import { buildLeaderboardBackgroundCss, resolveLeaderboardTheme } from '../leaderboard/theme'
import { buildHtmlCardDocumentHtml } from './shared-template'
import { buildPanelCardHtml } from './panel-template'
import type { PlayerRankCardDocument, RankChangeCardDocument, WatchListCardDocument } from './panel-types'
import type { HtmlCardDocument, HtmlCardRenderContext, HtmlCardResourceLayout } from './types'

function resolveHtmlCardResourceLayout(rootDir: string): HtmlCardResourceLayout {
  return getLeaderboardResourceLayout(rootDir)
}

async function buildSharedHtmlRenderState(context: HtmlCardRenderContext) {
  const browser = context.puppeteer?.browser
  if (!browser) throw new Error('puppeteer browser unavailable')

  const runtimeConfig = context.runtimeConfig || {}
  const resourceRoot = context.resourceLayout?.rootDir || runtimeConfig.resourceDir || 'data/apexrankwatch/leaderboard'
  const resourceLayout = context.resourceLayout || resolveHtmlCardResourceLayout(resourceRoot)

  await ensureLeaderboardResourceLayout(resourceLayout)
  const reloaded = await reloadLeaderboardResources({
    assetRoot: 'assets',
    layout: resourceLayout,
    defaultTitleFont: runtimeConfig.titleFont,
    defaultBodyFont: runtimeConfig.bodyFont,
    defaultNumberFont: runtimeConfig.numberFont,
    enableFontFallback: runtimeConfig.fontFallbackEnabled,
  })

  let fontState = reloaded.fontState
  if (!fontState) {
    fontState = await loadLeaderboardFonts(resourceLayout.rootDir, {
      defaultTitleFont: runtimeConfig.titleFont,
      defaultBodyFont: runtimeConfig.bodyFont,
      defaultNumberFont: runtimeConfig.numberFont,
    })
  }

  const theme = resolveLeaderboardTheme({
    themePreset: runtimeConfig.themePreset || 'apex-red',
    backgroundType: runtimeConfig.backgroundType || 'preset',
    backgroundValue: runtimeConfig.backgroundValue || '',
    customCss: runtimeConfig.customCss || '',
  })

  const backgroundCss = await buildLeaderboardBackgroundCss({
    theme,
    backgroundDir: resourceLayout.backgroundDir,
    apiKey: runtimeConfig.backgroundApiKey,
  })

  return {
    browser,
    runtimeConfig,
    resourceLayout,
    fontState,
    theme,
    backgroundCss,
    fontFacesCss: buildLeaderboardFontFacesCss(fontState.loadedFonts),
    resourceBaseHref: resolveHtmlCardResourceBaseHref(resourceLayout.rootDir),
  }
}

function resolveHtmlCardResourceBaseHref(rootDir: string) {
  const href = pathToFileURL(resolve(rootDir)).href
  return href.endsWith('/') ? href : `${href}/`
}

function renderHtmlToBuffer(browser: any, html: string, runtimeConfig: Record<string, any>, baseWidth: number) {
  return renderLeaderboardHtmlToBuffer({
    browser,
    html,
    rows: [],
    options: {
      viewportWidth: Math.max(640, baseWidth),
      deviceScaleFactor: runtimeConfig.deviceScaleFactor || 1,
      waitUntil: runtimeConfig.waitUntil || 'networkidle0',
      maxRowsPerImage: 1,
    },
  })
}

function ensureNonEmptyBuffer(bufferLike: unknown) {
  if (Buffer.isBuffer(bufferLike)) {
    if (!bufferLike.length) throw new Error('html card render returned empty buffer')
    return bufferLike
  }

  if (bufferLike instanceof Uint8Array) {
    const buffer = Buffer.from(bufferLike)
    if (!buffer.length) throw new Error('html card render returned empty buffer')
    return buffer
  }

  if (bufferLike instanceof ArrayBuffer) {
    const buffer = Buffer.from(bufferLike)
    if (!buffer.length) throw new Error('html card render returned empty buffer')
    return buffer
  }

  throw new Error('html card render returned invalid buffer')
}

/**
 * Shared HTML card renderer for help / predator / season cards.
 * Callers own the HTML -> legacy -> text fallback sequencing.
 */
export async function renderHtmlCardToBuffer(params: {
  document: HtmlCardDocument
  context: HtmlCardRenderContext
}): Promise<Buffer> {
  const { document, context } = params
  const state = await buildSharedHtmlRenderState(context)
  const html = buildHtmlCardDocumentHtml({
    document,
    theme: state.theme,
    fontFacesCss: state.fontFacesCss,
    backgroundCss: state.backgroundCss,
    resourceBaseHref: state.resourceBaseHref,
    titleFont: state.fontState.defaultTitleFont,
    bodyFont: state.fontState.defaultBodyFont,
    numberFont: state.fontState.defaultNumberFont,
    customCss: state.runtimeConfig.customCss || '',
  })

  const imageBuffer = await renderHtmlToBuffer(
    state.browser,
    html,
    state.runtimeConfig as Record<string, any>,
    state.runtimeConfig.viewportWidth || 1180,
  )

  return ensureNonEmptyBuffer(imageBuffer)
}

export async function renderHtmlMarkupToBuffer(params: {
  html: string
  context: HtmlCardRenderContext
  baseWidth?: number
}): Promise<Buffer> {
  const { html, context, baseWidth = 1180 } = params
  const state = await buildSharedHtmlRenderState(context)
  const imageBuffer = await renderHtmlToBuffer(
    state.browser,
    html,
    state.runtimeConfig as Record<string, any>,
    baseWidth,
  )
  return ensureNonEmptyBuffer(imageBuffer)
}

export async function renderPanelCardToBuffer(params: {
  mode: 'watch-list' | 'player-rank' | 'rank-change'
  document: WatchListCardDocument | PlayerRankCardDocument | RankChangeCardDocument
  context: HtmlCardRenderContext
  baseWidth?: number
  overrideBackgroundType?: 'preset' | 'css' | 'file' | 'url'
}): Promise<Buffer> {
  const { mode, document, context, baseWidth = 1180, overrideBackgroundType } = params
  const state = await buildSharedHtmlRenderState({
    ...context,
    runtimeConfig: {
      ...(context.runtimeConfig || {}),
      backgroundType: overrideBackgroundType || context.runtimeConfig?.backgroundType,
    },
  })
  const html = buildPanelCardHtml({
    mode,
    document,
    theme: state.theme,
    fontFacesCss: state.fontFacesCss,
    backgroundCss: state.backgroundCss,
    resourceBaseHref: state.resourceBaseHref,
    titleFont: state.fontState.defaultTitleFont,
    bodyFont: state.fontState.defaultBodyFont,
    numberFont: state.fontState.defaultNumberFont,
    customCss: state.runtimeConfig.customCss || '',
  })
  const imageBuffer = await renderHtmlToBuffer(
    state.browser,
    html,
    state.runtimeConfig as Record<string, any>,
    baseWidth,
  )
  return ensureNonEmptyBuffer(imageBuffer)
}
