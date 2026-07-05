import express from 'express'
import multer from 'multer'

const rawUploadParser = express.raw({
  limit: '20mb',
  type: () => true,
})
const multipartUploadParser = multer({
  storage: multer.memoryStorage(),
}).any()

function isMultipartRequest(req) {
  return req.headers['content-type']?.includes('multipart/form-data')
}

export function parseDocumentUpload(req, res, next) {
  if (isMultipartRequest(req)) {
    multipartUploadParser(req, res, next)
    return
  }

  rawUploadParser(req, res, next)
}

export function getUploadedDocument(req) {
  const multipartFile = Array.isArray(req.files) ? req.files[0] : null
  if (multipartFile) {
    return {
      buffer: multipartFile.buffer,
      byteSize: multipartFile.size,
      contentType: multipartFile.mimetype,
      filename: multipartFile.originalname,
      title: req.body?.title,
    }
  }

  if (Buffer.isBuffer(req.body)) {
    return {
      buffer: req.body,
      byteSize: req.body.length,
      contentType: req.headers['content-type'] ?? 'application/octet-stream',
      filename: req.headers['x-filename'] ?? 'uploaded-document',
      title: req.headers['x-document-title'],
    }
  }

  throw new Error('缺少上传文档')
}
