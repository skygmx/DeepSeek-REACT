import './src/loadEnv.js'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { serverConfig } from './src/config.js'
import { createApiHandler } from './src/http/apiHandler.js'
import { createHttpHandler } from './src/http/httpHandler.js'
import { createStaticHandler } from './src/staticServer.js'
import { bindChatSocket } from './src/chatSocket.js'
import { bindAsrSocket } from './src/asrSocket.js'
import { createDeepSeekClient } from './src/deepseekClient.js'
import { createDoubaoAsrClient } from './src/asr/doubaoAsrClient.js'
import { createPostgresPool } from './src/db/postgres.js'
import { createChatRepository } from './src/repositories/chatRepository.js'
import { createSessionService } from './src/session/sessionService.js'

const postgresPool = createPostgresPool({
  connectionString: serverConfig.databaseUrl,
})
const chatRepository = createChatRepository({ pool: postgresPool })
const sessionService = createSessionService({ pool: postgresPool })
const staticHandler = createStaticHandler(serverConfig.distDir)
const apiHandler = createApiHandler({
  chatRepository,
  sessionService,
})
const httpServer = createServer(
  createHttpHandler({
    apiHandler,
    staticHandler,
  }),
)
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
  chatRepository,
  sessionService,
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

async function shutdown() {
  httpServer.close()
  await postgresPool.end()
}

process.once('SIGINT', () => {
  void shutdown().finally(() => process.exit(0))
})

process.once('SIGTERM', () => {
  void shutdown().finally(() => process.exit(0))
})
