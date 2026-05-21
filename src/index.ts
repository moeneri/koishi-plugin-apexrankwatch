import { Context } from 'koishi'
import type { Config as PluginConfig } from './config'
import { ConfigSchema, resolveConfig } from './config'
import { ApexRankWatchRuntime } from './runtime'

export const name = 'apexrankwatch'
export const inject = {
  optional: ['puppeteer'],
}
export const Config = ConfigSchema
export const usage = [
  '填写 Apex Legends API Key 后即可使用玩家查询、猎杀线和群监控功能。',
  '支持使用 /apex绑定 绑定默认账号，并通过 /apex查分 快速查询自己的绑定账号信息。',
  '支持按北京时间自然日 / 自然周统计当前群的 /apex日上分榜、/apex日掉分榜、/apex周上分榜、/apex周掉分榜。',
  '榜单支持 HTML/CSS + Puppeteer、legacy 图片和文本三种输出模式；HTML 榜单会使用独立资源目录加载字体与背景，渲染失败时可自动回退。',
  'HTML 榜单头像默认使用“添加该监控项的 QQ 用户头像”，并带有成功 / 失败分级缓存；旧历史记录若没有绑定到监控创建者，则会回退为占位头像。',
  '帮助卡、赛季卡、猎杀线卡、监控列表卡、玩家档案卡与分数变化通知卡均已接入 HTML 主链，并统一保留 legacy 图片与文本回退。',
  '在 Linux / Docker 等缺少中文字体的环境中，legacy 图片链可通过 /apex_download（或配置 fontAutoDownload）自动保障中文字体可用性。',
  '榜单背景支持 preset / css / file / url / api；其中 api 模式会发起真实 HTTP 请求，并支持 CSS、图片 URL、base64 图片或二进制图片响应。',
  '常用命令：/apexrank yumola pc、/apex查分、/apex绑定 yumola pc、/apexrankwatch yumola pc、/apexranklist、/apex日上分榜、/apex周掉分榜、/map、/apexseason current、/apexpredator pc、/apex_download。',
].join('\n\n')

export function apply(ctx: Context, config: PluginConfig) {
  new ApexRankWatchRuntime(ctx, resolveConfig(config))
}
