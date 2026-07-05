function toTimestamp(value) {
  return value ? new Date(value).getTime() : null
}

function toDocument(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    createdByUserId: row.created_by_user_id,
    title: row.title,
    filename: row.filename,
    contentType: row.content_type,
    byteSize: row.byte_size,
    contentHash: row.content_hash,
    status: row.status,
    chunkCount: row.chunk_count,
    errorMessage: row.error_message,
    metadata: row.metadata,
    createdAt: toTimestamp(row.created_at),
    updatedAt: toTimestamp(row.updated_at),
    deletedAt: toTimestamp(row.deleted_at),
  }
}

export function createRagRepository({ pool }) {
  async function createDocument(options) {
    const result = await pool.query(
      `
        INSERT INTO documents (
          workspace_id,
          created_by_user_id,
          title,
          filename,
          content_type,
          byte_size,
          content_hash,
          status,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'indexing', $8::jsonb)
        RETURNING *
      `,
      [
        options.workspaceId,
        options.createdByUserId,
        options.title,
        options.filename,
        options.contentType,
        options.byteSize,
        options.contentHash,
        JSON.stringify(options.metadata ?? {}),
      ],
    )

    return toDocument(result.rows[0])
  }

  async function markDocumentReady({ chunkCount, id }) {
    const result = await pool.query(
      `
        UPDATE documents
        SET status = 'ready',
            chunk_count = $2,
            error_message = NULL
        WHERE id = $1
        RETURNING *
      `,
      [id, chunkCount],
    )

    return result.rows[0] ? toDocument(result.rows[0]) : null
  }

  async function markDocumentFailed({ errorMessage, id }) {
    const result = await pool.query(
      `
        UPDATE documents
        SET status = 'failed',
            error_message = $2
        WHERE id = $1
        RETURNING *
      `,
      [id, errorMessage],
    )

    return result.rows[0] ? toDocument(result.rows[0]) : null
  }

  return {
    createDocument,
    markDocumentFailed,
    markDocumentReady,
  }
}
