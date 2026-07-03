import express from 'express'

const MAX_BODY_SIZE = 1024 * 1024

function setCorsHeaders(req, res) {
  const origin = req.headers.origin
  if (!origin) return

  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS')
  res.setHeader('Vary', 'Origin')
}

function applyCors(req, res, next) {
  setCorsHeaders(req, res)
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  next()
}

function getHttpErrorStatus(error) {
  if (error?.type === 'entity.too.large') return 413
  if (Number.isInteger(error?.status) && error.status >= 400) return error.status
  if (Number.isInteger(error?.statusCode) && error.statusCode >= 400) {
    return error.statusCode
  }

  return 500
}

function getHttpErrorMessage(error) {
  if (error?.type === 'entity.too.large') return '请求体过大'
  if (error instanceof SyntaxError && 'body' in error) {
    return '请求体不是有效 JSON'
  }

  return error instanceof Error ? error.message : '服务器错误'
}

function handleHttpError(error, req, res, next) {
  if (res.headersSent) {
    next(error)
    return
  }

  res.status(getHttpErrorStatus(error)).json({
    message: getHttpErrorMessage(error),
  })
}

export function createHttpApp({ apiRouter, staticHandler }) {
  const app = express()

  app.disable('x-powered-by')
  app.use(applyCors)
  app.use('/api', express.json({ limit: MAX_BODY_SIZE }), apiRouter)
  app.use(staticHandler)
  app.use(handleHttpError)

  return app
}
