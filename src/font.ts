import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { GlobalFonts } from '@napi-rs/canvas'
import { LoggerLike } from './shared'

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

export type FontStatus = {
  available: boolean
  source: 'system' | 'cache' | 'missing'
  path: string | null
}

export const DEFAULT_FONT_FILE_NAME = 'NotoSansCJKsc-Regular.otf'
export const DEFAULT_FONT_SHA256 = '2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b'
export const DEFAULT_FONT_DOWNLOAD_URL = 'https://raw.githubusercontent.com/moeneri/apexrankwatch-assets/font-v1/fonts/NotoSansCJKsc-Regular.otf'

export class FontManager {
  private downloadAttempted = false

  constructor(private readonly options: {
    dataDir: string
    enabled: boolean
    downloadUrl?: string
    expectedSha256?: string
    fileName?: string
    maxBytes?: number
    systemFontPaths?: string[]
    logger: LoggerLike
    fetcher?: Fetcher
  }) {}

  get cachePath() {
    return resolve(this.options.dataDir, 'fonts', this.options.fileName || DEFAULT_FONT_FILE_NAME)
  }

  async status(): Promise<FontStatus> {
    const systemFont = this.resolveSystemFontPath()
    if (systemFont) {
      this.registerFont(systemFont)
      return { available: true, source: 'system', path: systemFont }
    }

    const cached = await this.resolveCachedFontPath()
    if (cached) {
      this.registerFont(cached)
      return { available: true, source: 'cache', path: cached }
    }

    return { available: false, source: 'missing', path: null }
  }

  async download(force = false): Promise<string | null> {
    const cached = await this.resolveCachedFontPath()
    if (cached) return cached
    if (!force && !this.options.enabled) return null
    if (!force && this.downloadAttempted) return null
    this.downloadAttempted = true

    const url = String(this.options.downloadUrl || DEFAULT_FONT_DOWNLOAD_URL).trim()
    if (!url) return null
    const response = await (this.options.fetcher || fetch)(url)
    if (!response.ok) throw new Error(`字体下载失败: HTTP ${response.status}`)
    const contentLength = response.headers.get('content-length')
    const maxBytes = this.options.maxBytes ?? 20 * 1024 * 1024
    if (contentLength && Number(contentLength) > maxBytes) throw new Error('字体文件超过允许大小')
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > maxBytes) throw new Error('字体文件超过允许大小')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (sha256 !== (this.options.expectedSha256 || DEFAULT_FONT_SHA256).toLowerCase()) {
      throw new Error('字体文件 SHA256 校验失败')
    }

    await mkdir(dirname(this.cachePath), { recursive: true })
    const tmpPath = `${this.cachePath}.tmp`
    await writeFile(tmpPath, bytes)
    await rename(tmpPath, this.cachePath)
    this.registerFont(this.cachePath)
    this.options.logger.info(`Apex Rank Watch 已下载中文字体缓存：${this.cachePath}`)
    return this.cachePath
  }

  async ensureAvailable() {
    const current = await this.status()
    if (current.available) return current
    if (this.options.enabled) {
      try {
        await this.download(false)
      } catch (error: any) {
        this.options.logger.warn(`中文字体自动下载失败：${error?.message || error}`)
      }
    }
    return this.status()
  }

  private resolveSystemFontPath() {
    for (const path of this.options.systemFontPaths || defaultSystemFontPaths()) {
      try {
        if (existsSync(path)) return path
      } catch {
        continue
      }
    }
    return ''
  }

  private async resolveCachedFontPath() {
    try {
      if (!existsSync(this.cachePath)) return ''
      const bytes = await readFile(this.cachePath)
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      if (sha256 === (this.options.expectedSha256 || DEFAULT_FONT_SHA256).toLowerCase()) return this.cachePath
      await unlink(this.cachePath).catch(() => {})
      this.options.logger.warn('Apex Rank Watch 字体缓存校验失败，已删除损坏文件')
    } catch (error: any) {
      this.options.logger.warn(`Apex Rank Watch 字体缓存读取失败：${error?.message || error}`)
    }
    return ''
  }

  private registerFont(path: string) {
    try {
      GlobalFonts.registerFromPath(path, 'Noto Sans CJK SC')
      GlobalFonts.registerFromPath(path, 'Microsoft YaHei')
    } catch {
      // Font registration is best effort; canvas can still fall back to system fonts.
    }
  }
}

function defaultSystemFontPaths() {
  return [
    'C:\\Windows\\Fonts\\msyh.ttc',
    'C:\\Windows\\Fonts\\simhei.ttf',
    'C:\\Windows\\Fonts\\simsun.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf',
    '/usr/share/fonts/truetype/noto/NotoSansCJKsc-Regular.otf',
    '/usr/share/fonts/opentype/source-han-sans/SourceHanSansSC-Regular.otf',
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
    '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf',
    '/System/Library/Fonts/PingFang.ttc',
    '/System/Library/Fonts/STHeiti Light.ttc',
    '/Library/Fonts/Arial Unicode.ttf',
  ]
}
