# DeepSeek React Chat

React + TypeScript 版聊天应用，当前已迁移聊天主流程，并接入项目内 Node.js WebSocket 后端。

## 当前能力

- React + TypeScript + Vite 前端。
- Less + CSS Modules 样式隔离。
- 多会话聊天，当前会话数据暂存 `localStorage`。
- `/ws/chat` WebSocket 流式聊天，后端转发 DeepSeek SSE 流。
- `/ws/asr` WebSocket 流式语音识别，前端只转发音频，后端调用豆包 ASR。
- 前端使用 `AudioWorklet` 采集麦克风音频，转为 16kHz、16bit、mono PCM，约 200ms 一包发送给后端。
- 语音识别结果以全量文本返回，前端直接覆盖输入框，不自动发送消息。

## 项目结构

```text
server/
  index.js                         # HTTP 静态服务和 WebSocket 路由装配
  src/chatSocket.js                # /ws/chat 消息协议
  src/deepseekClient.js            # DeepSeek 流式聊天适配
  src/asrSocket.js                 # /ws/asr 消息协议
  src/asr/doubaoAsrClient.js       # 豆包 ASR WebSocket 客户端
  src/asr/doubaoBinaryProtocol.js  # 豆包二进制帧封装和解析

src/
  audio/pcmRecorder.ts             # 麦克风授权、AudioWorklet 节点装配
  hooks/useWebSocketChat.ts        # 前端聊天 WebSocket hook
  hooks/useAsrSocket.ts            # 前端语音识别 WebSocket hook
  components/VoiceButton.tsx       # 语音输入入口
  store/                           # 会话状态和 localStorage 持久化

public/
  pcm-recorder-worklet.js          # AudioWorkletProcessor，负责重采样和 PCM 切包
```

## 环境变量

复制 `.env.example` 为 `.env` 后填写：

```env
DEEPSEEK_API_KEY=
PORT=3000
VITE_DEEPSEEK_WS_URL=ws://localhost:3000/ws/chat
VITE_ASR_WS_URL=ws://localhost:3000/ws/asr

DOUBAO_ASR_APP_KEY=
DOUBAO_ASR_ACCESS_KEY=
DOUBAO_ASR_RESOURCE_ID=volc.bigasr.sauc.duration
DOUBAO_ASR_WS_URL=wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async
```

说明：

- `DOUBAO_ASR_APP_KEY` / `DOUBAO_ASR_ACCESS_KEY` 对应豆包文档里的旧控制台鉴权头。
- 当前已验证可用的资源 ID 是 `volc.bigasr.sauc.duration`。
- `.env` 已被忽略，不要把真实密钥提交到仓库。

## 本地运行

安装依赖：

```bash
npm install
```

启动后端：

```bash
npm run server:dev
```

启动前端：

```bash
npm run dev
```

默认地址：

- 前端：`http://localhost:5173`
- 后端：`http://localhost:3000`
- 聊天 WebSocket：`ws://localhost:3000/ws/chat`
- 语音 WebSocket：`ws://localhost:3000/ws/asr`

## 前后端协议

聊天：

- 前端发送 `chat:start`
- 后端返回 `chat:accepted`、`chat:delta`、`chat:done`
- 取消时发送 `chat:cancel`

语音识别：

- 前端发送 `asr:start`
- 前端随后发送二进制 PCM 音频包
- 前端发送 `asr:end` 结束本轮识别
- 后端返回 `asr:ready`、`asr:partial`、`asr:final`、`asr:ended`
- `asr:partial` 和 `asr:final` 都返回当前完整识别文本，前端直接覆盖输入框

## 校验命令

```bash
npm run lint
npm run build
```

提交前 Husky 会自动执行以上两条命令。

## 已知边界

- 语音识别当前主要面向中文输入，前端只做提示，不主动设置语言字段。
- 浏览器需要麦克风权限；未授权时会进入语音错误状态。
- 聊天历史仍存在 `localStorage`，后续可迁移到后端数据库。
- Markdown 渲染当前在前端完成，后续可补 sanitizer 和渲染缓存。
