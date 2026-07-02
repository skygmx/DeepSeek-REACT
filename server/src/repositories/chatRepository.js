const MESSAGE_HISTORY_LIMIT = 30

function toTimestamp(value) {
  return value ? new Date(value).getTime() : null
}

function toConversation(row) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    mode: row.mode,
    defaultModel: row.default_model,
    messageCount: row.message_count,
    lastMessageId: row.last_message_id,
    lastMessageAt: toTimestamp(row.last_message_at),
    createdAt: toTimestamp(row.created_at),
    updatedAt: toTimestamp(row.updated_at),
  }
}

function toMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    kind: row.kind,
    content: row.content,
    contentFormat: row.content_format,
    status: row.status,
    timestamp: toTimestamp(row.created_at),
    completedAt: toTimestamp(row.completed_at),
    toolName: row.tool_name,
    metadata: row.metadata,
  }
}

function createTitleFromMessage(message) {
  const title = message.trim().replace(/\s+/g, ' ').slice(0, 18)
  return title || '新的对话'
}

async function getAccessibleConversation(client, conversationId, userId, options = {}) {
  const lockClause = options.lock ? 'FOR UPDATE OF c' : ''
  const result = await client.query(
    `
      SELECT c.*
      FROM conversations c
      JOIN workspace_members wm ON wm.workspace_id = c.workspace_id
      JOIN workspaces w ON w.id = c.workspace_id
      WHERE c.id = $1
        AND wm.user_id = $2
        AND wm.status = 'active'
        AND w.status = 'active'
        AND c.status <> 'deleted'
      LIMIT 1
      ${lockClause}
    `,
    [conversationId, userId],
  )

  return result.rows[0] ?? null
}

async function getHistoryMessages(client, conversationId) {
  const result = await client.query(
    `
      SELECT role, content
      FROM conversation_messages
      WHERE conversation_id = $1
        AND kind = 'message'
        AND role IN ('user', 'assistant')
        AND status = 'completed'
      ORDER BY sequence_no DESC
      LIMIT $2
    `,
    [conversationId, MESSAGE_HISTORY_LIMIT],
  )

  return result.rows
    .reverse()
    .map((row) => ({ role: row.role, content: row.content }))
}

async function insertUserMessage(client, options) {
  const result = await client.query(
    `
      INSERT INTO conversation_messages (
        conversation_id,
        role,
        kind,
        sender_user_id,
        content,
        status,
        request_id,
        completed_at
      )
      VALUES ($1, 'user', 'message', $2, $3, 'completed', $4, now())
      RETURNING *
    `,
    [
      options.conversationId,
      options.userId,
      options.content,
      options.requestId,
    ],
  )

  return result.rows[0]
}

async function insertAssistantMessage(client, options) {
  const result = await client.query(
    `
      INSERT INTO conversation_messages (
        conversation_id,
        role,
        kind,
        parent_message_id,
        content,
        status,
        request_id
      )
      VALUES ($1, 'assistant', 'message', $2, '', 'streaming', $3)
      RETURNING *
    `,
    [options.conversationId, options.parentMessageId, options.requestId],
  )

  return result.rows[0]
}

async function updateConversationAfterTurn(client, options) {
  const titleSql =
    options.messageCount === 0 ? ', title = $4' : ''
  const params = [
    options.assistantMessageId,
    options.conversationId,
    options.messageCountIncrement,
  ]

  if (options.messageCount === 0) {
    params.push(createTitleFromMessage(options.userMessage))
  }

  const result = await client.query(
    `
      UPDATE conversations
      SET
        last_message_id = $1,
        last_message_at = now(),
        message_count = message_count + $3
        ${titleSql}
      WHERE id = $2
      RETURNING *
    `,
    params,
  )

  return result.rows[0]
}

export function createChatRepository({ pool }) {
  async function listConversations(userId) {
    const result = await pool.query(
      `
        SELECT c.*
        FROM conversations c
        JOIN workspace_members wm ON wm.workspace_id = c.workspace_id
        WHERE wm.user_id = $1
          AND wm.status = 'active'
          AND c.status <> 'deleted'
        ORDER BY COALESCE(c.last_message_at, c.updated_at) DESC
      `,
      [userId],
    )

    return result.rows.map(toConversation)
  }

  async function createConversation({ userId, workspaceId, title }) {
    const result = await pool.query(
      `
        INSERT INTO conversations (workspace_id, created_by_user_id, title)
        VALUES ($1, $2, $3)
        RETURNING *
      `,
      [workspaceId, userId, title?.trim() || '新的对话'],
    )

    return toConversation(result.rows[0])
  }

  async function listMessages({ userId, conversationId, limit = 100 }) {
    const conversation = await getAccessibleConversation(
      pool,
      conversationId,
      userId,
    )
    if (!conversation) return null

    const result = await pool.query(
      `
        SELECT *
        FROM conversation_messages
        WHERE conversation_id = $1
        ORDER BY sequence_no ASC
        LIMIT $2
      `,
      [conversationId, limit],
    )

    return {
      conversation: toConversation(conversation),
      messages: result.rows.map(toMessage),
    }
  }

  async function startAssistantTurn({ userId, conversationId, content, requestId }) {
    const client = await pool.connect()

    try {
      await client.query('BEGIN')
      const conversation = await getAccessibleConversation(
        client,
        conversationId,
        userId,
        { lock: true },
      )
      if (!conversation) throw new Error('无权访问当前对话')

      const history = await getHistoryMessages(client, conversationId)
      const userMessage = await insertUserMessage(client, {
        conversationId,
        content,
        requestId,
        userId,
      })
      const assistantMessage = await insertAssistantMessage(client, {
        conversationId,
        parentMessageId: userMessage.id,
        requestId,
      })
      const updatedConversation = await updateConversationAfterTurn(client, {
        assistantMessageId: assistantMessage.id,
        conversationId,
        messageCount: conversation.message_count,
        messageCountIncrement: 2,
        userMessage: content,
      })

      await client.query('COMMIT')

      return {
        conversation: toConversation(updatedConversation),
        history,
        userMessage: toMessage(userMessage),
        assistantMessage: toMessage(assistantMessage),
      }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async function updateAssistantMessage({ id, content, status, errorMessage }) {
    const result = await pool.query(
      `
        UPDATE conversation_messages
        SET
          content = $2,
          status = $3,
          error_message = $4,
          completed_at = CASE
            WHEN $3 IN ('completed', 'failed', 'cancelled') THEN now()
            ELSE completed_at
          END
        WHERE id = $1
        RETURNING *
      `,
      [id, content, status, errorMessage ?? null],
    )

    return result.rows[0] ? toMessage(result.rows[0]) : null
  }

  return {
    createConversation,
    listConversations,
    listMessages,
    startAssistantTurn,
    updateAssistantMessage,
  }
}
