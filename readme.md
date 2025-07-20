# koishi-plugin-apexrankwatch

[![npm](https://img.shields.io/npm/v/koishi-plugin-apexrankwatch?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-apexrankwatch)

一个用于跟踪 Apex Legends 玩家段位并自动通知段位变化的 Koishi 插件。

## 功能

📋 Apex 段位监控插件使用帮助

1️⃣ 查询玩家段位：
   命令：/apexrank 示例：/apexrank moeneri
   说明：查询指定玩家的段位、分数和状态信息

2️⃣ 添加群监控：
   命令：/apexrankwatch 示例：/apexrankwatch moeneri
   说明：添加对指定玩家的段位变化监控，当段位分数变化时会在群内通知

3️⃣ 查看群监控列表：
   命令：/apexranklist
   说明：查看当前群内已添加监控的玩家列表

4️⃣ 移除群监控：
   命令：/apexrankremove 示例：/apexrankremove moeneri
   说明：移除对指定玩家的段位监控

5️⃣ 测试插件：
   命令：/apextest
   说明：测试插件是否正常工作及消息发送

📝 参数说明：：Apex Legends 游戏中的玩家ID

⏱️ 监控说明：
   系统会每 2 分钟检查一次玩家段位变化
   当玩家段位分数发生变化时，会在群内发送通知
   分数变化异常判断：下降超过 2000 分将被视为异常
   最小有效分数：1 分以下的分数将被视为无效

- 当玩家段位发生变化时自动通知

