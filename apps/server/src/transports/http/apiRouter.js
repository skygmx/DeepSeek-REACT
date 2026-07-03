import express from 'express'

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i

function sendJson(res, statusCode, payload) {
  res.status(statusCode).json(payload)
}

function sendMethodNotAllowed(res) {
  sendJson(res, 405, { message: '不支持的请求方法' })
}

function isUuid(value) {
  return uuidPattern.test(value)
}

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next)
  }
}

async function handleSession(req, res, sessionService) {
  const session = await sessionService.ensureWorkspace(req, res)
  sendJson(res, 200, session)
}

async function listConversations(req, res, services) {
  const session = await services.sessionService.ensureWorkspace(req, res)
  const conversations = await services.chatRepository.listConversations(
    session.user.id,
  )
  sendJson(res, 200, { conversations })
}

async function createConversation(req, res, services) {
  const session = await services.sessionService.ensureWorkspace(req, res)
  const body = req.body ?? {}
  const conversation = await services.chatRepository.createConversation({
    title: body.title,
    userId: session.user.id,
    workspaceId: session.workspace.id,
  })
  sendJson(res, 201, { conversation })
}

async function handleConversationMessages(req, res, services, conversationId) {
  if (!isUuid(conversationId)) {
    sendJson(res, 400, { message: '无效的对话 ID' })
    return
  }

  const session = await services.sessionService.ensureWorkspace(req, res)
  const result = await services.chatRepository.listMessages({
    conversationId,
    userId: session.user.id,
  })

  if (!result) {
    sendJson(res, 404, { message: '对话不存在或无权访问' })
    return
  }

  sendJson(res, 200, result)
}

export function createApiRouter(services) {
  const router = express.Router()

  router
    .route('/session')
    .head((req, res) => sendMethodNotAllowed(res))
    .get(
      asyncHandler((req, res) =>
        handleSession(req, res, services.sessionService),
      ),
    )
    .all((req, res) => sendMethodNotAllowed(res))

  router
    .route('/conversations')
    .head((req, res) => sendMethodNotAllowed(res))
    .get(asyncHandler((req, res) => listConversations(req, res, services)))
    .post(asyncHandler((req, res) => createConversation(req, res, services)))
    .all((req, res) => sendMethodNotAllowed(res))

  router
    .route('/conversations/:conversationId/messages')
    .head((req, res) => sendMethodNotAllowed(res))
    .get(
      asyncHandler((req, res) =>
        handleConversationMessages(
          req,
          res,
          services,
          req.params.conversationId,
        ),
      ),
    )
    .all((req, res) => sendMethodNotAllowed(res))

  router.use((req, res) => {
    sendJson(res, 404, { message: '接口不存在' })
  })

  return router
}
