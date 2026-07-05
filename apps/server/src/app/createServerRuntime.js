import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { serverConfig } from '../config/serverConfig.js'
import { createPostgresPool } from '../infrastructure/db/postgres.js'
import { createIncidentFixAiClient } from '../integrations/llm/incidentFixAiClient.js'
import { createGitMcpClient } from '../integrations/mcp/gitMcpClient.js'
import { createIncidentErrorMcpClient } from '../integrations/mcp/incidentErrorMcpClient.js'
import { createIncidentNotifyMcpClient } from '../integrations/mcp/incidentNotifyMcpClient.js'
import { createRepoMcpClient } from '../integrations/mcp/repoMcpClient.js'
import { createDeepSeekClient } from '../integrations/llm/deepseekClient.js'
import { bindAsrSocket } from '../modules/asr/asrSocket.js'
import { createDoubaoAsrClient } from '../modules/asr/doubaoAsrClient.js'
import { createChatRepository } from '../modules/chat/chatRepository.js'
import { bindChatSocket } from '../modules/chat/chatSocket.js'
import { createIncidentContextService } from '../modules/incidentFix/incidentContextService.js'
import { createIncidentFixScheduler } from '../modules/incidentFix/incidentFixScheduler.js'
import { createIncidentFixWorkflow } from '../modules/incidentFix/incidentFixWorkflow.js'
import { createIncidentOwnerResolver } from '../modules/incidentFix/incidentOwnerResolver.js'
import { createRagIngestionService } from '../modules/rag/ragIngestionService.js'
import { createRagRepository } from '../modules/rag/ragRepository.js'
import { createRagRetriever } from '../modules/rag/ragRetriever.js'
import { createRagRouter } from '../modules/rag/ragRouter.js'
import { createRagVectorStoreFactory } from '../modules/rag/ragVectorStore.js'
import { createSessionService } from '../modules/session/sessionService.js'
import { createWorkflowRepository } from '../modules/workflow/workflowRepository.js'
import { createWorkflowRunner } from '../modules/workflow/workflowRunner.js'
import { createWorkflowToolRegistry } from '../modules/workflow/workflowToolRegistry.js'
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
  const ragRepository = createRagRepository({ pool: postgresPool })
  const workflowRepository = createWorkflowRepository({ pool: postgresPool })
  const workflowRunner = createWorkflowRunner({ workflowRepository })
  const sessionService = createSessionService({ pool: postgresPool })
  const incidentTools = createWorkflowToolRegistry({
    ai: createIncidentFixAiClient(),
    error: createIncidentErrorMcpClient(),
    git: createGitMcpClient(),
    notify: createIncidentNotifyMcpClient(),
    repo: createRepoMcpClient(),
  })
  const incidentContextService = createIncidentContextService({
    tools: incidentTools,
  })
  const ownerResolver = createIncidentOwnerResolver({
    defaultOwner: serverConfig.incidentFix.defaultOwner,
  })
  const incidentFixWorkflow = createIncidentFixWorkflow({
    config: serverConfig.incidentFix,
    services: {
      incidentContextService,
      ownerResolver,
    },
    tools: incidentTools,
  })
  const incidentFixScheduler = createIncidentFixScheduler({
    config: serverConfig.incidentFix,
    tools: incidentTools,
    workflow: incidentFixWorkflow,
    workflowRepository,
    workflowRunner,
  })
  const getRagVectorStore = createRagVectorStoreFactory({
    config: serverConfig.rag,
    pool: postgresPool,
  })
  const ragIngestionService = createRagIngestionService({
    config: serverConfig.rag,
    getRagVectorStore,
    ragRepository,
  })
  const ragRetriever = createRagRetriever({
    config: serverConfig.rag,
    getRagVectorStore,
  })
  const ragRouter = createRagRouter({
    ragIngestionService,
    ragRetriever,
    sessionService,
  })
  const staticHandler = createStaticHandler(serverConfig.distDir)
  const apiRouter = createApiRouter({
    chatRepository,
    ragRouter,
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
    incidentFixScheduler.stop()
    httpServer.close()
    await postgresPool.end()
  }

  function listen() {
    incidentFixScheduler.start()
    httpServer.listen(serverConfig.port, logServerReady)
  }

  return {
    httpServer,
    listen,
    shutdown,
  }
}
