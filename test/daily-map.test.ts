import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ApexApiClient, buildDailyMapEntriesFromPoolState, updateDailyMapPoolState } from '../src/api'
import { ApexImageRenderer } from '../src/image'
import { DailyMapPoolState, MapRotationEntry } from '../src/shared'

const logger = {
  info() {},
  warn() {},
  error(message: string) {
    throw new Error(message)
  },
}

function entry(mapName: string, start: number): MapRotationEntry {
  return {
    mapName,
    mapNameZh: mapName,
    start,
    end: start + 3600,
    remainingTimer: '',
  }
}

test('daily map pool learns a closed ranked map cycle and builds a 24 hour schedule', () => {
  let state: DailyMapPoolState = {
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

  state = updateDailyMapPoolState(state, entry('Broken Moon', 1000), entry('Kings Canyon', 4600), null, new Date('2026-05-10T00:00:00Z'))
  assert.equal(state.status, 'learning')
  assert.deepEqual(state.cycle, ['Broken Moon', 'Kings Canyon'])

  state = updateDailyMapPoolState(state, entry('Kings Canyon', 4600), entry('Storm Point', 8200), null, new Date('2026-05-10T01:00:00Z'))
  assert.equal(state.status, 'learning')
  assert.deepEqual(state.cycle, ['Broken Moon', 'Kings Canyon', 'Storm Point'])

  state = updateDailyMapPoolState(state, entry('Storm Point', 8200), entry('Broken Moon', 11800), null, new Date('2026-05-10T02:00:00Z'))
  assert.equal(state.status, 'confirmed')
  assert.deepEqual(state.cycle, ['Broken Moon', 'Kings Canyon', 'Storm Point'])

  const [schedule, note] = buildDailyMapEntriesFromPoolState(state, entry('Storm Point', 8200), entry('Broken Moon', 11800))
  assert.match(note, /闭环/)
  assert.equal(schedule.length, 24)
  assert.equal(schedule[0].mapName, 'Storm Point')
  assert.equal(schedule[0].source, 'api')
  assert.equal(schedule[1].mapName, 'Broken Moon')
})

test('daily map pool falls back to learning when season or API anchors change', () => {
  const confirmed: DailyMapPoolState = {
    seasonKey: 'S29:Overclocked',
    seasonEndIso: '2026-08-04T17:00:00Z',
    status: 'confirmed',
    cycle: ['Broken Moon', 'Kings Canyon', 'Storm Point'],
    lastCurrent: 'Storm Point',
    lastNext: 'Broken Moon',
    lastCurrentStart: 8200,
    updatedAt: 0,
    reason: 'API 已确认排位地图池闭环',
  }

  const newSeason = updateDailyMapPoolState(
    confirmed,
    entry('Broken Moon', 11800),
    entry('Kings Canyon', 15400),
    {
      seasonNumber: 30,
      seasonName: 'New Season',
      startDate: '',
      endDate: '',
      timezone: 'Asia/Shanghai',
      updateTimeHint: '',
      source: 'test',
      seasonUrl: '',
      startIso: '',
      endIso: '2026-11-04T17:00:00Z',
    },
    new Date('2026-08-05T00:00:00Z'),
  )
  assert.equal(newSeason.status, 'learning')
  assert.match(newSeason.reason, /赛季已变化/)

  const changedPool = updateDailyMapPoolState(confirmed, entry('E-District', 11800), entry('Olympus', 15400), null, new Date('2026-05-10T03:00:00Z'))
  assert.equal(changedPool.status, 'learning')
  assert.match(changedPool.reason, /地图池变化/)

  const missingAnchor = updateDailyMapPoolState(confirmed, null, entry('Broken Moon', 11800), null, new Date('2026-05-10T03:00:00Z'))
  assert.equal(missingAnchor.status, 'learning')
  assert.match(missingAnchor.reason, /未返回完整/)
  const [entries] = buildDailyMapEntriesFromPoolState(missingAnchor, null, entry('Broken Moon', 11800))
  assert.equal(entries.length, 1)
  assert.equal(entries[0].source, 'api')
})

test('fetchDailyMapSchedule keeps API anchors and infers the remaining ranked day', async () => {
  const client = new ApexApiClient({
    apiKey: 'test-key',
    timeoutMs: 1000,
    maxRetries: 0,
    debugLogging: false,
    logger,
    fetcher: async (url) => {
      assert.match(url, /maprotation/)
      return new Response(JSON.stringify({
        ranked: {
          current: { map: 'Storm Point', start: 8200, end: 11800 },
          next: { map: 'Broken Moon', start: 11800, end: 15400 },
        },
        battle_royale: {
          current: { map: 'Olympus', start: 8200, end: 11800 },
          next: { map: 'Kings Canyon', start: 11800, end: 15400 },
        },
      }), { status: 200 })
    },
  })

  const schedule = await client.fetchDailyMapSchedule('ranked', {
    seasonKey: '',
    seasonEndIso: '',
    status: 'confirmed',
    cycle: ['Broken Moon', 'Kings Canyon', 'Storm Point'],
    lastCurrent: 'Kings Canyon',
    lastNext: 'Storm Point',
    lastCurrentStart: 4600,
    updatedAt: 0,
    reason: 'API 已确认排位地图池闭环',
  })

  assert.equal(schedule.mode, 'ranked')
  assert.equal(schedule.poolState?.status, 'confirmed')
  assert.ok(schedule.entries.length > 2)
  assert.equal(schedule.entries[0].source, 'api')
  assert.match(schedule.sourceNote, /闭环/)
})

test('fetchSeasonInfo falls back to the current season source when numeric current season is missing from history source', async () => {
  const requestedUrls: string[] = []
  const client = new ApexApiClient({
    apiKey: 'test-key',
    timeoutMs: 1000,
    maxRetries: 0,
    debugLogging: false,
    logger,
    fetcher: async (url) => {
      requestedUrls.push(url)
      if (url.includes('apexseasons.online')) {
        return new Response('<html><body>No Season 29 entry yet</body></html>', { status: 200 })
      }
      if (url.includes('apexlegendsstatus.com/new-season-countdown')) {
        return new Response(
          '<html><head><meta property="og:title" content="Countdown to Season 29: Overclocked"></head><body><script>startTime = 1778019600</script></body></html>',
          { status: 200 },
        )
      }
      throw new Error(`unexpected url: ${url}`)
    },
  })

  const season = await client.fetchSeasonInfo(29)

  assert.equal(season.seasonNumber, 29)
  assert.equal(season.seasonName, 'Overclocked')
  assert.equal(season.source, 'apexlegendsstatus.com')
  assert.ok(requestedUrls.some((url) => url.includes('apexlegendsstatus.com/new-season-countdown')))
})

test('daily map schedule card renders a non-empty long PNG', async () => {
  const renderer = new ApexImageRenderer(await mkdtemp(join(tmpdir(), 'apexrankwatch-daily-map-')))
  const filePath = await renderer.renderDailyMapSchedule({
    mode: 'ranked',
    title: 'Apex 排位全天地图',
    dateLabel: '2026-05-10',
    generatedAt: '2026-05-10 12:00:00',
    sourceUrl: 'https://example.invalid',
    sourceNote: 'API 已确认排位地图池闭环',
    poolState: null,
    entries: Array.from({ length: 10 }, (_, index) => {
      const start = 1778049000 + index * 3600
      return {
        mapName: ['Broken Moon', 'Kings Canyon', 'Storm Point'][index % 3],
        mapNameZh: ['残月', '诸王峡谷', '风暴点'][index % 3],
        start,
        end: start + 3600,
        readableStart: `${String(index).padStart(2, '0')}:00`,
        readableEnd: `${String(index + 1).padStart(2, '0')}:00`,
        durationSecs: 3600,
        source: index < 2 ? 'api' : 'inferred',
      }
    }),
  })

  const image = await import('@napi-rs/canvas').then(({ loadImage }) => loadImage(filePath))
  assert.equal(image.width, 900)
  assert.ok(image.height > 900)
})
