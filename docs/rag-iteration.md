# RAG 后端链路迭代方案

## 目标

本次迭代先打通后端 RAG 链路，验证文档上传、文档入库、文本切分、向量化、向量存储和向量检索的完整闭环。

第一版不做前端上传页面，不改现有聊天 prompt，不接入 LangChain chain/agent，不改现有聊天和会话 CRUD 逻辑。

## 迭代边界

### 本次包含

- 新增后端文档上传入口：`POST /api/documents`。
- 接口按二进制上传预留，面向后续真实文件上传流程。
- 新增 RAG 模块目录：`apps/server/src/modules/rag/`。
- 新增文档业务表，用于记录文档状态、归属、上传者和索引结果。
- 新增向量 chunk 表，存放 LangChain 切分后的 chunk 和 embedding 向量。
- LangChain 负责文本切分、embedding 调用、向量入库和相关向量检索。
- embedding 模型先保留接口，待模型选型后接入具体 provider。
- 用户隔离按现有 workspace 模型实现。

### 本次不包含

- 不实现前端上传页面。
- 不定义完整的文档校验、接收和解析规则。
- 不支持 PDF、Word、网页等复杂解析能力。
- 不把 RAG 结果注入现有 `/ws/chat` prompt。
- 不引入 LangChain prompt template、chain、agent 或 workflow。
- 不修改 `chatRepository`、`sessionService` 等现有数据库 CRUD 行为。

## 接口设计

### 上传文档

```text
POST /api/documents
Content-Type: multipart/form-data
```

第一版只预留接口和服务边界。文档校验、上传字段、大小限制、编码识别和解析规则后续单独补充。

预期语义：

```text
二进制文档上传
-> 后端解析为文本
-> 写入文档记录
-> 调用 LangChain 切分文本
-> 调用 embedding 模型生成向量
-> 写入向量 chunk 表
-> 更新文档索引状态
```

### 检索文档

```text
POST /api/documents/search
```

第一版作为后端调试接口，用于验证向量检索是否能按当前 workspace 返回相关 chunk。

检索时必须由后端注入 workspace 过滤条件，不接受前端传入 `workspaceId`。

## 模块设计

目录使用 `rag`，贴合当前后端分层：

```text
apps/server/src/modules/rag/
  ragRouter.js
  ragRepository.js
  ragIngestionService.js
  ragRetriever.js
  ragVectorStore.js
  embeddings/
    createRagEmbeddings.js
```

职责划分：

- `ragRouter.js`：挂载 `POST /api/documents` 和检索调试接口。
- `ragRepository.js`：维护文档业务表，不参与现有聊天 CRUD。
- `ragIngestionService.js`：编排文档记录、文本切分、向量入库和状态更新。
- `ragRetriever.js`：封装向量检索，统一 workspace 过滤。
- `ragVectorStore.js`：集中初始化 LangChain `PGVectorStore`。
- `createRagEmbeddings.js`：保留 embedding provider 工厂接口。

运行时装配继续放在 `src/app/createServerRuntime.js`，保持依赖集中注入，不把 RAG 依赖散落到入口文件。

## 数据库设计

RAG 使用当前项目同一个 PostgreSQL 数据库，即 `DATABASE_URL` 指向的数据库。项目已有 pgvector 扩展，不新建独立数据库。

### 文档业务表

建议新增 `documents` 表：

```sql
CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  title text NOT NULL,
  filename text NOT NULL,
  content_type text NOT NULL,
  byte_size integer NOT NULL,
  content_hash text NOT NULL,
  status text NOT NULL
    CHECK (status IN ('indexing', 'ready', 'failed', 'deleted')),
  chunk_count integer NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
```

建议索引：

```sql
CREATE INDEX documents_workspace_status_idx
  ON documents (workspace_id, status, updated_at DESC);

CREATE INDEX documents_created_by_user_id_idx
  ON documents (created_by_user_id);

CREATE UNIQUE INDEX documents_workspace_content_hash_idx
  ON documents (workspace_id, content_hash)
  WHERE status <> 'deleted';
```

### 向量 chunk 表

建议新增 `document_vector_chunks` 表，由 LangChain `PGVectorStore` 写入 chunk 内容和向量。

表名和列名使用服务端常量，不接受用户输入：

```text
tableName: document_vector_chunks
idColumnName: id
vectorColumnName: vector
contentColumnName: content
metadataColumnName: metadata
```

为了贴合当前 workspace 业务模型，向量表需要保留真实隔离字段：

```sql
workspace_id uuid NOT NULL
document_id uuid NOT NULL
created_by_user_id uuid
```

这些字段用于排查、删除、过滤和后续索引优化。metadata 中也同步写入同名信息，供 LangChain filter 使用。

## 用户隔离

用户隔离按 workspace 实现，而不是只按 user 实现。

依据是当前业务已经存在：

- `workspaces`
- `workspace_members`
- `conversations.workspace_id`
- session 中的 `workspace.id`

上传文档时：

```text
sessionService.ensureWorkspace()
-> 使用 session.workspace.id 写 documents.workspace_id
-> 使用 session.user.id 写 documents.created_by_user_id
```

检索向量时：

```js
{
  workspaceId: session.workspace.id
}
```

如果后续支持指定文档内检索，再追加：

```js
{
  workspaceId: session.workspace.id,
  documentId
}
```

前端不能传入或覆盖 `workspaceId`、`createdByUserId`。

## LangChain 使用边界

LangChain 负责：

- `RecursiveCharacterTextSplitter` 文本切分。
- embedding provider 的统一接口。
- `PGVectorStore.addDocuments()` 向量入库。
- `PGVectorStore.similaritySearchWithScore()` 相关向量检索。

项目自己负责：

- 文档上传接口。
- 文档校验和解析规则。
- 文档业务状态。
- workspace 权限和用户隔离。
- 数据库迁移。
- 现有聊天消息和会话 CRUD。
- 现有 DeepSeek 流式聊天 prompt。

## 切分和检索配置

第一版建议配置：

```text
RAG_CHUNK_SIZE=1000
RAG_CHUNK_OVERLAP=200
RAG_RETRIEVE_LIMIT=5
RAG_DISTANCE_STRATEGY=cosine
```

切分器建议：

```js
new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 200,
  separators: [
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
  ],
})
```

检索默认返回 top 5：

```js
vectorStore.similaritySearchWithScore(query, 5, {
  workspaceId: session.workspace.id,
})
```

embedding 模型未确定前，不创建 HNSW 索引。HNSW 需要明确向量维度，等模型选型后再补索引和重建策略。

## embedding 接口预留

第一版只保留工厂接口：

```js
export function createRagEmbeddings(config) {
  if (!config.provider) {
    throw new Error('缺少 RAG_EMBEDDING_PROVIDER 配置');
  }

  throw new Error(`不支持的 RAG_EMBEDDING_PROVIDER：${config.provider}`);
}
```

模型未接入时：

- 上传链路不能伪造向量。
- 索引阶段失败时更新文档状态为 `failed`。
- 错误信息写入 `documents.error_message`。

## 处理流程

```text
POST /api/documents
-> 获取当前 session 和 workspace
-> 接收二进制文件
-> 解析文本
-> 写入 documents(status=indexing)
-> LangChain 切分文本
-> LangChain 生成 embedding
-> LangChain 写入 document_vector_chunks
-> 更新 documents(status=ready, chunk_count)
```

失败流程：

```text
任意步骤失败
-> documents.status = failed
-> documents.error_message = 错误原因
-> 接口返回明确错误
```

## 验证计划

实现后需要验证：

- 后端 JS 语法检查通过。
- `pnpm lint` 通过。
- `pnpm build` 通过。
- `pnpm db:migrate` 通过。
- 未配置 embedding provider 时，上传接口 fail fast，不写假向量。
- 接入 embedding provider 后，`POST /api/documents` 能写入文档和 chunk。
- 检索接口只能返回当前 workspace 的 chunk。
- 现有 `/api/conversations`、`/ws/chat`、`/ws/asr` 行为不受影响。
