import { randomUUID, createHash } from 'node:crypto'
import { Document } from '@langchain/core/documents'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { parseUploadedDocumentText } from './documentTextParser.js'

const separators = [
  '\n\n',
  '\n',
  ' ',
  '.',
  ',',
  '\u200b',
  '\uff0c',
  '\u3001',
  '\uff0e',
  '\u3002',
  '',
]

function createContentHash(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function createTitle(upload) {
  return upload.title || upload.filename || '未命名文档'
}

function createChunkDocuments({ chunks, document, session }) {
  return chunks.map(
    (chunk, chunkIndex) =>
      new Document({
        pageContent: chunk,
        metadata: {
          chunkIndex,
          createdByUserId: session.user.id,
          documentId: document.id,
          filename: document.filename,
          workspaceId: session.workspace.id,
        },
      }),
  )
}

export function createRagIngestionService(options) {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkOverlap: options.config.chunkOverlap,
    chunkSize: options.config.chunkSize,
    separators,
  })

  async function indexDocument({ document, session, text }) {
    const chunks = await splitter.splitText(text)
    if (!chunks.length) {
      return options.ragRepository.markDocumentReady({
        chunkCount: 0,
        id: document.id,
      })
    }

    const vectorStore = await options.getRagVectorStore()
    const chunkDocuments = createChunkDocuments({ chunks, document, session })
    const ids = chunkDocuments.map(() => randomUUID())

    await vectorStore.addDocuments(chunkDocuments, { ids })
    return options.ragRepository.markDocumentReady({
      chunkCount: chunkDocuments.length,
      id: document.id,
    })
  }

  async function ingestUploadedDocument({ session, upload }) {
    const document = await options.ragRepository.createDocument({
      byteSize: upload.byteSize,
      contentHash: createContentHash(upload.buffer),
      contentType: upload.contentType,
      createdByUserId: session.user.id,
      filename: upload.filename,
      metadata: {},
      title: createTitle(upload),
      workspaceId: session.workspace.id,
    })

    try {
      const text = parseUploadedDocumentText(upload)
      return await indexDocument({ document, session, text })
    } catch (error) {
      const message = error instanceof Error ? error.message : '文档索引失败'
      await options.ragRepository.markDocumentFailed({
        errorMessage: message,
        id: document.id,
      })
      throw error
    }
  }

  return {
    ingestUploadedDocument,
  }
}
