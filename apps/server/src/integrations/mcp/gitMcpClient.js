import { createWorkspacePathResolver } from './workspacePath.js'
import { runCommand, truncateText } from './localCommand.js'

const DEFAULT_COMMAND_TIMEOUT_MS = 60_000
const MAX_PATCH_CHARACTERS = 200_000
const MAX_VERIFICATION_COMMANDS = 8
const VERIFICATION_COMMAND_ALLOWLIST = new Set(['node', 'npm', 'pnpm'])

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName} 不能为空`)
  }
  return value.trim()
}

function parseCommandLine(commandLine) {
  const input = assertNonEmptyString(commandLine, 'command')
  const tokens = []
  let current = ''
  let quote = null
  let escaping = false

  for (const char of input) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }

    if (char === '\\' && quote === '"') {
      escaping = true
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (quote) throw new Error('验证命令引号未闭合')
  if (escaping) current += '\\'
  if (current) tokens.push(current)

  return tokens
}

function normalizeCommandName(command) {
  return command.toLowerCase().replace(/\.(cmd|exe)$/u, '')
}

function assertVerificationCommandAllowed(command) {
  const commandName = normalizeCommandName(command)
  if (!VERIFICATION_COMMAND_ALLOWLIST.has(commandName)) {
    throw new Error(`验证命令不在允许列表中：${command}`)
  }
}

function extractPatchPaths(patch) {
  return patch
    .split(/\r?\n/)
    .filter((line) => line.startsWith('--- ') || line.startsWith('+++ '))
    .map((line) => line.slice(4).trim().split('\t')[0])
    .filter((path) => path && path !== '/dev/null')
    .map((path) => path.replace(/^[ab]\//u, ''))
}

export function createGitMcpClient({
  baseBranch = 'main',
  remoteName = 'origin',
  rootDir,
} = {}) {
  const paths = createWorkspacePathResolver(rootDir)

  async function runGit(args, options = {}) {
    return runCommand({
      args,
      command: 'git',
      cwd: paths.rootDir,
      maxOutputCharacters: 40_000,
      timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
      ...options,
    })
  }

  async function assertCleanWorktree() {
    const result = await runGit(['status', '--porcelain'])
    if (result.stdout.trim()) {
      throw new Error('工作区存在未提交变更，拒绝自动切换分支')
    }
  }

  async function assertBranchName(branchName) {
    const safeBranchName = assertNonEmptyString(branchName, 'branchName')
    await runGit(['check-ref-format', '--branch', safeBranchName])
    return safeBranchName
  }

  function assertPatch(patch) {
    const safePatch = assertNonEmptyString(patch, 'patch')
    if (safePatch.length > MAX_PATCH_CHARACTERS) {
      throw new Error('patch 过大，拒绝自动应用')
    }

    for (const patchPath of extractPatchPaths(safePatch)) {
      paths.resolvePath(patchPath, 'patch path')
    }

    return safePatch
  }

  return {
    async applyPatch(options = {}) {
      const patch = assertPatch(options.patch)

      await runGit(['apply', '--check', '--whitespace=nowarn'], {
        input: patch,
      })
      await runGit(['apply', '--whitespace=nowarn'], {
        input: patch,
      })

      return {
        applied: true,
        reason: options.reason,
      }
    },
    async commitChanges(options = {}) {
      const message = assertNonEmptyString(options.message, 'message')

      await runGit(['add', '--all'])
      const status = await runGit(['status', '--porcelain'])
      if (!status.stdout.trim()) {
        throw new Error('没有可提交的变更')
      }

      const result = await runGit(['commit', '-m', message])

      return {
        committed: true,
        output: truncateText(`${result.stdout}${result.stderr}`, 20_000),
      }
    },
    async createBranch(options = {}) {
      const branchName = await assertBranchName(options.branchName)
      const safeBaseBranch = assertNonEmptyString(
        options.baseBranch ?? baseBranch,
        'baseBranch',
      )

      await assertCleanWorktree()
      await runGit(['switch', '-c', branchName, safeBaseBranch])

      return {
        baseBranch: safeBaseBranch,
        branchName,
      }
    },
    async createPullRequest(options = {}) {
      const branchName = await assertBranchName(options.branchName)
      const title = assertNonEmptyString(options.title, 'title')
      const body = assertNonEmptyString(options.body, 'body')
      const targetBaseBranch = assertNonEmptyString(
        options.baseBranch ?? baseBranch,
        'baseBranch',
      )
      const result = await runCommand({
        args: [
          'pr',
          'create',
          '--base',
          targetBaseBranch,
          '--head',
          branchName,
          '--title',
          title,
          '--body',
          body,
          '--json',
          'number,title,url',
        ],
        command: 'gh',
        cwd: paths.rootDir,
        maxOutputCharacters: 20_000,
        timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
      })

      return JSON.parse(result.stdout)
    },
    async pushBranch(options = {}) {
      const branchName = await assertBranchName(options.branchName)
      const result = await runGit(['push', '-u', remoteName, branchName])

      return {
        branchName,
        output: truncateText(`${result.stdout}${result.stderr}`, 20_000),
      }
    },
    async runVerificationPlan(options = {}) {
      const commands = Array.isArray(options.commands) ? options.commands : []
      if (commands.length > MAX_VERIFICATION_COMMANDS) {
        throw new Error('验证命令数量过多')
      }

      const results = []
      for (const commandLine of commands) {
        const [command, ...args] = parseCommandLine(commandLine)
        assertVerificationCommandAllowed(command)

        try {
          const result = await runCommand({
            args,
            command: normalizeCommandName(command),
            cwd: paths.rootDir,
            maxOutputCharacters: 30_000,
            timeoutMs: options.timeoutMs ?? 120_000,
          })
          results.push({
            command: commandLine,
            passed: true,
            stderr: result.stderr,
            stdout: result.stdout,
          })
        } catch (error) {
          results.push({
            command: commandLine,
            errorMessage: error instanceof Error ? error.message : '验证失败',
            passed: false,
            stderr: error.stderr,
            stdout: error.stdout,
          })
          break
        }
      }

      return {
        passed: results.every((result) => result.passed),
        results,
      }
    },
  }
}
