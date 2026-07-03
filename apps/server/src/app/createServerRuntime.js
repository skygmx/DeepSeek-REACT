import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { serverConfig } from '../config/serverConfig.js'
import { createPostgresPool } from '../infrastructure/db/postgres.js'
import { createDeepSeekClient } from '../integrations/llm/deepseekClient.js'
import { bindAsrSocket } from '../modules/asr/asrSocket.js'
import { createDoubaoAsrClient } from '../modules/asr/doubaoAsrClient.js'
import { createChatRepository } from '../modules/chat/chatRepository.js'
import { bindChatSocket } from '../modules/chat/chatSocket.js'
import { createSessionService } from '../modules/session/sessionService.js'
import { createApiRouter } from '../transports/http/apiRouter.js'
import { createHttpApp } from '../transports/http/createHttpApp.js'
import { createStaticHandler } from '../transports/http/staticServer.js'
import { createWebSocketUpgradeHandler } from '../transports/websocket/upgradeRouter.js'

function createWebSocketServers() {
  return {
    asrWss: new WebSocketServer({ noServer: true }),
    chatWss: new WebSocketServer({ noServer: true }),
  }
}

function bindWebSockets({ asrWss, chatRepository, chatWss, sessionService }) {
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
      accessKey: serverConfig.doubaoAsrAccessKey,
      appKey: serverConfig.doubaoAsrAppKey,
      resourceId: serverConfig.doubaoAsrResourceId,
      wsUrl: serverConfig.doubaoAsrWsUrl,
    }),
  })
}

function logServerReady() {
  console.log(
    `DeepSeek WebSocket server is running at http://localhost:${serverConfig.port}`,
  )
  console.log(
    `Chat WebSocket endpoint: ws://localhost:${serverConfig.port}${serverConfig.wsPaths.chat}`,
  )
  console.log(
    `ASR WebSocket endpoint: ws://localhost:${serverConfig.port}${serverConfig.wsPaths.asr}`,
  )
}

export function createServerRuntime() {
  const postgresPool = createPostgresPool({
    connectionString: serverConfig.databaseUrl,
  })
  const chatRepository = createChatRepository({ pool: postgresPool })
  const sessionService = createSessionService({ pool: postgresPool })
  const staticHandler = createStaticHandler(serverConfig.distDir)
  const apiRouter = createApiRouter({
    chatRepository,
    sessionService,
  })
  const httpApp = createHttpApp({
    apiRouter,
    staticHandler,
  })
  const httpServer = createServer(httpApp)
  const webSocketServers = createWebSocketServers()

  bindWebSockets({
    ...webSocketServers,
    chatRepository,
    sessionService,
  })

  httpServer.on(
    'upgrade',
    createWebSocketUpgradeHandler(
      new Map([
        [serverConfig.wsPaths.chat, webSocketServers.chatWss],
        [serverConfig.wsPaths.asr, webSocketServers.asrWss],
      ]),
    ),
  )

  async function shutdown() {
    httpServer.close()
    await postgresPool.end()
  }

  function listen() {
    httpServer.listen(serverConfig.port, logServerReady)
  }

  return {
    httpServer,
    listen,
    shutdown,
  }
}
