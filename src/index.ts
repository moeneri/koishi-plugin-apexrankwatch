import { Context, Schema } from 'koishi'
import axios from 'axios'
import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'

// 插件名称
export const name = 'apexrankwatch'

// 配置接口定义
export interface Config {
  apiKey: string
  checkInterval: number
  dataDir: string
  maxRetries: number
  timeout: number
  maxScoreDropThreshold: number
  minValidScore: number
}

// 配置模式定义
export const Config = Schema.object({
  apiKey: Schema.string().required().description('Your API Key from https://portal.apexlegendsapi.com/'),
  checkInterval: Schema.number().default(2).description('轮询时间间隔（分钟）'),
  dataDir: Schema.string().default('./data/apexrankwatch').description('数据存储目录'),
  maxRetries: Schema.number().default(3).description('API请求最大重试次数'),
  timeout: Schema.number().default(10000).description('API请求超时时间（毫秒）'),
  maxScoreDropThreshold: Schema.number().default(2000).description('最大分数下降阈值（超过此值的下降将被视为异常）'),
  minValidScore: Schema.number().default(1).description('最小有效分数（低于此值的分数将被视为无效）')
})

// 群订阅记录接口
interface GroupSubscription {
  groupId: string
  players: Record<string, PlayerData>
}

// 玩家数据接口
interface PlayerData {
  playerName: string
  rankScore: number
  rankName: string
  rankDiv: number
  lastChecked: number
  globalRankPercent?: string
  selectedLegend?: string
}

// 翻译映射表
const nameMap = {
  // Rank
  'Unranked': '菜鸟',
  'Bronze': '青铜',
  'Silver': '白银',
  'Gold': '黄金',
  'Platinum': '白金',
  'Diamond': '钻石',
  'Master': '大师',
  'Apex Predator': 'Apex 猎杀者',
  // States
  'offline': '离线',
  'online': '在线',
  'inLobby': '在大厅',
  'in Lobby': '在大厅',
  'In lobby': '在大厅',
  'inMatch': '比赛中',
  'in Match': '比赛中',
  'In match': '比赛中',
  'Offline': '离线',
  'Online': '在线',
  'true': '是',
  'false': '否',
  // 英雄名称
  'Bloodhound': '寻血猎犬',
  'Gibraltar': '直布罗陀',
  'Lifeline': '命脉',
  'Pathfinder': '探路者',
  'Wraith': '恶灵',
  'Bangalore': '班加罗尔',
  'Caustic': '侵蚀',
  'Mirage': '幻象',
  'Octane': '动力小子',
  'Wattson': '沃特森',
  'Crypto': '密客',
  'Revenant': '亡灵',
  'Loba': '罗芭',
  'Rampart': '兰伯特',
  'Horizon': '地平线',
  'Fuse': '暴雷',
  'Valkyrie': '瓦尔基里',
  'Seer': '希尔',
  'Ash': '艾许',
  'Mad Maggie': '疯玛吉',
  'Newcastle': '纽卡斯尔',
  'Vantage': '万蒂奇',
  'Catalyst': '卡特莉丝',
  'Ballistic': '弹道',
  'Conduit': '导管',
  'Alter': '变幻',
  'Sparrow': '琉雀'
}

// 翻译函数
function translate(name: string): string {
  return nameMap[name] || name
}

// 检查字符串是否包含指定模式
function containsPattern(text: string, pattern: string): boolean {
  return text.toLowerCase().includes(pattern.toLowerCase())
}

export function apply(ctx: Context, config: Config) {
  // 日志输出，帮助调试
  ctx.logger.info('Apex Legends 排名监控插件已加载')
  ctx.logger.info(`配置：检测间隔 ${config.checkInterval} 分钟`)
  
  // 检查是否有OneBot实例可用，但不强制要求
  const bots = ctx.bots.filter(bot => bot.platform === 'onebot')
  if (bots.length > 0) {
    ctx.logger.info(`找到 ${bots.length} 个OneBot实例: ${bots.map(bot => bot.selfId).join(', ')}`)
  } else {
    ctx.logger.warn('未找到可用的OneBot机器人实例，消息通知功能可能不可用')
    // 注意这里只是警告，不影响插件加载
  }

  // 创建数据目录
  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true })
  }
  
  const dataFile = path.join(config.dataDir, 'groups.json')
  let groupSubscriptions: Record<string, GroupSubscription> = {}
  
  // 创建自定义的axios实例，增强错误处理能力
  const axiosInstance = axios.create({
    timeout: config.timeout,
    httpsAgent: new https.Agent({
      rejectUnauthorized: false,
      keepAlive: true
    }),
    maxRedirects: 5,
    headers: {
      'User-Agent': 'Koishi-ApexRankWatch/1.0'
    }
  })
  
  // 加载已保存的群订阅数据
  if (fs.existsSync(dataFile)) {
    try {
      groupSubscriptions = JSON.parse(fs.readFileSync(dataFile, 'utf-8'))
    } catch (error) {
      ctx.logger.error('Failed to load group subscription data:', error)
    }
  }
  
  // 保存群订阅数据的函数
  function saveGroupData() {
    try {
      fs.writeFileSync(dataFile, JSON.stringify(groupSubscriptions), 'utf-8')
    } catch (error) {
      ctx.logger.error('Failed to save group subscription data:', error)
    }
  }
  
  // 带重试功能的API请求函数
  async function apiRequestWithRetry(url: string, params: any, maxRetries: number = config.maxRetries): Promise<any> {
    let lastError: any
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = Math.pow(2, attempt) * 1000
          ctx.logger.info(`Retrying API request (attempt ${attempt}/${maxRetries}) after ${delay}ms delay...`)
          await new Promise(resolve => setTimeout(resolve, delay))
        }
        
        const response = await axiosInstance.get(url, { params })
        return response.data
      } catch (error) {
        lastError = error
        
        const isRetriableError = error.code === 'ECONNRESET' || 
                                error.code === 'ETIMEDOUT' || 
                                error.code === 'ECONNABORTED' ||
                                (error.response && (error.response.status >= 500 || error.response.status === 429))
        
        if (isRetriableError && attempt < maxRetries) {
          ctx.logger.warn(`API request failed with error (${error.code || error.message}). Retrying...`)
          continue
        }
        
        throw error
      }
    }
    
    throw lastError
  }
  
  // 向群发送消息的函数
  async function sendGroupMessage(groupId: string, message: string): Promise<boolean> {
    // 检查是否有OneBot实例可用
    const bots = ctx.bots.filter(bot => bot.platform === 'onebot')
    if (bots.length === 0) {
      ctx.logger.warn('发送失败: 未找到可用的OneBot机器人实例')
      return false
    }
    
    for (const bot of bots) {
      try {
        // 尝试使用bot.sendMessage方法发送消息
        await bot.sendMessage(groupId, message)
        ctx.logger.info(`消息发送成功: 群 ${groupId}`)
        return true
      } catch (error) {
        ctx.logger.error(`机器人 ${bot.selfId} 发送消息失败:`, error)
        
        // 尝试备用方法
        try {
          if (bot.internal && typeof bot.internal.sendGroupMsg === 'function') {
            await bot.internal.sendGroupMsg(groupId, message)
            ctx.logger.info(`使用备用方法消息发送成功: 群 ${groupId}`)
            return true
          }
        } catch (err) {
          ctx.logger.error(`备用方法也失败:`, err)
        }
      }
    }
    
    ctx.logger.error(`所有机器人发送消息到群 ${groupId} 均失败`)
    return false
  }
  
  // 测试命令
  ctx.command('apextest')
    .action(async ({ session }) => {
      ctx.logger.info('收到apextest命令')
      
      if (session?.guildId) {
        ctx.logger.info(`在群 ${session.guildId} 中执行测试命令`)
        const success = await sendGroupMessage(session.guildId, '✅ Apex Legends 排名监控测试消息')
        if (success) {
          return '✅ Apex Legends 排名监控插件正常运行中，已发送测试消息到本群'
        } else {
          return '✅ Apex Legends 排名监控插件正常运行中，但发送消息失败，可能缺少OneBot适配器'
        }
      }
      
      return '✅ Apex Legends 排名监控插件正常运行中'
    })
  
  // 帮助命令
  ctx.command('apexrankhelp')
    .action(async () => {
      let helpText = `📋 Apex 段位监控插件使用帮助\n\n`
      
      helpText += `1️⃣ 查询玩家段位：\n`
      helpText += `   命令：/apexrank <玩家名称>\n`
      helpText += `   示例：/apexrank moeneri\n`
      helpText += `   说明：查询指定玩家的段位、分数和状态信息\n\n`
      
      helpText += `2️⃣ 添加群监控：\n`
      helpText += `   命令：/apexrankwatch <玩家名称>\n`
      helpText += `   示例：/apexrankwatch moeneri\n`
      helpText += `   说明：添加对指定玩家的段位变化监控，当段位分数变化时会在群内通知\n\n`
      
      helpText += `3️⃣ 查看群监控列表：\n`
      helpText += `   命令：/apexranklist\n`
      helpText += `   说明：查看当前群内已添加监控的玩家列表\n\n`
      
      helpText += `4️⃣ 移除群监控：\n`
      helpText += `   命令：/apexrankremove <玩家名称>\n`
      helpText += `   示例：/apexrankremove moeneri\n`
      helpText += `   说明：移除对指定玩家的段位监控\n\n`
      
      helpText += `5️⃣ 测试插件：\n`
      helpText += `   命令：/apextest\n`
      helpText += `   说明：测试插件是否正常工作及消息发送\n\n`
      
      helpText += `📝 参数说明：\n`
      helpText += `   <玩家名称>：Apex Legends 游戏中的玩家ID\n\n`
      
      helpText += `⏱️ 监控说明：\n`
      helpText += `   系统会每 ${config.checkInterval} 分钟检查一次玩家段位变化\n`
      helpText += `   当玩家段位分数发生变化时，会在群内发送通知\n`
      helpText += `   分数变化异常判断：下降超过 ${config.maxScoreDropThreshold} 分将被视为异常\n`
      helpText += `   最小有效分数：${config.minValidScore} 分以下的分数将被视为无效\n`
      
      return helpText
    })
  
  // 查询玩家段位命令
  ctx.command('apexrank <player:string>')
    .example('apexrank moeneri')
    .action(async ({ session }, playerName) => {
      ctx.logger.info(`收到apexrank命令，参数：${playerName}`)
      if (!playerName) {
        return '请提供玩家名称，例如: /apexrank moeneri'
      }
      
      try {
        const playerData = await getPlayerStats(playerName)
        
        if (playerData.rankScore < config.minValidScore) {
          return `查询到 ${playerName} 的分数为 ${playerData.rankScore}，低于最小有效分数 ${config.minValidScore}，可能是API错误，请稍后再试`
        }
        
        return formatPlayerRankText(playerData)
      } catch (error) {
        ctx.logger.error('API查询失败:', error)
        return `查询失败: ${error.message || '未知错误'}\n可能是网络问题或API密钥无效，请稍后再试`
      }
    })
  
  // 添加监控命令
  ctx.command('apexrankwatch <player:string>')
    .example('apexrankwatch moeneri')
    .action(async ({ session }, playerName) => {
      ctx.logger.info(`收到apexrankwatch命令，参数：${playerName}`)
      if (!playerName) {
        return '请提供要监控的玩家名称，例如: /apexrankwatch moeneri'
      }
      
      if (!session.guildId) {
        return '此命令仅适用于群聊，请在群聊中使用'
      }
      
      try {
        const groupId = session.guildId
        const playerKey = playerName.toLowerCase()
        
        const playerData = await getPlayerStats(playerName)
        
        if (playerData.rankScore < config.minValidScore) {
          return `查询到 ${playerName} 的分数为 ${playerData.rankScore}，低于最小有效分数 ${config.minValidScore}，可能是API错误，请稍后再试`
        }
        
        if (!groupSubscriptions[groupId]) {
          groupSubscriptions[groupId] = {
            groupId,
            players: {}
          }
        }
        
        if (groupSubscriptions[groupId].players[playerKey]) {
          return `本群已经在监控 ${playerName} 的排名变化了`
        }
        
        groupSubscriptions[groupId].players[playerKey] = {
          playerName: playerName,
          rankScore: playerData.rankScore,
          rankName: playerData.rankName,
          rankDiv: playerData.rankDiv,
          globalRankPercent: playerData.globalRankPercent,
          selectedLegend: playerData.selectedLegend,
          lastChecked: Date.now()
        }
        
        saveGroupData()
        
        // 尝试发送测试消息，但不强制要求成功
        await sendGroupMessage(groupId, `✅ 测试消息: 已添加对 ${playerName} 的排名监控`)
        
        return `成功添加对 ${playerName} 的排名监控！\n当前排名: ${getRankDisplayText(playerData)}`
      } catch (error) {
        ctx.logger.error('添加群监控失败:', error)
        return `添加监控失败: ${error.message || '未知错误'}\n可能是网络问题或API密钥无效，请稍后再试`
      }
    })
  
  // 查看监控列表命令
  ctx.command('apexranklist')
    .action(async ({ session }) => {
      ctx.logger.info(`收到apexranklist命令`)
      if (!session.guildId) {
        return '此命令仅适用于群聊，请在群聊中使用'
      }
      
      const groupId = session.guildId
      
      if (!groupSubscriptions[groupId] || !groupSubscriptions[groupId].players || 
          Object.keys(groupSubscriptions[groupId].players).length === 0) {
        return '本群目前没有监控任何玩家的排名'
      }
      
      const players = groupSubscriptions[groupId].players
      
      let response = '📋 本群 Apex 排名监控列表\n\n'
      
      Object.values(players).forEach((player: PlayerData, index) => {
        const rankDisplay = player.rankDiv !== 0 ? `${player.rankName} ${player.rankDiv}` : player.rankName
        response += `${index + 1}. 👤 ${player.playerName}\n`
        response += `   🏆 段位: ${rankDisplay}\n`
        response += `   🔢 分数: ${player.rankScore}\n`
        
        if (player.globalRankPercent && player.globalRankPercent !== '未知') {
          response += `   🌎 全球排名: 前 ${player.globalRankPercent}%\n`
        }
        
        if (player.selectedLegend) {
          response += `   🎮 当前英雄: ${player.selectedLegend}\n`
        }
        
        response += `\n`
      })
      
      response += `总计: ${Object.keys(players).length} 个玩家\n`
      response += `检测间隔: ${config.checkInterval} 分钟\n`
      response += `分数下降阈值: ${config.maxScoreDropThreshold} 分\n`
      response += `最小有效分数: ${config.minValidScore} 分`
      
      return response
    })
  
  // 移除监控命令
  ctx.command('apexrankremove <player:string>')
    .example('apexrankremove moeneri')
    .action(async ({ session }, playerName) => {
      ctx.logger.info(`收到apexrankremove命令，参数：${playerName}`)
      if (!playerName) {
        return '请提供要移除监控的玩家名称，例如: /apexrankremove moeneri'
      }
      
      if (!session.guildId) {
        return '此命令仅适用于群聊，请在群聊中使用'
      }
      
      const groupId = session.guildId
      const playerKey = playerName.toLowerCase()
      
      if (!groupSubscriptions[groupId] || !groupSubscriptions[groupId].players) {
        return `本群没有监控 ${playerName} 的排名`
      }
      
      if (!groupSubscriptions[groupId].players[playerKey]) {
        return `本群没有监控 ${playerName} 的排名`
      }
      
      delete groupSubscriptions[groupId].players[playerKey]
      
      if (Object.keys(groupSubscriptions[groupId].players).length === 0) {
        delete groupSubscriptions[groupId]
      }
      
      saveGroupData()
      
      return `已移除本群对 ${playerName} 的排名监控`
    })
  
  // 定时检查排名变化
  ctx.setInterval(async () => {
    for (const groupId in groupSubscriptions) {
      const group = groupSubscriptions[groupId]
      
      for (const playerKey in group.players) {
        const player = group.players[playerKey]
        
        try {
          const playerData = await getPlayerStats(player.playerName)
          const newRankScore = playerData.rankScore
          const oldRankScore = player.rankScore
          
          const isValidScore = newRankScore >= config.minValidScore
          
          const diff = newRankScore - oldRankScore
          
          const isDroppingTooMuch = diff < 0 && Math.abs(diff) > config.maxScoreDropThreshold
          
          if (isValidScore && !isDroppingTooMuch && newRankScore !== oldRankScore) {
            const diffText = diff > 0 ? `上升 ${diff}` : `下降 ${Math.abs(diff)}`
            
            player.rankScore = newRankScore
            player.rankName = playerData.rankName
            player.rankDiv = playerData.rankDiv
            player.globalRankPercent = playerData.globalRankPercent
            player.selectedLegend = playerData.selectedLegend
            player.lastChecked = Date.now()
            
            const now = new Date()
            const dateStr = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
            
            const newRankDisplay = player.rankDiv !== 0 ? `${player.rankName} ${player.rankDiv}` : player.rankName
            
            let message = `📈 Apex 排位分数变化\n`
            message += `📅 ${dateStr}\n`
            message += `👤 ${player.playerName}\n`
            message += `🔢 原分数：${oldRankScore}\n`
            message += `🔢 当前分数：${newRankScore}\n`
            message += `🏆 段位：${newRankDisplay}\n`
            message += `📊 变动：${diffText} 分`
            
            if (playerData.globalRankPercent && playerData.globalRankPercent !== '未知') {
              message += `\n🌎 全球排名：前 ${playerData.globalRankPercent}%`
            }
            
            // 只有玩家在线时才显示当前英雄
            if (playerData.isOnline === '在线' && playerData.selectedLegend) {
              message += `\n🎮 当前英雄：${playerData.selectedLegend}`
            }
            
            // 尝试发送消息，但不影响程序运行
            try {
              await sendGroupMessage(groupId, message)
            } catch (error) {
              ctx.logger.error(`通知群 ${groupId} 失败:`, error)
            }
            
            saveGroupData()
          } else if (!isValidScore) {
            ctx.logger.warn(`玩家 ${player.playerName} 的分数 ${newRankScore} 无效，保留原分数 ${oldRankScore}`)
          } else if (isDroppingTooMuch) {
            ctx.logger.warn(`玩家 ${player.playerName} 的分数从 ${oldRankScore} 下降到 ${newRankScore}，下降幅度异常，可能是API错误`)
          }
        } catch (error) {
          ctx.logger.error(`检查玩家 ${player.playerName} 排名失败:`, error)
        }
      }
    }
  }, config.checkInterval * 60 * 1000)
  
  // 添加中间件监听消息
  ctx.middleware((session, next) => {
    if (session.content) {
      if (session.content.startsWith('apex') || session.content.startsWith('/apex')) {
        ctx.logger.info(`收到消息: ${session.content}, 来自: ${session.channelId || 'unknown'}, 类型: ${session.subtype}, 用户: ${session.userId}`)
      }
    }
    return next()
  })
  
  // 获取玩家数据
  async function getPlayerStats(playerName: string) {
    try {
      const apiUrl = `https://api.mozambiquehe.re/bridge`
      
      const data = await apiRequestWithRetry(apiUrl, {
        auth: config.apiKey,
        player: playerName,
        platform: 'PC'
      })
      
      const globalData = data.global || {}
      const realtimeData = data.realtime || {}
      const rankData = globalData.rank || {}
      
      // 解析状态文本
      const isOnlineStatus = realtimeData.isOnline === 1 ? '在线' : '离线'
      
      // 获取全球排名百分比
      const globalRankPercent = rankData.ALStopPercentGlobal || '未知'
      
      // 获取当前使用英雄
      const selectedLegend = translate(realtimeData.selectedLegend || '')
      
      // 解析并翻译当前状态文本
      let currentState = realtimeData.currentStateAsText || realtimeData.currentState || 'offline'
      
      // 如果状态包含时间信息（例如"In match (00:39)"），提取出时间信息
      let timeInfo = ''
      const matchTimeRegex = /$(\d+:\d+)$/
      const matchTime = currentState.match(matchTimeRegex)
      if (matchTime) {
        timeInfo = ` (${matchTime[1]})`
        currentState = currentState.replace(matchTimeRegex, '').trim()
      }
      
      // 翻译状态
      let translatedState = translate(currentState)
      
      // 如果找到了时间信息，添加回去
      if (timeInfo) {
        translatedState += timeInfo
      }
      
      return {
        name: globalData.name,
        uid: globalData.uid,
        platform: globalData.platform,
        level: globalData.level,
        toNextLevelPercent: globalData.toNextLevelPercent,
        rankScore: rankData.rankScore || 0,
        rankName: translate(rankData.rankName || 'Unranked'),
        rankDiv: rankData.rankDiv || 0,
        globalRankPercent: globalRankPercent,
        isOnline: isOnlineStatus,
        selectedLegend: selectedLegend,
        currentState: translatedState,
        // 添加一个字段来标识玩家是否在大厅或比赛中
        isInLobbyOrMatch: containsPattern(currentState, 'lobby') || containsPattern(currentState, 'match')
      }
    } catch (error) {
      ctx.logger.error('API 请求失败:', error)
      throw new Error('获取玩家数据失败，请检查网络连接或API密钥')
    }
  }
  
  // 获取段位显示文本
  function getRankDisplayText(playerData) {
    const rankDisplay = playerData.rankDiv !== 0 ? `${playerData.rankName} ${playerData.rankDiv}` : playerData.rankName
    return `${rankDisplay} (${playerData.rankScore}分)`
  }
  
  // 格式化玩家段位文本
  function formatPlayerRankText(playerData) {
    const now = new Date()
    const dateStr = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
    
    const rankDisplay = playerData.rankDiv !== 0 ? `${playerData.rankName} ${playerData.rankDiv}` : playerData.rankName
    
    let message = `📊 Apex 段位信息\n`
    message += `📅 ${dateStr}\n`
    message += `👤 ${playerData.name}\n`
    message += `🏆 段位：${rankDisplay}\n`
    message += `🔢 分数：${playerData.rankScore}\n`
    
    if (playerData.globalRankPercent && playerData.globalRankPercent !== '未知') {
      message += `🌎 全球排名：前 ${playerData.globalRankPercent}%\n`
    }
    
    message += `👑 等级：${playerData.level}\n`
    
    // 只有在玩家在线时才显示在线状态
    if (playerData.isOnline === '在线') {
      message += `🎮 在线状态：${playerData.isOnline}\n`
      
      // 只有在玩家在线时才显示当前使用的英雄
      if (playerData.selectedLegend) {
        message += `🎯 当前英雄：${playerData.selectedLegend}\n`
      }
      
      // 只有在玩家在大厅或比赛中时才显示当前状态
      if (playerData.isInLobbyOrMatch) {
        message += `🎯 当前状态：${playerData.currentState}`
      }
    } else {
      // 玩家离线时只显示离线状态
      message += `🎮 在线状态：${playerData.isOnline}`
    }
    
    return message
  }
}