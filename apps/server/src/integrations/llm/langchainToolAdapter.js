import { tool } from '@langchain/core/tools'

const stringSchema = { type: 'string' }
const optionalStringSchema = { type: 'string' }

function objectSchema({ properties, required = [] }) {
  return {
    additionalProperties: false,
    properties,
    required,
    type: 'object',
  }
}

function stringifyToolResult(result) {
  return typeof result === 'string' ? result : JSON.stringify(result, null, 2)
}

function createJsonTool({ description, invoke, name, schema }) {
  return tool(
    async (input) => stringifyToolResult(await invoke(input ?? {})),
    {
      description,
      name,
      schema,
    },
  )
}

function createRepoTools(repo) {
  if (!repo) return []

  return [
    createJsonTool({
      description: '在代码仓库中搜索文本，默认按固定字符串匹配。',
      invoke: (input) => repo.search(input),
      name: 'repo_search',
      schema: objectSchema({
        properties: {
          fixedStrings: { type: 'boolean' },
          glob: optionalStringSchema,
          maxResults: { type: 'integer' },
          path: optionalStringSchema,
          query: stringSchema,
        },
        required: ['query'],
      }),
    }),
    createJsonTool({
      description: '读取仓库中的指定文件，可限制起止行。',
      invoke: (input) => repo.readFile(input),
      name: 'repo_read_file',
      schema: objectSchema({
        properties: {
          endLine: { type: 'integer' },
          maxCharacters: { type: 'integer' },
          path: stringSchema,
          startLine: { type: 'integer' },
        },
        required: ['path'],
      }),
    }),
    createJsonTool({
      description: '列出仓库文件，可传 glob 过滤。',
      invoke: (input) => repo.listFiles(input),
      name: 'repo_list_files',
      schema: objectSchema({
        properties: {
          glob: optionalStringSchema,
          maxResults: { type: 'integer' },
        },
      }),
    }),
    createJsonTool({
      description: '查找符号或文本引用。',
      invoke: (input) => repo.findReferences(input),
      name: 'repo_find_references',
      schema: objectSchema({
        properties: {
          glob: optionalStringSchema,
          maxResults: { type: 'integer' },
          path: optionalStringSchema,
          symbol: stringSchema,
        },
        required: ['symbol'],
      }),
    }),
    createJsonTool({
      description: '查看当前工作区的 git diff。',
      invoke: (input) => repo.gitDiff(input),
      name: 'repo_git_diff',
      schema: objectSchema({
        properties: {
          path: optionalStringSchema,
        },
      }),
    }),
    createJsonTool({
      description: '查看近期 git 提交记录。',
      invoke: (input) => repo.gitLog(input),
      name: 'repo_git_log',
      schema: objectSchema({
        properties: {
          maxCount: { type: 'integer' },
        },
      }),
    }),
  ]
}

function createWriteTools(git) {
  if (!git?.applyPatch) return []

  return [
    createJsonTool({
      description: '受控应用 unified diff patch。调用前必须确认 patch 只包含必要修改。',
      invoke: (input) => git.applyPatch(input),
      name: 'git_apply_patch',
      schema: objectSchema({
        properties: {
          patch: stringSchema,
          reason: optionalStringSchema,
        },
        required: ['patch'],
      }),
    }),
  ]
}

export function createWorkflowLangChainTools({
  git,
  includeWriteTools = false,
  repo,
} = {}) {
  return [
    ...createRepoTools(repo),
    ...(includeWriteTools ? createWriteTools(git) : []),
  ]
}
