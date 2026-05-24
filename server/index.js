import 'dotenv/config'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { serverConfig } from './src/config.js'
import { createStaticHandler } from './src/staticServer.js'
import { bindChatSocket } from './src/chatSocket.js'
import { bindAsrSocket } from './src/asrSocket.js'
import { createDeepSeekClient } from './src/deepseekClient.js'
import { createDoubaoAsrClient } from './src/asr/doubaoAsrClient.js'

const httpServer = createServer(createStaticHandler(serverConfig.distDir))
const chatWss = new WebSocketServer({
  noServer: true,
})
const asrWss = new WebSocketServer({
  noServer: true,
})

function getUpgradePath(request) {
  const baseUrl = `http://${request.headers.host ?? 'localhost'}`
  return new URL(request.url ?? '/', baseUrl).pathname
}

httpServer.on('upgrade', (request, socket, head) => {
  const path = getUpgradePath(request)
  const socketServer =
    path === serverConfig.wsPaths.chat
      ? chatWss
      : path === serverConfig.wsPaths.asr
        ? asrWss
        : null

  if (!socketServer) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
    socket.destroy()
    return
  }

  socketServer.handleUpgrade(request, socket, head, (ws) => {
    socketServer.emit('connection', ws, request)
  })
})

bindChatSocket(chatWss, {
  chatClient: createDeepSeekClient({
    apiKey: serverConfig.deepSeekApiKey,
    apiUrl: serverConfig.deepSeekApiUrl,
  }),
})

bindAsrSocket(asrWss, {
  asrClient: createDoubaoAsrClient({
    appKey: serverConfig.doubaoAsrAppKey,
    accessKey: serverConfig.doubaoAsrAccessKey,
    resourceId: serverConfig.doubaoAsrResourceId,
    wsUrl: serverConfig.doubaoAsrWsUrl,
  }),
})

httpServer.listen(serverConfig.port, () => {
  console.log(`DeepSeek WebSocket server is running at http://localhost:${serverConfig.port}`)
  console.log(`Chat WebSocket endpoint: ws://localhost:${serverConfig.port}${serverConfig.wsPaths.chat}`)
  console.log(`ASR WebSocket endpoint: ws://localhost:${serverConfig.port}${serverConfig.wsPaths.asr}`)
})
