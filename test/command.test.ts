import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from 'koishi'
import MockBot from '@koishijs/plugin-mock'
import { ApexApiClient } from '../src/api'
import { apply } from '../src'
import { FontManager } from '../src/font'

const dailySchedule = {
  mode: 'ranked',
  title: 'Apex 排位全天地图',
  dateLabel: '2026-05-10',
  generatedAt: '2026-05-10 12:00:00',
  sourceUrl: 'https://example.invalid',
  sourceNote: 'API 已确认排位地图池闭环',
  poolState: {
    seasonKey: '',
    seasonEndIso: '',
    status: 'confirmed',
    cycle: ['Broken Moon', 'Kings Canyon', 'Storm Point'],
    lastCurrent: 'Broken Moon',
    lastNext: 'Kings Canyon',
    lastCurrentStart: 1778049000,
    updatedAt: 1778050000,
    reason: 'API 已确认排位地图池闭环',
  },
  entries: [
    { mapName: 'Broken Moon', mapNameZh: '残月', start: 1778049000, end: 1778052600, readableStart: '12:00', readableEnd: '13:00', durationSecs: 3600, source: 'api' },
    { mapName: 'Kings Canyon', mapNameZh: '诸王峡谷', start: 1778052600, end: 1778056200, readableStart: '13:00', readableEnd: '14:00', durationSecs: 3600, source: 'api' },
    { mapName: 'Storm Point', mapNameZh: '风暴点', start: 1778056200, end: 1778059800, readableStart: '14:00', readableEnd: '15:00', durationSecs: 3600, source: 'inferred' },
  ],
}

test('Koishi mock sandbox executes daily map aliases as image commands', async () => {
  const originalDailyMap = (ApexApiClient.prototype as any).fetchDailyMapSchedule
  const originalSeason = ApexApiClient.prototype.fetchSeasonInfo
  ;(ApexApiClient.prototype as any).fetchDailyMapSchedule = async () => dailySchedule
  ApexApiClient.prototype.fetchSeasonInfo = async () => ({
    seasonNumber: 29,
    seasonName: 'Overclocked',
    startDate: '',
    endDate: '',
    timezone: 'Asia/Shanghai',
    updateTimeHint: '',
    source: 'test',
    seasonUrl: '',
    startIso: '',
    endIso: '',
  })

  const app = new Context()
  app.plugin(MockBot, { selfId: '514' })
  apply(app, {
    apiKey: 'test-key',
    dataDir: await mkdtemp(join(tmpdir(), 'apexrankwatch-command-')),
    checkInterval: 999,
  })

  await app.start()
  const client = app.mock.client('10001', '20002')

  try {
    assert.match((await client.receive('全天地图', 1))[0], /<img/)
    assert.match((await client.receive('今日地图', 1))[0], /<img/)
    assert.match((await client.receive('dailymap', 1))[0], /<img/)
  } finally {
    ;(client.bot as any).dispose = () => {}
    await app.stop().catch(() => {})
    ;(ApexApiClient.prototype as any).fetchDailyMapSchedule = originalDailyMap
    ApexApiClient.prototype.fetchSeasonInfo = originalSeason
  }
})

test('outputMode text makes daily map return compact text instead of image', async () => {
  const originalDailyMap = (ApexApiClient.prototype as any).fetchDailyMapSchedule
  const originalSeason = ApexApiClient.prototype.fetchSeasonInfo
  ;(ApexApiClient.prototype as any).fetchDailyMapSchedule = async () => dailySchedule
  ApexApiClient.prototype.fetchSeasonInfo = async () => ({
    seasonNumber: 29,
    seasonName: 'Overclocked',
    startDate: '',
    endDate: '',
    timezone: 'Asia/Shanghai',
    updateTimeHint: '',
    source: 'test',
    seasonUrl: '',
    startIso: '',
    endIso: '',
  })

  const app = new Context()
  app.plugin(MockBot, { selfId: '514' })
  apply(app, {
    apiKey: 'test-key',
    dataDir: await mkdtemp(join(tmpdir(), 'apexrankwatch-command-text-')),
    checkInterval: 999,
    outputMode: 'text',
  })

  await app.start()
  const client = app.mock.client('10001', '20002')

  try {
    const result = (await client.receive('全天地图', 1))[0]
    assert.match(result, /Apex 排位全天地图/)
    assert.match(result, /残月/)
    assert.doesNotMatch(result, /<img/)
  } finally {
    ;(client.bot as any).dispose = () => {}
    await app.stop().catch(() => {})
    ;(ApexApiClient.prototype as any).fetchDailyMapSchedule = originalDailyMap
    ApexApiClient.prototype.fetchSeasonInfo = originalSeason
  }
})

async function runFontCommandWithMocks(statuses: any[], download: () => Promise<string | null>) {
  const originalStatus = FontManager.prototype.status
  const originalDownload = FontManager.prototype.download
  const originalDailyMap = (ApexApiClient.prototype as any).fetchDailyMapSchedule
  const originalSeason = ApexApiClient.prototype.fetchSeasonInfo
  let statusIndex = 0
  ;(FontManager.prototype as any).status = async () => statuses[Math.min(statusIndex++, statuses.length - 1)]
  ;(FontManager.prototype as any).download = download
  ;(ApexApiClient.prototype as any).fetchDailyMapSchedule = async () => dailySchedule
  ApexApiClient.prototype.fetchSeasonInfo = async () => ({
    seasonNumber: 29,
    seasonName: 'Overclocked',
    startDate: '',
    endDate: '',
    timezone: 'Asia/Shanghai',
    updateTimeHint: '',
    source: 'test',
    seasonUrl: '',
    startIso: '',
    endIso: '',
  })

  const app = new Context()
  app.plugin(MockBot, { selfId: '514' })
  apply(app, {
    apiKey: 'test-key',
    dataDir: await mkdtemp(join(tmpdir(), 'apexrankwatch-command-font-')),
    checkInterval: 999,
    fontAutoDownload: false,
  })

  await app.start()
  const client = app.mock.client('10001', '20002')

  try {
    return (await client.receive('apex_download', 1))[0]
  } finally {
    ;(client.bot as any).dispose = () => {}
    await app.stop().catch(() => {})
    FontManager.prototype.status = originalStatus
    FontManager.prototype.download = originalDownload
    ;(ApexApiClient.prototype as any).fetchDailyMapSchedule = originalDailyMap
    ApexApiClient.prototype.fetchSeasonInfo = originalSeason
  }
}

test('apex_download command reports cached font status', async () => {
  const result = await runFontCommandWithMocks([
    { available: true, source: 'cache', path: 'data/fonts/NotoSansCJKsc-Regular.otf' },
  ], async () => null)

  assert.match(result, /中文字体检测/)
  assert.match(result, /已可用/)
  assert.match(result, /插件缓存字体/)
})

test('apex_download command reports missing font status', async () => {
  const result = await runFontCommandWithMocks([
    { available: false, source: 'missing', path: null },
    { available: false, source: 'missing', path: null },
  ], async () => null)

  assert.match(result, /中文字体检测/)
  assert.match(result, /未检测到/)
  assert.match(result, /暂未成功/)
})

test('apex_download command reports download failure clearly', async () => {
  const result = await runFontCommandWithMocks([
    { available: false, source: 'missing', path: null },
    { available: false, source: 'missing', path: null },
  ], async () => {
    throw new Error('network blocked')
  })

  assert.match(result, /中文字体检测/)
  assert.match(result, /暂未成功/)
  assert.match(result, /fontDownloadUrl/)
})
