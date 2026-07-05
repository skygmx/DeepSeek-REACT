# DeepSeek React Chat

React + TypeScript 前端、Express/Node.js 后端和 PostgreSQL/pgvector 数据库组成的聊天应用。当前主链路已接入服务端会话、消息存储、DeepSeek 流式转发和豆包 ASR。

## 项目结构

```text
apps/
  web/                         # React + Vite 前端
  server/                      # Express + WebSocket/API 后端
    db/
      init.sql                 # Docker 初始化 pgvector 扩展
      migrations/              # 数据库迁移
    src/
      app/                     # 服务装配和启动运行时
      config/                  # 环境变量和运行配置
      infrastructure/          # 数据库等基础设施
      integrations/            # 外部模型和第三方服务客户端
      modules/                 # chat/session/asr 等业务模块
      transports/              # HTTP 路由和 WebSocket 协议层

docker-compose.yml             # 本地 PostgreSQL/pgvector
pnpm-workspace.yaml            # pnpm workspace 配置
```

## 当前能力

- 多会话聊天，会话和消息写入 PostgreSQL。
- `/api/conversations` 返回当前 session 可访问的会话列表。
- `/api/conversations/:id/messages` 返回指定会话消息。
- `/ws/chat` 转发 DeepSeek SSE 流，并在流式输出过程中更新数据库。
- `/ws/asr` 转发麦克风 PCM 音频到豆包 ASR。
- 前端默认运行在 `http://127.0.0.1:5273`，通过 Vite proxy 访问后端。
- 后端默认运行在 `http://localhost:3109`。

## 环境变量

复制 `.env.example` 为 `.env` 后填写：

```env
DEEPSEEK_API_KEY=
PORT=3109
DATABASE_URL=postgres://user:123456@localhost:15432/deepseek_agent
VITE_DEEPSEEK_API_URL=/api
VITE_DEEPSEEK_WS_URL=/ws/chat
VITE_ASR_WS_URL=/ws/asr
RAG_EMBEDDING_PROVIDER=
RAG_EMBEDDING_MODEL=
RAG_CHUNK_SIZE=1000
RAG_CHUNK_OVERLAP=200
RAG_RETRIEVE_LIMIT=5
RAG_DISTANCE_STRATEGY=cosine
INCIDENT_FIX_ENABLED=false
INCIDENT_POLL_INTERVAL_MS=300000
INCIDENT_POLL_WINDOW_MINUTES=10
INCIDENT_FIX_BASE_BRANCH=main
INCIDENT_FIX_BRANCH_PREFIX=codex/incident-
INCIDENT_FIX_DEFAULT_OWNER=
DOUBAO_ASR_APP_KEY=
DOUBAO_ASR_ACCESS_KEY=
DOUBAO_ASR_RESOURCE_ID=volc.bigasr.sauc.duration
DOUBAO_ASR_WS_URL=wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async
```

`.env` 保留在仓库根目录，后端启动和迁移脚本会显式读取根目录 `.env`。

## 本地运行

安装依赖：

```bash
pnpm install
```

启动数据库：

```bash
docker compose up -d postgres
```

执行迁移：

```bash
pnpm db:migrate
```

分别启动前后端：

```bash
pnpm dev:server
pnpm dev:web
```

也可以同时启动：

```bash
pnpm dev
```

## 常用命令

```bash
pnpm lint
pnpm build
pnpm preview
```

提交前 Husky 会自动执行 `pnpm lint` 和 `pnpm build`。
