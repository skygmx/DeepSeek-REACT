export function parseUploadedDocumentText(upload) {
  return upload.buffer.toString('utf8').replace(/^\uFEFF/, '')
}
