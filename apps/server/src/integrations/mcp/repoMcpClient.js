import { readFile as readFileFromDisk, stat } from 'node:fs/promises'
import { createWorkspacePathResolver } from './workspacePath.js'
import { runCommand, truncateText } from './localCommand.js'

const DEFAULT_MAX_RESULTS = 80
const MAX_FILE_CHARACTERS = 60_000
const MAX_OUTPUT_CHARACTERS = 30_000

function clampNumber(value, { defaultValue, max, min }) {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return defaultValue
  return Math.min(max, Math.max(min, Math.trunc(numberValue)))
}

function splitLines(output, maxResults) {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, maxResults)
}

function assertSearchQuery(query, fieldName) {
  if (typeof query !== 'string' || !query.trim()) {
    throw new Error(`${fieldName} 不能为空`)
  }
  return query.trim()
}

function normalizeGlob(glob) {
  if (glob === undefined || glob === null || glob === '') return null
  if (typeof glob !== 'string') throw new Error('glob 必须是字符串')
  return glob
}

export function createRepoMcpClient({ rootDir } = {}) {
  const paths = createWorkspacePathResolver(rootDir)

  async function runGit(args, options = {}) {
    return runCommand({
      args,
      command: 'git',
      cwd: paths.rootDir,
      maxOutputCharacters: MAX_OUTPUT_CHARACTERS,
      ...options,
    })
  }

  async function search(options = {}) {
    const query = assertSearchQuery(options.query, 'query')
    const maxResults = clampNumber(options.maxResults, {
      defaultValue: DEFAULT_MAX_RESULTS,
      max: 200,
      min: 1,
    })
    const targetPath = paths.toRelativePath(options.path ?? '.')
    const args = [
      '--line-number',
      '--column',
      '--no-heading',
      '--color',
      'never',
    ]
    const glob = normalizeGlob(options.glob)

    if (options.fixedStrings !== false) args.push('--fixed-strings')
    if (glob) args.push('-g', glob)
    args.push(query, targetPath)

    const result = await runCommand({
      allowedExitCodes: [0, 1],
      args,
      command: 'rg',
      cwd: paths.rootDir,
      maxOutputCharacters: MAX_OUTPUT_CHARACTERS,
    })

    return {
      matches: splitLines(result.stdout, maxResults),
      path: targetPath,
      query,
    }
  }

  return {
    async findReferences(options = {}) {
      const symbol = assertSearchQuery(options.symbol, 'symbol')
      return search({
        fixedStrings: true,
        glob: options.glob,
        maxResults: options.maxResults,
        path: options.path,
        query: symbol,
      })
    },
    async gitDiff(options = {}) {
      const args = ['diff', '--']
      if (options.path) args.push(paths.toRelativePath(options.path))
      const result = await runGit(args)

      return {
        diff: truncateText(result.stdout, MAX_OUTPUT_CHARACTERS),
      }
    },
    async gitLog(options = {}) {
      const maxCount = clampNumber(options.maxCount, {
        defaultValue: 10,
        max: 50,
        min: 1,
      })
      const result = await runGit([
        'log',
        `--max-count=${maxCount}`,
        '--date=iso',
        '--pretty=format:%h %ad %s',
      ])

      return {
        commits: splitLines(result.stdout, maxCount),
      }
    },
    async listFiles(options = {}) {
      const maxResults = clampNumber(options.maxResults, {
        defaultValue: DEFAULT_MAX_RESULTS,
        max: 500,
        min: 1,
      })
      const args = ['--files']
      const glob = normalizeGlob(options.glob)

      if (glob) args.push('-g', glob)

      const result = await runCommand({
        allowedExitCodes: [0, 1],
        args,
        command: 'rg',
        cwd: paths.rootDir,
        maxOutputCharacters: MAX_OUTPUT_CHARACTERS,
      })

      return {
        files: splitLines(result.stdout, maxResults),
      }
    },
    async readFile(options = {}) {
      const filePath = paths.resolvePath(options.path, 'path')
      const fileStat = await stat(filePath)
      if (!fileStat.isFile()) throw new Error('path 必须指向文件')

      const content = await readFileFromDisk(filePath, 'utf8')
      const lines = content.split(/\r?\n/)
      const startLine = clampNumber(options.startLine, {
        defaultValue: 1,
        max: lines.length,
        min: 1,
      })
      const endLine = clampNumber(options.endLine, {
        defaultValue: lines.length,
        max: lines.length,
        min: startLine,
      })
      const selectedContent = lines.slice(startLine - 1, endLine).join('\n')
      const maxCharacters = clampNumber(options.maxCharacters, {
        defaultValue: MAX_FILE_CHARACTERS,
        max: MAX_FILE_CHARACTERS,
        min: 1,
      })

      return {
        content: truncateText(selectedContent, maxCharacters),
        endLine,
        path: paths.toRelativePath(options.path),
        startLine,
      }
    },
    search,
  }
}
