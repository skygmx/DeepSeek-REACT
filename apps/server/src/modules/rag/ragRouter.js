import express from 'express'
import {
  getUploadedDocument,
  parseDocumentUpload,
} from './documentUploadParser.js'

function sendJson(res, statusCode, payload) {
  res.status(statusCode).json(payload)
}

function sendMethodNotAllowed(res) {
  sendJson(res, 405, { message: '不支持的请求方法' })
}

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next)
  }
}

async function uploadDocument(req, res, services) {
  const session = await services.sessionService.ensureWorkspace(req, res)
  const document = await services.ragIngestionService.ingestUploadedDocument({
    session,
    upload: getUploadedDocument(req),
  })

  sendJson(res, 201, { document })
}

async function searchDocuments(req, res, services) {
  const session = await services.sessionService.ensureWorkspace(req, res)
  const matches = await services.ragRetriever.search({
    documentId: req.body?.documentId,
    limit: req.body?.limit,
    query: req.body?.query,
    session,
  })

  sendJson(res, 200, { matches })
}

export function createRagRouter(services) {
  const router = express.Router()

  router
    .route('/')
    .head((req, res) => sendMethodNotAllowed(res))
    .post(
      parseDocumentUpload,
      asyncHandler((req, res) => uploadDocument(req, res, services)),
    )
    .all((req, res) => sendMethodNotAllowed(res))

  router
    .route('/search')
    .head((req, res) => sendMethodNotAllowed(res))
    .post(asyncHandler((req, res) => searchDocuments(req, res, services)))
    .all((req, res) => sendMethodNotAllowed(res))

  return router
}
