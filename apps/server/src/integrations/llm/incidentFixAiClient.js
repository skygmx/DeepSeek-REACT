import {
  buildApplyFixPrompt,
  buildDiagnoseAndPlanPrompt,
} from '../../modules/incidentFix/incidentFixPrompts.js'
import { createWorkflowLangChainTools } from './langchainToolAdapter.js'

function getToolNames(tools) {
  return tools.map((tool) => tool.name)
}

function createMissingModelError(stepName, prompt, tools) {
  const error = new Error(`事故修复 AI 模型未接入：${stepName}`)
  error.promptMessages = prompt.plainMessages
  error.promptVersion = prompt.promptVersion
  error.toolNames = getToolNames(tools)
  return error
}

function getResponseContent(response) {
  if (typeof response === 'string') return response
  const content = response?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .map((item) => {
      if (typeof item === 'string') return item
      if (typeof item?.text === 'string') return item.text
      return ''
    })
    .join('')
}

function parseJsonContent(content) {
  const trimmedContent = content.trim()
  const fencedJson = trimmedContent.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/u)
  return JSON.parse((fencedJson?.[1] ?? trimmedContent).trim())
}

async function invokeJsonModel({ chatModel, prompt, stepName, tools }) {
  if (!chatModel?.invoke) {
    throw createMissingModelError(stepName, prompt, tools)
  }

  const model =
    tools.length && typeof chatModel.bindTools === 'function'
      ? chatModel.bindTools(tools)
      : chatModel
  const response = await model.invoke(prompt.messages)

  if (response?.tool_calls?.length) {
    throw new Error('事故修复 AI 工具调用循环尚未接入')
  }

  return parseJsonContent(getResponseContent(response))
}

function removePatchFromResult(result) {
  const { patch, ...safeResult } = result
  return safeResult
}

export function createIncidentFixAiClient({ chatModel, tools = {} } = {}) {
  function createTools({ git, includeWriteTools, repo }) {
    return createWorkflowLangChainTools({
      git: git ?? tools.git,
      includeWriteTools,
      repo: repo ?? tools.repo,
    })
  }

  return {
    async applyFix(options = {}) {
      const langChainTools = createTools({
        git: options.git,
        includeWriteTools: true,
        repo: options.repo,
      })
      const prompt = await buildApplyFixPrompt({
        branchName: options.branchName,
        incidentContext: options.incidentContext,
        plan: options.plan,
        tools: langChainTools,
      })
      const result = await invokeJsonModel({
        chatModel,
        prompt,
        stepName: 'applyFix',
        tools: langChainTools,
      })
      const patch = typeof result.patch === 'string' ? result.patch.trim() : ''
      const git = options.git ?? tools.git
      if (patch && !git?.applyPatch) {
        throw new Error('事故修复 applyPatch 工具未接入')
      }
      const applyPatchResult = patch
        ? await git.applyPatch({
            patch,
            reason: result.summary ?? options.plan?.summary,
          })
        : undefined

      return {
        ...removePatchFromResult(result),
        applyPatchResult,
        promptVersion: prompt.promptVersion,
      }
    },
    async diagnoseAndPlan(options = {}) {
      const langChainTools = createTools({
        includeWriteTools: false,
        repo: options.repo,
      })
      const prompt = await buildDiagnoseAndPlanPrompt({
        context: options.context,
        tools: langChainTools,
      })
      const result = await invokeJsonModel({
        chatModel,
        prompt,
        stepName: 'diagnoseAndPlan',
        tools: langChainTools,
      })

      return {
        ...result,
        promptVersion: prompt.promptVersion,
      }
    },
  }
}
