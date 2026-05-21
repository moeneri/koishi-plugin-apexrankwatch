import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DATA_URI_CACHE = new Map<string, Promise<string>>()
const FILE_URL_CACHE = new Map<string, string>()

function packageRootCandidates() {
  return [
    resolve(__dirname, '..'),
    resolve(__dirname, '..', '..'),
    resolve(process.cwd()),
  ]
}

function resolvePackageRoot() {
  for (const candidate of packageRootCandidates()) {
    if (existsSync(resolve(candidate, 'assets', 'logo.png'))) return candidate
  }
  return packageRootCandidates()[0]
}

function assetPath(...parts: string[]) {
  return resolve(resolvePackageRoot(), 'assets', ...parts)
}

function normalizeAssetToken(value: string) {
  return String(value || '').trim().replace(/[·'’\-_ ]+/g, '').toLowerCase()
}

const DIVISION_RANKS = new Set(['rookie', 'bronze', 'silver', 'gold', 'platinum', 'diamond'])

function rankIconName(rankName: string, rankDiv = 0) {
  const aliases: Record<string, string> = {
    rookie: 'rookie',
    unranked: 'rookie',
    菜鸟: 'rookie',
    novice: 'rookie',
    青铜: 'bronze',
    bronze: 'bronze',
    白银: 'silver',
    silver: 'silver',
    黄金: 'gold',
    gold: 'gold',
    白金: 'platinum',
    铂金: 'platinum',
    platinum: 'platinum',
    钻石: 'diamond',
    diamond: 'diamond',
    大师: 'master',
    master: 'master',
    猎杀: 'predator',
    apex猎杀者: 'predator',
    apexpredator: 'predator',
    predator: 'predator',
  }

  const normalized = normalizeAssetToken(rankName)
  const key = aliases[normalized] || (normalized.includes('猎杀') ? 'predator' : normalized) || 'rookie'
  const division = Number(rankDiv)
  if (DIVISION_RANKS.has(key) && Number.isInteger(division) && division >= 1 && division <= 4) {
    const divisionName = `${key}_${division}.png`
    if (existsSync(assetPath('ranks', divisionName))) return divisionName
  }
  return `${key}.png`
}

function legendIconName(legendName: string) {
  const aliases: Record<string, string> = {
    艾许: 'ash',
    ash: 'ash',
    班加罗尔: 'bangalore',
    bangalore: 'bangalore',
    寻血猎犬: 'bloodhound',
    bloodhound: 'bloodhound',
    卡特莉丝: 'catalyst',
    催化姬: 'catalyst',
    catalyst: 'catalyst',
    侵蚀: 'caustic',
    caustic: 'caustic',
    密客: 'crypto',
    crypto: 'crypto',
    暴雷: 'fuse',
    fuse: 'fuse',
    直布罗陀: 'gibraltar',
    gibraltar: 'gibraltar',
    地平线: 'horizon',
    horizon: 'horizon',
    命脉: 'lifeline',
    lifeline: 'lifeline',
    罗芭: 'loba',
    loba: 'loba',
    疯玛吉: 'mad_maggie',
    madmaggie: 'mad_maggie',
    幻象: 'mirage',
    mirage: 'mirage',
    纽卡斯尔: 'newcastle',
    newcastle: 'newcastle',
    动力小子: 'octane',
    octane: 'octane',
    探路者: 'pathfinder',
    pathfinder: 'pathfinder',
    兰伯特: 'rampart',
    rampart: 'rampart',
    亡灵: 'revenant',
    revenant: 'revenant',
    希尔: 'seer',
    seer: 'seer',
    琉雀: 'sparrow',
    麻雀: 'sparrow',
    sparrow: 'sparrow',
    瓦尔基里: 'valkyrie',
    valkyrie: 'valkyrie',
    万蒂奇: 'vantage',
    vantage: 'vantage',
    沃特森: 'wattson',
    wattson: 'wattson',
    恶灵: 'wraith',
    wraith: 'wraith',
    导管: 'conduit',
    导线管: 'conduit',
    conduit: 'conduit',
    弹道: 'ballistic',
    ballistic: 'ballistic',
    变幻: 'alter',
    alter: 'alter',
    艾克赛尔: 'axle',
    axle: 'axle',
  }

  const normalized = normalizeAssetToken(legendName)
  return `${aliases[normalized] || normalized || 'octane'}.png`
}

function statusAssetName(status: string) {
  const normalized = normalizeAssetToken(status)
  const aliases: Record<string, string> = {
    比赛中: 'in_match',
    正在比赛: 'in_match',
    游戏中: 'in_match',
    inmatch: 'in_match',
    match: 'in_match',
    在大厅: 'in_lobby',
    大厅中: 'in_lobby',
    等待中: 'in_lobby',
    inlobby: 'in_lobby',
    lobby: 'in_lobby',
    离线: 'offline',
    offline: 'offline',
  }

  let key = aliases[normalized]
  if (!key && (normalized.includes('比赛') || normalized.includes('match'))) key = 'in_match'
  if (!key && (normalized.includes('大厅') || normalized.includes('lobby'))) key = 'in_lobby'
  if (!key && (normalized.includes('离线') || normalized.includes('offline'))) key = 'offline'
  return `${key || normalized || 'offline'}.png`
}

function getMimeType(filePath: string) {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.svg') return 'image/svg+xml'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  return 'image/png'
}

async function resolveAssetDataUri(filePath: string) {
  if (!existsSync(filePath)) return ''
  const cached = DATA_URI_CACHE.get(filePath)
  if (cached) return cached

  const task = readFile(filePath)
    .then((buffer) => `data:${getMimeType(filePath)};base64,${buffer.toString('base64')}`)
    .catch(() => '')
  DATA_URI_CACHE.set(filePath, task)
  return task
}

function resolveAssetFileUrl(filePath: string) {
  if (!existsSync(filePath)) return ''
  const cached = FILE_URL_CACHE.get(filePath)
  if (cached) return cached
  const href = pathToFileURL(filePath).href
  FILE_URL_CACHE.set(filePath, href)
  return href
}

export async function resolveLogoAsset() {
  return resolveAssetDataUri(assetPath('logo.png'))
}

export async function resolveDefaultAvatarAsset() {
  return resolveAssetDataUri(assetPath('default_user_avatar.png'))
}

export async function resolveRankAsset(rankName: string, rankDiv = 0) {
  return resolveAssetFileUrl(assetPath('ranks', rankIconName(rankName, rankDiv)))
}

export async function resolveLegendAsset(legendName: string) {
  return resolveAssetFileUrl(assetPath('legends', legendIconName(legendName)))
}

export async function resolveStatusAsset(status: string) {
  return resolveAssetDataUri(assetPath('status', statusAssetName(status)))
}
