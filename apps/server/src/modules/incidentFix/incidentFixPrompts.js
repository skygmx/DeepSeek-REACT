import { ChatPromptTemplate } from '@langchain/core/prompts'

export const INCIDENT_FIX_DIAGNOSE_PROMPT_VERSION =
  'incident-fix-diagnose-v1'
export const INCIDENT_FIX_APPLY_PROMPT_VERSION = 'incident-fix-apply-v1'

const diagnoseOutputSchema = {
  confidence: 'number, 0 到 1',
  owner: 'string, 可选，建议负责人',
  status: 'ready_to_patch 或 needs_human',
  summary: 'string, 简短说明根因和修复方向',
  suspectFiles: 'string[], 可能相关的仓库文件',
  verificationCommands: 'string[], 建议执行的验证命令',
}

const applyOutputSchema = {
  changedFiles: 'string[], 实际修改或计划修改的文件',
  commitMessage: 'string, Git commit message',
  patch: 'string, unified diff，可选；如通过工具完成修改可不返回',
  prBody: 'string, PR 描述',
  prTitle: 'string, PR 标题',
}

const diagnosePromptTemplate = ChatPromptTemplate.fromMessages([
  [
    'system',
    [
      '你是线上事故修复工作流中的诊断节点。',
      '你的任务是根据报错上下文判断可能根因，给出最小可行修复计划。',
      '不要修改文件；不要提交代码；不能确定时将 status 设为 needs_human。',
      '只输出一个 JSON 对象，不要输出 Markdown。',
    ].join('\n'),
  ],
  [
    'human',
    [
      '事故上下文：',
      '{incidentContext}',
      '',
      '可用工具：',
      '{availableTools}',
      '',
      '输出字段约束：',
      '{outputSchema}',
    ].join('\n'),
  ],
])

const applyPromptTemplate = ChatPromptTemplate.fromMessages([
  [
    'system',
    [
      '你是线上事故修复工作流中的修复节点。',
      '你的任务是在当前修复分支上给出最小变更，优先修复根因，避免无关重构。',
      '如需要修改文件，输出 unified diff patch；不要输出解释性 Markdown。',
      '只输出一个 JSON 对象。',
    ].join('\n'),
  ],
  [
    'human',
    [
      '当前分支：{branchName}',
      '',
      '诊断计划：',
      '{plan}',
      '',
      '事故上下文：',
      '{incidentContext}',
      '',
      '可用工具：',
      '{availableTools}',
      '',
      '输出字段约束：',
      '{outputSchema}',
    ].join('\n'),
  ],
])

function stringifyForPrompt(value) {
  return JSON.stringify(value ?? null, null, 2)
}

function contentToText(content) {
  return typeof content === 'string' ? content : stringifyForPrompt(content)
}

function messageTypeToRole(messageType) {
  if (messageType === 'human') return 'user'
  if (messageType === 'ai') return 'assistant'
  return messageType
}

function toPlainMessages(messages) {
  return messages.map((message) => ({
    content: contentToText(message.content),
    role: messageTypeToRole(message._getType?.() ?? 'user'),
  }))
}

export function describeLangChainTools(tools = []) {
  if (!tools.length) return '无'

  return tools
    .map((tool) =>
      stringifyForPrompt({
        description: tool.description,
        name: tool.name,
        schema: tool.schema,
      }),
    )
    .join('\n')
}

export async function buildDiagnoseAndPlanPrompt({ context, tools = [] }) {
  const messages = await diagnosePromptTemplate.formatMessages({
    availableTools: describeLangChainTools(tools),
    incidentContext: stringifyForPrompt(context),
    outputSchema: stringifyForPrompt(diagnoseOutputSchema),
  })

  return {
    messages,
    plainMessages: toPlainMessages(messages),
    promptVersion: INCIDENT_FIX_DIAGNOSE_PROMPT_VERSION,
  }
}

export async function buildApplyFixPrompt({
  branchName,
  incidentContext,
  plan,
  tools = [],
}) {
  const messages = await applyPromptTemplate.formatMessages({
    availableTools: describeLangChainTools(tools),
    branchName,
    incidentContext: stringifyForPrompt(incidentContext),
    outputSchema: stringifyForPrompt(applyOutputSchema),
    plan: stringifyForPrompt(plan),
  })

  return {
    messages,
    plainMessages: toPlainMessages(messages),
    promptVersion: INCIDENT_FIX_APPLY_PROMPT_VERSION,
  }
}
