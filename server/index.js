import 'dotenv/config'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { serverConfig } from './src/config.js'
import { createStaticHandler } from './src/staticServer.js'
import { bindChatSocket } from './src/chatSocket.js'
import { createDeepSeekClient } from './src/deepseekClient.js'

const httpServer = createServer(createStaticHandler(serverConfig.distDir))
const wss = new WebSocketServer({
  server: httpServer,
  path: serverConfig.wsPath,
})

bindChatSocket(wss, {
  chatClient: createDeepSeekClient({
    apiKey: serverConfig.deepSeekApiKey,
    apiUrl: serverConfig.deepSeekApiUrl,
  }),
})

httpServer.listen(serverConfig.port, () => {
  console.log(`DeepSeek WebSocket server is running at http://localhost:${serverConfig.port}`)
  console.log(`WebSocket endpoint: ws://localhost:${serverConfig.port}${serverConfig.wsPath}`)
})

