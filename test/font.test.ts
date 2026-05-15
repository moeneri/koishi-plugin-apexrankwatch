import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { FontManager } from '../src/font'

const logger = {
  info() {},
  warn() {},
  error(message: string) {
    throw new Error(message)
  },
}

test('FontManager reports cached font, missing font, and download result deterministically', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'apexrankwatch-font-'))
  const bytes = Buffer.from('fake-font-for-test')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const manager = new FontManager({
    dataDir,
    enabled: true,
    downloadUrl: 'https://example.invalid/font.otf',
    expectedSha256: sha256,
    maxBytes: 1024,
    systemFontPaths: [],
    logger,
    fetcher: async () => new Response(bytes, { status: 200 }),
  })

  assert.equal((await manager.status()).available, false)

  const downloaded = await manager.download(true)
  assert.ok(downloaded)
  assert.deepEqual(Buffer.from(await readFile(downloaded!)), bytes)

  const status = await manager.status()
  assert.equal(status.available, true)
  assert.equal(status.source, 'cache')
})

test('FontManager rejects downloaded fonts with an invalid checksum', async () => {
  const manager = new FontManager({
    dataDir: await mkdtemp(join(tmpdir(), 'apexrankwatch-font-bad-')),
    enabled: true,
    downloadUrl: 'https://example.invalid/font.otf',
    expectedSha256: '0'.repeat(64),
    maxBytes: 1024,
    systemFontPaths: [],
    logger: { info() {}, warn() {}, error() {} },
    fetcher: async () => new Response(Buffer.from('bad-font'), { status: 200 }),
  })

  await assert.rejects(() => manager.download(true), /SHA256/)
  assert.equal((await manager.status()).available, false)
})
