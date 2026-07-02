const JSON_CONTENT_TYPE = 'application/json; charset=utf-8'
const MAX_BODY_SIZE = 1024 * 1024
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function setCorsHeaders(req, res) {
  const origin = req.headers.origin
  if (!origin) return

  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS')
  res.setHeader('Vary', 'Origin')
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': JSON_CONTENT_TYPE })
  res.end(JSON.stringify(payload))
}

function sendMethodNotAllowed(res) {
  sendJson(res, 405, { message: '不支持的请求方法' })
}

function isUuid(value) {
  return uuidPattern.test(value)
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0

  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_SIZE) throw new Error('请求体过大')
    chunks.push(chunk)
  }

  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function handleSession(req, res, sessionService) {
  if (req.method !== 'GET') {
    sendMethodNotAllowed(res)
    return
  }

  const session = await sessionService.ensureWorkspace(req, res)
  sendJson(res, 200, session)
}

async function handleConversationList(req, res, services) {
  if (req.method === 'GET') {
    const session = await services.sessionService.ensureWorkspace(req, res)
    const conversations = await services.chatRepository.listConversations(
      session.user.id,
    )
    sendJson(res, 200, { conversations })
    return
  }

  if (req.method === 'POST') {
    const session = await services.sessionService.ensureWorkspace(req, res)
    const body = await readJsonBody(req)
    const conversation = await services.chatRepository.createConversation({
      title: body.title,
      userId: session.user.id,
      workspaceId: session.workspace.id,
    })
    sendJson(res, 201, { conversation })
    return
  }

  sendMethodNotAllowed(res)
}

async function handleConversationMessages(req, res, services, conversationId) {
  if (req.method !== 'GET') {
    sendMethodNotAllowed(res)
    return
  }
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

function getConversationMessagesMatch(pathname) {
  return pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/)
}

function handleOptions(req, res) {
  setCorsHeaders(req, res)
  res.writeHead(204)
  res.end()
}

function handleApiError(res, error) {
  const message = error instanceof Error ? error.message : '服务器错误'
  const statusCode = message === '请求体过大' ? 413 : 500
  sendJson(res, statusCode, { message })
}

export function createApiHandler(services) {
  return async function handleApiRequest(req, res) {
    setCorsHeaders(req, res)
    if (req.method === 'OPTIONS') {
      handleOptions(req, res)
      return true
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    if (!url.pathname.startsWith('/api')) return false

    try {
      if (url.pathname === '/api/session') {
        await handleSession(req, res, services.sessionService)
        return true
      }

      if (url.pathname === '/api/conversations') {
        await handleConversationList(req, res, services)
        return true
      }

      const messagesMatch = getConversationMessagesMatch(url.pathname)
      if (messagesMatch) {
        await handleConversationMessages(req, res, services, messagesMatch[1])
        return true
      }

      sendJson(res, 404, { message: '接口不存在' })
      return true
    } catch (error) {
      handleApiError(res, error)
      return true
    }
  }
}

