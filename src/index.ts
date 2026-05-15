import { Context } from 'koishi'
import type { Config as PluginConfig } from './config'
import { ConfigSchema, resolveConfig } from './config'
import { ApexRankWatchRuntime } from './runtime'

export const name = 'apexrankwatch'
export const Config = ConfigSchema
export const usage = [
  '填写 Apex Legends API Key 后即可使用玩家查询、猎杀线和群监控功能。',
  '地图轮换、全天地图、赛季信息、帮助卡片和监控列表会优先以图片输出；可将 outputMode 改为 text 使用紧凑文字模式。',
  'Linux 或 Docker 环境如果缺少中文字体，可使用 /apex_download 检测并下载字体缓存。',
  '常用命令：/apexrank yumola pc、/apexrankwatch yumola pc、/apexranklist、/map、/全天地图、/apexseason current、/apexpredator pc。',
].join('\n\n')

export function apply(ctx: Context, config: PluginConfig) {
  new ApexRankWatchRuntime(ctx, resolveConfig(config))
}
