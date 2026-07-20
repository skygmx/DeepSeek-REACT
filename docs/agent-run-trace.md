# Agent Run 过程态展示方案

## 目标

将现有 `/ws/chat` 从纯聊天流升级为 Agent Run 流。

一次用户请求仍然由 `chat:start` 发起，最终回答仍然通过 `chat:delta` 流式返回；中间的 RAG 检索、工具调用、工作流节点、提示词构建和验证过程，通过新增的离散事件 `agent:event` 推给前端。

前端在 assistant 消息内部展示执行过程：运行中默认展开，最终回答完成后默认折叠；失败、等待人工确认时保持展开。

## 当前现状

### 后端

当前 `/ws/chat` 只支持：

```text
client -> server: chat:start
client -> server: chat:cancel

server -> client: chat:accepted
server -> client: chat:delta
server -> client: chat:done
server -> client: chat:cancelled
server -> client: chat:error
```

`chatSocket` 在收到 `chat:start` 后：

```text
创建 user message 和 assistant message
-> 发送 chat:accepted
-> 调用 chatClient.streamChat
-> 持续发送 chat:delta
-> 完成 assistant message
-> 发送 chat:done
```

### 前端

`useWebSocketChat` 当前只处理聊天结果：

```text
chat:accepted  创建 user/assistant 消息
chat:delta     追加 assistant content
chat:done      完成请求
chat:error     标记失败
chat:cancelled 完成取消
```

`ChatMessage` 已经有 `kind`、`toolName`、`metadata` 字段，但前端消息列表还没有独立的 Agent 过程态结构。

## 设计边界

### 本次包含

- 复用现有 `/ws/chat` endpoint。
- 保留现有 `chat:*` 事件，保证旧逻辑兼容。
- 新增 `agent:event` 服务端事件。
- 前端新增 Agent Trace hook 和展示组件。
- 中间过程不做 token 级流式，只做离散事件。
- 最终回答继续使用现有 `chat:delta` 流式。

### 本次不包含

- 不新增 `/ws/workflow`。
- 不改变现有 `chat:start` 入参。
- 不把完整 prompt、完整日志、完整 diff 原样发给前端。
- 不要求第一版持久化全部 trace 事件；可先内存态展示，后续再入库。

## WebSocket 协议

### 客户端请求

继续使用现有请求：

```json
{
  "type": "chat:start",
  "requestId": "req_1",
  "conversationId": "conv_1",
  "message": "帮我分析这个报错"
}
```

取消请求继续使用：

```json
{
  "type": "chat:cancel",
  "requestId": "req_1"
}
```

### 服务端新增事件

新增统一事件：

```json
{
  "type": "agent:event",
  "requestId": "req_1",
  "conversationId": "conv_1",
  "messageId": "assistant_msg_1",
  "runId": "run_1",
  "event": {
    "seq": 4,
    "type": "tool:completed",
    "status": "completed",
    "title": "检索代码片段",
    "summary": "命中 5 个相关文件",
    "stepName": "locate_code",
    "toolName": "repo_search",
    "metadata": {
      "durationMs": 328,
      "matchCount": 5
    },
    "createdAt": "2026-07-05T13:00:00.000Z"
  }
}
```

`messageId` 指向本次请求创建的 assistant message。前端优先按 `messageId` 追加 trace；如果事件早于 `chat:accepted` 到达，则按 `requestId` 暂存，等 assistant message 创建后再回放。

### Agent 事件类型

第一版事件类型收敛为：

```text
agent:started
agent:completed
agent:failed

step:started
step:completed
step:failed

tool:started
tool:completed
tool:failed

rag:retrieved
ai:prompt_built
ai:output_parsed
workflow:waiting_review
```

### Agent 事件状态

```text
queued
running
completed
failed
cancelled
waiting_review
needs_human
```

### 事件字段规范

```ts
type AgentTraceEvent = {
  seq: number
  type: AgentTraceEventType
  status: AgentTraceStatus
  title: string
  summary?: string
  stepName?: string
  toolName?: string
  metadata?: Record<string, unknown>
  createdAt: string
}
```

字段约束：

- `seq`：同一次 request 内递增，用于前端稳定排序。
- `title`：用户可读的短标题。
- `summary`：可选摘要，不放大段日志。
- `metadata`：只放安全、可展示、可审计的数据。
- `metadata.promptVersion`：提示词构建事件必须带。
- `metadata.durationMs`：工具调用完成或失败时建议带。
- `metadata.preview`：日志、检索结果、diff 只放截断预览。

## 后端改造

### 1. 新增 Agent 事件工具

建议新增：

```text
apps/server/src/modules/agent/
  agentEvent.js
  agentRunContext.js
```

职责：

```js
createAgentRunContext({
  conversationId,
  messageId,
  requestId,
  sendJson,
})
```

返回：

```js
{
  emit(event),
  emitStarted(),
  emitCompleted(),
  emitFailed(error),
  nextSeq()
}
```

`emit` 内部统一补齐：

```text
type = agent:event
requestId
conversationId
messageId
runId
event.seq
event.createdAt
```

### 2. 改造 chatSocket

`handleChatStart` 创建 assistant message 后，构造 `agentRunContext`：

```text
startAssistantTurn
-> send chat:accepted
-> createAgentRunContext
-> emit agent:started
-> 执行 chat / rag / workflow / tool
-> emit agent:completed
-> send chat:done
```

失败时：

```text
handleChatFailure
-> emit agent:failed
-> send chat:error 或 chat:cancelled
```

注意顺序：

- `chat:accepted` 仍然优先发送，保证前端有 assistant message。
- `agent:event` 在 `chat:accepted` 后发送，避免前端找不到目标消息。
- 如果未来并发工具调用导致事件先到，前端仍按 `requestId` 做暂存兜底。

### 3. 包装工具调用

建议新增工具包装层：

```text
apps/server/src/modules/agent/agentToolTracer.js
```

包装 MCP 方法：

```js
traceTool({
  agentRun,
  inputPreview,
  title,
  toolName,
}, () => tools.repo.search(input))
```

自动发：

```text
tool:started
tool:completed
tool:failed
```

第一版重点包装：

```text
repo_search
repo_read_file
repo_find_references
git_apply_patch
git_run_verification_plan
rag_retrieve
```

### 4. 接入 RAG / Workflow / AI Client

RAG 检索：

```text
rag:retrieved
metadata:
  retrieveLimit
  hitCount
  documentIds
  preview
```

提示词构建：

```text
ai:prompt_built
metadata:
  promptVersion
  messageCount
  toolNames
```

AI 输出解析：

```text
ai:output_parsed
metadata:
  promptVersion
  outputType
  status
```

工作流节点：

```text
step:started
step:completed
step:failed
workflow:waiting_review
```

第一版不需要把所有内部实现都改完，可以先从 chatSocket 主链路和 incident_fix workflow 关键节点开始。

### 5. 是否持久化

第一版可以不新增数据库表，先通过 WebSocket 实时展示。

后续如果需要刷新后恢复 trace，再新增：

```text
agent_run_events
- id
- conversation_id
- message_id
- request_id
- run_id
- seq
- type
- status
- title
- summary
- step_name
- tool_name
- metadata
- created_at
```

持久化后可复用 `conversation_messages.metadata` 保存 trace 摘要：

```json
{
  "agentTraceSummary": {
    "eventCount": 12,
    "toolCallCount": 4,
    "status": "completed"
  }
}
```

## 前端改造

### 1. 类型扩展

在 `apps/web/src/types/chat.ts` 增加：

```ts
export type AgentTraceEventType =
  | 'agent:started'
  | 'agent:completed'
  | 'agent:failed'
  | 'step:started'
  | 'step:completed'
  | 'step:failed'
  | 'tool:started'
  | 'tool:completed'
  | 'tool:failed'
  | 'rag:retrieved'
  | 'ai:prompt_built'
  | 'ai:output_parsed'
  | 'workflow:waiting_review'

export type AgentTraceStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'waiting_review'
  | 'needs_human'

export interface AgentTraceEvent {
  seq: number
  type: AgentTraceEventType
  status: AgentTraceStatus
  title: string
  summary?: string
  stepName?: string
  toolName?: string
  metadata?: Record<string, unknown>
  createdAt: string
}
```

`ChatMessage` 增加：

```ts
traceEvents?: AgentTraceEvent[]
traceStatus?: AgentTraceStatus
traceCollapsed?: boolean
```

### 2. 扩展 ServerMessage

在 `useWebSocketChat.ts` 的 `ServerMessage` union 中增加：

```ts
| {
    type: 'agent:event'
    requestId: string
    conversationId: string
    messageId: string
    runId: string
    event: AgentTraceEvent
  }
```

`isTerminalMessage` 不需要把 `agent:event` 算作终态。

### 3. 新增状态更新方法

当前 hook 只有：

```ts
appendMessage
updateConversation
updateAssistantMessage
```

需要在上层 store 增加：

```ts
appendAgentTraceEvent(
  messageId: string,
  event: AgentTraceEvent,
  conversationId?: string,
): void

setAgentTraceCollapsed(
  messageId: string,
  collapsed: boolean,
  conversationId?: string,
): void
```

追加事件时：

- 按 `seq` 去重。
- 按 `seq` 排序。
- 更新 `traceStatus`。
- 收到 `agent:completed` 时默认折叠。
- 收到 `agent:failed`、`workflow:waiting_review`、`needs_human` 时默认展开。

### 4. useWebSocketChat 处理逻辑

新增分支：

```ts
if (payload.type === 'agent:event') {
  appendAgentTraceEvent(
    payload.messageId,
    payload.event,
    payload.conversationId,
  )
  return
}
```

如果 `messageId` 对应的 assistant message 尚未创建：

```text
pendingTraceEventsRef[requestId].push(payload)
```

在 `chat:accepted` 创建 assistant message 后回放。

### 5. 新增展示组件

建议目录：

```text
apps/web/src/components/agent/
  AgentTracePanel.tsx
  AgentTraceTimeline.tsx
  AgentTraceEventItem.tsx
```

`MessageList` 渲染 assistant 消息时：

```tsx
{message.traceEvents?.length ? (
  <AgentTracePanel
    collapsed={message.traceCollapsed}
    events={message.traceEvents}
    status={message.traceStatus}
    onToggleCollapsed={...}
  />
) : null}
```

展示规则：

```text
运行中：默认展开
已完成：默认折叠，展示摘要
失败：默认展开，定位到失败事件
等待人工确认：默认展开
用户手动切换折叠状态后，不再自动覆盖
```

折叠摘要示例：

```text
已完成：6 个步骤，4 次工具调用，检索 3 个文档片段
```

展开明细示例：

```text
✓ 开始分析
✓ RAG 检索：命中 3 个片段
✓ 调用 repo_search：命中 5 个文件
✓ 构建提示词：incident-fix-diagnose-v1
✓ 解析 AI 输出：ready_to_patch
```

### 6. UI 状态建议

图标和颜色语义：

```text
running        spinner / 当前态
completed      check
failed         alert
waiting_review pause / clock
needs_human    user / alert
cancelled      circle-slash
```

中间过程不要占用太大空间：

- `title` 一行展示。
- `summary` 作为次级文本。
- `metadata.preview` 放到可展开详情里。
- 工具输入和输出默认不展示完整内容。

## 流式策略

### 做流式

只对最终回答做流式：

```text
chat:delta
```

### 不做流式

中间过程不做 token 级流式：

```text
agent:event
tool:started
tool:completed
rag:retrieved
ai:prompt_built
```

原因：

- 中间过程是状态事件，不是自然语言正文。
- 离散事件更利于折叠、去重、排序和失败定位。
- 后端不需要维护多路 token 流。
- 前端不会因为工具日志过长导致渲染抖动。

如果某个工具耗时较长，可以增加低频进度事件：

```text
tool:progress
```

第一版先不加，避免事件类型过多。

## 兼容性

- 老前端收到未知 `agent:event` 时不会影响 `chat:*` 主流程。
- 新前端仍以 `chat:accepted` 创建 assistant message。
- 现有 `chat:delta`、`chat:done` 语义不变。
- `chat:error` 仍作为请求失败的终态事件。
- Agent Trace 是 assistant message 的附属状态，不替代最终回答。

## 落地步骤

### 第一步：协议和前端静态结构

- 增加 `AgentTraceEvent` 类型。
- 增加 message trace 字段。
- 增加 store 更新方法。
- 增加 `AgentTracePanel` 静态展示。

### 第二步：后端 agent:event 发射

- 新增 `agentRunContext`。
- `chatSocket` 在 `chat:accepted` 后发送 `agent:started`。
- `chatSocket` 在完成时发送 `agent:completed`。
- 失败时发送 `agent:failed`。

### 第三步：接入工具和 RAG 事件

- 包装 RAG 检索，发送 `rag:retrieved`。
- 包装 MCP 工具，发送 `tool:*`。
- 包装提示词构建，发送 `ai:prompt_built`。

### 第四步：工作流事件接入

- `workflowRunner` 发送 `step:*`。
- `incidentFixAiClient` 发送 `ai:output_parsed`。
- `workflow:waiting_review` 显示等待人工确认。

### 第五步：持久化和历史回放

- 需要跨刷新恢复时，再新增 `agent_run_events`。
- 历史消息接口返回 `traceEvents` 或 trace 摘要。

## 验收标准

- 普通聊天不触发工具时，仍正常显示流式回答。
- 后端发送 `agent:event` 时，前端能挂到当前 assistant message 下。
- Agent 运行中 trace 默认展开。
- 收到 `agent:completed` 后 trace 默认折叠。
- 收到失败或等待人工确认事件后 trace 默认展开。
- 中间过程不通过 `chat:delta` 输出。
- 旧 `chat:*` 协议兼容，不影响现有会话和消息 CRUD。
